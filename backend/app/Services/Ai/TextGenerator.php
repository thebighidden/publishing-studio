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
     * @param  string|null  $effort  low, medium, high, xhigh or max; null keeps the model's default.
     * @return Generator<int, string>
     *
     * @throws GenerationFailed with a message that can be shown to the person who asked.
     */
    public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator;

    /**
     * Answer with one JSON object that matches `$schema`, decoded.
     *
     * @param  string|list<array<string, mixed>>  $content  The request: plain text, or content blocks when it carries images.
     * @param  array<string, mixed>  $schema  JSON Schema for the object.
     * @return array<string, mixed>
     *
     * @throws GenerationFailed with a message that can be shown to the person who asked.
     */
    public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array;
}
