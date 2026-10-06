<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

/**
 * One master piece of a campaign: what it says, how it looks, its media. Each account it goes
 * to gets a variant.
 */
#[Fillable(['position', 'title', 'pillar', 'format', 'message', 'hook', 'caption', 'visual', 'prompts', 'reference_photo', 'shots', 'asset_ids', 'account_ids', 'source', 'status', 'error'])]
class CampaignItem extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'planned', 'format' => 'image', 'source' => 'ai'];

    public const FORMATS = ['text', 'image', 'video', 'carousel'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'prompts' => 'array',
            'shots' => 'array',
            'asset_ids' => 'array',
            'account_ids' => 'array',
            'position' => 'integer',
            'reference_photo' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    /**
     * @return HasMany<ItemVariant, $this>
     */
    public function variants(): HasMany
    {
        return $this->hasMany(ItemVariant::class);
    }

    /**
     * @return HasMany<Generation, $this>
     */
    public function generations(): HasMany
    {
        return $this->hasMany(Generation::class);
    }

    /**
     * @return Collection<int, Asset>
     */
    public function assets(): Collection
    {
        $ids = $this->asset_ids ?? [];

        return $ids ? Asset::whereIn('id', $ids)->get()->sortBy(fn (Asset $a) => array_search($a->id, $ids))->values() : collect();
    }

    public function needsMedia(): bool
    {
        return $this->format !== 'text';
    }
}
