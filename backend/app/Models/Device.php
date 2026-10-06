<?php

namespace App\Models;

use Database\Factories\DeviceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A phone that publishes. One job runs on it at a time: `booked_run_id` is taken and released
 * with conditional updates, never read-then-write.
 */
#[Fillable(['name', 'driver', 'ref', 'status', 'profile', 'paused_at', 'last_seen_at', 'last_screenshot', 'meta'])]
class Device extends Model
{
    /** @use HasFactory<DeviceFactory> */
    use HasFactory;

    public const DRIVERS = ['simulator', 'http'];

    public const PROFILES = ['reliable', 'flaky', 'broken'];

    /** @var array<string, mixed> */
    protected $attributes = ['driver' => 'simulator', 'status' => 'idle', 'profile' => 'reliable'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'paused_at' => 'datetime',
            'booked_at' => 'datetime',
            'last_seen_at' => 'datetime',
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
     * @return HasMany<Account, $this>
     */
    public function accounts(): HasMany
    {
        return $this->hasMany(Account::class);
    }

    public function isPaused(): bool
    {
        return $this->paused_at !== null;
    }
}
