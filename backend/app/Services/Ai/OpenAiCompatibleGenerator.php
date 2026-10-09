<?php

namespace App\Services\Ai;

use Generator;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Text from any OpenAI-compatible chat API: a team gateway, OpenRouter, vLLM, LM Studio, or
 * Ollama's /v1 endpoint. Same contract as Claude's generator, so callers don't care which.
 */
class OpenAiCompatibleGenerator implements TextGenerator
{
    /**
     * @param  string|null  $fixedEffort  When set, every call uses this effort whatever the caller
     *                                    asked for (AI_GATEWAY_REASONING_EFFORT). "low" is how to run
     *                                    GLM without thinking: see reasoning() below.
     * @param  list<string>  $plainModels  Model-name prefixes that answer without thinking unless told
     *                                     otherwise (AI_GATEWAY_PLAIN_MODELS, e.g. gemma4). They are never
     *                                     sent reasoning_effort, because any value turns thinking on.
     */
    public function __construct(
        private readonly string $provider,
        private readonly string $baseUrl,
        private readonly ?string $key,
        private readonly ?UsageMeter $usage = null,
        private readonly ?string $fixedEffort = null,
        private readonly array $plainModels = [],
    ) {}

    public function enabled(): bool
    {
        return filled($this->baseUrl);
    }

    public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
    {
        $response = $this->send([
            'model' => $model,
            'stream' => true,
            'stream_options' => ['include_usage' => true],
            'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $prompt]],
            ...$this->reasoning($effort, $model),
        ], stream: true);

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        while (! $body->eof()) {
            $buffer .= $body->read(2048);
            while (($end = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $end));
                $buffer = substr($buffer, $end + 1);
                if (! str_starts_with($line, 'data:')) {
                    continue;
                }
                $data = trim(substr($line, 5));
                if ($data === '[DONE]') {
                    return;
                }
                $event = json_decode($data, true);
                if (isset($event['error'])) {
                    throw new GenerationFailed('The model stopped: '.($event['error']['message'] ?? 'unknown error').'.');
                }
                if (isset($event['usage']['prompt_tokens'])) {
                    $this->usage?->record($this->provider, $model, (int) $event['usage']['prompt_tokens'], (int) ($event['usage']['completion_tokens'] ?? 0));
                }
                $text = $event['choices'][0]['delta']['content'] ?? null;
                if (is_string($text) && $text !== '') {
                    yield $text;
                }
            }
        }
    }

    /**
     * The schema goes in two places on purpose. `response_format` is the real constraint on
     * gateways that implement it, but plenty don't — Ollama Cloud accepts the parameter and
     * ignores it outright, answering with keys of the model's own invention and none of the ones
     * asked for, which silently empties every caller that reads named fields. Spelling the schema
     * out in the system message costs a few hundred tokens and makes those gateways conform, so
     * the contract holds either way rather than depending on which endpoint is configured.
     */
    public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
    {
        $response = $this->send([
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system
                    ."\n\nReply with one JSON object only, matching this JSON Schema exactly: the same keys, "
                    .'no extra keys, no missing keys. Use "" or an empty list for anything you have no value for.'
                    ."\n".json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)],
                ['role' => 'user', 'content' => is_string($content) ? $content : $this->blocks($content)],
            ],
            'response_format' => ['type' => 'json_schema', 'json_schema' => ['name' => 'reply', 'schema' => $schema, 'strict' => true]],
            ...$this->reasoning($effort, $model),
        ]);

        $this->usage?->record($this->provider, $model, (int) $response->json('usage.prompt_tokens', 0), (int) $response->json('usage.completion_tokens', 0));
        $text = (string) $response->json('choices.0.message.content', '');
        // Some local models wrap JSON in a code fence despite being asked not to.
        $data = json_decode(preg_replace('/^```(?:json)?\s*|\s*```$/', '', trim($text)), true);

        if (! is_array($data)) {
            throw new GenerationFailed('The model’s answer came back garbled. Try again, or switch model.');
        }

        return $data;
    }

    /**
     * How hard a reasoning model should think, as `reasoning_effort`. Omitted entirely when the
     * caller has no preference, which leaves the model on its default.
     *
     * "low" is the useful setting for a conversational agent: measurably faster, and on GLM it
     * returns no reasoning at all while the answer stays clean in `content`. Note that "none" is
     * deliberately never sent — it does not stop a reasoning model thinking, it stops the thinking
     * being separated out, so the monologue lands inside `content` (complete with a stray
     * `</think>`) and ends up in a caption. Capped at "high" because xhigh/max aren't accepted here.
     *
     * Plain models are the opposite case: Gemma 4 answers directly by default, and sending it
     * reasoning_effort — even "low" — switches thinking on (measured: 0 → 800+ characters of
     * reasoning, 1.1s → 2.7s). So they get nothing.
     *
     * @return array<string, string>
     */
    private function reasoning(?string $effort, string $model): array
    {
        foreach ($this->plainModels as $prefix) {
            if ($prefix !== '' && str_starts_with($model, $prefix)) {
                return [];
            }
        }

        return match ($this->fixedEffort ?: $effort) {
            'low' => ['reasoning_effort' => 'low'],
            'medium' => ['reasoning_effort' => 'medium'],
            'high', 'xhigh', 'max' => ['reasoning_effort' => 'high'],
            default => [],
        };
    }

    /**
     * Anthropic-style content blocks (text, base64 images) in OpenAI's shape.
     *
     * @param  list<array<string, mixed>>  $blocks
     * @return list<array<string, mixed>>
     */
    private function blocks(array $blocks): array
    {
        return array_map(fn (array $b) => $b['type'] === 'image'
            ? ['type' => 'image_url', 'image_url' => ['url' => "data:{$b['source']['mediaType']};base64,{$b['source']['data']}"]]
            : ['type' => 'text', 'text' => $b['text']], $blocks);
    }

    private function send(array $body, bool $stream = false): Response
    {
        try {
            $response = $this->client($stream)->post($this->baseUrl.'/chat/completions', $body);
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach the model. Is the '.($this->provider === 'ollama' ? 'Ollama server' : 'gateway').' running?');
        }

        if ($response->status() === 401 || $response->status() === 403) {
            throw new GenerationFailed('The '.$this->provider.' rejected the key.');
        }
        if ($response->status() === 429) {
            throw new GenerationFailed('The model is busy, or the spend cap is reached. Give it a minute.');
        }
        if (! $response->successful()) {
            throw new GenerationFailed('The model couldn’t answer ('.$response->status().'). Try again, or switch model.');
        }

        return $response;
    }

    private function client(bool $stream): PendingRequest
    {
        return Http::timeout(600)->acceptJson()
            ->when($this->key, fn (PendingRequest $r) => $r->withToken($this->key))
            ->when($stream, fn (PendingRequest $r) => $r->withOptions(['stream' => true]));
    }
}
