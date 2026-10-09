<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A published post's latest likes, comments, shares, saves, views, reach and reactions. */
#[Fillable(['post_id', 'likes', 'comments', 'shares', 'saves', 'views', 'reach', 'reactions', 'source', 'error', 'fetched_at'])]
class PostMetric extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['reactions' => 'array', 'fetched_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<Post, $this>
     */
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'likes' => $this->likes,
            'comments' => $this->comments,
            'shares' => $this->shares,
            'saves' => $this->saves,
            'views' => $this->views,
            'reach' => $this->reach,
            'reactions' => $this->reactions,
            'source' => $this->source,
            'error' => $this->error,
            'fetched_at' => $this->fetched_at?->toIso8601ZuluString(),
        ];
    }
}
