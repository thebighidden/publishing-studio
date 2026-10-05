<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

class PasswordController extends Controller
{
    /**
     * Change the password, or set a first one for accounts made through Google or GitHub.
     */
    public function __invoke(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $request->validate([
            'current_password' => $user->hasPassword() ? ['required', 'current_password'] : ['nullable'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $user->update(['password' => $request->input('password')]);

        return response()->json(['status' => 'password-updated']);
    }
}
