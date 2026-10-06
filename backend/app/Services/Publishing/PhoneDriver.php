<?php

namespace App\Services\Publishing;

/**
 * How a run talks to a phone. The simulator implements this in-process; phones on the
 * phone-control service are driven by the external automation agent instead, which reports
 * the same primitives (transfer, app-start, tap, type, screenshot) as run steps.
 */
interface PhoneDriver
{
    /** Copy media to the phone before the job starts. */
    public function transfer(string $contents, string $name, string $mime): void;

    /** Open the platform's app (and stop it first, so every run starts cold). */
    public function appStart(string $package): void;

    /** Tap a named target — never raw coordinates (R6). */
    public function tap(string $target): void;

    /** Type the caption as keyboard events. */
    public function type(string $text): void;

    /**
     * What the screen shows now: the PNG, and the truth the verification reads.
     *
     * @return array{png: string, text: string|null}
     */
    public function screenshot(): array;
}
