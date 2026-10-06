<?php

namespace App\Http\Resources;

use App\Models\Post;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Post
 */
class PostResource extends JsonResource
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
            'title' => $this->title,
            'body' => $this->body,
            'format' => $this->format,
            'placement' => $this->placement,
            'platforms' => $this->platforms,
            'status' => $this->status,
            'account' => $this->account ? [
                'id' => $this->account->id,
                'platform' => $this->account->platform,
                'handle' => $this->account->handle,
                'automation' => $this->account->automation,
            ] : null,
            'assets' => $this->assets->map->summary(),
            'campaign' => $this->campaign_id ? ['id' => $this->campaign_id, 'name' => $this->campaign?->title()] : null,
            'approved_at' => $this->approved_at?->toIso8601ZuluString(),
            'post_url' => $this->post_url,
            'error' => $this->error,
            'scheduled_at' => $this->scheduled_at?->toIso8601ZuluString(),
            'published_at' => $this->published_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
