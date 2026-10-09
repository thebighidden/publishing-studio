<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * One Higgsfield request per generation, shaped to the model's own schema (config/ai.php):
 * the text or image route, values snapped to what the model accepts, input images uploaded
 * to the field it reads. Sending a field a model doesn't take is a 422, not a guess.
 */
class HiggsfieldProvider implements MediaProvider
{
    public function __construct(private readonly HiggsfieldClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $spec = config('ai.providers.higgsfield.models.'.$model['model']);
        $images = $inputs->where('kind', 'image')->values();
        [$route, $body] = $this->request($spec, $generation->prompt, $generation->params ?? [], $images->count());

        if ($images->isNotEmpty() && filled($spec['image_field'] ?? null)) {
            $urls = $images->take(max(1, (int) ($spec['max_images'] ?? 1)))
                ->map(fn (Asset $image) => $this->client->upload(Storage::disk('local')->get($image->path), $image->mime));
            $body[$spec['image_field']] = ! empty($spec['image_list']) ? $urls->values()->all() : $urls->first();
            // A second image is the last frame, on the video models that take one.
            if ($spec['kind'] === 'video' && filled($spec['end_field'] ?? null) && $images->count() > 1) {
                $body[$spec['end_field']] = $this->client->upload(Storage::disk('local')->get($images[1]->path), $images[1]->mime);
            }
        }

        $request = $this->client->submit($route, $body, $this->idempotencyKey($generation, $route, $body));

        return ['external_id' => $request['request_id'], 'status_url' => $request['status_url']];
    }

    /**
     * Stable for one body so a queue retry of the same job cannot be charged twice, and distinct
     * for anything else. The generation id alone is not enough: ids are reused once a row is
     * deleted, and Higgsfield remembers a key for about a day, so a reused id either earns a 422
     * ("already used with different request parameters") or — worse, silently — hands back the
     * image belonging to the deleted generation.
     *
     * @param  array<string, mixed>  $body
     */
    private function idempotencyKey(Generation $generation, string $route, array $body): string
    {
        $fingerprint = substr(hash('sha256', $route."\n".json_encode($body)), 0, 16);

        return "flowai-generation-{$generation->id}-".($generation->created_at?->getTimestamp() ?? 0)."-{$fingerprint}";
    }

    /**
     * The route and body for a request, before any image is uploaded.
     *
     * @param  array<string, mixed>  $spec
     * @param  array<string, mixed>  $params
     * @return array{0: string, 1: array<string, mixed>}
     */
    public function request(array $spec, string $prompt, array $params, int $imageCount): array
    {
        $fromImage = $imageCount > 0 && filled($spec['image_route'] ?? null);
        $route = $fromImage ? $spec['image_route'] : ($spec['route'] ?? null);
        if ((! empty($spec['requires_image']) && $imageCount === 0) || ! $route) {
            throw new GenerationFailed("{$spec['label']} starts from an image. Pick one first.");
        }

        $allowed = $spec['params'] ?? [];
        $body = ['prompt' => $prompt];
        foreach ($allowed as $key) {
            $value = $params[$key] ?? null;
            if ($value === null || $value === '' || $key === 'audio') {
                continue; // audio is mapped below, per model
            }
            if ($key === 'aspect_ratio') {
                // Image-to-video takes its shape from the start frame; those routes have no aspect_ratio.
                if (! $fromImage) {
                    $body['aspect_ratio'] = self::nearestAspect((string) $value, $spec['aspects'] ?? []);
                }
            } elseif ($key === 'duration') {
                $body['duration'] = self::nearest((int) $value, $spec['durations'] ?? []);
            } elseif ($key === 'resolution') {
                if (in_array($value, $spec['resolutions'] ?? [$value], true)) {
                    $body['resolution'] = $value;
                }
            } elseif ($key === 'seed') {
                $body['seed'] = self::fitSeed((int) $value, $spec['seed_range'] ?? null);
            } else {
                $body[$key] = $value;
            }
        }
        if (in_array('audio', $allowed, true)) {
            $on = filter_var($params['audio'] ?? true, FILTER_VALIDATE_BOOL);
            if (($spec['audio'] ?? null) === 'sound') {
                $body['sound'] = $on ? 'on' : 'off';
            } elseif (($spec['audio'] ?? null) === 'generate_audio') {
                $body['generate_audio'] = $on;
            }
        }
        // Defaults fill what the person didn't choose; they never override a choice.
        $body += $spec['defaults'] ?? [];
        if (isset($body['resolution'], $spec['resolutions']) && ! in_array($body['resolution'], $spec['resolutions'], true)) {
            unset($body['resolution']);
        }

        return [$route, $body];
    }

    public function poll(Generation $generation): array
    {
        $status = $this->client->status($generation->status_url);

        return match ($status['status'] ?? null) {
            'queued' => ['status' => 'queued'],
            'in_progress', 'processing' => ['status' => 'running'],
            // The runner reads the real type of each file; Higgsfield returns JPEG as often as PNG.
            'completed' => ['status' => 'succeeded', 'outputs' => [
                ...collect($status['images'] ?? [])->map(fn ($i) => ['url' => $i['url'], 'mime' => 'image/png'])->all(),
                ...(isset($status['video']['url']) ? [['url' => $status['video']['url'], 'mime' => 'video/mp4']] : []),
                ...collect($status['videos'] ?? [])->map(fn ($v) => ['url' => $v['url'], 'mime' => 'video/mp4'])->all(),
            ]],
            'nsfw' => ['status' => 'failed', 'error' => 'Higgsfield flagged the result as unsafe and withheld it. Edit the prompt and try again.'],
            'canceled' => ['status' => 'failed', 'error' => 'The request was canceled.'],
            default => ['status' => 'failed', 'error' => $status['error'] ?? 'Higgsfield couldn’t make this one.'],
        };
    }

    /**
     * @param  list<string>  $allowed
     */
    public static function nearestAspect(string $aspect, array $allowed): string
    {
        if ($allowed === [] || in_array($aspect, $allowed, true)) {
            return $aspect;
        }
        $ratio = fn (string $a) => (fn ($p) => count($p) === 2 && (float) $p[1] > 0 ? (float) $p[0] / (float) $p[1] : 1.0)(explode(':', $a));
        $want = $ratio($aspect);

        return collect($allowed)->sortBy(fn ($a) => abs($ratio($a) - $want))->first();
    }

    /**
     * @param  list<int>  $allowed
     */
    public static function nearest(int $value, array $allowed): int
    {
        return $allowed === [] ? $value : collect($allowed)->sortBy(fn ($d) => abs($d - $value))->first();
    }

    /**
     * Studio seeds can be large; Higgsfield takes 1..1,000,000. A seed already in range is kept,
     * so reusing a seed reproduces the image.
     *
     * @param  array{0: int, 1: int}|null  $range
     */
    public static function fitSeed(int $seed, ?array $range): int
    {
        if (! $range) {
            return $seed;
        }
        [$lo, $hi] = $range;

        return $seed >= $lo && $seed <= $hi ? $seed : $lo + ($seed % ($hi - $lo + 1));
    }
}
