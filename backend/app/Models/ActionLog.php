<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * Who did what, and on whose authority: a person, an agent, a rule, or the system.
 * Policy previews replay it, and investigations read it.
 */
#[Fillable(['actor', 'action', 'subject_type', 'subject_id', 'decision', 'summary', 'meta'])]
class ActionLog extends Model
{
    public const UPDATED_AT = null;

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
     * @param  array<string, mixed>  $meta
     */
    public static function record(User $user, string $actor, string $action, ?Model $subject, string $summary, ?string $decision = null, array $meta = []): self
    {
        return $user->actionLogs()->create([
            'actor' => $actor,
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'decision' => $decision,
            'summary' => $summary,
            'meta' => $meta ?: null,
        ]);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function subject(): MorphTo
    {
        return $this->morphTo();
    }
}
