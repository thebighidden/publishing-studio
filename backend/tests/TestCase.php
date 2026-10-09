<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Storage;

abstract class TestCase extends BaseTestCase
{
    /**
     * Every test gets a throwaway disk. The tests share ids with the dev database (user 1, …),
     * and deleting a user removes storage/app/private/assets/{id}: on the real disk that wiped
     * the dev account's media whenever the suite ran.
     */
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /**
     * Send the request the way the React app does, so Sanctum treats it as stateful
     * and gives it a session.
     */
    protected function spa(): static
    {
        return $this->withHeaders([
            'Referer' => 'http://localhost:5173/',
            'Accept' => 'application/json',
        ]);
    }
}
