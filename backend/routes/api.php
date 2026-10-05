<?php

use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationNotificationController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\SocialiteController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Controllers\OverviewController;
use App\Http\Controllers\PasswordController;
use App\Http\Controllers\PostController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\QueueSlotController;
use App\Http\Controllers\SocialAccountController;
use App\Http\Controllers\WritingController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::get('providers', [SocialiteController::class, 'providers']);

    Route::middleware('throttle:auth')->group(function () {
        Route::post('register', RegisteredUserController::class);
        Route::post('login', [AuthenticatedSessionController::class, 'store']);
        Route::post('forgot-password', PasswordResetLinkController::class);
        Route::post('reset-password', NewPasswordController::class);
    });

    Route::get('verify-email/{id}/{hash}', VerifyEmailController::class)
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthenticatedSessionController::class, 'destroy']);
        Route::post('email/verification-notification', EmailVerificationNotificationController::class)
            ->middleware('throttle:6,1');
    });
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('user', [ProfileController::class, 'show']);
    Route::patch('user', [ProfileController::class, 'update']);
    Route::delete('user', [ProfileController::class, 'destroy']);
    Route::put('user/password', PasswordController::class);
    Route::delete('user/social/{provider}', [SocialAccountController::class, 'destroy']);

    Route::get('overview', OverviewController::class);
    Route::get('analytics', AnalyticsController::class);

    Route::post('posts/{post}/duplicate', [PostController::class, 'duplicate']);
    Route::apiResource('posts', PostController::class);

    Route::get('queue-slots', [QueueSlotController::class, 'index']);
    Route::put('queue-slots', [QueueSlotController::class, 'update']);

    Route::get('ai', [WritingController::class, 'options']);
    // Every request spends API credit: confirmed accounts only, and not too fast.
    Route::post('ai/write', [WritingController::class, 'write'])->middleware(['verified', 'throttle:ai']);
});
