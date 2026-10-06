<?php

namespace App\Http\Resources;

use App\Models\Campaign;
use App\Services\Intake\Brief;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A campaign in the list: what it is and how far along.
 *
 * @mixin Campaign
 */
class CampaignSummaryResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title(),
            'name' => $this->name,
            'source' => $this->source,
            'stage' => $this->stage,
            'depth' => $this->depth,
            'complete' => $this->isComplete(),
            'filled' => $this->filledCount(),
            'total' => count(Brief::FIELDS),
            'photo_count' => $this->photos->count(),
            'has_kit' => filled($this->kit),
            'items_count' => $this->items()->count(),
            'period_start' => $this->period_start?->toDateString(),
            'period_end' => $this->period_end?->toDateString(),
            'completed_at' => $this->completed_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
