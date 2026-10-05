<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_reset_link_to_the_react_app_is_emailed(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $this->spa()->postJson('/api/auth/forgot-password', ['email' => $user->email])->assertOk();

        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use ($user) {
            return str_starts_with($n->toMail($user)->actionUrl, 'http://localhost:5173/reset-password?token=');
        });
    }

    public function test_unknown_addresses_get_the_same_answer_and_no_email(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $known = $this->spa()->postJson('/api/auth/forgot-password', ['email' => $user->email])->json();
        $unknown = $this->spa()->postJson('/api/auth/forgot-password', ['email' => 'nobody@example.com'])->json();

        $this->assertSame($known, $unknown);
        Notification::assertSentTimes(ResetPassword::class, 1);
    }

    public function test_the_password_can_be_reset_with_the_emailed_token(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $this->spa()->postJson('/api/auth/forgot-password', ['email' => $user->email]);

        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use ($user) {
            $this->spa()->postJson('/api/auth/reset-password', [
                'token' => $n->token,
                'email' => $user->email,
                'password' => 'NewPassword1!',
                'password_confirmation' => 'NewPassword1!',
            ])->assertOk();

            return true;
        });

        $user->refresh();
        $this->assertTrue(Hash::check('NewPassword1!', $user->password));
        $this->assertTrue($user->hasVerifiedEmail());
    }

    public function test_a_bad_token_is_rejected(): void
    {
        $user = User::factory()->create();

        $this->spa()->postJson('/api/auth/reset-password', [
            'token' => 'not-a-token',
            'email' => $user->email,
            'password' => 'NewPassword1!',
            'password_confirmation' => 'NewPassword1!',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');
    }
}
