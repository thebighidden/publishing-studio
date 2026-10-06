<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One pass of the investigation pipeline: collect → compare → validate → report, over what
 * the studio claims happened and what the evidence actually shows.
 */
#[Fillable(['user_id', 'account_id', 'title', 'status', 'stage', 'stages', 'findings', 'counts', 'report', 'error'])]
class Investigation extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'running', 'stage' => 'collect'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'stages' => 'array',
            'findings' => 'array',
            'counts' => 'array',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** Note a stage done, timed, then move to the next. */
    public function stageDone(string $stage, string $summary, float $started): void
    {
        $stages = $this->stages ?? [];
        $stages[] = ['name' => $stage, 'summary' => $summary, 'ms' => (int) round((microtime(true) - $started) * 1000)];
        $this->stages = $stages;
        $this->stage = $stage;
        $this->save();
    }

    /** Open findings: issues, not things the validation explained. */
    public function openFindings(): array
    {
        return collect($this->findings ?? [])->filter(fn ($f) => ($f['verdict'] ?? 'issue') === 'issue')->values()->all();
    }
}
