<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
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
