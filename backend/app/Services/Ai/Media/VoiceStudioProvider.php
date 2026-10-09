<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;

/**
 * Speech from VoiceStudio: the prompt is the script, read in the chosen voice. Answers in one go.
 */
class VoiceStudioProvider implements MediaProvider
{
    private const MIMES = ['mp3' => 'audio/mpeg', 'wav' => 'audio/wav'];

    public function __construct(private readonly VoiceStudioClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $params = $generation->params ?? [];
        $voice = (string) ($params['voice'] ?? VoiceStudioClient::DEFAULT_VOICE);
        $format = (string) ($params['format'] ?? 'mp3');
        $speed = (float) ($params['speed'] ?? 1);

        // An unknown voice would come back in the default voice without a word; say so instead.
        $voices = collect($model['capabilities']->voices ?? $this->client->voicesFor($model['model']))->pluck('id');
        if (! $voices->contains($voice)) {
            throw new GenerationFailed("{$model['label']} doesn’t have that voice. Pick one from the list.");
        }
        if (! isset(self::MIMES[$format])) {
            throw new GenerationFailed('Choose MP3 or WAV.');
        }

        $audio = $this->client->speech($model['model'], $generation->prompt, $voice, $format, $speed);

        return ['outputs' => [['b64' => base64_encode($audio), 'mime' => self::MIMES[$format]]]];
    }

    public function poll(Generation $generation): array
    {
        return ['status' => $generation->status];
    }
}
