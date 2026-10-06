<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Something an account remembers. Three kinds, kept apart: instructions (rules the operator
 * wrote), examples (posts someone liked), and history (what went out).
 */
#[Fillable(['kind', 'content', 'source', 'meta'])]
class AccountMemory extends Model
{
    public const KINDS = ['instruction', 'example', 'history'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['meta' => 'array'];
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}
