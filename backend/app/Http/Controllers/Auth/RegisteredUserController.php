<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

class RegisteredUserController extends Controller
{
    /**
     * Create the account and sign the new user in. There's no email confirmation step: the
     * account counts as confirmed from the start, so no confirmation email goes out.
     */
    public function __invoke(RegisterRequest $request): JsonResponse
    {
        $user = User::create([
            'name' => $request->string('name')->trim()->value(),
            'email' => $request->input('email'),
            'password' => $request->input('password'),
            'timezone' => $request->input('timezone'),
            'preferences' => [
                'platforms' => $request->input('platforms', []),
                'formats' => $request->input('formats', []),
            ],
        ]);
        $user->markEmailAsVerified();

        event(new Registered($user));

        Auth::login($user);
        $request->session()->regenerate();

        return UserResource::make($user)->response()->setStatusCode(201);
    }
}
