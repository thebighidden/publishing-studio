<?php

namespace App\Http\Resources;

use App\Models\PublishingRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A run as the dashboard shows it: the hand-in record plus what it belongs to.
 *
 * @mixin PublishingRun
 */
class PublishingRunResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...$this->record(),
            'id' => $this->id,
            'attempt' => $this->attempt,
            'error' => $this->error,
            'post' => $this->whenLoaded('post', fn () => [
                'id' => $this->post->id,
                'title' => $this->post->title,
                'status' => $this->post->status->value,
                'placement' => $this->post->placement,
            ]),
            'device' => $this->whenLoaded('device', fn () => ['id' => $this->device?->id, 'name' => $this->device?->name]),
            'screenshot_url' => $this->screenshot_id ? "/api/assets/{$this->screenshot_id}/file" : null,
        ];
    }
}
