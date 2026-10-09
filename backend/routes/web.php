<?php

use App\Http\Controllers\Auth\SocialiteController;
use App\Http\Controllers\ConnectController;
use App\Http\Controllers\PublicMediaController;
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

// Connecting accounts through the platforms' official APIs (Meta, X): the same session reason.
Route::prefix('oauth/connect/{provider}')
    ->whereIn('provider', ConnectController::PROVIDERS)
    ->group(function () {
        Route::get('redirect', [ConnectController::class, 'redirect']);
        Route::get('callback', [ConnectController::class, 'callback']);
    });

// A library file at a signed, short-lived address, for platforms that fetch media themselves.
Route::get('media/{asset}', PublicMediaController::class)->name('public.media')->middleware('signed:relative');
