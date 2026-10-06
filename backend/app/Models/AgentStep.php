<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One agent's turn in a campaign's pipeline: who, what it made, what it cost, or why it failed.
 */
#[Fillable(['agent', 'status', 'summary', 'output', 'model', 'cost', 'error', 'started_at', 'finished_at'])]
class AgentStep extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'running'];

    public const AGENTS = ['writer', 'visual_director', 'media', 'adapter', 'qa', 'scheduler', 'publisher'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'output' => 'array',
            'cost' => 'float',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
