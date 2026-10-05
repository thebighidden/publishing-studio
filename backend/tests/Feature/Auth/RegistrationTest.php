<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Maya Ross',
            'email' => 'Maya@Studio.co',
            'password' => 'Spring2026!',
            'timezone' => 'Europe/Paris',
            'platforms' => ['instagram', 'linkedin'],
            'formats' => ['text', 'image'],
            'terms' => true,
        ], $overrides);
    }

    public function test_new_users_can_register_and_are_signed_in(): void
    {
        Notification::fake();

        $response = $this->spa()->postJson('/api/auth/register', $this->payload());

        $response->assertCreated()
            ->assertJsonPath('email', 'maya@studio.co')
            ->assertJsonPath('email_verified', false)
            ->assertJsonPath('timezone', 'Europe/Paris')
            ->assertJsonPath('preferences.platforms', ['instagram', 'linkedin'])
            ->assertJsonPath('has_password', true);

        $user = User::firstWhere('email', 'maya@studio.co');
        $this->assertAuthenticatedAs($user);
        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_the_confirmation_link_points_back_through_the_app(): void
    {
        Notification::fake();

        $this->spa()->postJson('/api/auth/register', $this->payload())->assertCreated();

        $user = User::firstWhere('email', 'maya@studio.co');
        Notification::assertSentTo($user, VerifyEmail::class, function (VerifyEmail $n) use ($user) {
            return str_contains($n->toMail($user)->actionUrl, '/api/auth/verify-email/'.$user->id.'/');
        });
    }

    public function test_email_must_be_unique(): void
    {
        User::factory()->create(['email' => 'maya@studio.co']);

        $this->spa()->postJson('/api/auth/register', $this->payload())
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertGuest();
    }

    public function test_terms_must_be_accepted_and_platforms_must_be_known(): void
    {
        $this->spa()->postJson('/api/auth/register', $this->payload(['terms' => false, 'platforms' => ['myspace']]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['terms', 'platforms.0']);
    }

    public function test_short_passwords_are_rejected(): void
    {
        $this->spa()->postJson('/api/auth/register', $this->payload(['password' => 'short']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');
    }
}
