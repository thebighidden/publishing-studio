<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One attempt to publish a post from a phone. While it runs the steps accumulate; when it
 * ends the outcome is confirmed, failed or — honestly — uncertain. `record()` is the exact
 * JSON object the hand-in asks for, one per run.
 */
#[Fillable(['uuid', 'user_id', 'post_id', 'device_id', 'attempt', 'status', 'goal', 'steps', 'evidence', 'screenshot_id', 'spend', 'error', 'started_at', 'ended_at'])]
class PublishingRun extends Model
{
    public const OUTCOMES = ['running', 'confirmed', 'failed', 'uncertain'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'running', 'attempt' => 1, 'spend' => 0];

    protected static function booted(): void
    {
        static::creating(fn (PublishingRun $run) => $run->uuid ??= (string) Str::uuid());
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'steps' => 'array',
            'evidence' => 'array',
            'spend' => 'decimal:4',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
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
     * @return BelongsTo<Post, $this>
     */
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /**
     * The screenshot taken at the end of the run, whatever happened.
     *
     * @return BelongsTo<Asset, $this>
     */
    public function screenshot(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'screenshot_id');
    }

    public function isRunning(): bool
    {
        return $this->status === 'running';
    }

    /**
     * Append one step, timed. Steps are how the run proves what it did.
     */
    public function step(string $action, bool $ok, int $ms, ?string $note = null): void
    {
        $steps = $this->steps ?? [];
        $step = ['n' => count($steps) + 1, 'action' => $action, 'ok' => $ok, 'ms' => $ms];
        if ($note) {
            $step['note'] = Str::limit($note, 200, '');
        }
        $steps[] = $step;
        $this->steps = $steps;
    }

    public function wallClockMs(): int
    {
        return (int) round(($this->started_at?->diffInMilliseconds($this->ended_at ?? now())) ?? 0);
    }

    /**
     * The run record, exactly as the hand-in wants it: one JSON object per publishing run.
     *
     * @return array<string, mixed>
     */
    public function record(): array
    {
        return [
            'run_id' => $this->uuid,
            'goal' => $this->goal,
            'account' => $this->post?->account?->handle,
            'started_at' => $this->started_at?->toIso8601ZuluString(),
            'ended_at' => $this->ended_at?->toIso8601ZuluString(),
            'outcome' => $this->status,
            'evidence' => $this->evidence,
            'steps' => $this->steps ?? [],
            'totals' => [
                'steps' => count($this->steps ?? []),
                'wall_clock_ms' => $this->wallClockMs(),
                'spend' => (float) $this->spend,
            ],
        ];
    }
}
