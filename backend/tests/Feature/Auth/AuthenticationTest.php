<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_log_in(): void
    {
        $user = User::factory()->create(['email' => 'maya@studio.co']);

        $this->spa()->postJson('/api/auth/login', [
            'email' => 'MAYA@studio.co',
            'password' => 'password',
            'remember' => true,
        ])->assertOk()->assertJsonPath('id', $user->id);

        $this->assertAuthenticatedAs($user);
    }

    public function test_wrong_passwords_are_rejected(): void
    {
        $user = User::factory()->create();

        $this->spa()->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'nope'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertGuest();
    }

    public function test_login_is_throttled_after_five_wrong_guesses(): void
    {
        $user = User::factory()->create();

        foreach (range(1, 5) as $_) {
            $this->spa()->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'nope']);
        }

        $this->spa()->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertStatus(429);

        $this->assertGuest();
    }

    public function test_accounts_without_a_password_cannot_log_in_with_one(): void
    {
        $user = User::factory()->create(['password' => null]);

        $this->spa()->postJson('/api/auth/login', ['email' => $user->email, 'password' => ''])
            ->assertUnprocessable();
        $this->spa()->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'anything'])
            ->assertUnprocessable();

        $this->assertGuest();
    }

    public function test_users_can_log_out(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/auth/logout')->assertNoContent();

        $this->assertGuest('web');
    }

    public function test_the_current_user_endpoint_requires_a_session(): void
    {
        $this->spa()->getJson('/api/user')->assertUnauthorized();

        $user = User::factory()->create();
        $this->actingAs($user)->spa()->getJson('/api/user')->assertOk()->assertJsonPath('email', $user->email);
    }
}
