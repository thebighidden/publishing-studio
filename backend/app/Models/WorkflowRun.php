<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One run of a workflow. `outputs` holds, per step, what it made: the generation, its files,
 * the text it wrote, or the post it drafted.
 */
#[Fillable(['workflow_id', 'name', 'steps', 'prompt', 'start_asset_id', 'board_id', 'status', 'step', 'outputs', 'error', 'finished_at'])]
class WorkflowRun extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['steps' => 'array', 'outputs' => 'array', 'step' => 'integer', 'finished_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Workflow, $this>
     */
    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        $outputs = $this->outputs ?? [];
        $assets = Asset::whereIn('id', collect($outputs)->pluck('assets')->flatten()->filter()->all())->get()->keyBy('id');

        return [
            'id' => $this->id,
            'workflow_id' => $this->workflow_id,
            'name' => $this->name,
            'prompt' => $this->prompt,
            'status' => $this->status,
            'step' => $this->step,
            'error' => $this->error,
            'steps' => collect($this->steps)->map(fn (array $s, int $i) => [
                'type' => $s['type'],
                'status' => match (true) {
                    isset($outputs[$i]['done']) => 'succeeded',
                    $this->status === 'failed' && $i === $this->step => 'failed',
                    $this->status === 'running' && $i === $this->step => 'running',
                    default => 'waiting',
                },
                'assets' => collect($outputs[$i]['assets'] ?? [])->map(fn ($id) => $assets->get($id)?->summary())->filter()->values(),
                'text' => $outputs[$i]['text'] ?? null,
                'post_id' => $outputs[$i]['post_id'] ?? null,
            ])->values(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'finished_at' => $this->finished_at?->toIso8601ZuluString(),
        ];
    }
}
