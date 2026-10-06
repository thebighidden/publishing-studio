<?php

namespace App\Services\Campaigns;

use App\Models\Account;
use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Services\Intake\IntakePrompt;

/**
 * What the agents read about a campaign: the brief (from the form, the intake interview, or
 * both), the reference photos, the period, and the accounts it goes to with their voices.
 */
class CampaignBrief
{
    public function __construct(private readonly Voice $voice) {}

    public function text(Campaign $campaign, bool $withVoices = true): string
    {
        $parts = [];
        $brief = array_filter($campaign->brief ?? []);
        if ($brief) {
            $parts[] = "# Campaign brief\n".collect([
                'goal' => 'Goal', 'audience' => 'Audience', 'message' => 'Message', 'key_facts' => 'Key facts (use only these; never invent others)', 'deadline' => 'Deadline',
            ])->filter(fn ($label, $key) => isset($brief[$key]))->map(fn ($label, $key) => "- **{$label}:** {$brief[$key]}")->join("\n");
        }
        if ($campaign->source === 'intake') {
            $parts[] = IntakePrompt::markdown($campaign);
        } elseif ($campaign->photos->isNotEmpty()) {
            $parts[] = "## Reference photos\n".$this->photos($campaign);
        }

        if ($campaign->period_start) {
            $parts[] = '## Period'."\n".$campaign->period_start->format('l j F Y').' to '.$campaign->period_end?->format('l j F Y');
        }

        $accounts = $campaign->accounts();
        if ($accounts->isNotEmpty()) {
            $parts[] = "## Accounts\n".$accounts->map(fn (Account $a) => "### Account id {$a->id}\n".($withVoices ? $this->voice->context($a) : "@{$a->handle} on {$a->platform->label()}"))->join("\n\n");
        }

        return implode("\n\n", $parts);
    }

    public function photos(Campaign $campaign): string
    {
        return $campaign->photos->values()
            ->map(fn (CampaignPhoto $p, int $i) => 'Photo '.($i + 1).($p->kind ? " ({$p->kind})" : '').': '.($p->description ?: $p->title ?: 'no description'))
            ->join("\n");
    }
}
