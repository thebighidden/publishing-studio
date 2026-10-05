<?php

namespace Tests\Feature;

use App\Models\Post;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PostTest extends TestCase
{
    use RefreshDatabase;

    private function draft(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Spring launch',
            'body' => 'Spring is here, and so is our new collection.',
            'format' => 'text',
            'platforms' => ['linkedin', 'x'],
            'status' => 'draft',
        ], $overrides);
    }

    public function test_guests_cannot_touch_posts(): void
    {
        $this->spa()->getJson('/api/posts')->assertUnauthorized();
        $this->spa()->postJson('/api/posts', $this->draft())->assertUnauthorized();
    }

    public function test_a_draft_can_be_written_edited_and_deleted(): void
    {
        $user = User::factory()->create();

        $id = $this->actingAs($user)->spa()->postJson('/api/posts', $this->draft())
            ->assertCreated()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('platforms', ['linkedin', 'x'])
            ->json('id');

        $this->spa()->putJson("/api/posts/{$id}", $this->draft(['title' => 'Spring launch v2']))
            ->assertOk()
            ->assertJsonPath('title', 'Spring launch v2');

        $this->spa()->deleteJson("/api/posts/{$id}")->assertNoContent();
        $this->assertDatabaseMissing('posts', ['id' => $id]);
    }

    public function test_other_peoples_posts_are_off_limits(): void
    {
        $post = Post::factory()->create();
        $intruder = User::factory()->create();

        $this->actingAs($intruder)->spa()->getJson("/api/posts/{$post->id}")->assertForbidden();
        $this->spa()->putJson("/api/posts/{$post->id}", $this->draft())->assertForbidden();
        $this->spa()->deleteJson("/api/posts/{$post->id}")->assertForbidden();
        $this->spa()->getJson('/api/posts')->assertJsonCount(0, 'data');
    }

    public function test_a_post_must_fit_the_strictest_platform(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/posts', $this->draft(['body' => str_repeat('a', 281)]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['body' => 'X allows 280 characters. This post has 281.']);

        $this->spa()->postJson('/api/posts', $this->draft(['body' => str_repeat('a', 281), 'platforms' => ['linkedin']]))
            ->assertCreated();
    }

    public function test_scheduling_needs_a_future_time(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->spa()->postJson('/api/posts', $this->draft(['status' => 'scheduled']))
            ->assertJsonValidationErrors('scheduled_at');
        $this->spa()->postJson('/api/posts', $this->draft(['status' => 'scheduled', 'scheduled_at' => now()->subHour()->toIso8601String()]))
            ->assertJsonValidationErrors('scheduled_at');
        $this->spa()->postJson('/api/posts', $this->draft(['status' => 'scheduled', 'scheduled_at' => now()->addDay()->toIso8601String()]))
            ->assertCreated()
            ->assertJsonPath('status', 'scheduled');
    }

    public function test_marking_published_stamps_the_time(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/posts', $this->draft(['status' => 'published']))
            ->assertCreated()
            ->assertJsonPath('status', 'published')
            ->assertJson(fn ($json) => $json->whereType('published_at', 'string')->etc());
    }

    public function test_add_to_queue_takes_the_next_free_slot(): void
    {
        // Thursday 1 October 2026, 10:00 in Paris.
        $this->travelTo(CarbonImmutable::parse('2026-10-01 10:00', 'Europe/Paris'));
        $user = User::factory()->create(['timezone' => 'Europe/Paris']);
        $user->queueSlots()->createMany([
            ['weekday' => 4, 'time' => '09:00'], // Thursday morning: already gone today
            ['weekday' => 5, 'time' => '09:30'], // Friday
            ['weekday' => 6, 'time' => '17:00'], // Saturday
        ]);

        $first = $this->actingAs($user)->spa()
            ->postJson('/api/posts', $this->draft(['status' => 'scheduled', 'queue' => true]))
            ->assertCreated()
            ->json('scheduled_at');
        $second = $this->spa()
            ->postJson('/api/posts', $this->draft(['status' => 'scheduled', 'queue' => true]))
            ->json('scheduled_at');

        // Paris is UTC+2 in October.
        $this->assertSame('2026-10-02T07:30:00Z', $first);
        $this->assertSame('2026-10-03T15:00:00Z', $second);
    }

    public function test_the_queue_needs_posting_times_first(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->spa()
            ->postJson('/api/posts', $this->draft(['status' => 'scheduled', 'queue' => true]))
            ->assertJsonValidationErrors('queue');
    }

    public function test_posts_can_be_duplicated_as_drafts(): void
    {
        $post = Post::factory()->scheduled()->create(['title' => 'Launch']);

        $this->actingAs($post->user)->spa()->postJson("/api/posts/{$post->id}/duplicate")
            ->assertCreated()
            ->assertJsonPath('title', 'Launch (copy)')
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('scheduled_at', null);
    }

    public function test_the_library_filters_and_the_calendar_reads_a_window(): void
    {
        $user = User::factory()->create();
        Post::factory()->for($user)->create(['title' => 'Hiring post', 'platforms' => ['linkedin']]);
        Post::factory()->for($user)->scheduled(now()->addDays(2))->create(['title' => 'Reel', 'platforms' => ['instagram']]);
        Post::factory()->for($user)->scheduled(now()->addDays(20))->create(['title' => 'Later', 'platforms' => ['instagram']]);

        $this->actingAs($user);
        $this->spa()->getJson('/api/posts?status=scheduled')->assertJsonCount(2, 'data');
        $this->spa()->getJson('/api/posts?platform=linkedin')->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'Hiring post');
        $this->spa()->getJson('/api/posts?q=hiring')->assertJsonCount(1, 'data');

        $from = urlencode(now()->toIso8601String());
        $to = urlencode(now()->addWeek()->toIso8601String());
        $this->spa()->getJson("/api/posts?from={$from}&to={$to}&sort=scheduled")
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'Reel');
    }
}
