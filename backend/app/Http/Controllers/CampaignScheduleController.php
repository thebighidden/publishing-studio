<?php

namespace App\Http\Controllers;

use App\Http\Resources\PostResource;
use App\Models\Campaign;
use App\Models\ItemVariant;
use App\Models\Post;
use App\Services\Campaigns\Scheduler;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * The scheduler: approved content onto the calendar, over a week or a custom period.
 */
class CampaignScheduleController extends Controller
{
    /**
     * Propose times (`preview`), or book them. Items follow `order`, or the plan's order.
     */
    public function schedule(Request $request, Campaign $campaign, Scheduler $scheduler): JsonResponse
    {
        Gate::authorize('update', $campaign);
        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
            'order' => ['nullable', 'array'],
            'order.*' => ['integer'],
            'preview' => ['boolean'],
        ], ['to.after_or_equal' => 'The period has to end after it starts.']);

        $tz = $request->user()->timezoneOrUtc();
        $proposal = $scheduler->propose(
            $campaign,
            $data['order'] ?? $campaign->items()->pluck('id')->all(),
            CarbonImmutable::parse($data['from'], $tz)->startOfDay(),
            CarbonImmutable::parse($data['to'], $tz)->endOfDay(),
        );
        if (! $proposal) {
            throw ValidationException::withMessages(['schedule' => 'Nothing is approved yet. Approve content at gate 6B first.']);
        }

        if ($request->boolean('preview')) {
            return response()->json(['proposal' => array_map(fn ($p) => [...$p, 'at' => $p['at']->toIso8601ZuluString()], $proposal)]);
        }

        $campaign->update(['period_start' => $data['from'], 'period_end' => $data['to']]);
        $posts = $scheduler->apply($campaign, $proposal, $request->user());

        $posts = Post::with(['account', 'assets'])->whereIn('id', $posts->pluck('id'))->orderBy('scheduled_at')->get();

        return response()->json(['posts' => PostResource::collection($posts), 'conflicts' => $scheduler->conflicts($request->user())]);
    }

    /** Another posting time for an approved version. */
    public function addTime(Request $request, Campaign $campaign, ItemVariant $variant, Scheduler $scheduler): JsonResponse
    {
        Gate::authorize('update', $campaign);
        abort_unless($variant->item->campaign_id === $campaign->id, 404);
        if ($variant->status !== 'approved') {
            throw ValidationException::withMessages(['at' => 'Approve it first (gate 6B).']);
        }
        $data = $request->validate(['at' => ['required', 'date', 'after:now']], ['at.after' => 'Pick a time in the future.']);

        return response()->json(PostResource::make($scheduler->book($variant, CarbonImmutable::parse($data['at']), $request->user())->load(['account', 'assets'])), 201);
    }

    /** Everything that clashes in what's scheduled: phones, account gaps, approvals piling up. */
    public function conflicts(Request $request, Scheduler $scheduler): JsonResponse
    {
        return response()->json($scheduler->conflicts($request->user()));
    }
}
