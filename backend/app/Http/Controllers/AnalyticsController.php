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
     * Output analytics: what was written, planned and published, where, and when.
     * Engagement needs the networks' own APIs, which aren't connected, so it isn't here.
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
        ]);
    }
}
