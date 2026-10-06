<?php

namespace App\Http\Resources;

use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Services\Campaigns\Agents;
use App\Services\Intake\Brief;
use App\Services\Intake\IntakePrompt;
use App\Services\Intake\Interviewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Everything the intake page shows: the brief by group, the chat, the open question's answer
 * chips, the photos and the content kit.
 *
 * @mixin Campaign
 */
class CampaignResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $photoIds = $this->photos->pluck('id')->all();

        return [
            ...CampaignSummaryResource::make($this->resource)->toArray($request),
            'mode' => $this->mode,
            'ai_available' => app(Interviewer::class)->aiAvailable($request->user()),
            'asked' => $this->asked,
            'max_questions' => Brief::MAX_QUESTIONS[$this->depth],
            'pending' => $this->pending,
            'awaiting_reply' => $this->awaitingReply(),
            'brief' => collect(Brief::GROUPS)->map(fn (string $label, string $group) => [
                'id' => $group,
                'label' => $label,
                'fields' => collect(Brief::FIELDS)
                    ->filter(fn (array $f) => $f['group'] === $group)
                    ->map(fn (array $f, string $key) => [
                        'key' => $key,
                        'label' => $f['label'],
                        'value' => $this->value($key),
                        'suggested' => Brief::isSuggested($this->value($key)),
                    ])->values(),
            ])->values(),
            'messages' => collect($this->messages)->map(fn (array $m) => isset($m['photos'])
                // Photos removed since are dropped from the message that shared them.
                ? [...$m, 'photos' => array_values(array_intersect($m['photos'], $photoIds))]
                : $m),
            'prompt' => $this->prompt,
            'photos' => $this->photos->map(fn (CampaignPhoto $p) => [
                'id' => $p->id,
                'url' => "/api/campaigns/{$this->id}/photos/{$p->id}",
                'mime' => $p->mime,
                'kind' => $p->kind,
                'title' => $p->title,
                'description' => $p->description,
            ]),
            'max_photos' => Brief::MAX_PHOTOS,
            'kit' => $this->kit,
            'markdown' => IntakePrompt::markdown($this->resource),
            // The campaign engine.
            'brief_form' => (object) ($this->brief ?? []),
            'brief_ready' => $this->briefReady(),
            'account_ids' => $this->account_ids ?? [],
            'autonomy' => $this->autonomy,
            'plan' => $this->plan,
            'plan_approved_at' => $this->plan_approved_at?->toIso8601ZuluString(),
            // How many posts the writer will plan for the period, at the brief's rhythm.
            'post_count' => app(Agents::class)->postCount($this->resource),
            'steps' => $this->steps()->latest('id')->limit(30)->get()->reverse()->values()->map(fn ($s) => [
                'id' => $s->id, 'agent' => $s->agent, 'status' => $s->status, 'summary' => $s->summary, 'error' => $s->error,
                'cost' => $s->cost, 'started_at' => $s->started_at?->toIso8601ZuluString(), 'finished_at' => $s->finished_at?->toIso8601ZuluString(),
            ]),
        ];
    }
}
