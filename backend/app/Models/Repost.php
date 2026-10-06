<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An X post picked for reuse on Instagram. A person records whether reuse is allowed and why
 * before anything is adapted; the adapted caption always credits the original author.
 */
#[Fillable(['user_id', 'account_id', 'source_url', 'author', 'source_text', 'permission', 'permission_note', 'status', 'caption', 'hashtags', 'attribution', 'post_id'])]
class Repost extends Model
{
    public const PERMISSIONS = ['pending', 'allowed', 'denied'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'captured', 'permission' => 'pending', 'attribution' => true];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'hashtags' => 'array',
            'attribution' => 'boolean',
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

    /**
     * @return BelongsTo<Post, $this>
     */
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /** The caption as it would post: the adaptation plus the credit line, when attribution is on. */
    public function creditedCaption(): string
    {
        $credit = 'Credit: @'.ltrim($this->author, '@');

        return $this->attribution ? trim($this->caption ?? '')."\n\n".$credit : trim($this->caption ?? '');
    }
}
