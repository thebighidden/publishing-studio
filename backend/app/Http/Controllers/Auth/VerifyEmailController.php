<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\RedirectResponse;

class VerifyEmailController extends Controller
{
    /**
     * The link in the confirmation email. The signed URL is the proof, so this works
     * even when it's opened in a browser that isn't signed in.
     */
    public function __invoke(string $id, string $hash): RedirectResponse
    {
        $user = User::find($id);
        $frontend = config('app.frontend_url');

        if (! $user || ! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return redirect()->away($frontend.'/login?error=verification_invalid');
        }

        if (! $user->hasVerifiedEmail() && $user->markEmailAsVerified()) {
            event(new Verified($user));
        }

        return redirect()->away($frontend.'/dashboard?verified=1');
    }
}
