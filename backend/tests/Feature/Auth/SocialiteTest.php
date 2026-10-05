<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Tests\TestCase;

class SocialiteTest extends TestCase
{
    use RefreshDatabase;

    private function configure(): void
    {
        config([
            'services.google.client_id' => 'id',
            'services.google.client_secret' => 'secret',
        ]);
    }

    private function fakeProfile(string $email = 'maya@gmail.com', string $id = 'g-123'): void
    {
        $profile = (new OAuthUser)->map([
            'id' => $id,
            'name' => 'Maya Ross',
            'email' => $email,
            'avatar' => 'https://example.com/a.png',
        ]);

        Socialite::shouldReceive('driver->user')->andReturn($profile);
    }

    public function test_unconfigured_providers_send_people_back_with_a_reason(): void
    {
        config(['services.github.client_id' => null]);

        $this->get('/oauth/github/redirect')
            ->assertRedirect('http://localhost:5173/login?error=oauth_unconfigured&provider=github');
    }

    public function test_the_app_can_ask_which_providers_are_ready(): void
    {
        $this->configure();
        config(['services.github.client_id' => null]);

        $this->getJson('/api/auth/providers')->assertExactJson(['google' => true, 'github' => false]);
    }

    public function test_unknown_providers_do_not_exist(): void
    {
        $this->get('/oauth/myspace/redirect')->assertNotFound();
    }

    public function test_a_first_sign_in_creates_a_verified_account(): void
    {
        $this->configure();
        $this->fakeProfile();

        $this->get('/oauth/google/callback')->assertRedirect('http://localhost:5173/dashboard');

        $user = User::firstWhere('email', 'maya@gmail.com');
        $this->assertNotNull($user);
        $this->assertTrue($user->hasVerifiedEmail());
        $this->assertFalse($user->hasPassword());
        $this->assertSame(['google'], $user->socialAccounts()->pluck('provider')->all());
        $this->assertAuthenticatedAs($user);
    }

    public function test_returning_users_are_matched_by_provider_id(): void
    {
        $this->configure();
        $user = User::factory()->create(['email' => 'old@studio.co']);
        $user->socialAccounts()->create(['provider' => 'google', 'provider_id' => 'g-123']);
        $this->fakeProfile(email: 'new@gmail.com');

        $this->get('/oauth/google/callback')->assertRedirect('http://localhost:5173/dashboard');

        $this->assertAuthenticatedAs($user);
        $this->assertSame(1, User::count());
    }

    public function test_an_unverified_account_with_the_same_email_loses_its_password(): void
    {
        $this->configure();
        $squatter = User::factory()->unverified()->create([
            'email' => 'maya@gmail.com',
            'password' => Hash::make('i-registered-first'),
        ]);
        $this->fakeProfile();

        $this->get('/oauth/google/callback');

        $squatter->refresh();
        $this->assertFalse($squatter->hasPassword());
        $this->assertTrue($squatter->hasVerifiedEmail());
        $this->assertAuthenticatedAs($squatter);
    }

    public function test_a_signed_in_user_can_connect_a_provider_from_settings(): void
    {
        $this->configure();
        $user = User::factory()->create();
        $this->fakeProfile(email: 'other@gmail.com');

        $this->actingAs($user)->get('/oauth/google/callback')
            ->assertRedirect('http://localhost:5173/dashboard/settings?linked=google');

        $this->assertSame(['google'], $user->socialAccounts()->pluck('provider')->all());
    }

    public function test_a_provider_account_cannot_be_connected_to_two_users(): void
    {
        $this->configure();
        User::factory()->create()->socialAccounts()->create(['provider' => 'google', 'provider_id' => 'g-123']);
        $user = User::factory()->create();
        $this->fakeProfile();

        $this->actingAs($user)->get('/oauth/google/callback')
            ->assertRedirect('http://localhost:5173/dashboard/settings?error=oauth_taken&provider=google');

        $this->assertSame(0, $user->socialAccounts()->count());
    }
}
