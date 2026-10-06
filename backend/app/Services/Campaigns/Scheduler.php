<?php

namespace App\Services\Campaigns;

use App\Enums\PostStatus;
use App\Models\ActionLog;
use App\Models\Campaign;
use App\Models\CampaignItem;
use App\Models\ItemVariant;
use App\Models\Post;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The scheduler: spreads approved content over a period, in order, at good times in each
 * account's own timezone, never two posts on one phone at once, never closer on one account
 * than its minimum gap. Also finds the conflicts in what's already scheduled.
 */
class Scheduler
{
    /** Two runs on one phone need this much room. */
    public const PHONE_MINUTES = 15;

    /** When nobody has set queue times: morning, lunch, evening. */
    private const DEFAULT_TIMES = ['09:00', '12:30', '18:30'];

    /**
     * Times for each approved variant, items in the given order.
     *
     * @param  list<int>  $order  item ids
     * @return list<array{variant_id: int, item_id: int, account_id: int, at: CarbonImmutable}>
     */
    public function propose(Campaign $campaign, array $order, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $user = $campaign->user;
        $items = $campaign->items()->with(['variants' => fn ($q) => $q->where('status', 'approved')->with('account.device')])->get()
            ->sortBy(fn (CampaignItem $i) => ($p = array_search($i->id, $order, true)) === false ? 1000 + $i->position : $p)
            ->filter(fn (CampaignItem $i) => $i->variants->isNotEmpty())
            ->values();
        if ($items->isEmpty()) {
            return [];
        }

        $days = max(1, (int) $from->diffInDays($to) + 1);
        $slots = $user->queueSlots()->get()->groupBy('weekday');
        // What's already booked, so new times work around it (this campaign's own posts get replaced).
        $taken = $user->posts()->with('account')->whereIn('status', [PostStatus::Scheduled, PostStatus::Publishing])
            ->where('scheduled_at', '>', now())->where(fn ($q) => $q->whereNull('campaign_id')->orWhere('campaign_id', '!=', $campaign->id))
            ->get()->map(fn (Post $p) => ['at' => CarbonImmutable::instance($p->scheduled_at), 'account_id' => $p->account_id, 'device_id' => $p->account?->device_id])->all();

        $proposal = [];
        foreach ($items as $i => $item) {
            $day = $from->addDays((int) floor($i * $days / $items->count()));
            foreach ($item->variants as $variant) {
                $account = $variant->account;
                $tz = $account->timezoneOrUsers();
                $local = CarbonImmutable::parse($day->toDateString(), $tz);
                $times = $slots->get($local->dayOfWeekIso)?->pluck('time')->all() ?: self::DEFAULT_TIMES;
                [$h, $m] = array_map('intval', explode(':', $times[$i % count($times)]));
                $at = $local->setTime($h, $m)->utc();
                if ($at->lessThan(now()->addMinutes(10))) {
                    $at = CarbonImmutable::now()->addMinutes(15)->second(0);
                }

                // Step forward until the account's gap and the phone are both clear.
                for ($tries = 0; $tries < 48 && ! $this->free($at, $account->id, $account->device_id, $account->min_gap_minutes, $taken); $tries++) {
                    $at = $at->addMinutes(20);
                }

                $taken[] = ['at' => $at, 'account_id' => $account->id, 'device_id' => $account->device_id];
                $proposal[] = ['variant_id' => $variant->id, 'item_id' => $item->id, 'account_id' => $account->id, 'at' => $at];
            }
        }

        return $proposal;
    }

    /**
     * Book the proposal: one scheduled post per variant and time. Replaces this campaign's
     * earlier, not yet published posts.
     *
     * @param  list<array{variant_id: int, at: CarbonImmutable}>  $proposal
     * @return Collection<int, Post>
     */
    public function apply(Campaign $campaign, array $proposal, User $user): Collection
    {
        $user->posts()->where('campaign_id', $campaign->id)->where('status', PostStatus::Scheduled)->delete();
        $variants = ItemVariant::with(['item', 'account'])->whereIn('id', array_column($proposal, 'variant_id'))->get()->keyBy('id');

        $posts = collect($proposal)->map(fn (array $p) => $this->book($variants[$p['variant_id']], $p['at'], $user));

        $campaign->update(['stage' => 'scheduled']);
        $campaign->steps()->create([
            'agent' => 'scheduler', 'status' => 'done', 'started_at' => now(), 'finished_at' => now(),
            'summary' => "Scheduled {$posts->count()} posts between ".$posts->min('scheduled_at')?->format('D j M').' and '.$posts->max('scheduled_at')?->format('D j M').'.',
            'output' => ['post_ids' => $posts->pluck('id')->all()],
        ]);
        ActionLog::record($user, 'agent:scheduler', 'campaign.scheduled', $campaign, "Scheduled {$posts->count()} posts for “{$campaign->title()}”.", 'approved');

        return $posts;
    }

    /** One more posting time for an approved variant: an item can go out more than once. */
    public function book(ItemVariant $variant, CarbonImmutable $at, User $user): Post
    {
        $item = $variant->item;
        $post = $user->posts()->create([
            'account_id' => $variant->account_id,
            'campaign_id' => $item->campaign_id,
            'variant_id' => $variant->id,
            'title' => Str::limit($item->title, 120, ''),
            'body' => (string) $variant->caption,
            'format' => match ($item->format) {
                'video' => 'video', 'text' => 'text', default => 'image'
            },
            'placement' => $variant->placement,
            'platforms' => [$variant->account->platform->value],
            'status' => PostStatus::Scheduled,
            'scheduled_at' => $at,
            // Gate 6B is the approval that lets it publish.
            'approved_at' => $variant->approved_at,
            'approved_by' => $variant->approved_by,
        ]);
        $post->syncAssets($variant->assets()->pluck('id')->all());

        return $post;
    }

    /**
     * What's wrong with what's scheduled: a phone booked twice, an account posting too close
     * together, too many approvals due at once.
     *
     * @return list<array{kind: string, message: string, post_ids: list<int>}>
     */
    public function conflicts(User $user): array
    {
        $posts = $user->posts()->with('account.device')
            ->whereIn('status', [PostStatus::Scheduled])->whereNotNull('account_id')
            ->where('scheduled_at', '>', now()->subMinutes(5))->where('scheduled_at', '<', now()->addDays(60))
            ->orderBy('scheduled_at')->get();
        $out = [];

        foreach ($posts->whereNotNull('account.device_id')->groupBy('account.device_id') as $group) {
            foreach ($group->values() as $i => $post) {
                $next = $group->values()[$i + 1] ?? null;
                if ($next && $post->scheduled_at->diffInMinutes($next->scheduled_at) < self::PHONE_MINUTES) {
                    $out[] = ['kind' => 'phone', 'message' => "{$post->account->device->name} is booked twice: @{$post->account->handle} at {$this->when($post)} and @{$next->account->handle} at {$this->when($next)}.", 'post_ids' => [$post->id, $next->id]];
                }
            }
        }

        foreach ($posts->groupBy('account_id') as $group) {
            foreach ($group->values() as $i => $post) {
                $next = $group->values()[$i + 1] ?? null;
                $gap = $post->account->min_gap_minutes;
                if ($next && $post->scheduled_at->diffInMinutes($next->scheduled_at) < $gap) {
                    $out[] = ['kind' => 'gap', 'message' => "@{$post->account->handle} posts twice within ".(int) $post->scheduled_at->diffInMinutes($next->scheduled_at)." minutes ({$this->when($post)}); its minimum is {$gap}.", 'post_ids' => [$post->id, $next->id]];
                }
            }
        }

        // Approvals: content waiting for gate 6B or plans waiting for 6A, for campaigns that start soon.
        $soon = $user->campaigns()->whereIn('stage', ['plan_review', 'content_review'])->whereNotNull('period_start')->where('period_start', '<=', now()->addDays(3))->get();
        $pending = $soon->sum(fn (Campaign $c) => $c->stage === 'plan_review' ? $c->items()->count() : ItemVariant::whereIn('campaign_item_id', $c->items()->pluck('id'))->where('status', 'draft')->count());
        if ($pending > 10) {
            $out[] = ['kind' => 'approvals', 'message' => "{$pending} approvals are due within three days across ".$soon->count().' '.Str::plural('campaign', $soon->count()).'. That’s a lot at once: start reviewing, or move a start date.', 'post_ids' => []];
        }
        foreach ($soon->where('stage', 'plan_review') as $c) {
            if ($c->period_start->isBefore(now()->addDay())) {
                $out[] = ['kind' => 'approvals', 'message' => "The plan for “{$c->title()}” isn’t approved, and the campaign starts {$c->period_start->diffForHumans()}.", 'post_ids' => []];
            }
        }

        return $out;
    }

    /**
     * @param  list<array{at: CarbonImmutable, account_id: int|null, device_id: int|null}>  $taken
     */
    private function free(CarbonImmutable $at, int $accountId, ?int $deviceId, int $gap, array $taken): bool
    {
        foreach ($taken as $t) {
            $minutes = abs($at->diffInMinutes($t['at']));
            if ($t['account_id'] === $accountId && $minutes < $gap) {
                return false;
            }
            if ($deviceId && $t['device_id'] === $deviceId && $minutes < self::PHONE_MINUTES) {
                return false;
            }
        }

        return true;
    }

    private function when(Post $post): string
    {
        return $post->scheduled_at->setTimezone($post->account->timezoneOrUsers())->format('D j M H:i');
    }
}
