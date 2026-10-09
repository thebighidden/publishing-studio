<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Models\Post;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class AnalyticsController extends Controller
{
    /**
     * Output analytics: what was written, planned and published, where, and when, plus the
     * engagement read back from the platforms for what was published.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $range = (int) ($request->validate([
            'range' => ['nullable', Rule::in([7, 30, 90])],
        ])['range'] ?? 30);

        /** @var User $user */
        $user = $request->user();
        $tz = $user->timezoneOrUtc();

        $start = CarbonImmutable::now($tz)->startOfDay()->subDays($range - 1);
        $prevStart = $start->subDays($range);

        $posts = $user->posts()->get(['id', 'status', 'format', 'platforms', 'scheduled_at', 'published_at', 'created_at']);

        $local = fn (?CarbonInterface $at) => $at ? CarbonImmutable::instance($at)->setTimezone($tz) : null;
        $planned = $posts->filter(fn (Post $p) => $p->status !== PostStatus::Draft && $p->scheduled_at);

        $countBetween = fn (Collection $set, string $field, CarbonImmutable $from, CarbonImmutable $to) => $set
            ->filter(fn (Post $p) => ($at = $local($p->{$field})) && $at->greaterThanOrEqualTo($from) && $at->lessThan($to))
            ->count();

        $days = collect(range(0, $range - 1))->map(function (int $i) use ($start, $posts, $planned, $countBetween) {
            $from = $start->addDays($i);
            $to = $from->addDay();

            return [
                'date' => $from->toDateString(),
                'created' => $countBetween($posts, 'created_at', $from, $to),
                'scheduled' => $countBetween($planned, 'scheduled_at', $from, $to),
                'published' => $countBetween($posts, 'published_at', $from, $to),
            ];
        });

        $end = $start->addDays($range);

        $inRange = $planned->filter(fn (Post $p) => ($at = $local($p->scheduled_at)) && $at->greaterThanOrEqualTo($start) && $at->lessThan($end));

        $byPlatform = [];
        foreach ($inRange as $post) {
            foreach ($post->platforms as $platform) {
                $byPlatform[$platform] = ($byPlatform[$platform] ?? 0) + 1;
            }
        }
        arsort($byPlatform);

        // Weekday (1 = Monday) × hour, across everything ever planned.
        $heatmap = array_fill(1, 7, array_fill(0, 24, 0));
        foreach ($planned as $post) {
            $at = $local($post->scheduled_at);
            $heatmap[$at->dayOfWeekIso][$at->hour]++;
        }

        return response()->json([
            'range' => $range,
            'days' => $days,
            'totals' => [
                'created' => ['now' => $countBetween($posts, 'created_at', $start, $end), 'before' => $countBetween($posts, 'created_at', $prevStart, $start)],
                'scheduled' => ['now' => $countBetween($planned, 'scheduled_at', $start, $end), 'before' => $countBetween($planned, 'scheduled_at', $prevStart, $start)],
                'published' => ['now' => $countBetween($posts, 'published_at', $start, $end), 'before' => $countBetween($posts, 'published_at', $prevStart, $start)],
                'drafts' => $posts->where('status', PostStatus::Draft)->count(),
            ],
            'platforms' => $byPlatform,
            'formats' => $inRange->countBy(fn (Post $p) => $p->format->value),
            'heatmap' => array_values(array_map('array_values', $heatmap)),
            'engagement' => $this->engagement($user, $start, $end),
        ]);
    }

    /**
     * Likes, comments, shares, saves and views on what was published in the range, as last
     * read from the platforms (API hourly, phones for X), with the best posts first.
     *
     * @return array<string, mixed>
     */
    private function engagement(User $user, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $posts = $user->posts()->with(['metric', 'account:id,platform,handle'])->whereHas('metric')
            ->whereBetween('published_at', [$start->utc(), $end->utc()])->get();
        $fields = ['likes', 'comments', 'shares', 'saves', 'views', 'reach'];
        $totals = collect($fields)->mapWithKeys(fn (string $f) => [$f => (int) $posts->sum(fn (Post $p) => (int) $p->metric->{$f})])->all();
        $reactions = [];
        foreach ($posts as $post) {
            foreach ($post->metric->reactions ?? [] as $type => $n) {
                $reactions[$type] = ($reactions[$type] ?? 0) + (int) $n;
            }
        }
        arsort($reactions);
        $score = fn (Post $p) => (int) $p->metric->likes + 2 * (int) $p->metric->comments + 3 * (int) $p->metric->shares + 2 * (int) $p->metric->saves;

        return [
            'posts' => $posts->count(),
            'totals' => $totals,
            'reactions' => $reactions,
            'by_platform' => $posts->groupBy(fn (Post $p) => $p->account?->platform?->value ?? 'other')
                ->map(fn (Collection $set) => ['posts' => $set->count(), 'likes' => (int) $set->sum(fn (Post $p) => (int) $p->metric->likes), 'comments' => (int) $set->sum(fn (Post $p) => (int) $p->metric->comments)]),
            'top' => $posts->sortByDesc($score)->take(5)->values()->map(fn (Post $p) => [
                'id' => $p->id,
                'title' => str($p->title ?: $p->body)->limit(60)->toString(),
                'platform' => $p->account?->platform?->value,
                'handle' => $p->account?->handle,
                'post_url' => $p->post_url,
                'published_at' => $p->published_at?->toIso8601ZuluString(),
                'metrics' => $p->metric->summary(),
            ]),
            'updated_at' => $posts->max(fn (Post $p) => $p->metric->fetched_at)?->toIso8601ZuluString(),
        ];
    }
}
