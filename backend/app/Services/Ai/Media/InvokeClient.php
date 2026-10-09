<?php

namespace App\Services\Ai\Media;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * An InvokeAI server: its installed models, image uploads, and its session queue.
 */
class InvokeClient
{
    /**
     * The server's main models (full configs, as Invoke's graphs need them) and how each model
     * family is shaped, cached briefly. A failure is remembered for less long.
     *
     * @return array{version: string|null, models: list<array<string, mixed>>, grids: array<string, int>, error: string|null}
     */
    public function server(): array
    {
        if ($cached = Cache::get('models.invoke')) {
            return $cached;
        }
        try {
            $version = $this->call(fn (PendingRequest $http) => $http->timeout(4)->get($this->url('/api/v1/app/version')))->json('version');
            $models = collect($this->call(fn (PendingRequest $http) => $http->timeout(6)->get($this->url('/api/v2/models/'), ['model_type' => 'main']))->json('models', []))
                ->where('type', 'main')->values()->all();
            $grids = collect($this->call(fn (PendingRequest $http) => $http->timeout(6)->get($this->url('/api/v2/models/capabilities')))->json() ?? [])
                ->filter(fn ($c) => is_array($c) && isset($c['base']))
                ->mapWithKeys(fn (array $c) => [$c['base'] => (int) ($c['features']['dimension_grid'] ?? 8)])->all();
            $state = ['version' => $version, 'models' => $models, 'grids' => $grids, 'error' => null];
            Cache::put('models.invoke', $state, 120);
        } catch (GenerationFailed $e) {
            $state = ['version' => null, 'models' => [], 'grids' => [], 'error' => $e->getMessage()];
            Cache::put('models.invoke', $state, 30);
        }

        return $state;
    }

    /**
     * @return array<string, mixed>|null the model's full config, as Invoke stores it
     */
    public function model(string $key): ?array
    {
        return collect($this->server()['models'])->firstWhere('key', $key);
    }

    public function grid(string $base): int
    {
        return $this->server()['grids'][$base] ?? 16;
    }

    public function test(): string
    {
        Cache::forget('models.invoke');
        $state = $this->server();
        if ($state['error']) {
            throw new GenerationFailed($state['error']);
        }
        $names = collect($state['models'])->pluck('name');

        return "Connected to InvokeAI {$state['version']}. ".($names->isEmpty()
            ? 'No image models are installed yet.'
            : $names->count().' '.str('model')->plural($names->count()).': '.$names->take(4)->implode(', ').'.');
    }

    /**
     * Put an image on the server for a graph to read. Intermediate, so it stays out of Invoke's gallery.
     *
     * @return string the image's name on the server
     */
    public function upload(string $contents, string $filename, string $mime = 'image/png'): string
    {
        $r = $this->call(fn (PendingRequest $http) => $http->timeout(60)
            ->attach('file', $contents, $filename, ['Content-Type' => $mime])
            ->post($this->url('/api/v1/images/upload').'?'.http_build_query(['image_category' => 'general', 'is_intermediate' => 'true'])));

        return (string) ($r->json('image_name') ?: throw new GenerationFailed('InvokeAI didn’t keep the uploaded image.'));
    }

    /**
     * @param  array<string, mixed>  $graph
     * @param  list<int>  $seeds  one run per seed; none for graphs without a seed (upscaling)
     * @return list<int> the queue item ids
     */
    public function enqueue(array $graph, array $seeds, string $key): array
    {
        $batch = [
            'graph' => $graph,
            'runs' => 1,
            'origin' => 'flowai',
            'destination' => 'flowai',
            'idempotency_key' => $key,
        ] + ($seeds ? ['data' => [[['node_path' => 'denoise_latents', 'field_name' => 'seed', 'items' => array_values($seeds)]]]] : []);
        $r = $this->call(fn (PendingRequest $http) => $http->timeout(30)->post($this->url('/api/v1/queue/'.$this->queue().'/enqueue_batch'), ['batch' => $batch, 'prepend' => false]));
        $ids = array_map('intval', $r->json('item_ids', []));

        return $ids ?: throw new GenerationFailed('InvokeAI didn’t queue anything.');
    }

    /**
     * @return array{status: string, image: string|null, error: string|null}
     */
    public function item(int $id): array
    {
        $item = $this->call(fn (PendingRequest $http) => $http->timeout(15)->get($this->url('/api/v1/queue/'.$this->queue()."/i/{$id}")))->json();
        $session = $item['session'] ?? [];
        $image = null;
        foreach ($session['source_prepared_mapping']['canvas_output'] ?? [] as $prepared) {
            $image = $session['results'][$prepared]['image']['image_name'] ?? $image;
        }

        return [
            'status' => (string) ($item['status'] ?? 'pending'),
            'image' => $image,
            'error' => $item['error_message'] ?? $item['error_type'] ?? null,
        ];
    }

    public function imageUrl(string $name): string
    {
        return $this->url('/api/v1/images/i/'.rawurlencode($name).'/full');
    }

    /** A short, readable reason from Invoke's error text: "CUDA error: out of memory" and the like. */
    public static function reason(?string $error): string
    {
        $line = trim(Str::before((string) $error, "\n"));
        if (str_contains(strtolower($line), 'out of memory')) {
            return 'The InvokeAI GPU is out of memory. Something else on that machine is probably holding it; free it and try again.';
        }

        return $line !== '' ? 'InvokeAI couldn’t make it: '.Str::limit($line, 200) : 'InvokeAI couldn’t make this one.';
    }

    /**
     * @param  callable(PendingRequest): Response  $send
     */
    private function call(callable $send): Response
    {
        if (! filled(config('ai.providers.invoke.url'))) {
            throw new GenerationFailed('No InvokeAI server is set up.');
        }
        try {
            $r = $send(Http::acceptJson());
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach InvokeAI at '.config('ai.providers.invoke.url').'.');
        }

        return match (true) {
            $r->successful() => $r,
            in_array($r->status(), [401, 403], true) => throw new GenerationFailed('InvokeAI asked for a login. Turn off multi-user mode, or give FlowAI an account.'),
            $r->status() === 422 => throw new GenerationFailed('InvokeAI refused the request: '.Str::limit((string) ($r->json('detail.0.msg') ?? (is_string($r->json('detail')) ? $r->json('detail') : '')), 160)),
            default => throw new GenerationFailed("InvokeAI answered {$r->status()}."),
        };
    }

    private function queue(): string
    {
        return (string) config('ai.providers.invoke.queue', 'default');
    }

    private function url(string $path): string
    {
        return rtrim((string) config('ai.providers.invoke.url'), '/').$path;
    }
}
