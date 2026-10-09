<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Board;
use App\Models\Generation;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Media\AssetStore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CreativeLabTest extends TestCase
{
    use RefreshDatabase;

    private const ZI = [
        'key' => 'zi-key', 'name' => 'Z-Image Turbo', 'base' => 'z-image', 'type' => 'main', 'hash' => 'blake3:abc',
        'description' => 'Z-Image Turbo - fast 6B parameter text-to-image model with 8 inference steps. Supports bilingual prompts.',
        'default_settings' => ['steps' => 9, 'cfg_scale' => 1, 'width' => 1024, 'height' => 1024, 'scheduler' => 'euler'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['ai.providers.invoke.url' => 'http://invoke.test:9090']);
    }

    /**
     * @param  list<array<string, mixed>>  $items  what queue item 11 says when asked, in turn
     * @param  array<string, mixed>|null  $second  what queue item 12 says
     */
    private function fakeInvoke(array $items = [], ?array $second = null): void
    {
        $done = fn (int $id, string $image) => ['item_id' => $id, 'status' => 'completed', 'session' => [
            'source_prepared_mapping' => ['canvas_output' => ["prep-{$id}"]],
            'results' => ["prep-{$id}" => ['image' => ['image_name' => $image]]],
        ]];
        Http::fake([
            'invoke.test:9090/api/v1/app/version' => Http::response(['version' => '7.0.0']),
            'invoke.test:9090/api/v2/models/capabilities' => Http::response([['base' => 'z-image', 'features' => ['dimension_grid' => 16]]]),
            'invoke.test:9090/api/v2/models/*' => Http::response(['models' => [self::ZI, ['key' => 'xl-key', 'name' => 'Juggernaut XL', 'base' => 'sdxl', 'type' => 'main']]]),
            'invoke.test:9090/api/v1/images/upload*' => Http::sequence()->push(['image_name' => 'up-image.png'])->push(['image_name' => 'up-mask.png'])->whenEmpty(Http::response(['image_name' => 'up-more.png'])),
            'invoke.test:9090/api/v1/queue/default/enqueue_batch' => Http::response(['queue_id' => 'default', 'enqueued' => 2, 'requested' => 2, 'batch' => [], 'priority' => 0, 'item_ids' => [11, 12]]),
            'invoke.test:9090/api/v1/queue/default/i/11' => Http::sequence(array_map(fn (array $body) => Http::response($body), $items = $items ?: [['item_id' => 11, 'status' => 'in_progress', 'session' => []], $done(11, 'out-1.png')]))->whenEmpty(Http::response(end($items))),
            'invoke.test:9090/api/v1/queue/default/i/12' => Http::response($second ?? $done(12, 'out-2.png')),
            'invoke.test:9090/api/v1/images/i/*' => Http::response($this->png(8, 8), 200, ['Content-Type' => 'image/png']),
        ]);
    }

    private function png(int $width, int $height, bool $transparentEdge = false): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, $transparentEdge ? imagecolorallocatealpha($image, 0, 0, 0, 127) : imagecolorallocate($image, 200, 120, 40));
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    /** The batch FlowAI sent to Invoke. */
    private function batch(): array
    {
        return collect(Http::recorded())->map(fn ($pair) => $pair[0])->first(fn (Request $r) => str_ends_with($r->url(), '/enqueue_batch'))['batch'];
    }

    public function test_invoke_models_are_listed_and_only_families_with_a_graph_can_run(): void
    {
        $this->fakeInvoke();
        $this->actingAs(User::factory()->create());

        $list = collect($this->spa()->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');
        $zi = $list['invoke/zi-key'];
        $this->assertSame(['image', true, 'InvokeAI', true], [$zi['kind'], $zi['available'], $zi['reach'], $zi['local']]);
        $this->assertSame('On your GPU · Fast 6B parameter text-to-image model with 8 inference steps', $zi['purpose']);
        $this->assertSame([true, 9, 4], [$zi['capabilities']['edit'], $zi['capabilities']['steps'], $zi['capabilities']['max_outputs']]);
        $this->assertSame('FlowAI can’t drive sdxl models yet; Z-Image models work today.', $list['invoke/xl-key']['reason']);

        $this->spa()->postJson('/api/models/test/invoke')->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Connected to InvokeAI 7.0.0. 2 models: Z-Image Turbo, Juggernaut XL.');
    }

    public function test_a_prompt_runs_on_invoke_with_variations_and_lands_on_the_chosen_board(): void
    {
        $this->fakeInvoke();
        $user = User::factory()->create();
        $board = $this->actingAs($user)->spa()->postJson('/api/boards', ['name' => 'Autumn launch'])->assertCreated()->json('id');

        $id = $this->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'Amber candle on linen', 'board_id' => $board,
            'params' => ['aspect_ratio' => '16:9', 'batch_size' => 2, 'seed' => 42, 'steps' => 8],
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame(['succeeded', '11,12'], [$generation->status, $generation->external_id], (string) $generation->error);
        $assets = Asset::whereIn('id', $generation->output_asset_ids)->get();
        $this->assertCount(2, $assets);
        $this->assertSame([$board, $board], $assets->pluck('board_id')->all());

        $batch = $this->batch();
        $nodes = $batch['graph']['nodes'];
        $this->assertSame('z_image_model_loader', $nodes['model_loader']['type']);
        $this->assertSame('zi-key', $nodes['model_loader']['model']['key']);
        // 16:9 at the model's 1024² area, on a 16-pixel grid.
        $this->assertSame([1360, 768, 8, 'z_image_l2i'], [$nodes['denoise_latents']['width'], $nodes['denoise_latents']['height'], $nodes['denoise_latents']['steps'], $nodes['canvas_output']['type']]);
        $this->assertArrayNotHasKey('neg_cond', $nodes); // guidance 1 ignores a negative prompt
        $this->assertSame(['denoise_latents', 'seed', [42, 43]], [$batch['data'][0][0]['node_path'], $batch['data'][0][0]['field_name'], $batch['data'][0][0]['items']]);

        $boards = $this->spa()->getJson('/api/boards')->assertOk();
        $this->assertSame([2, 0], [$boards->json('data.0.count'), $boards->json('unfiled')]);
        $this->spa()->getJson("/api/assets?board={$board}")->assertJsonCount(2, 'data');
        $this->spa()->getJson('/api/assets?board=none')->assertJsonCount(0, 'data');
    }

    public function test_a_painted_area_is_regenerated_and_blended_back_over_the_original(): void
    {
        $this->fakeInvoke();
        $user = User::factory()->create();
        $photo = app(AssetStore::class)->fromContents($user, $this->png(64, 48), 'image/png', 'cafe.png', 'upload');

        $this->actingAs($user)->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'a croissant', 'input_asset_ids' => [$photo->id],
            'params' => ['mode' => 'inpaint'], 'mask' => 'data:image/png;base64,'.base64_encode($this->png(32, 32)),
        ])->assertJsonValidationErrors(['mask' => 'The painted area has to be the same size as the image.']);

        $id = $this->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'a croissant', 'input_asset_ids' => [$photo->id],
            'params' => ['mode' => 'inpaint', 'strength' => 0.6], 'mask' => 'data:image/png;base64,'.base64_encode($this->png(64, 48)),
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame('succeeded', $generation->status, (string) $generation->error);
        [$source, $mask] = $generation->inputs();
        $this->assertSame([$photo->id, 'mask'], [$source->id, $mask->source]);
        // The working mask stays out of the library.
        $this->assertNotContains($mask->id, $this->spa()->getJson('/api/assets')->json('data.*.id'));

        $nodes = $this->batch()['graph']['nodes'];
        $this->assertSame(['tomask', true, 'up-mask.png'], [$nodes['user_mask']['type'], $nodes['user_mask']['invert'], $nodes['user_mask']['image']['image_name']]);
        $this->assertSame(0.4, $nodes['denoise_latents']['denoising_start']);
        $this->assertSame(['invokeai_img_blend', 'up-image.png', false], [$nodes['canvas_output']['type'], $nodes['canvas_output']['layer_base']['image_name'], $nodes['canvas_output']['is_intermediate']]);
        $this->assertArrayHasKey('create_gradient_mask', $nodes);
        // 64×48 is worked at the model's size, then put back.
        $this->assertSame([1184, 880], [$nodes['denoise_latents']['width'], $nodes['denoise_latents']['height']]);
        $this->assertSame([64, 48], [$nodes['canvas_resize_generated_to_bbox']['width'], $nodes['canvas_resize_generated_to_bbox']['height']]);
        $this->assertArrayNotHasKey('infill', $nodes);
    }

    public function test_extending_an_image_infills_its_transparent_edges(): void
    {
        $this->fakeInvoke();
        $user = User::factory()->create();

        $id = $this->actingAs($user)->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'more of the street',
            'params' => ['mode' => 'outpaint'],
            'image' => 'data:image/png;base64,'.base64_encode($this->png(1184, 880, transparentEdge: true)),
            'mask' => 'data:image/png;base64,'.base64_encode($this->png(1184, 880, transparentEdge: true)),
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame('succeeded', $generation->status, (string) $generation->error);
        $this->assertSame(['mask', 'mask'], $generation->inputs()->pluck('source')->all());
        $nodes = $this->batch()['graph']['nodes'];
        $this->assertSame(['infill_patchmatch', 'mask_combine'], [$nodes['infill']['type'], $nodes['mask_combine']['type']]);
        // Already the model's size: nothing to resize.
        $this->assertArrayNotHasKey('canvas_resize_initial_to_processing', $nodes);
    }

    public function test_an_out_of_memory_gpu_is_explained(): void
    {
        $this->fakeInvoke(
            [['item_id' => 11, 'status' => 'failed', 'error_type' => 'AcceleratorError', 'error_message' => "CUDA error: out of memory\nSearch for cudaErrorMemoryAllocation", 'session' => []]],
            ['item_id' => 12, 'status' => 'failed', 'error_message' => 'CUDA error: out of memory', 'session' => []],
        );

        $id = $this->actingAs(User::factory()->create())->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'make a duck',
        ])->assertCreated()->json('id');

        $this->assertSame(
            ['failed', 'The InvokeAI GPU is out of memory. Something else on that machine is probably holding it; free it and try again.'],
            [Generation::find($id)->status, Generation::find($id)->error],
        );
    }

    public function test_an_image_is_upscaled_by_invokes_built_in_real_esrgan(): void
    {
        $this->fakeInvoke();
        $user = User::factory()->create();
        $photo = app(AssetStore::class)->fromContents($user, $this->png(64, 48), 'image/png', 'cafe.png', 'upload');
        $this->actingAs($user);

        $upscaler = collect($this->spa()->getJson('/api/models')->json('models'))->firstWhere('id', 'invoke/esrgan');
        $this->assertSame([true, true, [2, 4]], [$upscaler['available'], $upscaler['capabilities']['upscale'], $upscaler['capabilities']['scales']]);

        // An upscaler can't make an image from a prompt, and a model that can't upscale won't.
        $this->spa()->postJson('/api/generations', ['kind' => 'image', 'model' => 'invoke/esrgan', 'prompt' => 'a duck'])->assertJsonValidationErrors('model');
        $this->spa()->postJson('/api/generations', ['kind' => 'image', 'model' => 'invoke/zi-key', 'prompt' => 'Upscale', 'params' => ['mode' => 'upscale'], 'input_asset_ids' => [$photo->id]])->assertJsonValidationErrors('model');

        $id = $this->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'invoke/esrgan', 'prompt' => 'Upscale 2×', 'params' => ['mode' => 'upscale', 'scale' => 2], 'input_asset_ids' => [$photo->id],
        ])->assertCreated()->json('id');

        $this->assertSame('succeeded', Generation::find($id)->status, (string) Generation::find($id)->error);
        $batch = $this->batch();
        $this->assertArrayNotHasKey('data', $batch); // no seed to vary
        $this->assertSame(['esrgan', 'RealESRGAN_x2plus.pth', 'up-image.png'], [
            $batch['graph']['nodes']['canvas_output']['type'], $batch['graph']['nodes']['canvas_output']['model_name'], $batch['graph']['nodes']['canvas_output']['image']['image_name'],
        ]);
    }

    private function fakeWriter(string $text = 'Fresh from the oven. Come early.'): void
    {
        $this->app->instance(TextGenerator::class, new class($text) implements TextGenerator
        {
            public function __construct(private string $text) {}

            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): \Generator
            {
                yield $this->text;
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                return [];
            }
        });
    }

    public function test_a_workflow_runs_every_step_from_the_one_before_and_drafts_the_post(): void
    {
        $this->fakeInvoke();
        $this->fakeWriter();
        $user = User::factory()->create(['preferences' => ['platforms' => ['instagram', 'tiktok']]]);
        $board = Board::forceCreate(['user_id' => $user->id, 'name' => 'Launch']);
        $steps = [
            ['type' => 'image', 'model' => 'invoke/zi-key', 'aspect_ratio' => '9:16'],
            ['type' => 'upscale', 'model' => 'invoke/esrgan', 'scale' => 2],
            ['type' => 'write', 'model' => 'anthropic/claude-sonnet-5-5', 'prompt' => 'A caption for {prompt}'],
            ['type' => 'post'],
        ];
        $this->actingAs($user);

        $saved = $this->spa()->postJson('/api/workflows', ['name' => 'Bakery post', 'steps' => $steps])->assertCreated();
        $this->assertSame('{prompt}', $saved->json('steps.0.prompt'));

        $run = $this->spa()->postJson('/api/workflows/run', ['workflow_id' => $saved->json('id'), 'name' => 'Bakery post', 'steps' => $steps, 'prompt' => 'warm croissants', 'board_id' => $board->id])
            ->assertCreated()->json();
        $runs = $this->spa()->getJson('/api/workflow-runs')->assertOk()->json();
        $this->assertSame('succeeded', $runs[0]['status'], (string) $runs[0]['error']);
        $this->assertSame(['succeeded', 'succeeded', 'succeeded', 'succeeded'], array_column($runs[0]['steps'], 'status'));
        $this->assertSame($run['id'], $runs[0]['id']);

        // Step 2 upscaled what step 1 made; every file landed on the run's board.
        $generations = Generation::where('workflow_run_id', $run['id'])->orderBy('id')->get();
        $this->assertSame(['image', 'image', 'text'], $generations->pluck('kind')->all());
        $this->assertSame('upscale', $generations[1]->params['mode']);
        $this->assertContains($generations[1]->input_asset_ids[0], $generations[0]->output_asset_ids);
        $this->assertSame('A caption for warm croissants', $generations[2]->prompt);
        $this->assertSame(0, Asset::whereIn('id', [...$generations[0]->output_asset_ids, ...$generations[1]->output_asset_ids])->where('board_id', '!=', $board->id)->count());

        // A draft, never published: the upscaled picture and the caption written for it.
        $post = $user->posts()->latest('id')->first();
        $this->assertSame(['draft', 'image', ['instagram', 'tiktok'], 'Fresh from the oven. Come early.'], [$post->status->value, $post->format->value, $post->platforms, $post->body]);
        $this->assertContains($post->assets()->first()->id, $generations[1]->output_asset_ids);
    }

    public function test_a_workflow_is_checked_before_it_runs_and_a_failed_step_can_be_picked_up_again(): void
    {
        $this->fakeInvoke([['item_id' => 11, 'status' => 'failed', 'error_message' => 'CUDA error: out of memory', 'session' => []]], ['item_id' => 12, 'status' => 'failed', 'session' => []]);
        $this->actingAs(User::factory()->create());

        $this->spa()->postJson('/api/workflows/run', ['steps' => [['type' => 'upscale', 'model' => 'invoke/esrgan']], 'prompt' => 'x'])
            ->assertJsonValidationErrors(['steps.0.type' => 'Step 1 (Upscale) needs an image before it: add Generate image first, or start from one of your photos.']);
        $this->spa()->postJson('/api/workflows/run', ['steps' => [['type' => 'image', 'model' => 'invoke/esrgan']], 'prompt' => 'x'])
            ->assertJsonValidationErrors('steps.0.model');
        $this->spa()->postJson('/api/workflows/run', ['steps' => [['type' => 'image', 'model' => 'invoke/zi-key']]])
            ->assertJsonValidationErrors('prompt');

        $run = $this->spa()->postJson('/api/workflows/run', ['steps' => [['type' => 'image', 'model' => 'invoke/zi-key'], ['type' => 'post']], 'prompt' => 'a duck'])->assertCreated()->json('id');
        $failed = $this->spa()->getJson('/api/workflow-runs')->json('0');
        $this->assertSame(['failed', ['failed', 'waiting']], [$failed['status'], array_column($failed['steps'], 'status')]);
        $this->assertStringStartsWith('Step 1 (Generate image): The InvokeAI GPU is out of memory.', $failed['error']);

        $this->spa()->postJson("/api/workflow-runs/{$run}/resume")->assertOk();
        $this->assertSame(2, Generation::where('workflow_run_id', $run)->count());
    }

    public function test_boards_are_named_renamed_filled_and_deleted_without_losing_files(): void
    {
        $user = User::factory()->create();
        $other = Board::forceCreate(['user_id' => User::factory()->create()->id, 'name' => 'Theirs']);
        $assets = collect(range(1, 3))->map(fn ($i) => app(AssetStore::class)->fromContents($user, $this->png(4, 4), 'image/png', "a{$i}.png", 'upload'));
        $this->actingAs($user);

        $board = $this->spa()->postJson('/api/boards', ['name' => 'Shots'])->assertCreated()->json('id');
        $this->spa()->postJson('/api/boards', ['name' => 'Shots'])->assertJsonValidationErrors(['name' => 'You already have a board with that name.']);
        $this->spa()->patchJson("/api/boards/{$board}", ['name' => 'Product shots'])->assertOk()->assertJsonPath('name', 'Product shots');

        $this->spa()->postJson('/api/assets/board', ['ids' => $assets->take(2)->pluck('id')->all(), 'board_id' => $board])->assertJsonPath('moved', 2);
        $this->spa()->postJson('/api/assets/board', ['ids' => [$assets[2]->id], 'board_id' => $other->id])->assertJsonValidationErrors('board_id');
        $this->spa()->getJson('/api/boards')->assertJsonPath('data.0.count', 2)->assertJsonPath('unfiled', 1)
            ->assertJsonPath('data.0.cover_url', "/api/assets/{$assets[1]->id}/file");

        $this->spa()->deleteJson("/api/boards/{$other->id}")->assertNotFound();
        $this->spa()->deleteJson("/api/boards/{$board}")->assertNoContent();
        $this->assertSame(3, $user->assets()->whereNull('board_id')->count());
    }
}
