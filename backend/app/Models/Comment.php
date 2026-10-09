<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A comment on one of the account's posts. The AI triages it (reply, ignore, or send to a
 * human); a human approves every reply before it's sent, unless a mode-B rule covers it.
 */
#[Fillable(['user_id', 'account_id', 'author', 'body', 'post_ref', 'status', 'triage', 'draft', 'reply', 'sent_at', 'external_id', 'post_id', 'posted_at', 'reply_external_id'])]
class Comment extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'new'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'triage' => 'array',
            'sent_at' => 'datetime',
            'posted_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** Waiting on a person: triaged for a human, or a draft nobody approved yet. */
    public function needsHuman(): bool
    {
        return in_array($this->status, ['human', 'drafted'], true);
    }
}
