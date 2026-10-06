<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Device;
use App\Models\Post;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Area 12: the investigation pipeline — collect → compare → validate → report — and the
 * privacy of its results.
 */
class InvestigationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $account;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $phone = Device::factory()->for($this->user)->create();
        $this->account = Account::factory()->for($this->user)->create(['device_id' => $phone->id]);
    }

    private function fakeAi(bool $on = true): void
    {
        $this->app->instance(TextGenerator::class, new class($on) implements TextGenerator
        {
            public function __construct(private bool $on) {}

            public function enabled(): bool
            {
                return $this->on;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                yield 'x';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                return ['verdicts' => [['index' => 0, 'verdict' => 'issue', 'note' => 'No proof exists: this needs a person.']]];
            }
        });
    }

    public function test_the_pipeline_catches_a_published_post_with_no_proof(): void
    {
        $this->fakeAi();
        // The lie: marked published by hand, no post URL and no confirmed run behind it.
        Post::factory()->for($this->user)->for($this->account)->published()->create(['post_url' => null]);

        $inv = $this->spa()->actingAs($this->user)->postJson('/api/investigations', [])->assertCreated()->json();
        $this->assertSame('done', $inv['status']); // sync queue: the pipeline already ran

        $this->assertSame(['collect', 'compare', 'validate', 'report'], array_column($inv['stages'], 'name'));
        $this->assertSame(1, $inv['counts']['issues']);
        $this->assertSame(1, $inv['open_issues']);

        $finding = collect($inv['findings'])->firstWhere('rule', 'published_without_proof');
        $this->assertSame('high', $finding['severity']);
        $this->assertSame('issue', $finding['verdict']);
        $this->assertSame('No proof exists: this needs a person.', $finding['note']);
        $this->assertStringContainsString('Needs a person', $inv['report']);
    }

    public function test_a_clean_studio_gets_a_clean_report(): void
    {
        $this->fakeAi(false); // no AI: the compare verdicts stand
        Post::factory()->for($this->user)->for($this->account)->published()->create(['post_url' => 'https://instagram.com/p/ok']);

        $inv = $this->spa()->actingAs($this->user)->postJson('/api/investigations', [])->assertCreated()->json();
        $this->assertSame('done', $inv['status']);
        $this->assertSame(0, $inv['counts']['issues']);
        $this->assertStringContainsString('Nothing out of place', $inv['report']);
    }

    public function test_scoping_to_one_account_leaves_the_rest_out(): void
    {
        $this->fakeAi(false);
        $other = Account::factory()->for($this->user)->create();
        Post::factory()->for($this->user)->for($other)->published()->create(['post_url' => null]); // the lie, on another account
        Post::factory()->for($this->user)->for($this->account)->published()->create(['post_url' => 'https://instagram.com/p/ok']);

        $inv = $this->spa()->actingAs($this->user)->postJson('/api/investigations', ['account_id' => $this->account->id])->assertCreated()->json();
        $this->assertSame(0, $inv['counts']['issues']);
    }

    public function test_investigations_are_private_to_their_studio(): void
    {
        $this->fakeAi(false);
        $inv = $this->spa()->actingAs($this->user)->postJson('/api/investigations', [])->assertCreated()->json();

        $other = User::factory()->create();
        $this->spa()->actingAs($other)->getJson('/api/investigations')->assertJsonCount(0);
        $this->spa()->actingAs($other)->getJson("/api/investigations/{$inv['id']}")->assertNotFound();
        $this->spa()->actingAs($other)->deleteJson("/api/investigations/{$inv['id']}")->assertNotFound();
    }
}
