<?php

namespace App\Services\Ai\Media;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * A VoiceStudio (OmniVoice) server: its voices and engines, and speech through the
 * OpenAI-compatible /v1/audio/speech.
 */
class VoiceStudioClient
{
    public const DEFAULT_VOICE = 'default';

    /**
     * The server's voice profiles and which engines are up, cached briefly: the model list is
     * built on every page load and the GPU box shouldn't be asked each time. A failure is
     * remembered for less long, so a server that comes back shows up quickly.
     *
     * @return array{voices: list<array{id: string, name: string, language: string|null}>, engines: array<string, bool>, error: string|null}
     */
    public function server(): array
    {
        if ($cached = Cache::get('models.voicestudio')) {
            return $cached;
        }
        try {
            $r = $this->call(fn (PendingRequest $http) => $http->timeout(4)->get($this->url('/v1/audio/voices')));
            $state = [
                'voices' => collect($r->json('voices', []))
                    ->where('type', 'profile')
                    // "Auto" means the voice follows the script's language; nothing worth labelling.
                    ->map(fn (array $v) => ['id' => (string) $v['voice_id'], 'name' => (string) ($v['name'] ?? $v['voice_id']), 'language' => ($v['language'] ?? 'Auto') === 'Auto' ? null : $v['language']])
                    ->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()->all(),
                'engines' => collect($r->json('engines', []))->mapWithKeys(fn (array $e) => [$e['id'] => (bool) ($e['available'] ?? false)])->all(),
                'error' => null,
            ];
            Cache::put('models.voicestudio', $state, 120);
        } catch (GenerationFailed $e) {
            $state = ['voices' => [], 'engines' => [], 'error' => $e->getMessage()];
            Cache::put('models.voicestudio', $state, 30);
        }

        return $state;
    }

    /**
     * The voices a model can speak in: the default, and the cloned profiles if its engine clones.
     *
     * @return list<array{id: string, name: string, language: string|null}>
     */
    public function voicesFor(string $model): array
    {
        $default = ['id' => self::DEFAULT_VOICE, 'name' => 'Default voice', 'language' => null];

        return config("ai.providers.voicestudio.models.{$model}.cloning")
            ? [$default, ...$this->server()['voices']]
            : [$default];
    }

    /**
     * @return string the audio file's bytes
     */
    public function speech(string $model, string $text, string $voice, string $format, float $speed): string
    {
        $r = $this->call(fn (PendingRequest $http) => $http->timeout(300)->post($this->url('/v1/audio/speech'), [
            'model' => $model, 'input' => $text, 'voice' => $voice, 'response_format' => $format, 'speed' => $speed,
        ]));
        if ($r->body() === '') {
            throw new GenerationFailed('VoiceStudio answered without any audio.');
        }

        return $r->body();
    }

    public function test(): string
    {
        Cache::forget('models.voicestudio');
        $state = $this->server();
        if ($state['error']) {
            throw new GenerationFailed($state['error']);
        }
        $up = collect(config('ai.providers.voicestudio.models', []))->keys()->filter(fn ($m) => $state['engines'][$m] ?? false);

        $voices = count($state['voices']);

        return "Connected. {$voices} ".str('voice')->plural($voices).'; '.($up->isEmpty() ? 'no engine this studio uses is running.' : $up->implode(' and ').' ready.');
    }

    /**
     * @param  callable(PendingRequest): Response  $send
     */
    private function call(callable $send): Response
    {
        if (! filled(config('ai.providers.voicestudio.url')) || ! filled(config('ai.providers.voicestudio.key'))) {
            throw new GenerationFailed('No VoiceStudio server is set up.');
        }
        try {
            $r = $send(Http::withToken((string) config('ai.providers.voicestudio.key'))->acceptJson());
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach VoiceStudio at '.config('ai.providers.voicestudio.url').'.');
        }

        return match (true) {
            $r->successful() => $r,
            in_array($r->status(), [401, 403], true) => throw new GenerationFailed('VoiceStudio rejected the API key.'),
            $r->status() === 422 => throw new GenerationFailed(rtrim('VoiceStudio couldn’t read that request. '.mb_substr(is_string($r->json('detail')) ? $r->json('detail') : (string) $r->json('detail.0.msg', ''), 0, 160))),
            $r->status() === 503 => throw new GenerationFailed('VoiceStudio is busy loading a voice engine. Try again in a minute.'),
            default => throw new GenerationFailed("VoiceStudio answered {$r->status()}."),
        };
    }

    private function url(string $path): string
    {
        return rtrim((string) config('ai.providers.voicestudio.url'), '/').$path;
    }
}
