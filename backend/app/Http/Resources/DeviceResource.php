<?php

namespace App\Http\Resources;

use App\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Device
 */
class DeviceResource extends JsonResource
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
            'name' => $this->name,
            'driver' => $this->driver,
            'ref' => $this->ref,
            'status' => $this->paused_at ? 'paused' : $this->status,
            'profile' => $this->profile,
            'booked_run_id' => $this->booked_run_id,
            'paused' => $this->isPaused(),
            'last_seen_at' => $this->last_seen_at?->toIso8601ZuluString(),
            'screenshot_url' => $this->last_screenshot ? "/api/devices/{$this->id}/screenshot" : null,
            'accounts' => $this->whenLoaded('accounts', fn () => $this->accounts->map(fn ($a) => ['id' => $a->id, 'platform' => $a->platform, 'handle' => $a->handle])),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
