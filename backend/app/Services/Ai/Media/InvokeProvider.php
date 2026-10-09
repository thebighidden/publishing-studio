<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Images from InvokeAI: a graph per request, queued on the server (one run per variation),
 * then polled. Edits upload the image and the painted mask first.
 */
class InvokeProvider implements MediaProvider
{
    public function __construct(private readonly InvokeClient $client, private readonly InvokeGraphs $graphs) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        if ($model['model'] === InvokeGraphs::UPSCALER) {
            return $this->upscale($generation, $inputs);
        }
        $config = $this->client->model($model['model']) ?? throw new GenerationFailed("{$model['label']} isn’t installed on InvokeAI any more.");
        if (! InvokeGraphs::supports($config['base'] ?? null)) {
            throw new GenerationFailed("FlowAI can’t drive {$config['base']} models on InvokeAI yet.");
        }

        $params = $generation->params ?? [];
        $defaults = $config['default_settings'] ?? [];
        $steps = (int) ($params['steps'] ?? $defaults['steps'] ?? 9);
        $cfg = (float) ($params['guidance'] ?? $defaults['cfg_scale'] ?? 1);
        $negative = $params['negative_prompt'] ?? null;
        $area = (int) (($defaults['width'] ?? 1024) * ($defaults['height'] ?? 1024));
        $grid = $this->client->grid($config['base']);

        if (in_array($params['mode'] ?? null, ['inpaint', 'outpaint'], true)) {
            [$image, $mask] = [$inputs->get(0), $inputs->get(1)];
            if (! $image || ! $mask) {
                throw new GenerationFailed('An edit needs the image and the painted area.');
            }
            [$width, $height] = $this->size($image);
            $graph = $this->graphs->edit(
                $config, $generation->prompt, $negative,
                $this->client->upload(Storage::disk('local')->get($image->path), "flowai-{$generation->id}-image.png", $image->mime),
                $this->client->upload(Storage::disk('local')->get($mask->path), "flowai-{$generation->id}-mask.png", $mask->mime),
                [$width, $height], InvokeGraphs::fit($width / $height, $area, $grid),
                $steps, $cfg, (float) ($params['strength'] ?? 0.8), $params['mode'] === 'outpaint',
            );
            $runs = 1;
        } else {
            [$w, $h] = array_map('floatval', explode(':', (string) ($params['aspect_ratio'] ?? '1:1')) + [1, 1]);
            [$width, $height] = InvokeGraphs::fit(($w ?: 1) / ($h ?: 1), $area, $grid);
            $graph = $this->graphs->textToImage($config, $generation->prompt, $negative, $width, $height, $steps, $cfg);
            $runs = max(1, min(4, (int) ($params['batch_size'] ?? 1)));
        }

        $first = isset($params['seed']) ? (int) $params['seed'] : random_int(0, 2 ** 31 - 1);
        $ids = $this->client->enqueue($graph, array_map(fn ($i) => ($first + $i) % 2 ** 31, range(0, $runs - 1)),
            "flowai-generation-{$generation->id}-".$generation->created_at?->getTimestamp().'-'.bin2hex(random_bytes(4)));

        // One queue item per variation; external_id is a string column, so they're kept as a list.
        return ['external_id' => implode(',', $ids), 'status_url' => null];
    }

    public function poll(Generation $generation): array
    {
        $items = collect(explode(',', (string) $generation->external_id))->filter()->map(fn ($id) => $this->client->item((int) $id));
        if ($items->contains(fn ($i) => in_array($i['status'], ['pending', 'in_progress'], true))) {
            return ['status' => 'running'];
        }
        $images = $items->pluck('image')->filter()->values();
        if ($images->isEmpty()) {
            $failed = $items->firstWhere('status', 'failed');

            return ['status' => 'failed', 'error' => $failed ? InvokeClient::reason($failed['error']) : 'InvokeAI stopped without making anything.'];
        }

        return ['status' => 'succeeded', 'outputs' => $images->map(fn ($name) => ['url' => $this->client->imageUrl($name), 'mime' => 'image/png'])->all()];
    }

    /**
     * @return array{external_id: string, status_url: null}
     */
    private function upscale(Generation $generation, Collection $inputs): array
    {
        $image = $inputs->firstWhere('kind', 'image') ?? throw new GenerationFailed('Pick the image to upscale.');
        $scale = (int) ($generation->params['scale'] ?? 4) === 2 ? 2 : 4;
        [$width, $height] = $this->size($image);
        if (max($width, $height) * $scale > 8192) {
            throw new GenerationFailed("That would be wider than 8192 pixels. Try 2×, or a smaller image ({$width}×{$height} now).");
        }
        $name = $this->client->upload(Storage::disk('local')->get($image->path), "flowai-{$generation->id}-upscale.png", $image->mime);
        $ids = $this->client->enqueue($this->graphs->upscale($name, $scale), [],
            "flowai-generation-{$generation->id}-".$generation->created_at?->getTimestamp().'-'.bin2hex(random_bytes(4)));

        return ['external_id' => implode(',', $ids), 'status_url' => null];
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function size(Asset $image): array
    {
        if ($image->width && $image->height) {
            return [$image->width, $image->height];
        }
        $measured = @getimagesizefromstring(Storage::disk('local')->get($image->path));

        return $measured ? [$measured[0], $measured[1]] : throw new GenerationFailed('Couldn’t read the image’s size.');
    }
}
