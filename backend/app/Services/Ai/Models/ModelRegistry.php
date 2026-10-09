<?php

namespace App\Services\Ai\Models;

use Anthropic\Client;
use App\Models\ConnectorTest;
use App\Models\ModelEval;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\ComfyUiClient;
use App\Services\Ai\Media\HiggsfieldClient;
use App\Services\Ai\Media\InvokeClient;
use App\Services\Ai\Media\InvokeGraphs;
use App\Services\Ai\Media\VoiceStudioClient;
use App\Services\Ai\OpenAiCompatibleGenerator;
use App\Services\Ai\TextGenerator;
use App\Services\Ai\UsageMeter;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Every model the studio can use, local and cloud, in one list: what it's for, how it's
 * reached, whether it can run right now and if not why, and its eval score.
 *
 * Ids are "provider/model": anthropic/claude-opus-5-5, gateway/llama-3.3-70b, ollama/qwen2.5:7b,
 * higgsfield/soul-2, comfyui/z-image-turbo. Image and video models also carry `caps`: what the
 * studio's controls may offer for them (formats, lengths, quality, sound, input images).
 */
class ModelRegistry
{
    public const PROVIDERS = ['anthropic', 'gateway', 'ollama', 'higgsfield', 'google', 'comfyui', 'invoke', 'voicestudio'];

    /** What InvokeAI image models offer in the studio: shapes, render settings, variations and edits. */
    private const INVOKE_CAPABILITIES = [
        'aspect_ratios' => ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '4:3'],
        'max_inputs' => 0, 'seed' => true, 'max_outputs' => 4, 'negative_prompt' => true, 'edit' => true,
    ];

    public function __construct(private readonly TextGenerator $claude, private readonly UsageMeter $usage) {}

    /**
     * @return list<array{id: string, provider: string, model: string, label: string, kind: string, reach: string, local: bool, available: bool, reason: string|null, purpose: string|null, score: int|null}>
     */
    public function all(?string $kind = null): array
    {
        $models = [...$this->anthropic(), ...$this->gateway(), ...$this->ollama(), ...$this->higgsfield(), ...$this->google(), ...$this->comfyui(), ...$this->invoke(), ...$this->voicestudio()];
        $scores = ModelEval::query()
            ->selectRaw('model, avg(score) as score')
            ->whereIn('id', ModelEval::query()->selectRaw('max(id)')->groupBy('model', 'task'))
            ->groupBy('model')
            ->pluck('score', 'model');

        return array_values(array_filter(
            array_map(fn (array $m) => [...$m, 'score' => isset($scores[$m['id']]) ? (int) round($scores[$m['id']]) : null], $models),
            fn (array $m) => $kind === null || $m['kind'] === $kind,
        ));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        return collect($this->all())->firstWhere('id', $id);
    }

    public function defaultText(): string
    {
        return $this->textModelOr((string) config('ai.default_text'));
    }

    /**
     * The preferred text model if it can run, otherwise whichever one can, or null when nothing
     * can — which is the honest answer to "is AI writing switched on", because a key for one
     * provider doesn't help a feature pointed at another.
     */
    public function availableText(string $preferred): ?string
    {
        $available = collect($this->all('text'))->where('available', true)->pluck('id');

        return $available->contains($preferred) ? $preferred : $available->first();
    }

    /**
     * The preferred text model if it can run, otherwise whichever one can. Configuring a model
     * that isn't reachable should cost a fallback, not a dead feature — and the caller records
     * the id this returns, so the run says which model actually wrote it.
     */
    public function textModelOr(string $preferred): string
    {
        return $this->availableText($preferred) ?? $preferred;
    }

    /**
     * The generator for a text model, and the model's name at its provider.
     *
     * @return array{0: TextGenerator, 1: string}
     *
     * @throws GenerationFailed when the model can't run.
     */
    public function text(string $id): array
    {
        $model = $this->find($id);
        if (! $model || $model['kind'] !== 'text') {
            throw new GenerationFailed('That model isn’t one the studio knows.');
        }
        if (! $model['available']) {
            throw new GenerationFailed("{$model['label']} isn’t available: {$model['reason']}");
        }

        return [match ($model['provider']) {
            'anthropic' => $this->claude,
            'gateway' => new OpenAiCompatibleGenerator('gateway', rtrim(config('ai.providers.gateway.url'), '/'), config('ai.providers.gateway.key'), $this->usage, config('ai.providers.gateway.reasoning_effort') ?: null, config('ai.providers.gateway.plain_models', [])),
            'ollama' => new OpenAiCompatibleGenerator('ollama', rtrim(config('ai.providers.ollama.url'), '/').'/v1', null, $this->usage),
        }, $model['model']];
    }

    /**
     * Try a provider's credentials without spending anything, and remember the result.
     */
    public function test(string $provider): ConnectorTest
    {
        $started = microtime(true);
        try {
            $message = match ($provider) {
                'anthropic' => $this->testAnthropic(),
                'gateway' => $this->testOpenAi(rtrim((string) config('ai.providers.gateway.url'), '/').'/models', config('ai.providers.gateway.key')),
                'ollama' => $this->testOllama(),
                'higgsfield' => app(HiggsfieldClient::class)->test(),
                'google' => $this->testGoogle(),
                'voicestudio' => $this->testVoiceStudio(),
                'invoke' => app(InvokeClient::class)->test(),
                'comfyui' => app(ComfyUiClient::class)->test(),
            };
            $ok = true;
        } catch (Throwable $e) {
            [$ok, $message] = [false, $e instanceof GenerationFailed ? $e->getMessage() : 'Couldn’t connect: '.class_basename($e)];
        }
        Cache::forget("models.{$provider}");

        return ConnectorTest::create([
            'provider' => $provider,
            'ok' => $ok,
            'message' => mb_substr($message, 0, 250),
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
        ]);
    }

    /**
     * How each provider stands: configured, its last connector test.
     *
     * @return list<array<string, mixed>>
     */
    public function providers(): array
    {
        return array_map(function (string $p) {
            $test = ConnectorTest::latestFor($p);

            return [
                'id' => $p,
                'reach' => config("ai.providers.{$p}.reach"),
                'local' => (bool) config("ai.providers.{$p}.local", false),
                'configured' => $this->configured($p),
                'setup' => [
                    'anthropic' => 'Set ANTHROPIC_API_KEY.',
                    'gateway' => 'Set AI_GATEWAY_URL (an OpenAI-compatible /v1 base) and AI_GATEWAY_KEY.',
                    'ollama' => 'Set OLLAMA_URL to an Ollama server, e.g. http://ollama:11434.',
                    'higgsfield' => 'Set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET. HIGGSFIELD_PLAN can narrow the models to the ones your plan includes.',
                    'google' => 'Set GEMINI_API_KEY for Gemini image generation and Veo video generation.',
                    'comfyui' => 'Set COMFYUI_URL to a ComfyUI server started with --listen (from Docker, a server on this computer is http://host.docker.internal:8188).',
                    'invoke' => 'Set INVOKE_URL to an InvokeAI server, e.g. http://gpu-box:9090.',
                    'voicestudio' => 'Set OMNIVOICE_URL to a VoiceStudio server, e.g. http://gpu-box:3900, and OMNIVOICE_API_KEY.',
                ][$p],
                'test' => $test ? ['ok' => $test->ok, 'message' => $test->message, 'latency_ms' => $test->latency_ms, 'at' => $test->created_at?->toIso8601ZuluString()] : null,
            ];
        }, self::PROVIDERS);
    }

    public function configured(string $provider): bool
    {
        return match ($provider) {
            'anthropic' => $this->claude->enabled(),
            'gateway' => filled(config('ai.providers.gateway.url')),
            'ollama' => filled(config('ai.providers.ollama.url')),
            'higgsfield' => filled(config('ai.providers.higgsfield.key_id')) && filled(config('ai.providers.higgsfield.key_secret')),
            'google' => filled(config('ai.providers.google.key')),
            'voicestudio' => filled(config('ai.providers.voicestudio.url')) && filled(config('ai.providers.voicestudio.key')),
            'invoke' => filled(config('ai.providers.invoke.url')),
            'comfyui' => filled(config('ai.providers.comfyui.url')),
            default => false,
        };
    }

    /**
     * What the studio's controls may offer for an image or video model. Null lists mean
     * "the studio's usual choices"; the provider snaps anything else to what the model accepts.
     *
     * @param  array<string, mixed>  $spec
     * @return array<string, mixed>
     */
    public static function caps(array $spec, string $kind): array
    {
        $imageInput = filled($spec['image_field'] ?? null) || filled($spec['image_route'] ?? null);

        return [
            'aspects' => $spec['aspects'] ?? null,
            'durations' => $kind === 'video' ? ($spec['durations'] ?? null) : null,
            'resolutions' => $spec['resolutions'] ?? null,
            'default_resolution' => $spec['defaults']['resolution'] ?? null,
            'image_input' => $imageInput,
            'requires_image' => (bool) ($spec['requires_image'] ?? false) || ($kind === 'video' && ! ($spec['route'] ?? null) && $imageInput),
            'max_images' => $imageInput ? (int) ($spec['max_images'] ?? 1) : 0,
            'end_frame' => filled($spec['end_field'] ?? null),
            'audio' => filled($spec['audio'] ?? null),
            'seed' => isset($spec['seed_range']) || in_array('seed', $spec['params'] ?? [], true),
        ];
    }

    /**
     * The same abilities in the workbench's names. Null lists stay out, so the workbench falls
     * back to its usual choices exactly as the Lab page does.
     *
     * @param  array<string, mixed>  $caps
     * @return array<string, mixed>
     */
    public static function capabilities(array $caps): array
    {
        return array_filter([
            'aspect_ratios' => $caps['aspects'] ?? null,
            'durations' => $caps['durations'] ?? null,
            'resolutions' => $caps['resolutions'] ?? null,
            'default_resolution' => $caps['default_resolution'] ?? null,
            'max_inputs' => (int) ($caps['max_images'] ?? 0),
            'input_optional' => ($caps['image_input'] ?? false) && ! ($caps['requires_image'] ?? false),
            'requires_image' => (bool) ($caps['requires_image'] ?? false),
            'end_frame' => (bool) ($caps['end_frame'] ?? false),
            'audio' => (bool) ($caps['audio'] ?? false),
            'seed' => (bool) ($caps['seed'] ?? false),
        ], fn ($v) => $v !== null && $v !== false);
    }

    /* ------------------------------------------------------------------ */

    /**
     * Each model carries its abilities twice: `caps` (the Higgsfield-spec shape the Lab page reads)
     * and `capabilities` (the shape the Creative Lab workbench reads). Pass whichever the provider
     * has; the other is worked out from it.
     *
     * @param  array<string, mixed>|null  $caps
     * @param  array<string, mixed>  $capabilities
     */
    private function entry(string $provider, string $model, string $label, string $kind, ?string $purpose, bool $available, ?string $reason, ?bool $local = null, ?array $caps = null, ?string $family = null, array $capabilities = []): array
    {
        return [
            'id' => "{$provider}/{$model}",
            'provider' => $provider,
            'model' => $model,
            'label' => $label,
            'kind' => $kind,
            'family' => $family,
            'reach' => config("ai.providers.{$provider}.reach"),
            'local' => $local ?? (bool) config("ai.providers.{$provider}.local", false),
            'available' => $available,
            'reason' => $available ? null : $reason,
            'purpose' => $purpose,
            'caps' => $kind === 'text' ? null : ($caps ?? self::caps([], $kind)),
            'capabilities' => (object) ($capabilities ?: ($caps ? self::capabilities($caps) : [])),
        ];
    }

    private function anthropic(): array
    {
        $on = $this->claude->enabled();

        return collect(config('ai.providers.anthropic.models'))
            ->map(fn (array $m, string $id) => $this->entry('anthropic', $id, $m['label'], 'text', $m['purpose'] ?? null, $on, 'No Anthropic API key is set.'))
            ->values()->all();
    }

    private function gateway(): array
    {
        if (! $this->configured('gateway')) {
            return [];
        }
        $local = config('ai.providers.gateway.local_models', []);
        $text = Cache::remember('models.gateway', 300, function () {
            try {
                $r = Http::timeout(4)->withToken((string) config('ai.providers.gateway.key'))->acceptJson()
                    ->get(rtrim(config('ai.providers.gateway.url'), '/').'/models');

                return $r->successful() ? collect($r->json('data', []))->pluck('id')->filter()->values()->all() : [];
            } catch (Throwable) {
                return [];
            }
        });
        $images = config('ai.providers.gateway.image_models', []);

        return [
            ...collect($text)->reject(fn ($id) => in_array($id, $images, true))
                ->map(fn ($id) => $this->entry('gateway', $id, $id, 'text', in_array($id, $local, true) ? 'Local: effectively free, for prototyping' : 'Gateway model', true, null, in_array($id, $local, true)))->all(),
            ...collect($images)->map(fn ($id) => $this->entry('gateway', $id, $id, 'image', 'Images through the gateway', true, null, null, self::caps(['aspects' => ['1:1', '4:5', '9:16', '16:9']], 'image')))->all(),
        ];
    }

    private function ollama(): array
    {
        if (! $this->configured('ollama')) {
            return [];
        }
        $tags = Cache::remember('models.ollama', 300, function () {
            try {
                $r = Http::timeout(4)->acceptJson()->get(rtrim(config('ai.providers.ollama.url'), '/').'/api/tags');

                return $r->successful() ? collect($r->json('models', []))->pluck('name')->filter()->values()->all() : [];
            } catch (Throwable) {
                return [];
            }
        });

        return collect($tags)->map(fn ($id) => $this->entry('ollama', $id, $id, 'text', 'Installed locally: free, private, for prototyping', true, null))->values()->all();
    }

    private function higgsfield(): array
    {
        $configured = $this->configured('higgsfield');
        $plan = config('ai.providers.higgsfield.plan', []);
        $test = ConnectorTest::latestFor('higgsfield');

        return collect(config('ai.providers.higgsfield.models'))->map(function (array $m, string $id) use ($configured, $plan, $test) {
            $reason = match (true) {
                ! ($m['route'] ?? null) && ! ($m['image_route'] ?? null) => 'No API route for this model yet.',
                $plan !== [] && ! in_array($id, $plan, true) => 'Not in your Higgsfield plan.',
                ! $configured => 'No Higgsfield API key is set.',
                ! $test => 'The Higgsfield connector hasn’t been tested.',
                ! $test->ok => 'The Higgsfield connector test failed: '.$test->message,
                default => null,
            };

            return $this->entry('higgsfield', $id, $m['label'], $m['kind'], $m['purpose'] ?? null, $reason === null, $reason, null, self::caps($m, $m['kind']), $m['family'] ?? null);
        })->values()->all();
    }

    private function comfyui(): array
    {
        $configured = $this->configured('comfyui');
        $test = ConnectorTest::latestFor('comfyui');

        return collect(config('ai.providers.comfyui.workflows', []))->map(function (array $w, string $id) use ($configured, $test) {
            $reason = match (true) {
                ! $configured => 'No ComfyUI server is set (COMFYUI_URL).',
                ! $test => 'The ComfyUI connector hasn’t been tested.',
                ! $test->ok => 'The ComfyUI connector test failed: '.$test->message,
                default => null,
            };
            $caps = self::caps(['aspects' => ['1:1', '4:5', '9:16', '16:9'], 'seed_range' => [0, 4294967295]], $w['kind']);

            return $this->entry('comfyui', $id, $w['label'], $w['kind'], $w['purpose'] ?? null, $reason === null, $reason, true, $caps, 'Your GPU · ComfyUI');
        })->values()->all();
    }

    private function google(): array
    {
        $configured = $this->configured('google');

        return collect(config('ai.providers.google.models', []))->map(fn (array $m, string $id) => $this->entry(
            'google', $id, $m['label'], $m['kind'], $m['purpose'] ?? null,
            $configured, $configured ? null : 'No Gemini API key is set.',
            capabilities: $m['capabilities'] ?? [],
        ))->values()->all();
    }

    /**
     * Available when the server answers and the model's engine is running there; the voices
     * come from the server, so the picker only offers ones it will actually use.
     */
    private function voicestudio(): array
    {
        $configured = $this->configured('voicestudio');
        $client = app(VoiceStudioClient::class);
        $server = $configured ? $client->server() : null;

        return collect(config('ai.providers.voicestudio.models', []))->map(function (array $m, string $id) use ($configured, $server, $client) {
            $reason = match (true) {
                ! $configured => 'No VoiceStudio server is set up.',
                (bool) $server['error'] => $server['error'],
                ! ($server['engines'][$id] ?? false) => "The {$m['label']} engine isn’t running on the VoiceStudio server.",
                default => null,
            };

            return $this->entry('voicestudio', $id, $m['label'], $m['kind'], $m['purpose'] ?? null, $reason === null, $reason,
                capabilities: [...$m['capabilities'] ?? [], 'voices' => $reason === null ? $client->voicesFor($id) : []]);
        })->values()->all();
    }

    /**
     * The image models installed on the InvokeAI server. Ids use Invoke's model key, which
     * survives renames; families FlowAI has no graph for are listed but can't run.
     */
    private function invoke(): array
    {
        if (! $this->configured('invoke')) {
            return [];
        }
        $server = app(InvokeClient::class)->server();
        // Built into Invoke: no model to install, so it's there whenever the server answers.
        $upscaler = $this->entry('invoke', InvokeGraphs::UPSCALER, 'Real-ESRGAN upscaler', 'image', 'On your GPU · 2× or 4× larger and sharper, no prompt needed',
            ! $server['error'], $server['error'], capabilities: ['upscale' => true, 'scales' => [2, 4], 'max_inputs' => 1, 'aspect_ratios' => []]);

        return collect($server['models'])->map(function (array $m) use ($server) {
            $reason = match (true) {
                (bool) $server['error'] => $server['error'],
                ! InvokeGraphs::supports($m['base'] ?? null) => "FlowAI can’t drive {$m['base']} models yet; Z-Image models work today.",
                default => null,
            };
            $defaults = $m['default_settings'] ?? [];

            return $this->entry('invoke', (string) $m['key'], (string) $m['name'], 'image',
                // "Z-Image Turbo - fast 6B parameter text-to-image model with 8 inference steps. …"
                'On your GPU · '.str((string) ($m['description'] ?? 'an InvokeAI model'))->after(' - ')->before('. ')->ucfirst()->limit(80),
                $reason === null, $reason,
                capabilities: [...self::INVOKE_CAPABILITIES, 'steps' => (int) ($defaults['steps'] ?? 9), 'guidance' => (float) ($defaults['cfg_scale'] ?? 1)]);
        })->push($upscaler)->values()->all();
    }

    private function testVoiceStudio(): string
    {
        return app(VoiceStudioClient::class)->test();
    }

    private function testAnthropic(): string
    {
        if (! $this->claude->enabled()) {
            throw new GenerationFailed('No Anthropic API key is set.');
        }
        $page = (new Client(apiKey: config('services.anthropic.key')))->models->list(limit: 5);
        $n = count($page->getItems());

        return "Connected. The key can see {$n}+ models.";
    }

    private function testOpenAi(string $url, ?string $key): string
    {
        if (! filled(config('ai.providers.gateway.url'))) {
            throw new GenerationFailed('No gateway URL is set.');
        }
        $r = Http::timeout(6)->withToken((string) $key)->acceptJson()->get($url);
        if ($r->status() === 401 || $r->status() === 403) {
            throw new GenerationFailed('The gateway rejected the key.');
        }
        if (! $r->successful()) {
            throw new GenerationFailed("The gateway answered {$r->status()}.");
        }

        return 'Connected. '.count($r->json('data', [])).' models available.';
    }

    private function testOllama(): string
    {
        if (! filled(config('ai.providers.ollama.url'))) {
            throw new GenerationFailed('No Ollama URL is set.');
        }
        $r = Http::timeout(6)->acceptJson()->get(rtrim(config('ai.providers.ollama.url'), '/').'/api/tags');
        if (! $r->successful()) {
            throw new GenerationFailed("Ollama answered {$r->status()}.");
        }

        return 'Connected. '.count($r->json('models', [])).' models installed.';
    }

    private function testGoogle(): string
    {
        if (! $this->configured('google')) {
            throw new GenerationFailed('No Gemini API key is set.');
        }
        $r = Http::timeout(10)->withHeaders(['x-goog-api-key' => config('ai.providers.google.key')])
            ->acceptJson()->get(rtrim(config('ai.providers.google.url'), '/').'/models');
        if (in_array($r->status(), [401, 403], true)) {
            throw new GenerationFailed('Google rejected the Gemini API key.');
        }
        if (! $r->successful()) {
            throw new GenerationFailed("Google answered {$r->status()}.");
        }

        return 'Connected. Gemini and Veo are ready.';
    }
}
