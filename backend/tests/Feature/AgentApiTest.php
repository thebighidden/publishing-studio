<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Models\User;
use App\Services\Publishing\Publisher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The contract the automation service (the Python dev) builds against: next job → steps and
 * screenshots → finish. Signed with the studio's agent token, never a session.
 */
class AgentApiTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'agent-token-under-test';

    private User $user;

    private Device $phone;

    private Account $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create(['agent_token' => self::TOKEN]);
        $this->phone = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $this->account = Account::factory()->for($this->user)->automated()->create([
            'platform' => 'instagram', 'handle' => 'maisoncire', 'device_id' => $this->phone->id,
        ]);
    }

    private function agent(): static
    {
        return $this->withHeaders(['Authorization' => 'Bearer '.self::TOKEN, 'Accept' => 'application/json']);
    }

    public function test_the_phone_reads_x_numbers_for_its_recent_posts(): void
    {
        $x = Account::factory()->for($this->user)->create(['platform' => 'x', 'handle' => 'maisoncire', 'device_id' => $this->phone->id]);
        $fresh = Post::factory()->for($this->user)->for($x)->published()->create(['body' => 'Candles for slow evenings', 'post_url' => 'https://x.com/maisoncire/status/1', 'published_at' => now()->subHour()]);
        $old = Post::factory()->for($this->user)->for($x)->published()->create(['published_at' => now()->subDays(20)]);
        $justRead = Post::factory()->for($this->user)->for($x)->published()->create(['published_at' => now()->subHours(2)]);
        $justRead->metric()->create(['likes' => 3, 'source' => 'phone', 'fetched_at' => now()->subMinutes(5)]);
        // Instagram numbers come from its API, not the phone.
        Post::factory()->for($this->user)->for($this->account)->published()->create(['published_at' => now()->subHour()]);

        $jobs = $this->agent()->getJson('/api/agent/metrics-jobs?device_ref=phone-1')->assertOk()->json('posts');
        $this->assertSame([$fresh->id], array_column($jobs, 'id'));
        $this->assertSame(['https://x.com/maisoncire/status/1', 'Candles for slow evenings', 'maisoncire'], [$jobs[0]['post_url'], $jobs[0]['caption'], $jobs[0]['handle']]);

        $this->agent()->postJson('/api/agent/metrics', ['post_id' => $fresh->id, 'likes' => 12, 'comments' => 2, 'shares' => 1, 'views' => 340])
            ->assertOk()->assertJsonPath('source', 'phone')->assertJsonPath('views', 340);
        $this->assertSame([], $this->agent()->getJson('/api/agent/metrics-jobs?device_ref=phone-1')->json('posts'));

        // A failed read keeps the last numbers and says why.
        $this->agent()->postJson('/api/agent/metrics', ['post_id' => $fresh->id, 'error' => 'post not found on the profile'])->assertOk()
            ->assertJsonPath('likes', 12)->assertJsonPath('error', 'post not found on the profile');

        // Only the studio's own posts.
        $stranger = Post::factory()->published()->create();
        $this->agent()->postJson('/api/agent/metrics', ['post_id' => $stranger->id, 'likes' => 1])->assertNotFound();
        $this->assertNull($old->metric()->first());
    }

    public function test_a_phone_deleted_while_connected_stays_deleted_until_brought_back(): void
    {
        $hello = fn () => $this->agent()->postJson('/api/agent/hello', ['phones' => [['ref' => 'phone-1', 'name' => 'Pixel 8', 'kind' => 'adb']]]);
        $hello()->assertOk()->assertJsonCount(1, 'phones');
        $offline = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'old-pixel', 'last_seen_at' => now()->subDay()]);
        $this->flushHeaders();
        $this->actingAs($this->user);

        // Connected: deleted, its account unlinked, and hidden so the next check-in can't bring it back.
        $this->spa()->deleteJson("/api/devices/{$this->phone->id}")->assertOk()->assertJsonPath('hidden', true);
        $this->assertNull($this->account->fresh()->device_id);
        $this->assertDatabaseMissing('devices', ['id' => $this->phone->id]);
        $hello()->assertOk()->assertJsonCount(0, 'phones');
        $this->assertSame(0, $this->user->devices()->where('ref', 'phone-1')->count());
        $this->flushHeaders();
        $this->spa()->getJson('/api/devices/hidden')->assertJsonPath('refs', ['phone-1']);

        // Brought back: the agent's next check-in registers it again.
        $this->spa()->deleteJson('/api/devices/hidden/phone-1')->assertJsonPath('refs', []);
        $hello()->assertOk()->assertJsonCount(1, 'phones');
        $this->assertSame(1, $this->user->devices()->where('ref', 'phone-1')->count());

        // Not seen for a day: just deleted, nothing to hide (plugging it in later brings it back).
        $this->flushHeaders();
        $this->spa()->deleteJson("/api/devices/{$offline->id}")->assertOk()->assertJsonPath('hidden', false);
        $this->spa()->getJson('/api/devices/hidden')->assertJsonPath('refs', []);
    }

    /** A booked run waiting on the phone: what the agent's loop starts from. */
    private function book(?Asset $media = null): PublishingRun
    {
        $post = Post::factory()->for($this->user)->for($this->account)->scheduled(now()->subMinute())
            ->create(['approved_at' => now(), 'body' => 'A warm caption for the evening ritual.']);
        if ($media) {
            $post->syncAssets([$media->id]);
        }

        return tap(app(Publisher::class)->open($post), fn ($run) => $this->assertNotNull($run));
    }

    public function test_calls_without_a_token_are_refused(): void
    {
        $this->getJson('/api/agent/next-job?device_ref=phone-1')->assertUnauthorized();
        $this->withHeaders(['Authorization' => 'Bearer wrong'])->getJson('/api/agent/next-job?device_ref=phone-1')->assertUnauthorized();
    }

    public function test_no_booked_run_means_no_job(): void
    {
        $this->agent()->getJson('/api/agent/next-job?device_ref=phone-1')->assertNoContent();
        $this->agent()->getJson('/api/agent/next-job?device_ref=not-mine')->assertNotFound();
    }

    public function test_the_agent_drives_a_run_to_confirmed(): void
    {
        $media = Asset::factory()->for($this->user)->create();
        Storage::disk('local')->put($media->path, 'jpeg-bytes');
        $run = $this->book($media);

        $job = $this->agent()->getJson('/api/agent/next-job?device_ref=phone-1')->assertOk()->json();
        $this->assertSame($run->uuid, $job['run_id']);
        $this->assertSame('instagram', $job['account']['platform']);
        $this->assertSame('com.instagram.android', $job['account']['app']['package']);
        $this->assertContains('post-button', $job['account']['app']['targets']);
        $this->assertSame('A warm caption for the evening ritual.', $job['post']['caption']);
        $this->assertSame("/api/agent/assets/{$media->id}/file", $job['media'][0]['url']);
        $this->assertSame((int) config('publishing.step_budget'), $job['limits']['step_budget']);
        $this->assertSame((int) config('publishing.hard_timeout_seconds'), $job['limits']['hard_timeout_seconds']);

        // The media comes down with the same token.
        $this->agent()->get($job['media'][0]['url'])->assertOk();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [
            ['action' => 'app-start', 'ok' => true, 'ms' => 1200],
            ['action' => 'tap:compose-button', 'ok' => true, 'ms' => 400],
        ]])->assertOk()->assertJsonPath('steps', 2);

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", [
            'file' => UploadedFile::fake()->image('shot.png'),
        ])->assertCreated()->assertJsonStructure(['asset_id', 'url']);

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'confirmed', 'post_url' => 'https://instagram.com/p/abc123',
        ])->assertOk()->assertJsonPath('outcome', 'confirmed');

        $run->refresh();
        $this->assertSame('post_url', $run->evidence['kind']);
        $this->assertSame('https://instagram.com/p/abc123', $run->evidence['ref']);
        $this->assertSame(PostStatus::Published, $run->post->status);
        $this->assertNull($this->phone->refresh()->booked_run_id); // the phone is free
        $this->assertNotNull($this->phone->last_screenshot);
    }

    public function test_confirmed_needs_proof(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'confirmed'])
            ->assertUnprocessable();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", [
            'file' => UploadedFile::fake()->image('shot.png'),
        ])->assertCreated();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'confirmed'])
            ->assertOk()->assertJsonPath('outcome', 'confirmed');
        $this->assertSame('screenshot', $run->refresh()->evidence['kind']);
    }

    public function test_a_failed_report_waits_and_tries_again(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'failed', 'note' => 'The app crashed on open.',
        ])->assertOk()->assertJsonPath('outcome', 'failed');

        $post = $run->post->refresh();
        $this->assertSame(PostStatus::Scheduled, $post->status); // R3: back in line, not lost
        $this->assertSame('The app crashed on open.', $post->error);
        $this->assertTrue($post->scheduled_at->greaterThan(now()->addMinutes(4)));
    }

    public function test_an_honest_uncertain_asks_a_person_to_look(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'uncertain', 'note' => 'Tapped Publish; the screen went blank.',
        ])->assertOk()->assertJsonPath('outcome', 'uncertain');

        $this->assertSame(PostStatus::Submitted, $run->post->refresh()->status);
    }

    public function test_an_ended_run_refuses_more_work(): void
    {
        $run = $this->book();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertOk();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [['action' => 'tap', 'ok' => true, 'ms' => 1]]])->assertConflict();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", ['file' => UploadedFile::fake()->image('shot.png')])->assertConflict();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertConflict();
    }

    public function test_the_step_budget_is_enforced(): void
    {
        config(['publishing.step_budget' => 3]);
        $run = $this->book();
        $step = ['action' => 'tap:compose-button', 'ok' => true, 'ms' => 10];

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [$step, $step, $step]])->assertOk();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [$step]])->assertUnprocessable();
    }

    public function test_the_agent_registers_the_phones_it_can_drive(): void
    {
        $this->agent()->postJson('/api/agent/hello', [
            'phones' => [
                ['ref' => 'phone-1', 'name' => 'Pixel 8', 'model' => 'Pixel 8', 'android' => '15', 'width' => 1080, 'height' => 2400, 'kind' => 'adb'],
                ['ref' => 'R58N123ABC', 'name' => 'SM-S921B', 'model' => 'SM-S921B', 'android' => '14', 'width' => 1080, 'height' => 2340, 'kind' => 'adb'],
            ],
            'mirror_url' => 'http://localhost:8765',
        ])->assertOk()->assertJsonCount(2, 'phones')->assertJsonPath('phones.1.name', 'SM-S921B');

        // The known phone keeps its name; the new one appears as an HTTP phone, online, with its live view.
        $this->assertSame('phone-1', $this->phone->refresh()->ref);
        $this->assertNotSame('Pixel 8', $this->phone->name);
        $new = $this->user->devices()->where('ref', 'R58N123ABC')->first();
        $this->assertSame(['http', 'SM-S921B'], [$new->driver, $new->name]);

        $listed = collect($this->actingAs($this->user)->spa()->getJson('/api/devices')->assertOk()->json('data') ?? $this->spa()->getJson('/api/devices')->json())->keyBy('ref');
        $this->assertTrue($listed['R58N123ABC']['online']);
        $this->assertSame(['14', [1080, 2340], 'http://localhost:8765'], [$listed['R58N123ABC']['android'], $listed['R58N123ABC']['screen'], $listed['R58N123ABC']['mirror_url']]);

        // Silent for long enough, it's offline.
        $this->travel(5)->minutes();
        $this->assertFalse(collect($this->spa()->getJson('/api/devices')->json('data') ?? $this->spa()->getJson('/api/devices')->json())->firstWhere('ref', 'R58N123ABC')['online']);
    }

    public function test_the_dashboard_knows_where_the_agent_is_and_whether_it_is_running(): void
    {
        $status = fn () => $this->actingAs($this->user->fresh())->spa()->getJson('/api/publishing/agent')->assertOk();
        $status()->assertJsonPath('online', false)->assertJsonPath('url', null);

        $this->agent()->postJson('/api/agent/hello', [
            'phones' => [['ref' => 'emulator-5554', 'name' => 'Emulator 5554', 'kind' => 'emulator']],
            'mirror_url' => 'http://localhost:8765',
            'agent' => ['host' => 'STUDIO-PC', 'os' => 'Windows', 'version' => '1.1', 'adb' => true, 'scrcpy' => false],
        ])->assertOk();

        $status()->assertJsonPath('online', true)->assertJsonPath('url', 'http://localhost:8765')
            ->assertJsonPath('host', 'STUDIO-PC')->assertJsonPath('adb', true)->assertJsonPath('scrcpy', false);
        $this->assertSame('emulator', $this->user->devices()->where('ref', 'emulator-5554')->first()->meta['kind']);

        // An agent that stopped checking in is shown as not running.
        $this->travel(5)->minutes();
        $status()->assertJsonPath('online', false)->assertJsonPath('host', 'STUDIO-PC');
    }

    public function test_an_idle_phone_sends_its_screen_for_the_thumbnail(): void
    {
        $this->agent()->postJson('/api/agent/devices/phone-1/screen', ['file' => UploadedFile::fake()->image('screen.png')])->assertOk();
        $this->assertNotNull($this->phone->refresh()->last_screenshot);
        Storage::disk('local')->assertExists($this->phone->last_screenshot);
        $this->actingAs($this->user)->spa()->get("/api/devices/{$this->phone->id}/screenshot")->assertOk();

        $this->agent()->postJson('/api/agent/devices/not-mine/screen', ['file' => UploadedFile::fake()->image('screen.png')])->assertNotFound();
    }

    public function test_another_studios_token_sees_nothing(): void
    {
        $run = $this->book();
        $other = User::factory()->create(['agent_token' => 'other-token']);
        $asOther = $this->withHeaders(['Authorization' => 'Bearer other-token', 'Accept' => 'application/json']);

        $asOther->getJson('/api/agent/next-job?device_ref=phone-1')->assertNotFound();
        $asOther->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [['action' => 'tap', 'ok' => true, 'ms' => 1]]])->assertNotFound();
        $asOther->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertNotFound();
        $this->assertTrue($run->refresh()->isRunning()); // untouched
    }
}
