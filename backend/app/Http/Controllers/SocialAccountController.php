<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SocialAccountController extends Controller
{
    /**
     * Disconnect Google or GitHub, as long as it isn't the only way back in.
     *
     * @throws ValidationException
     */
    public function destroy(Request $request, string $provider): UserResource
    {
        /** @var User $user */
        $user = $request->user();
        $account = $user->socialAccounts()->where('provider', $provider)->firstOrFail();

        if (! $user->hasPassword() && $user->socialAccounts()->count() === 1) {
            throw ValidationException::withMessages([
                'provider' => 'Set a password first. This is the only way you can sign in right now.',
            ]);
        }

        $account->delete();

        return UserResource::make($user);
    }
}
