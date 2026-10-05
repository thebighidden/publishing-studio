<?php

namespace App\Services\Ai;

use Generator;

interface TextGenerator
{
    /**
     * Whether there are credentials to generate with at all.
     */
    public function enabled(): bool;

    /**
     * Write a reply to `$prompt`, yielding the text as it arrives.
     *
     * @return Generator<int, string>
     *
     * @throws GenerationFailed with a message that can be shown to the person who asked.
     */
    public function stream(string $model, string $system, string $prompt): Generator;
}
