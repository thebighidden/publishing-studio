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
    public function __construct(
        private readonly string $provider,
        private readonly string $baseUrl,
        private readonly ?string $key,
        private readonly ?UsageMeter $usage = null,
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

    public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
    {
        $response = $this->send([
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system."\n\nReply with one JSON object only."],
                ['role' => 'user', 'content' => is_string($content) ? $content : $this->blocks($content)],
            ],
            'response_format' => ['type' => 'json_schema', 'json_schema' => ['name' => 'reply', 'schema' => $schema, 'strict' => true]],
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
