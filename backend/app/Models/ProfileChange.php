<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A proposed edit to an account's editorial profile, by a person or by the AI. It changes
 * nothing until it's approved.
 */
#[Fillable(['field', 'from', 'to', 'reason', 'source', 'status', 'decided_by', 'decided_at'])]
class ProfileChange extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'pending', 'source' => 'operator'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['decided_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}
