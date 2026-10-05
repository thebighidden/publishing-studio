<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\ValidationException;

class PasswordResetLinkController extends Controller
{
    /**
     * Email a reset link. The response is the same whether or not the address has an
     * account, so this can't be used to find out who's signed up.
     *
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        $request->validate(['email' => ['required', 'email']]);

        $status = Password::sendResetLink($request->only('email'));

        if ($status === Password::RESET_THROTTLED) {
            throw ValidationException::withMessages([
                'email' => 'We just sent a link to this address. Give it a minute before asking for another.',
            ])->status(429);
        }

        return response()->json(['status' => 'If that email has an account, a reset link is on its way.']);
    }
}
