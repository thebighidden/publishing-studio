<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

class HiggsfieldProvider implements MediaProvider
{
    public function __construct(private readonly HiggsfieldClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $spec = config('ai.providers.higgsfield.models.'.$model['model']);
        $body = ['prompt' => $generation->prompt]
            + collect($generation->params ?? [])->only($spec['params'] ?? [])->filter(fn ($v) => $v !== null && $v !== '')->all();

        $image = $inputs->firstWhere('kind', 'image');
        if (! empty($spec['requires_image']) && ! $image) {
            throw new GenerationFailed("{$spec['label']} starts from an image. Pick one first.");
        }
        if ($image && ! empty($spec['image_field'])) {
            $body[$spec['image_field']] = $this->client->upload(Storage::disk('local')->get($image->path), $image->mime);
        }

        $request = $this->client->submit($spec['route'], $body, "flowai-generation-{$generation->id}");

        return ['external_id' => $request['request_id'], 'status_url' => $request['status_url']];
    }

    public function poll(Generation $generation): array
    {
        $status = $this->client->status($generation->status_url);

        return match ($status['status'] ?? null) {
            'queued' => ['status' => 'queued'],
            'in_progress' => ['status' => 'running'],
            'completed' => ['status' => 'succeeded', 'outputs' => [
                ...collect($status['images'] ?? [])->map(fn ($i) => ['url' => $i['url'], 'mime' => 'image/png'])->all(),
                ...(isset($status['video']['url']) ? [['url' => $status['video']['url'], 'mime' => 'video/mp4']] : []),
            ]],
            'nsfw' => ['status' => 'failed', 'error' => 'Higgsfield flagged the result as unsafe and withheld it. Edit the prompt and try again.'],
            'canceled' => ['status' => 'failed', 'error' => 'The request was canceled.'],
            default => ['status' => 'failed', 'error' => $status['error'] ?? 'Higgsfield couldn’t make this one.'],
        };
    }
}
