<?php

use App\Services\Publishing\Publisher;
use App\Services\Social\Engagement;
use Illuminate\Support\Facades\Schedule;

// When a post's time comes, its publishing run starts on its own.
Schedule::call(fn () => app(Publisher::class)->dispatchDue())->name('publishing:dispatch-due')->everyMinute()->withoutOverlapping();

// Runs that report nothing end honestly (uncertain or failed) and release the phone.
Schedule::call(fn () => app(Publisher::class)->sweepStale())->name('publishing:sweep-stale')->everyFiveMinutes()->withoutOverlapping();

// Likes, comments, shares, views and reactions come back from the platforms' APIs each hour.
Schedule::call(fn () => app(Engagement::class)->refreshRecent())->name('social:engagement')->hourly()->withoutOverlapping();
