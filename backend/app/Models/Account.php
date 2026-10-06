<?php

namespace App\Models;

use App\Enums\Platform;
use Database\Factories\AccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A social account the studio posts to, e.g. @maisoncire on Instagram. Its editorial profile
 * and memory shape everything written for it; its phone is where automated posts go out.
 */
#[Fillable(['platform', 'handle', 'name', 'timezone', 'device_id', 'automation', 'autonomy', 'min_gap_minutes', 'profile'])]
class Account extends Model
{
    /** @use HasFactory<AccountFactory> */
    use HasFactory;

    /** Mode A: every action waits for a person. Mode B: approved rules let matching actions run. */
    public const AUTONOMY = ['approve_all', 'rules'];

    /** @var array<string, mixed> */
    protected $attributes = ['automation' => false, 'autonomy' => 'approve_all', 'min_gap_minutes' => 60];

    /** The editorial profile's fields, used in every generation for the account. */
    public const PROFILE_FIELDS = ['tone', 'topics', 'style', 'do', 'avoid', 'language', 'hashtags'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'platform' => Platform::class,
            'automation' => 'boolean',
            'min_gap_minutes' => 'integer',
            'profile' => 'array',
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
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /**
     * @return HasMany<Post, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }

    /**
     * @return HasMany<AccountMemory, $this>
     */
    public function memories(): HasMany
    {
        return $this->hasMany(AccountMemory::class);
    }

    /**
     * @return HasMany<ProfileChange, $this>
     */
    public function profileChanges(): HasMany
    {
        return $this->hasMany(ProfileChange::class);
    }

    /**
     * The account's mode-B rules: what may run on its own.
     *
     * @return HasMany<AutonomyRule, $this>
     */
    public function rules(): HasMany
    {
        return $this->hasMany(AutonomyRule::class);
    }

    /**
     * @return HasMany<Comment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    /**
     * @return HasMany<Repost, $this>
     */
    public function reposts(): HasMany
    {
        return $this->hasMany(Repost::class);
    }

    public function timezoneOrUsers(): string
    {
        return $this->timezone ?? $this->user->timezoneOrUtc();
    }

    /** How many comment replies this account sent today (for max_per_day rules). */
    public function repliesSentToday(): int
    {
        return $this->comments()->whereNotNull('sent_at')->where('sent_at', '>=', now()->startOfDay())->count();
    }

    public function label(): string
    {
        return '@'.ltrim($this->handle, '@').' on '.$this->platform->label();
    }
}
