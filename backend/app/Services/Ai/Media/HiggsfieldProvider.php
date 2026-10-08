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
        $allParams = $generation->params ?? [];
        $params = collect($allParams)->only($spec['params'] ?? [])->filter(fn ($v) => $v !== null && $v !== '')->all();
        $body = array_merge($spec['extra'] ?? [], ['prompt' => $generation->prompt], $params);
        $images = $inputs->where('kind', 'image')->values();

        if (! empty($spec['requires_image']) && $images->isEmpty()) {
            throw new GenerationFailed("{$spec['label']} starts from an image. Pick one first.");
        }
        $uploads = $images->map(fn ($image) => $this->client->upload(Storage::disk('local')->get($image->path), $image->mime))->all();
        if ($uploads && ! empty($spec['image_field'])) {
            $body[$spec['image_field']] = $uploads[0];
        }
        if ($uploads && ! empty($spec['reference_field'])) {
            $body[$spec['reference_field']] = ! empty($spec['reference_list']) ? $uploads : $uploads[0];
        }
        if (count($uploads) > 1 && ! empty($spec['end_frame_field'])) {
            $body[$spec['end_frame_field']] = $uploads[1];
        }
        if (array_key_exists('audio', $allParams) && ! empty($spec['audio_field'])) {
            $audio = filter_var($allParams['audio'], FILTER_VALIDATE_BOOLEAN);
            $body[$spec['audio_field']] = $spec['audio_values'][$audio ? 0 : 1] ?? $audio;
        }

        $route = $uploads && ! empty($spec['i2v_route']) ? $spec['i2v_route'] : $spec['route'];
        if (! $route) {
            throw new GenerationFailed("{$spec['label']} does not have an API route yet.");
        }
        $request = $this->client->submit($route, $body, "flowai-generation-{$generation->id}");

        return ['external_id' => $request['request_id'], 'status_url' => $request['status_url']];
    }

    public function poll(Generation $generation): array
    {
        $status = $this->client->status($generation->status_url);

        return match ($status['status'] ?? null) {
            'queued' => ['status' => 'queued'],
            'in_progress', 'processing' => ['status' => 'running'],
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
}
