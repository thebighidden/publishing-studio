<?php

namespace App\Models;

use App\Services\Intake\Brief;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * A campaign intake: the interview, the brief it fills in, the reference photos, and the content kit.
 *
 * `messages` is the chat as shown, each `{who: agency|client|note, text, photos?: list<photo id>}`.
 * Notes are for the person only; they're left out of what Claude reads.
 */
#[Fillable(['name', 'source', 'stage', 'autonomy', 'depth', 'mode', 'fields', 'brief', 'messages', 'prompt', 'pending', 'asked', 'completed_at', 'kit', 'account_ids', 'period_start', 'period_end', 'plan', 'plan_approved_at', 'plan_approved_by'])]
class Campaign extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['stage' => 'brief', 'source' => 'intake'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'fields' => 'array',
            'messages' => 'array',
            'prompt' => 'array',
            'asked' => 'integer',
            'completed_at' => 'datetime',
            'brief' => 'array',
            'account_ids' => 'array',
            'period_start' => 'date',
            'period_end' => 'date',
            'plan' => 'array',
            'plan_approved_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::deleted(fn (Campaign $campaign) => Storage::disk('local')->deleteDirectory($campaign->directory()));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<CampaignPhoto, $this>
     */
    public function photos(): HasMany
    {
        return $this->hasMany(CampaignPhoto::class)->orderBy('id');
    }

    /**
     * @return HasMany<CampaignItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(CampaignItem::class)->orderBy('position')->orderBy('id');
    }

    /**
     * @return HasMany<AgentStep, $this>
     */
    public function steps(): HasMany
    {
        return $this->hasMany(AgentStep::class)->orderBy('id');
    }

    /**
     * The accounts the campaign publishes to.
     *
     * @return Collection<int, Account>
     */
    public function accounts(): Collection
    {
        return $this->user->accounts()->whereIn('id', $this->account_ids ?? [])->get();
    }

    /** The brief is ready for the agents: the interview finished, or the form was filled in. */
    public function briefReady(): bool
    {
        return $this->source === 'form' || $this->isComplete();
    }

    /** Where this campaign's photos are kept on the local disk. */
    public function directory(): string
    {
        return self::directoryFor($this->user_id)."/{$this->id}";
    }

    public static function directoryFor(int $userId): string
    {
        return "campaigns/{$userId}";
    }

    public function isComplete(): bool
    {
        return $this->completed_at !== null;
    }

    /**
     * A field as the brief shows it. Shared photos stand in for the answer to the photos question.
     */
    public function value(string $key): string
    {
        if ($key === 'photos' && $this->photos->isNotEmpty()) {
            $kinds = $this->photos->pluck('kind')->filter()->countBy()
                ->map(fn (int $n, string $kind) => "{$n} {$kind}")->values();
            $n = $this->photos->count();

            return $n.' '.Str::plural('photo', $n).($kinds->isNotEmpty() ? ' ('.$kinds->join(', ').')' : '');
        }

        return (string) ($this->fields[$key] ?? '');
    }

    public function filledCount(): int
    {
        return count(array_filter(Brief::keys(), fn (string $key) => $this->value($key) !== ''));
    }

    public function hasSuggestions(): bool
    {
        return collect(Brief::keys())->contains(fn (string $key) => Brief::isSuggested($this->value($key)));
    }

    /** What the list calls it: its name, who it's for, or what it sells. */
    public function title(): ?string
    {
        if (filled($this->name)) {
            return Str::limit($this->name, 60);
        }
        foreach (['business', 'offer'] as $key) {
            $value = trim(Str::replaceLast(Brief::SUGGESTED, '', $this->value($key)));
            if ($value !== '') {
                return Str::limit($value, 60);
            }
        }

        return null;
    }

    /**
     * The last thing said was the client's: the interview owes them its next question.
     * (A failed turn leaves it this way, and "try again" picks it up from here.)
     */
    public function awaitingReply(): bool
    {
        if ($this->isComplete()) {
            return false;
        }
        $said = array_filter($this->messages ?? [], fn (array $m) => $m['who'] !== 'note');

        return ($said ? end($said)['who'] : null) === 'client';
    }

    /**
     * @param  list<int>  $photos
     */
    public function say(string $who, string $text, array $photos = []): void
    {
        $this->messages = [...($this->messages ?? []), ['who' => $who, 'text' => $text] + ($photos ? ['photos' => $photos] : [])];
    }
}
