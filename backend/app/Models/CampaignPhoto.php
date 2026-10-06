<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A reference photo for a campaign. Claude's description of it is what the content kit's
 * image prompts build on.
 */
#[Fillable(['path', 'mime', 'kind', 'title', 'description'])]
class CampaignPhoto extends Model
{
    public const KINDS = ['person', 'product', 'place', 'other'];

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
