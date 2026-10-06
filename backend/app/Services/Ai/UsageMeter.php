<?php

namespace App\Services\Ai;

use App\Models\AiUsage;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Records what each model call cost. Callers say who it's for and what it's part of with
 * `within()`; the generators report tokens, and the price comes from config/ai.php.
 */
class UsageMeter
{
    private ?User $user = null;

    private ?Model $context = null;

    private ?string $purpose = null;

    /** @var list<array{0: User|null, 1: Model|null, 2: string|null}> */
    private array $stack = [];

    /**
     * @template T
     *
     * @param  callable(): T  $run
     * @return T
     */
    public function within(?User $user, ?Model $context, ?string $purpose, callable $run): mixed
    {
        $this->push($user, $context, $purpose);

        try {
            return $run();
        } finally {
            $this->pop();
        }
    }

    /**
     * For streams, which run lazily: push before iterating, pop in a finally once done.
     */
    public function push(?User $user, ?Model $context, ?string $purpose): void
    {
        $this->stack[] = [$this->user, $this->context, $this->purpose];
        [$this->user, $this->context, $this->purpose] = [$user, $context, $purpose];
    }

    public function pop(): void
    {
        [$this->user, $this->context, $this->purpose] = array_pop($this->stack) ?? [null, null, null];
    }

    public function record(string $provider, string $model, int $inputTokens, int $outputTokens, ?float $cost = null): AiUsage
    {
        return AiUsage::create([
            'user_id' => $this->user?->id,
            'provider' => $provider,
            'model' => $model,
            'purpose' => $this->purpose,
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'cost' => $cost ?? self::price($model, $inputTokens, $outputTokens),
            'context_type' => $this->context?->getMorphClass(),
            'context_id' => $this->context?->getKey(),
        ]);
    }

    /** Dollars, at the per-million-token prices in config/ai.php (0 for models without one). */
    public static function price(string $model, int $inputTokens, int $outputTokens): float
    {
        [$in, $out] = config("ai.prices.{$model}", [0, 0]);

        return round(($inputTokens * $in + $outputTokens * $out) / 1_000_000, 6);
    }
}
