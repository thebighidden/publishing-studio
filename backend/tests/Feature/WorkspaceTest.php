<?php

namespace Tests\Feature;

use App\Models\Post;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Overview, analytics, the posting queue and account settings.
 */
class WorkspaceTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_overview_counts_real_posts(): void
    {
        $user = User::factory()->create();
        Post::factory()->for($user)->count(2)->create();
        Post::factory()->for($user)->scheduled(now()->addHours(3))->create(['platforms' => ['x', 'linkedin']]);
        Post::factory()->for($user)->scheduled(now()->subHour())->create();
        Post::factory()->for($user)->published()->create();
        Post::factory()->create(); // someone else's

        $this->actingAs($user)->spa()->getJson('/api/overview')
            ->assertOk()
            ->assertJsonPath('counts', ['draft' => 2, 'scheduled' => 2, 'published' => 1, 'publishing' => 0, 'failed' => 0, 'total' => 5])
            ->assertJsonPath('due', 1)
            ->assertJsonCount(1, 'upcoming')
            ->assertJsonCount(2, 'drafts')
            ->assertJsonCount(7, 'week')
            ->assertJsonPath('platforms.linkedin', 5);
    }

    public function test_analytics_buckets_output_by_day_in_the_users_timezone(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 12:00', 'UTC'));
        $user = User::factory()->create(['timezone' => 'Asia/Tokyo']);
        // 23:30 UTC on Sept 30 is 08:30 on Oct 1 in Tokyo.
        Post::factory()->for($user)->published()->create([
            'scheduled_at' => '2026-09-30 23:30:00',
            'published_at' => '2026-09-30 23:30:00',
            'platforms' => ['instagram'],
        ]);

        $response = $this->actingAs($user)->spa()->getJson('/api/analytics?range=7')->assertOk();

        $response->assertJsonCount(7, 'days')
            ->assertJsonPath('days.6.date', '2026-10-01')
            ->assertJsonPath('days.6.published', 1)
            ->assertJsonPath('totals.published.now', 1)
            ->assertJsonPath('platforms.instagram', 1)
            // Thursday (index 3), 08:00 hour.
            ->assertJsonPath('heatmap.3.8', 1);
    }

    public function test_the_weekly_queue_is_replaced_as_a_whole(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->putJson('/api/queue-slots', ['slots' => [
            ['weekday' => 1, 'time' => '09:30'],
            ['weekday' => 1, 'time' => '09:30'],
            ['weekday' => 3, 'time' => '17:00'],
        ]])->assertOk()->assertJsonCount(2, 'slots');

        $this->spa()->putJson('/api/queue-slots', ['slots' => [['weekday' => 8, 'time' => '25:00']]])
            ->assertJsonValidationErrors(['slots.0.weekday', 'slots.0.time']);

        $this->spa()->putJson('/api/queue-slots', ['slots' => []])->assertOk()->assertJsonCount(0, 'slots');
    }

    public function test_upcoming_queue_times_show_what_fills_them(): void
    {
        // Thursday morning, before the 09:30 slot.
        $this->travelTo(CarbonImmutable::parse('2026-10-01 08:00', 'UTC'));
        $user = User::factory()->create(['timezone' => 'UTC']);
        $user->queueSlots()->create(['weekday' => 4, 'time' => '09:30']);
        Post::factory()->for($user)->scheduled(CarbonImmutable::parse('2026-10-01 09:30', 'UTC')->addWeek())->create(['title' => 'Booked']);

        $this->actingAs($user)->spa()->getJson('/api/queue-slots')
            ->assertJsonPath('upcoming.0.at', '2026-10-01T09:30:00Z')
            ->assertJsonPath('upcoming.0.post', null)
            ->assertJsonPath('upcoming.1.post.title', 'Booked')
            ->assertJsonPath('next_free', '2026-10-01T09:30:00Z');
    }

    public function test_profile_changes_and_a_new_email_needs_no_confirming(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->patchJson('/api/user', [
            'name' => 'Maya R.',
            'timezone' => 'America/New_York',
            'preferences' => ['platforms' => ['tiktok']],
        ])->assertOk()->assertJsonPath('name', 'Maya R.')->assertJsonPath('preferences.platforms', ['tiktok']);

        $this->spa()->patchJson('/api/user', ['email' => 'new@studio.co'])
            ->assertOk()
            ->assertJsonPath('email', 'new@studio.co')
            ->assertJsonPath('email_verified', true);
        Notification::assertNotSentTo($user->fresh(), VerifyEmail::class);

        $this->spa()->patchJson('/api/user', ['timezone' => 'Mars/Olympus'])->assertJsonValidationErrors('timezone');
    }

    public function test_changing_the_password_needs_the_current_one_and_keeps_you_signed_in(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->spa()->putJson('/api/user/password', [
            'current_password' => 'wrong',
            'password' => 'NewPassword1!',
            'password_confirmation' => 'NewPassword1!',
        ])->assertJsonValidationErrors('current_password');

        $this->spa()->putJson('/api/user/password', [
            'current_password' => 'password',
            'password' => 'NewPassword1!',
            'password_confirmation' => 'NewPassword1!',
        ])->assertOk();

        // The session that made the change stays valid.
        $this->spa()->getJson('/api/user')->assertOk();
        $this->assertTrue(Hash::check('NewPassword1!', $user->fresh()->password));
    }

    public function test_social_accounts_can_set_a_first_password_without_a_current_one(): void
    {
        $social = User::factory()->create(['password' => null]);

        $this->actingAs($social)->spa()->putJson('/api/user/password', [
            'password' => 'NewPassword1!',
            'password_confirmation' => 'NewPassword1!',
        ])->assertOk();

        $this->assertTrue(Hash::check('NewPassword1!', $social->fresh()->password));
    }

    public function test_the_only_sign_in_method_cannot_be_disconnected(): void
    {
        $user = User::factory()->create(['password' => null]);
        $user->socialAccounts()->create(['provider' => 'github', 'provider_id' => '42']);

        $this->actingAs($user)->spa()->deleteJson('/api/user/social/github')->assertJsonValidationErrors('provider');

        $this->spa()->putJson('/api/user/password', [
            'password' => 'NewPassword1!',
            'password_confirmation' => 'NewPassword1!',
        ])->assertOk();

        $this->spa()->deleteJson('/api/user/social/github')->assertOk()->assertJsonPath('providers', []);
    }

    public function test_deleting_the_account_needs_the_password_and_takes_the_posts_with_it(): void
    {
        $user = User::factory()->create();
        Post::factory()->for($user)->count(3)->create();

        $this->actingAs($user)->spa()->deleteJson('/api/user', ['password' => 'wrong'])->assertJsonValidationErrors('password');
        $this->spa()->deleteJson('/api/user', ['password' => 'password'])->assertNoContent();

        $this->assertDatabaseMissing('users', ['id' => $user->id]);
        $this->assertDatabaseCount('posts', 0);
    }
}
