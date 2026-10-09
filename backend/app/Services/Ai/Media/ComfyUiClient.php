<?php

namespace App\Services\Ai\Media;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * A ComfyUI server: queue an exported (API-format) workflow with POST /prompt, read its
 * history until it has finished, then fetch the saved files from /view.
 */
class ComfyUiClient
{
    public function url(): string
    {
        return rtrim((string) config('ai.providers.comfyui.url'), '/');
    }

    private function http(): PendingRequest
    {
        return Http::baseUrl($this->url())->acceptJson()->timeout(30);
    }

    /**
     * @param  array<string, mixed>  $graph
     */
    public function queue(array $graph): string
    {
        $r = $this->call(fn () => $this->http()->post('/prompt', ['prompt' => $graph, 'client_id' => 'flowai']));
        if ($r->status() === 400) {
            throw new GenerationFailed('ComfyUI rejected the workflow: '.$this->rejection($r));
        }
        if (! $r->successful() || ! $r->json('prompt_id')) {
            throw new GenerationFailed("ComfyUI couldn’t take the request ({$r->status()}).");
        }

        return (string) $r->json('prompt_id');
    }

    /**
     * The history entry once the prompt has finished (successfully or not), null while it runs.
     *
     * @return array<string, mixed>|null
     */
    public function history(string $promptId): ?array
    {
        $r = $this->call(fn () => $this->http()->get("/history/{$promptId}"));

        return $r->successful() ? $r->json($promptId) : null;
    }

    /**
     * @param  array{filename: string, subfolder?: string, type?: string}  $file
     */
    public function fileUrl(array $file): string
    {
        return $this->url().'/view?'.http_build_query([
            'filename' => $file['filename'], 'subfolder' => $file['subfolder'] ?? '', 'type' => $file['type'] ?? 'output',
        ]);
    }

    /**
     * Reachable, and the workflows' models installed. Costs nothing.
     */
    public function test(): string
    {
        if (! filled(config('ai.providers.comfyui.url'))) {
            throw new GenerationFailed('No ComfyUI server is set (COMFYUI_URL).');
        }
        try {
            $stats = $this->http()->timeout(8)->get('/system_stats');
        } catch (ConnectionException) {
            throw new GenerationFailed("Couldn’t reach ComfyUI at {$this->url()}. Is it running with --listen?");
        }
        if (! $stats->successful()) {
            throw new GenerationFailed("ComfyUI answered {$stats->status()}.");
        }
        $device = $stats->json('devices.0.name') ?? 'unknown device';
        $version = $stats->json('system.comfyui_version') ?? '?';

        $installed = $this->http()->timeout(8)->get('/object_info/UNETLoader')->json('UNETLoader.input.required.unet_name.0') ?? [];
        $missing = collect(config('ai.providers.comfyui.workflows', []))->pluck('unet')->filter()
            ->reject(fn ($unet) => in_array($unet, (array) $installed, true))->values();
        if ($installed && $missing->isNotEmpty()) {
            throw new GenerationFailed("Reachable (ComfyUI {$version} on {$device}), but {$missing->implode(', ')} isn’t installed in models/diffusion_models.");
        }

        return "Connected. ComfyUI {$version} on {$device}.";
    }

    private function call(callable $send): Response
    {
        try {
            return $send();
        } catch (ConnectionException) {
            throw new GenerationFailed("Couldn’t reach ComfyUI at {$this->url()}. Is it running with --listen?");
        }
    }

    private function rejection(Response $r): string
    {
        $parts = [$r->json('error.message') ?? 'invalid workflow'];
        foreach ((array) $r->json('node_errors', []) as $node => $info) {
            foreach ($info['errors'] ?? [] as $err) {
                $parts[] = "node {$node} ({$info['class_type']}): {$err['message']}";
            }
        }

        return implode('; ', $parts);
    }
}
