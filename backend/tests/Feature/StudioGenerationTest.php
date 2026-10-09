<?php

namespace Tests\Feature;

use App\Jobs\PollGeneration;
use App\Jobs\RunGeneration;
use App\Models\Asset;
use App\Models\ConnectorTest;
use App\Models\Generation;
use App\Models\ModelEval;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\HiggsfieldProvider;
use App\Services\Ai\OpenAiCompatibleGenerator;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class StudioGenerationTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'ai.providers.higgsfield.key_id' => 'kid',
            'ai.providers.higgsfield.key_secret' => 'ksecret',
            'ai.providers.higgsfield.plan' => ['ideogram-4', 'wan-2-7-i2v'],
        ]);
    }

    private function fakeClaude(array $chunks = ['Autumn ', 'pour.'], ?string $fail = null, array|\Closure $json = []): object
    {
        $fake = new class($chunks, $fail, $json) implements TextGenerator
        {
            public array $calls = [];

            public function __construct(private array $chunks, private ?string $fail, private array|\Closure $json) {}

            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->calls[] = compact('model', 'prompt');
                yield from $this->chunks;
                if ($this->fail) {
                    throw new GenerationFailed($this->fail);
                }
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $this->calls[] = ['model' => $model, 'prompt' => $content];

                return $this->json instanceof \Closure ? ($this->json)($schema) : (array_shift($this->json) ?? ['score' => 80, 'reason' => 'Fine.']);
            }
        };
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function higgsfieldTested(): void
    {
        ConnectorTest::create(['provider' => 'higgsfield', 'ok' => true, 'message' => 'Connected.']);
    }

    /**
     * @return list<array{event: string, data: mixed}>
     */
    private function events(TestResponse $response): array
    {
        preg_match_all('/^event: (\w+)\ndata: (.*)$/m', $response->streamedContent(), $m, PREG_SET_ORDER);

        return array_map(fn ($x) => ['event' => $x[1], 'data' => json_decode($x[2], true)], $m);
    }

    public function test_the_registry_lists_every_model_and_says_why_some_cannot_run(): void
    {
        $this->fakeClaude();
        $models = fn () => collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');

        $list = $models();
        $this->assertTrue($list['anthropic/claude-opus-5-5']['available']);
        $this->assertSame('Claude API', $list['anthropic/claude-opus-5-5']['reach']);
        $this->assertSame('Not in your Higgsfield plan.', $list['higgsfield/soul']['reason']);
        $this->assertSame(['16:9', '9:16', '1:1'], $list['higgsfield/kling-3-pro']['capabilities']['aspect_ratios']);
        $this->assertSame('No API route for this model yet.', $list['higgsfield/seedance-2-5']['reason']);
        $this->assertSame('The Higgsfield connector hasn’t been tested.', $list['higgsfield/ideogram-4']['reason']);

        // Testing the connector: bad credentials are refused, good ones get "not found".
        Http::fake(['api.higgsfield.ai/requests/*' => Http::sequence()
            ->push(['detail' => 'Unauthorized'], 401)
            ->push(['detail' => 'Not found'], 404)]);
        $this->spa()->postJson('/api/models/test/higgsfield')->assertJsonPath('ok', false)->assertJsonPath('message', 'Higgsfield rejected the key.');
        $this->assertSame('The Higgsfield connector test failed: Higgsfield rejected the key.', $models()['higgsfield/ideogram-4']['reason']);

        $this->spa()->postJson('/api/models/test/higgsfield')->assertJsonPath('ok', true);
        $this->assertTrue($models()['higgsfield/ideogram-4']['available']);

        config(['ai.providers.higgsfield.plan' => ['wan-2-7-i2v']]);
        $this->assertSame('Not in your Higgsfield plan.', $models()['higgsfield/ideogram-4']['reason']);
    }

    public function test_gateway_and_local_models_are_discovered_and_labelled(): void
    {
        $this->fakeClaude();
        config([
            'ai.providers.gateway.url' => 'https://gw.example/v1', 'ai.providers.gateway.key' => 'team-key',
            'ai.providers.gateway.local_models' => ['llama-3.3-70b'], 'ai.providers.gateway.image_models' => ['flux-1'],
            'ai.providers.ollama.url' => 'http://ollama:11434',
        ]);
        Http::fake([
            'gw.example/v1/models' => Http::response(['data' => [['id' => 'llama-3.3-70b'], ['id' => 'gpt-frontier'], ['id' => 'flux-1']]]),
            'ollama:11434/api/tags' => Http::response(['models' => [['name' => 'qwen2.5:7b']]]),
        ]);

        $list = collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->json('models'))->keyBy('id');

        $this->assertSame(['text', true, 'Gateway'], [$list['gateway/llama-3.3-70b']['kind'], $list['gateway/llama-3.3-70b']['local'], $list['gateway/llama-3.3-70b']['reach']]);
        $this->assertFalse($list['gateway/gpt-frontier']['local']);
        $this->assertSame('image', $list['gateway/flux-1']['kind']);
        $this->assertSame(['Ollama', true], [$list['ollama/qwen2.5:7b']['reach'], $list['ollama/qwen2.5:7b']['local']]);
        Http::assertSent(fn (Request $r) => $r->url() === 'https://gw.example/v1/models' && $r->hasHeader('Authorization', 'Bearer team-key'));
    }

    public function test_text_streams_in_and_is_kept_whether_it_works_or_not(): void
    {
        $fake = $this->fakeClaude();
        $user = User::factory()->create();

        $response = $this->actingAs($user)->spa()->postJson('/api/generations/text', ['prompt' => 'A caption for the autumn pour', 'model' => 'anthropic/claude-opus-5-5']);
        $events = $this->events($response);
        $this->assertSame(['start', 'delta', 'delta', 'done'], array_column($events, 'event'));
        $generation = Generation::find($events[0]['data']['id']);
        $this->assertSame(['succeeded', 'Autumn pour.', 'claude-opus-5-5'], [$generation->status, $generation->output_text, $fake->calls[0]['model']]);

        $this->fakeClaude(['Autumn '], fail: 'Claude is busy right now.');
        $events = $this->events($this->spa()->postJson('/api/generations/text', ['prompt' => 'Again']));
        $this->assertSame('error', end($events)['event']);
        $failed = Generation::latest('id')->first();
        $this->assertSame(['failed', 'Claude is busy right now.', 'Autumn'], [$failed->status, $failed->error, $failed->output_text]);

        $this->spa()->postJson('/api/generations/text', ['prompt' => 'x', 'model' => 'higgsfield/ideogram-4'])->assertJsonValidationErrors('model');
    }

    public function test_a_photo_is_made_by_higgsfield_polled_and_brought_into_the_library(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        Http::fake([
            'api.higgsfield.ai/ideogram/v4.0' => Http::response(['status' => 'queued', 'request_id' => 'req-1', 'status_url' => 'https://api.higgsfield.ai/requests/req-1/status']),
            'api.higgsfield.ai/requests/req-1/status' => Http::sequence()
                ->push(['status' => 'in_progress', 'request_id' => 'req-1'])
                ->push(['status' => 'completed', 'request_id' => 'req-1', 'images' => [['url' => 'https://cdn.example/out.png']]]),
            'cdn.example/out.png' => Http::response(base64_decode(self::PNG), 200, ['Content-Type' => 'image/png']),
        ]);

        $id = $this->actingAs(User::factory()->create())->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'higgsfield/ideogram-4', 'prompt' => 'Amber candle jar on linen, morning light',
            'params' => ['aspect_ratio' => '4:5', 'resolution' => '1080p'],
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame(['succeeded', 'req-1'], [$generation->status, $generation->external_id]);
        $asset = Asset::find($generation->output_asset_ids[0]);
        $this->assertSame(['image', 'generated', 'image/png'], [$asset->kind, $asset->source, $asset->mime]);
        $this->spa()->getJson("/api/generations/{$id}")->assertJsonPath('outputs.0.id', $asset->id)->assertJsonPath('model_label', 'Ideogram 4.0');

        // Key auth, an idempotency key, and only the params the model takes. The key carries more
        // than the generation id on purpose: ids are reused once a row is deleted and Higgsfield
        // remembers a key for about a day, so an id-only key can be answered with the image that
        // belonged to the deleted generation. Row timestamp and body fingerprint rule that out.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/ideogram/v4.0'
            && $r->hasHeader('Authorization', 'Key kid:ksecret')
            && preg_match("/^flowai-generation-{$id}-\d+-[0-9a-f]{16}$/", $r->header('Idempotency-Key')[0] ?? '') === 1
            && $r['aspect_ratio'] === '4:5' && ! isset($r['resolution']));
    }

    private function voiceStudio(array $engines = ['omnivoice' => true, 'kittentts' => false]): void
    {
        config(['ai.providers.voicestudio.url' => 'http://voice.test:3900', 'ai.providers.voicestudio.key' => 'vkey']);
        Http::fake([
            'voice.test:3900/v1/audio/voices' => Http::response([
                'voices' => [
                    ['voice_id' => 'f2b7a8cf', 'name' => 'The Calm Guide', 'type' => 'profile', 'language' => 'English'],
                    ['voice_id' => 'alloy', 'name' => 'Alloy', 'type' => 'openai_alias'],
                ],
                'engines' => collect($engines)->map(fn ($up, $id) => ['id' => $id, 'available' => $up])->values()->all(),
            ]),
            // An MP3 as the server sends it: an ID3 tag, then a frame.
            'voice.test:3900/v1/audio/speech' => Http::response("ID3\x04\x00\x00\x00\x00\x00\x00\xFF\xFB\x90\x00".str_repeat("\x00", 413), 200, ['Content-Type' => 'audio/mpeg']),
        ]);
    }

    public function test_voicestudio_offers_its_cloned_voices_and_says_which_engines_are_down(): void
    {
        $this->fakeClaude();
        $this->voiceStudio();

        $list = collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');

        $omni = $list['voicestudio/omnivoice'];
        $this->assertSame(['audio', true, 'VoiceStudio'], [$omni['kind'], $omni['available'], $omni['reach']]);
        // The OpenAI aliases all mean the default voice, so they're folded into it.
        $this->assertSame(['default', 'f2b7a8cf'], array_column($omni['capabilities']['voices'], 'id'));
        $this->assertSame(['mp3', 'wav'], $omni['capabilities']['formats']);
        $this->assertSame('The KittenTTS engine isn’t running on the VoiceStudio server.', $list['voicestudio/kittentts']['reason']);
        Http::assertSent(fn (Request $r) => $r->url() === 'http://voice.test:3900/v1/audio/voices' && $r->hasHeader('Authorization', 'Bearer vkey'));
    }

    public function test_the_voicestudio_connector_test_reports_a_bad_key_and_a_good_one(): void
    {
        $this->fakeClaude();
        config(['ai.providers.voicestudio.url' => 'http://voice.test:3900', 'ai.providers.voicestudio.key' => 'vkey']);
        Http::fake(['voice.test:3900/v1/audio/voices' => Http::sequence()
            ->push(['detail' => 'Missing or invalid API key'], 401)
            ->push(['voices' => [['voice_id' => 'a1', 'name' => 'Host voice', 'type' => 'profile']], 'engines' => [['id' => 'omnivoice', 'available' => true]]])]);
        $this->actingAs(User::factory()->create());

        $this->spa()->postJson('/api/models/test/voicestudio')->assertJsonPath('ok', false)->assertJsonPath('message', 'VoiceStudio rejected the API key.');
        $this->spa()->postJson('/api/models/test/voicestudio')->assertJsonPath('ok', true)->assertJsonPath('message', 'Connected. 1 voice; omnivoice ready.');
    }

    public function test_a_script_is_read_in_a_cloned_voice_and_kept_in_the_library(): void
    {
        $this->fakeClaude();
        $this->voiceStudio();
        $script = 'Slow mornings start here. Fresh bread, warm coffee, and a seat by the window.';

        $id = $this->actingAs(User::factory()->create())->spa()->postJson('/api/generations', [
            'kind' => 'audio', 'model' => 'voicestudio/omnivoice', 'prompt' => $script,
            'params' => ['voice' => 'f2b7a8cf', 'speed' => 1.25, 'format' => 'mp3'],
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame('succeeded', $generation->status, (string) $generation->error);
        $asset = Asset::find($generation->output_asset_ids[0]);
        $this->assertSame(['audio', 'generated', 'audio/mpeg'], [$asset->kind, $asset->source, $asset->mime]);
        $this->assertStringEndsWith('.mp3', $asset->name);
        $this->assertStringEndsWith('.mp3', $asset->path);
        $this->spa()->getJson("/api/generations/{$id}")->assertJsonPath('outputs.0.script', $script)->assertJsonPath('outputs.0.poster_url', null);
        $this->spa()->getJson('/api/assets?kind=audio')->assertOk()->assertJsonPath('data.0.id', $asset->id);

        Http::assertSent(fn (Request $r) => $r->url() === 'http://voice.test:3900/v1/audio/speech'
            && $r->hasHeader('Authorization', 'Bearer vkey')
            && $r['model'] === 'omnivoice' && $r['input'] === $script && $r['voice'] === 'f2b7a8cf'
            && $r['response_format'] === 'mp3' && $r['speed'] === 1.25);
    }

    public function test_a_voice_the_server_does_not_have_fails_instead_of_falling_back(): void
    {
        $this->fakeClaude();
        $this->voiceStudio();
        $user = User::factory()->create();

        // VoiceStudio would answer an unknown voice in its default one, without saying so.
        $id = $this->actingAs($user)->spa()->postJson('/api/generations', [
            'kind' => 'audio', 'model' => 'voicestudio/omnivoice', 'prompt' => 'Hello there.', 'params' => ['voice' => 'nope123'],
        ])->assertCreated()->json('id');
        $this->assertSame(['failed', 'OmniVoice doesn’t have that voice. Pick one from the list.'], [Generation::find($id)->status, Generation::find($id)->error]);
        Http::assertNotSent(fn (Request $r) => str_ends_with($r->url(), '/v1/audio/speech'));

        $this->spa()->postJson('/api/generations', ['kind' => 'audio', 'model' => 'voicestudio/omnivoice', 'prompt' => 'Hi.', 'params' => ['format' => 'ogg', 'speed' => 5]])
            ->assertJsonValidationErrors(['params.format', 'params.speed']);
        $this->spa()->postJson('/api/generations', ['kind' => 'audio', 'model' => 'higgsfield/ideogram-4', 'prompt' => 'Hi.'])
            ->assertJsonValidationErrors('model');
    }

    public function test_video_starts_from_an_uploaded_image_and_failures_can_be_retried_differently(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        $user = User::factory()->create();
        Storage::disk('local')->put('assets/x/still.png', base64_decode(self::PNG));
        $still = Asset::factory()->for($user)->create(['path' => 'assets/x/still.png', 'mime' => 'image/png']);

        // No image: refused before anything is spent.
        $this->actingAs($user)->spa()->postJson('/api/generations', ['kind' => 'video', 'model' => 'higgsfield/wan-2-7-i2v', 'prompt' => 'Slow push in'])->assertCreated();
        $this->assertSame('Wan 2.7 · image to video starts from an image. Pick one first.', Generation::latest('id')->first()->error);

        Http::fake([
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/still.png', 'upload_url' => 'https://upload.example/put', 'upload_headers' => ['x-amz-acl' => 'private']]),
            'upload.example/put' => Http::response('', 200),
            'api.higgsfield.ai/wan/v2.7/image-to-video' => Http::sequence()
                ->push(['detail' => [['msg' => 'duration must be ≤ 15']]], 422)
                ->push(['request_id' => 'v-2', 'status_url' => 'https://api.higgsfield.ai/requests/v-2/status']),
            'api.higgsfield.ai/requests/v-2/status' => Http::response(['status' => 'nsfw']),
        ]);
        $id = $this->spa()->postJson('/api/generations', ['kind' => 'video', 'model' => 'higgsfield/wan-2-7-i2v', 'prompt' => 'Slow push in', 'input_asset_ids' => [$still->id], 'params' => ['duration' => 15]])->json('id');
        $failed = Generation::find($id);
        $this->assertSame(['failed', 'Higgsfield didn’t accept those settings: duration must be ≤ 15.'], [$failed->status, $failed->error]);
        // The input went up through the presigned URL, without the API key.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://upload.example/put' && ! $r->hasHeader('Authorization') && $r->hasHeader('x-amz-acl', 'private'));
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), 'image-to-video') && $r['image_url'] === 'https://files.example/still.png');

        // Retry with an edited prompt: a new generation that remembers what it replaces.
        $retry = $this->spa()->postJson("/api/generations/{$id}/retry", ['prompt' => 'Slow push in, candle flame flickers'])
            ->assertCreated()->assertJsonPath('retry_of', $id)->assertJsonPath('prompt', 'Slow push in, candle flame flickers')->json('id');
        $this->assertStringContainsString('flagged the result as unsafe', Generation::find($retry)->error);
        // Two submissions down one route, two idempotency keys, so the edited prompt is actually
        // rendered instead of being served the cached answer to the prompt it replaces.
        $keys = Http::recorded(fn (Request $r) => str_ends_with($r->url(), 'image-to-video'))
            ->map(fn ($pair) => $pair[0]->header('Idempotency-Key')[0] ?? null);
        $this->assertSame([2, 2], [$keys->count(), $keys->unique()->count()]);

        // Switching to a model that can't run is refused up front.
        $this->spa()->postJson("/api/generations/{$id}/retry", ['model' => 'higgsfield/seedance-2-5'])->assertCreated();
        $this->assertSame('Seedance 2.5 isn’t available: No API route for this model yet.', Generation::latest('id')->first()->error);
    }

    public function test_each_higgsfield_model_gets_only_the_fields_its_schema_takes(): void
    {
        $provider = app(HiggsfieldProvider::class);
        $spec = fn (string $id) => config("ai.providers.higgsfield.models.{$id}");

        // Soul 2 has no 4:5, so the nearest ratio goes; resolution and batch size are filled in;
        // a big studio seed is folded into Higgsfield's 1..1,000,000.
        [$route, $body] = $provider->request($spec('soul-2'), 'p', ['aspect_ratio' => '4:5', 'seed' => 3_000_000_123], 0);
        $this->assertSame('/higgsfield-ai/soul/v2/standard', $route);
        $this->assertSame(['prompt' => 'p', 'aspect_ratio' => '3:4', 'seed' => 124, 'resolution' => '1080p', 'batch_size' => 1], $body);

        // Kling: sound is "on"/"off", lengths snap to what it offers.
        [$route, $body] = $provider->request($spec('kling-3-pro'), 'p', ['aspect_ratio' => '9:16', 'duration' => 7, 'audio' => false], 0);
        $this->assertSame(['/kling-video/v3.0/pro/text-to-video', ['prompt' => 'p', 'aspect_ratio' => '9:16', 'duration' => 8, 'sound' => 'off']], [$route, $body]);
        // With a start frame it switches to image-to-video, which takes its shape from the frame.
        [$route, $body] = $provider->request($spec('kling-3-pro'), 'p', ['aspect_ratio' => '9:16', 'duration' => 15], 1);
        $this->assertSame(['/kling-video/v3.0/pro/image-to-video', ['prompt' => 'p', 'duration' => 15, 'sound' => 'on']], [$route, $body]);

        // Seedance: generate_audio is a bool, 4K is allowed; a resolution it doesn't offer falls back to its default.
        [, $body] = $provider->request($spec('seedance-2'), 'p', ['duration' => 10, 'resolution' => '4k', 'audio' => true], 0);
        $this->assertSame(['prompt' => 'p', 'duration' => 10, 'resolution' => '4k', 'generate_audio' => true], $body);
        [, $body] = $provider->request($spec('seedance-2'), 'p', ['resolution' => '2k'], 0);
        $this->assertSame('1080p', $body['resolution']);

        // Hailuo takes no aspect and only 6 or 10 seconds.
        [, $body] = $provider->request($spec('hailuo-2-3'), 'p', ['aspect_ratio' => '16:9', 'duration' => 7], 0);
        $this->assertSame(['prompt' => 'p', 'duration' => 6, 'prompt_optimizer' => true], $body);
    }

    public function test_the_registry_tells_the_studio_what_each_model_can_take(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        config(['ai.providers.higgsfield.plan' => []]); // empty: every model with a route

        $list = collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->json('models'))->keyBy('id');

        $this->assertTrue($list['higgsfield/kling-3-pro']['available']);
        $this->assertEquals(['durations' => [5, 8, 10, 15], 'audio' => true, 'end_frame' => true, 'image_input' => true, 'requires_image' => false],
            collect($list['higgsfield/kling-3-pro']['caps'])->only(['durations', 'audio', 'end_frame', 'image_input', 'requires_image'])->all());
        $this->assertSame(['1k', '2k'], $list['higgsfield/grok-image-2']['caps']['resolutions']);
        $this->assertSame(10, $list['higgsfield/grok-image-2']['caps']['max_images']);
        $this->assertFalse($list['higgsfield/soul-2']['caps']['image_input']);
        $this->assertSame('Kling', $list['higgsfield/kling-3-pro']['family']);
        $this->assertNull($list['anthropic/claude-opus-5-5']['caps']);
    }

    public function test_a_video_runs_from_a_start_frame_to_an_end_frame(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        config(['ai.providers.higgsfield.plan' => []]);
        $user = User::factory()->create();
        Storage::disk('local')->put('assets/x/a.png', base64_decode(self::PNG));
        Storage::disk('local')->put('assets/x/b.png', base64_decode(self::PNG));
        $start = Asset::factory()->for($user)->create(['path' => 'assets/x/a.png', 'mime' => 'image/png']);
        $end = Asset::factory()->for($user)->create(['path' => 'assets/x/b.png', 'mime' => 'image/png']);
        Http::fake([
            'api.higgsfield.ai/files/generate-upload-url' => Http::sequence()
                ->push(['public_url' => 'https://files.example/a.png', 'upload_url' => 'https://upload.example/a'])
                ->push(['public_url' => 'https://files.example/b.png', 'upload_url' => 'https://upload.example/b']),
            'upload.example/*' => Http::response('', 200),
            'api.higgsfield.ai/kling-video/v3.0/pro/image-to-video' => Http::response(['request_id' => 'k-1', 'status_url' => 'https://api.higgsfield.ai/requests/k-1/status']),
            'api.higgsfield.ai/requests/k-1/status' => Http::sequence()
                ->push(['status' => 'in_progress'])
                ->push(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/k.mp4']]),
            'cdn.example/k.mp4' => Http::response('not really a video', 200),
        ]);

        $this->actingAs($user)->spa()->postJson('/api/generations', [
            'kind' => 'video', 'model' => 'higgsfield/kling-3-pro', 'prompt' => 'The jar turns to face the window',
            'input_asset_ids' => [$start->id, $end->id], 'params' => ['duration' => 10, 'audio' => true, 'aspect_ratio' => '9:16'],
        ])->assertCreated();

        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/kling-video/v3.0/pro/image-to-video')
            && $r['image_url'] === 'https://files.example/a.png' && $r['last_image_url'] === 'https://files.example/b.png'
            && $r['duration'] === 10 && $r['sound'] === 'on' && ! isset($r['aspect_ratio']));
    }

    public function test_grok_edits_from_a_list_of_reference_images(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        config(['ai.providers.higgsfield.plan' => []]);
        $user = User::factory()->create();
        Storage::disk('local')->put('assets/x/a.png', base64_decode(self::PNG));
        $ref = Asset::factory()->for($user)->create(['path' => 'assets/x/a.png', 'mime' => 'image/png']);
        Http::fake([
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/a.png', 'upload_url' => 'https://upload.example/a']),
            'upload.example/*' => Http::response('', 200),
            'api.higgsfield.ai/xai/grok-imagine-image-2.0' => Http::response(['request_id' => 'g-1', 'status_url' => 'https://api.higgsfield.ai/requests/g-1/status']),
            'api.higgsfield.ai/requests/g-1/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/g.jpg']]]),
            'cdn.example/g.jpg' => Http::response(base64_decode(self::PNG)),
        ]);

        $id = $this->actingAs($user)->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'higgsfield/grok-image-2', 'prompt' => 'Put the jar on a marble counter',
            'input_asset_ids' => [$ref->id], 'params' => ['aspect_ratio' => '1:1'],
        ])->assertCreated()->json('id');

        $this->assertSame('succeeded', Generation::find($id)->status);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), 'grok-imagine-image-2.0')
            && $r['image_urls'] === ['https://files.example/a.png'] && $r['quality'] === 'medium' && $r['resolution'] === '2k');
    }

    public function test_the_gallery_lists_finished_media_by_search_and_shape_a_page_at_a_time(): void
    {
        $user = User::factory()->create();
        $make = fn (array $a) => $user->generations()->create($a + ['model' => 'higgsfield/soul-2', 'status' => 'succeeded']);
        $reel = $make(['kind' => 'video', 'prompt' => 'Candle reveal for a reel', 'params' => ['aspect_ratio' => '9:16', 'duration' => 8, 'style' => 'ugc', 'base_prompt' => 'Candle reveal']]);
        $still = $make(['kind' => 'image', 'prompt' => 'Candle on linen', 'params' => ['aspect_ratio' => '4:5']]);
        $make(['kind' => 'text', 'prompt' => 'Candle captions']);
        $make(['kind' => 'image', 'prompt' => 'Candle that failed', 'status' => 'failed', 'params' => ['aspect_ratio' => '9:16']]);
        $other = User::factory()->create()->generations()->create(['kind' => 'image', 'model' => 'x', 'prompt' => 'Candle elsewhere', 'status' => 'succeeded']);

        $ids = fn (array $query) => collect($this->actingAs($user)->spa()->getJson('/api/generations?'.http_build_query($query))->assertOk()->json())->pluck('id')->all();

        $this->assertSame([$still->id, $reel->id], $ids(['media' => 1, 'status' => 'succeeded']));
        $this->assertSame([$reel->id], $ids(['media' => 1, 'status' => 'succeeded', 'aspect' => '9:16']));
        $this->assertSame([$still->id], $ids(['media' => 1, 'status' => 'succeeded', 'q' => 'linen']));
        $this->assertSame([$still->id], $ids(['media' => 1, 'status' => 'succeeded', 'limit' => 1]));
        $this->assertSame([$reel->id], $ids(['media' => 1, 'status' => 'succeeded', 'before_id' => $still->id]));
        $this->assertNotContains($other->id, $ids(['media' => 1]));
        // What a remake needs comes back as it was saved: the style and the prompt before it.
        $this->spa()->getJson("/api/generations/{$reel->id}")->assertJsonPath('params.style', 'ugc')->assertJsonPath('params.base_prompt', 'Candle reveal');
    }

    public function test_a_job_that_dies_never_leaves_a_generation_waiting_forever(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $make = fn (array $a) => $user->generations()->create($a + ['kind' => 'image', 'model' => 'higgsfield/soul-2', 'prompt' => 'cat']);
        $locked = new \PDOException('SQLSTATE[HY000]: General error: 5 database is locked');

        // Never reached the provider: failed, with a way forward.
        $queued = $make(['status' => 'queued']);
        (new RunGeneration($queued->id))->failed($locked);
        $this->assertSame('failed', $queued->fresh()->status);
        $this->assertStringContainsString('try again', $queued->fresh()->error);

        // Already with the provider: keep polling rather than lose what's being made.
        $sent = $make(['status' => 'running', 'external_id' => 'hf-1', 'started_at' => now()]);
        (new RunGeneration($sent->id))->failed($locked);
        $this->assertSame('running', $sent->fresh()->status);
        Queue::assertPushed(PollGeneration::class, fn (PollGeneration $job) => $job->generationId === $sent->id);

        // A poll that dies asks again, up to a point.
        (new PollGeneration($sent->id, 3))->failed($locked);
        Queue::assertPushed(PollGeneration::class, fn (PollGeneration $job) => $job->generationId === $sent->id && $job->attempt === 4);
        (new PollGeneration($sent->id, 60))->failed($locked);
        $this->assertSame('failed', $sent->fresh()->status);

        // Finished ones are left alone.
        $done = $make(['status' => 'succeeded']);
        (new RunGeneration($done->id))->failed($locked);
        $this->assertSame('succeeded', $done->fresh()->status);
    }

    public function test_comfyui_runs_a_workflow_on_your_own_gpu(): void
    {
        $this->fakeClaude();
        config(['ai.providers.comfyui.url' => 'http://comfy.test:8188']);
        Http::fake([
            'comfy.test:8188/system_stats' => Http::response(['system' => ['comfyui_version' => '0.3.60'], 'devices' => [['name' => 'cuda:0 RTX 4090']]]),
            'comfy.test:8188/object_info/UNETLoader' => Http::response(['UNETLoader' => ['input' => ['required' => ['unet_name' => [['z_image_turbo_bf16.safetensors']]]]]]),
            'comfy.test:8188/prompt' => Http::response(['prompt_id' => 'c-1']),
            'comfy.test:8188/history/c-1' => Http::sequence()
                ->push([])
                ->push(['c-1' => ['status' => ['status_str' => 'success'], 'outputs' => ['9' => ['images' => [['filename' => 'flowai_00001_.png', 'subfolder' => 'flowai', 'type' => 'output']]]]]]),
            'comfy.test:8188/view*' => Http::response(base64_decode(self::PNG)),
        ]);
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/models/test/comfyui')->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Connected. ComfyUI 0.3.60 on cuda:0 RTX 4090.');
        $id = $this->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'comfyui/z-image-turbo', 'prompt' => 'Amber jar on linen', 'params' => ['aspect_ratio' => '4:5', 'seed' => 42],
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame(['succeeded', 'c-1'], [$generation->status, $generation->external_id]);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/prompt')
            && $r['prompt']['57:27']['inputs']['text'] === 'Amber jar on linen'
            && $r['prompt']['57:3']['inputs']['seed'] === 42
            && [$r['prompt']['57:13']['inputs']['width'], $r['prompt']['57:13']['inputs']['height']] === [1024, 1280]);
        Http::assertSent(fn (Request $r) => str_contains($r->url(), '/view?filename=flowai_00001_.png&subfolder=flowai&type=output'));
    }

    public function test_the_text_to_video_recipe_runs_its_steps_on_its_own(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        Http::fake([
            'api.higgsfield.ai/ideogram/v4.0' => Http::response(['request_id' => 'i-1', 'status_url' => 'https://api.higgsfield.ai/requests/i-1/status']),
            'api.higgsfield.ai/requests/i-1/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/still.png']]]),
            'cdn.example/still.png' => Http::response(base64_decode(self::PNG)),
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/still.png', 'upload_url' => 'https://upload.example/put']),
            'upload.example/put' => Http::response('', 200),
            'api.higgsfield.ai/wan/v2.7/image-to-video' => Http::response(['request_id' => 'v-1', 'status_url' => 'https://api.higgsfield.ai/requests/v-1/status']),
            'api.higgsfield.ai/requests/v-1/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/clip.mp4']]),
            'cdn.example/clip.mp4' => Http::response('not really a video', 200),
        ]);

        $this->actingAs(User::factory()->create())->spa()->postJson('/api/recipes/text_to_video', [
            'prompt' => 'Amber jar on a linen table', 'motion' => 'Candle flame flickers, slow dolly in',
            'image_model' => 'higgsfield/ideogram-4', 'video_model' => 'higgsfield/wan-2-7-i2v', 'duration' => 5,
        ])->assertCreated()->assertJsonPath('recipe', 'text_to_video')->assertJsonPath('recipe_step', 0);

        [$image, $video] = Generation::orderBy('id')->get();
        $this->assertSame(['image', 'succeeded'], [$image->kind, $image->status]);
        $this->assertSame(['video', 1, $image->id, $image->output_asset_ids, 'Candle flame flickers, slow dolly in', 'succeeded'],
            [$video->kind, $video->recipe_step, $video->parent_id, $video->input_asset_ids, $video->prompt, $video->status]);

        $this->spa()->postJson('/api/recipes/image_to_video', ['prompt' => 'x', 'video_model' => 'higgsfield/wan-2-7-i2v'])
            ->assertJsonValidationErrors(['asset_id' => 'Pick the image to start from.']);
    }

    public function test_an_openai_compatible_gateway_streams_text_and_answers_in_json(): void
    {
        $this->fakeClaude();
        config(['ai.providers.gateway.url' => 'https://gw.example/v1', 'ai.providers.gateway.key' => 'team-key', 'ai.prices.llama-3.3-70b' => [1, 2]]);
        $sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Slow \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"mornings.\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n";
        Http::fake([
            'gw.example/v1/models' => Http::response(['data' => [['id' => 'llama-3.3-70b']]]),
            'gw.example/v1/chat/completions' => Http::response($sse, 200, ['Content-Type' => 'text/event-stream']),
        ]);

        $user = User::factory()->create();
        $events = $this->events($this->actingAs($user)->spa()->postJson('/api/generations/text', ['prompt' => 'A line about mornings', 'model' => 'gateway/llama-3.3-70b']));
        $this->assertSame('done', end($events)['event']);
        $this->assertSame('Slow mornings.', Generation::first()->output_text);
        $this->assertDatabaseHas('ai_usages', ['provider' => 'gateway', 'model' => 'llama-3.3-70b', 'input_tokens' => 12, 'output_tokens' => 4, 'user_id' => $user->id, 'purpose' => 'studio']);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/chat/completions') && $r['model'] === 'llama-3.3-70b' && $r['stream'] === true);
    }

    public function test_a_fixed_reasoning_effort_overrides_every_caller_on_the_gateway(): void
    {
        $this->fakeClaude();
        config(['ai.providers.gateway.url' => 'https://gw.example/v1', 'ai.providers.gateway.key' => 'team-key', 'ai.providers.gateway.reasoning_effort' => 'low']);
        $sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Calm.\"}}]}\n\ndata: [DONE]\n\n";
        Http::fake([
            'gw.example/v1/models' => Http::response(['data' => [['id' => 'glm-5.3-flash']]]),
            'gw.example/v1/chat/completions' => Http::sequence()
                ->push($sse, 200, ['Content-Type' => 'text/event-stream'])
                ->push(['choices' => [['message' => ['content' => '{"headline":"Calm"}']]]])
                ->push(['choices' => [['message' => ['content' => '{"headline":"Calm"}']]]]),
        ]);

        // Through the app: the studio's text generation goes out at "low".
        $user = User::factory()->create();
        $this->events($this->actingAs($user)->spa()->postJson('/api/generations/text', ['prompt' => 'A calm line', 'model' => 'gateway/glm-5.3-flash']));
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/chat/completions') && $r['reasoning_effort'] === 'low');

        // A caller asking for "medium" still gets "low" while the setting is on...
        $schema = ['type' => 'object', 'properties' => ['headline' => ['type' => 'string']], 'required' => ['headline']];
        (new OpenAiCompatibleGenerator('gateway', 'https://gw.example/v1', 'team-key', null, 'low'))->json('glm-5.3-flash', 'sys', 'go', $schema, 'medium');
        // ...and its own choice when the setting is empty.
        (new OpenAiCompatibleGenerator('gateway', 'https://gw.example/v1', 'team-key'))->json('glm-5.3-flash', 'sys', 'go', $schema, 'medium');

        $efforts = collect(Http::recorded())->map(fn ($pair) => $pair[0])
            ->filter(fn (Request $r) => str_ends_with($r->url(), '/chat/completions'))
            ->map(fn (Request $r) => $r['reasoning_effort'] ?? null)->values()->all();
        $this->assertSame(['low', 'low', 'medium'], $efforts);
    }

    public function test_plain_models_are_never_sent_a_reasoning_effort(): void
    {
        Http::fake(['gw.example/v1/chat/completions' => Http::response(['choices' => [['message' => ['content' => '{"headline":"Calm"}']]]])]);
        $schema = ['type' => 'object', 'properties' => ['headline' => ['type' => 'string']], 'required' => ['headline']];
        $gateway = new OpenAiCompatibleGenerator('gateway', 'https://gw.example/v1', 'team-key', null, 'low', ['gemma4']);

        // Gemma answers directly; any reasoning_effort would switch its thinking on, so none is sent,
        // not the gateway's "low" and not a caller's "medium". GLM on the same gateway still gets "low".
        $gateway->json('gemma4:31b', 'sys', 'go', $schema, 'medium');
        $gateway->json('glm-5.3-flash', 'sys', 'go', $schema, 'medium');

        $sent = collect(Http::recorded())->map(fn ($pair) => $pair[0]);
        $this->assertFalse(isset($sent[0]['reasoning_effort']));
        $this->assertSame('gemma4:31b', $sent[0]['model']);
        $this->assertSame('low', $sent[1]['reasoning_effort']);
    }

    public function test_evals_score_a_model_by_rules_and_by_a_judge(): void
    {
        $this->fakeClaude(['Hand-poured lavender & fig, from our Lyon studio. #candles #slowliving'], json: fn (array $schema) => isset($schema['properties']['headline'])
            ? ['headline' => 'Autumn is pouring', 'hashtags' => ['#autumn', '#candles', '#lyon']]
            : ['score' => 90, 'reason' => 'Specific.']);
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/models/evals', ['model' => 'anthropic/claude-sonnet-5-5'])->assertStatus(202);

        $scores = ModelEval::where('model', 'anthropic/claude-sonnet-5-5')->pluck('score', 'task');
        $this->assertCount(5, $scores);
        $this->assertSame(100, $scores['json']);
        // The caption passes every rule; the French task can't, with an English answer.
        $this->assertGreaterThan($scores['french'], $scores['caption']);
        $this->spa()->getJson('/api/models/evals')->assertJsonPath('results.anthropic/claude-sonnet-5-5.json.score', 100);
        $this->assertNotNull(collect($this->spa()->getJson('/api/models')->json('models'))->firstWhere('id', 'anthropic/claude-sonnet-5-5')['score']);
    }

    public function test_projects_keep_a_canvas(): void
    {
        $user = User::factory()->create();
        $id = $this->actingAs($user)->spa()->postJson('/api/projects', ['name' => 'Autumn launch'])->assertCreated()->assertJsonPath('canvas.nodes', [])->json('id');

        $this->spa()->patchJson("/api/projects/{$id}", ['canvas' => [
            'nodes' => [['id' => 'n1', 'type' => 'note', 'x' => 40, 'y' => 60, 'text' => 'Hook ideas'], ['id' => 'n2', 'type' => 'asset', 'x' => 300, 'y' => 60, 'ref' => 7]],
            'edges' => [['from' => 'n1', 'to' => 'n2']],
            'view' => ['x' => 0, 'y' => 0, 'zoom' => 1],
        ]])->assertOk()->assertJsonPath('nodes', 2)->assertJsonPath('canvas.edges.0.to', 'n2');

        $this->spa()->patchJson("/api/projects/{$id}", ['canvas' => ['nodes' => [['id' => 'x', 'type' => 'spaceship', 'x' => 0, 'y' => 0]]]])->assertJsonValidationErrors('canvas.nodes.0.type');
        $this->actingAs(User::factory()->create())->spa()->getJson("/api/projects/{$id}")->assertForbidden();
    }
}
