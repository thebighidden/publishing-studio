<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An account connected through a platform's official API: an Instagram professional account or
 * a Facebook Page (through Meta), or an X account. The tokens are encrypted at rest and never
 * leave the server.
 */
#[Fillable(['user_id', 'account_id', 'provider', 'kind', 'external_id', 'name', 'username', 'access_token', 'refresh_token', 'token_expires_at', 'scopes', 'meta', 'status', 'error', 'checked_at'])]
#[Hidden(['access_token', 'refresh_token'])]
class AccountConnection extends Model
{
    public const KINDS = ['instagram', 'facebook_page', 'x'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'token_expires_at' => 'datetime',
            'checked_at' => 'datetime',
            'scopes' => 'array',
            'meta' => 'array',
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

    /** The FlowAI platform this connection publishes to. */
    public function platform(): string
    {
        return $this->kind === 'facebook_page' ? 'facebook' : $this->kind;
    }

    public function usable(): bool
    {
        return $this->status === 'ok' && (! $this->token_expires_at || $this->token_expires_at->isFuture() || $this->refresh_token);
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'provider' => $this->provider,
            'kind' => $this->kind,
            'platform' => $this->platform(),
            'name' => $this->name,
            'username' => $this->username,
            'account_id' => $this->account_id,
            'status' => $this->status,
            'error' => $this->error,
            'token_expires_at' => $this->token_expires_at?->toIso8601ZuluString(),
            'checked_at' => $this->checked_at?->toIso8601ZuluString(),
        ];
    }
}
