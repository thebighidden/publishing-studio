<?php

namespace App\Services\Ai;

use Anthropic\Beta\Messages\BetaRawContentBlockDeltaEvent;
use Anthropic\Beta\Messages\BetaRawMessageDeltaEvent;
use Anthropic\Beta\Messages\BetaStopReason;
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
    public function __construct(private readonly ?string $apiKey) {}

    public function enabled(): bool
    {
        return filled($this->apiKey);
    }

    public function stream(string $model, string $system, string $prompt): Generator
    {
        $client = new Client(apiKey: $this->apiKey);

        try {
            $events = $client->beta->messages->createStream(
                model: $model,
                maxTokens: 64000,
                system: $system,
                messages: [['role' => 'user', 'content' => $prompt]],
                thinking: ['type' => 'adaptive'],
                // If the model declines, the API re-runs the request on Anthropic's recommended
                // fallback model and keeps streaming, instead of handing back a refusal.
                fallbacks: 'default',
                betas: ['server-side-fallback-2026-07-01'],
            );

            foreach ($events as $event) {
                if ($event instanceof BetaRawContentBlockDeltaEvent && $event->delta instanceof BetaTextDelta) {
                    yield $event->delta->text;
                } elseif ($event instanceof BetaRawMessageDeltaEvent) {
                    $this->checkStop($event->delta->stopReason);
                }
            }
        } catch (AuthenticationException|PermissionDeniedException $e) {
            report($e);
            throw new GenerationFailed('AI writing isn’t set up correctly: the Anthropic API key was rejected.');
        } catch (RateLimitException) {
            throw new GenerationFailed('Claude is busy right now. Give it a minute and try again.');
        } catch (APIConnectionException) {
            throw new GenerationFailed('Couldn’t reach Claude. Try again in a moment.');
        } catch (APIStatusException $e) {
            report($e);
            throw new GenerationFailed('Claude couldn’t write this one. Try again in a moment.');
        }
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
