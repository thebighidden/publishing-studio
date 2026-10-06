<?php

namespace App\Services\Ai;

use Anthropic\Beta\Messages\BetaRawContentBlockDeltaEvent;
use Anthropic\Beta\Messages\BetaRawMessageDeltaEvent;
use Anthropic\Beta\Messages\BetaRawMessageStartEvent;
use Anthropic\Beta\Messages\BetaStopReason;
use Anthropic\Beta\Messages\BetaTextBlock;
use Anthropic\Beta\Messages\BetaTextDelta;
use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\PermissionDeniedException;
use Anthropic\Core\Exceptions\RateLimitException;
use Generator;

class ClaudeTextGenerator implements TextGenerator
{
    // If the model declines, the API re-runs the request on Anthropic's recommended
    // fallback model and carries on, instead of handing back a refusal.
    private const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

    public function __construct(private readonly ?string $apiKey, private readonly ?UsageMeter $usage = null) {}

    public function enabled(): bool
    {
        return filled($this->apiKey);
    }

    public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
    {
        $client = new Client(apiKey: $this->apiKey);

        try {
            $events = $client->beta->messages->createStream(
                model: $model,
                maxTokens: 64000,
                system: $system,
                messages: [['role' => 'user', 'content' => $prompt]],
                thinking: ['type' => 'adaptive'],
                outputConfig: $effort ? ['effort' => $effort] : null,
                fallbacks: 'default',
                betas: [self::FALLBACK_BETA],
            );

            $in = $out = 0;
            foreach ($events as $event) {
                if ($event instanceof BetaRawContentBlockDeltaEvent && $event->delta instanceof BetaTextDelta) {
                    yield $event->delta->text;
                } elseif ($event instanceof BetaRawMessageStartEvent) {
                    $in = $event->message->usage->inputTokens;
                } elseif ($event instanceof BetaRawMessageDeltaEvent) {
                    $out = $event->usage->outputTokens;
                    $this->usage?->record('anthropic', $model, $in, $out);
                    $this->checkStop($event->delta->stopReason);
                }
            }
        } catch (APIConnectionException|APIStatusException $e) {
            throw $this->failure($e);
        }
    }

    public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
    {
        $client = new Client(apiKey: $this->apiKey);

        try {
            $message = $client->beta->messages->create(
                model: $model,
                maxTokens: 16000,
                system: $system,
                messages: [['role' => 'user', 'content' => $content]],
                thinking: ['type' => 'adaptive'],
                outputConfig: array_filter([
                    'effort' => $effort,
                    'format' => ['type' => 'json_schema', 'schema' => $schema],
                ]),
                fallbacks: 'default',
                betas: [self::FALLBACK_BETA],
            );
        } catch (APIConnectionException|APIStatusException $e) {
            throw $this->failure($e);
        }

        $this->usage?->record('anthropic', $model, $message->usage->inputTokens, $message->usage->outputTokens);

        if ($message->stopReason === BetaStopReason::REFUSAL->value) {
            throw new GenerationFailed('Claude won’t answer this one. Try putting it differently.');
        }
        if ($message->stopReason === BetaStopReason::MAX_TOKENS->value) {
            throw new GenerationFailed('Claude’s answer ran too long. Try again.');
        }

        foreach ($message->content as $block) {
            if ($block instanceof BetaTextBlock && is_array($data = json_decode($block->text, true))) {
                return $data;
            }
        }

        throw new GenerationFailed('Claude’s answer came back garbled. Try again.');
    }

    private function failure(APIConnectionException|APIStatusException $e): GenerationFailed
    {
        if ($e instanceof AuthenticationException || $e instanceof PermissionDeniedException) {
            report($e);

            return new GenerationFailed('AI writing isn’t set up correctly: the Anthropic API key was rejected.');
        }
        if ($e instanceof RateLimitException) {
            return new GenerationFailed('Claude is busy right now. Give it a minute and try again.');
        }
        if ($e instanceof APIConnectionException) {
            return new GenerationFailed('Couldn’t reach Claude. Try again in a moment.');
        }

        report($e);

        return new GenerationFailed('Claude couldn’t write this one. Try again in a moment.');
    }

    private function checkStop(?string $reason): void
    {
        match ($reason) {
            BetaStopReason::REFUSAL->value => throw new GenerationFailed(
                'Claude won’t write this one. Try a different brief.'
            ),
            BetaStopReason::MAX_TOKENS->value => throw new GenerationFailed(
                'That ran longer than a post can be. Ask for something shorter.'
            ),
            default => null,
        };
    }
}
