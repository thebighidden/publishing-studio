<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

/**
 * An item as it goes to one account: the same as the master (shared), or its own version
 * (adapted). Gate 6B approves variants; only approved ones can be scheduled.
 */
#[Fillable(['campaign_item_id', 'account_id', 'mode', 'caption', 'placement', 'asset_ids', 'checks', 'qa', 'status', 'feedback', 'approved_at', 'approved_by'])]
class ItemVariant extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['mode' => 'adapted', 'status' => 'draft'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'asset_ids' => 'array',
            'checks' => 'array',
            'qa' => 'array',
            'approved_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<CampaignItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CampaignItem::class, 'campaign_item_id');
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /**
     * Every posting time this variant has.
     *
     * @return HasMany<Post, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class, 'variant_id');
    }

    /**
     * Its own media, or the master's when it shares them.
     *
     * @return Collection<int, Asset>
     */
    public function assets(): Collection
    {
        $ids = $this->asset_ids ?? $this->item->asset_ids ?? [];

        return $ids ? Asset::whereIn('id', $ids)->get()->sortBy(fn (Asset $a) => array_search($a->id, $ids))->values() : collect();
    }

    public function passes(): bool
    {
        return ($this->checks['ok'] ?? false) && ($this->qa['status'] ?? 'pass') !== 'fail';
    }
}
