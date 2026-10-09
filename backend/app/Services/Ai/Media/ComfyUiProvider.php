<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;

/**
 * Images from a workflow on your own GPU. The workflow file stays as ComfyUI exported it; only
 * the inputs named in config/ai.php (prompt, seed, size) are filled in per generation.
 */
class ComfyUiProvider implements MediaProvider
{
    /** Sizes divisible by 16, which latent models need. */
    private const SIZES = ['1:1' => [1024, 1024], '4:5' => [1024, 1280], '9:16' => [768, 1344], '16:9' => [1344, 768],
        '3:4' => [960, 1280], '4:3' => [1280, 960], '2:3' => [832, 1248], '3:2' => [1248, 832]];

    public function __construct(private readonly ComfyUiClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $workflow = config('ai.providers.comfyui.workflows.'.$model['model']);
        if (! $workflow) {
            throw new GenerationFailed('That ComfyUI workflow isn’t set up.');
        }
        if ($inputs->isNotEmpty()) {
            throw new GenerationFailed("{$workflow['label']} makes images from text only. Remove the input image, or pick a model that takes one.");
        }

        $params = $generation->params ?? [];
        [$width, $height] = self::SIZES[$params['aspect_ratio'] ?? '1:1'] ?? self::SIZES['1:1'];
        $graph = $this->graph($workflow, [
            'prompt' => $generation->prompt,
            'seed' => isset($params['seed']) ? (int) $params['seed'] : random_int(0, 2 ** 32 - 1),
            'width' => $width,
            'height' => $height,
        ]);

        $promptId = $this->client->queue($graph);

        return ['external_id' => $promptId, 'status_url' => $promptId];
    }

    public function poll(Generation $generation): array
    {
        $entry = $this->client->history($generation->status_url);
        if ($entry === null) {
            return ['status' => 'running'];
        }
        if (($entry['status']['status_str'] ?? null) === 'error') {
            return ['status' => 'failed', 'error' => 'ComfyUI failed: '.$this->executionError($entry)];
        }

        $workflow = config('ai.providers.comfyui.workflows.'.str($generation->model)->after('/'));
        $files = collect($entry['outputs'][$workflow['output'] ?? ''] ?? [])->flatten(1)
            ->filter(fn ($f) => is_array($f) && isset($f['filename']))->values();

        return $files->isEmpty()
            ? ['status' => 'failed', 'error' => 'ComfyUI finished without an output image.']
            : ['status' => 'succeeded', 'outputs' => $files->map(fn ($f) => ['url' => $this->client->fileUrl($f), 'mime' => 'image/png'])->all()];
    }

    /**
     * @param  array<string, mixed>  $workflow
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public function graph(array $workflow, array $values): array
    {
        $graph = json_decode((string) file_get_contents(resource_path('comfyui/'.$workflow['file'])), true);
        foreach ($values as $key => $value) {
            if (isset($workflow[$key])) {
                [$node, $field] = $workflow[$key];
                $graph[$node]['inputs'][$field] = $value;
            }
        }

        return $graph;
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function executionError(array $entry): string
    {
        foreach ($entry['status']['messages'] ?? [] as [$kind, $data]) {
            if ($kind === 'execution_error') {
                return "node {$data['node_id']} ({$data['node_type']}): ".trim((string) ($data['exception_message'] ?? ''));
            }
        }

        return 'execution error';
    }
}
