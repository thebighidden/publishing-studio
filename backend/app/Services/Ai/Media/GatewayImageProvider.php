<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;

/**
 * Images from an OpenAI-compatible gateway (POST /images/generations). Answers in one go.
 */
class GatewayImageProvider implements MediaProvider
{
    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $ratio = $generation->params['aspect_ratio'] ?? '1:1';
        $size = ['9:16' => '1024x1792', '4:5' => '1024x1280', '16:9' => '1792x1024'][$ratio] ?? '1024x1024';

        try {
            $r = Http::timeout(300)->withToken((string) config('ai.providers.gateway.key'))->acceptJson()
                ->post(rtrim(config('ai.providers.gateway.url'), '/').'/images/generations', [
                    'model' => $model['model'], 'prompt' => $generation->prompt, 'size' => $size, 'n' => 1, 'response_format' => 'b64_json',
                ]);
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach the gateway.');
        }
        if (! $r->successful()) {
            throw new GenerationFailed($r->status() === 429 ? 'The gateway is busy, or the spend cap is reached.' : "The gateway couldn’t make the image ({$r->status()}).");
        }

        return ['outputs' => collect($r->json('data', []))->map(fn ($d) => isset($d['b64_json'])
            ? ['b64' => $d['b64_json'], 'mime' => 'image/png']
            : ['url' => $d['url'], 'mime' => 'image/png'])->all()];
    }

    public function poll(Generation $generation): array
    {
        return ['status' => $generation->status];
    }
}
