<?php

use App\Http\Controllers\Auth\SocialiteController;
use Illuminate\Support\Facades\Route;

// This app is an API; people belong in the React frontend.
Route::get('/', fn () => redirect()->away(config('app.frontend_url')));

// Social login runs on web routes because the provider's callback needs the session
// that started the round trip, and it arrives without a Referer Sanctum would trust.
Route::prefix('oauth/{provider}')
    ->whereIn('provider', SocialiteController::PROVIDERS)
    ->group(function () {
        Route::get('redirect', [SocialiteController::class, 'redirect']);
        Route::get('callback', [SocialiteController::class, 'callback']);
    });
