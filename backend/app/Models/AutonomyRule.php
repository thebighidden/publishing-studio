<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One approved rule of an account's mode B: matching actions run on their own.
 * Conditions narrow it; empty conditions match every action of that kind.
 */
#[Fillable(['action', 'allow', 'conditions', 'created_by'])]
class AutonomyRule extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['allow' => true];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'allow' => 'boolean',
            'conditions' => 'array',
        ];
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** Whether this rule applies to an action with this context (today's count of it, say). */
    public function matches(array $context = []): bool
    {
        foreach ($this->conditions ?? [] as $key => $want) {
            if ($key === 'max_per_day') {
                if (($context['today'] ?? 0) >= (int) $want) {
                    return false;
                }

                continue;
            }
            if (($context[$key] ?? null) !== $want) {
                return false;
            }
        }

        return true;
    }
}
