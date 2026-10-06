<?php

namespace App\Http\Controllers;

use App\Jobs\RunInvestigation;
use App\Models\Account;
use App\Models\Investigation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * The investigator side (area 12): start an investigation over an account or the whole
 * studio, watch it move through the pipeline, and read the report it leaves.
 */
class InvestigationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $list = $request->user()->investigations()->with('account:id,platform,handle')->latest('id')->limit(50)->get();

        return response()->json($list->map(fn (Investigation $i) => $this->out($i, false)));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['nullable', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
        ]);
        $account = $data['account_id'] ?? null ? Account::find($data['account_id']) : null;
        $investigation = $request->user()->investigations()->create([
            'account_id' => $account?->id,
            'title' => $account ? 'Investigation: '.$account->label() : 'Investigation: the whole studio',
        ]);
        RunInvestigation::dispatch($investigation->id);

        return response()->json($this->out($investigation->fresh()->load('account'), true), 201);
    }

    public function show(Request $request, Investigation $investigation): JsonResponse
    {
        abort_unless($investigation->user()->is($request->user()), 404);

        return response()->json($this->out($investigation->load('account'), true));
    }

    public function destroy(Request $request, Investigation $investigation): Response
    {
        abort_unless($investigation->user()->is($request->user()), 404);
        $investigation->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function out(Investigation $i, bool $detail): array
    {
        $open = collect($i->openFindings())->count();

        return [
            'id' => $i->id,
            'title' => $i->title,
            'status' => $i->status,
            'stage' => $i->stage,
            'stages' => $i->stages ?? [],
            'counts' => $i->counts,
            'open_issues' => $open,
            'account' => $i->relationLoaded('account') && $i->account ? ['id' => $i->account->id, 'platform' => $i->account->platform, 'handle' => $i->account->handle] : null,
            'error' => $i->error,
            'created_at' => $i->created_at?->toIso8601ZuluString(),
            ...$detail ? ['findings' => $i->findings ?? [], 'report' => $i->report] : [],
        ];
    }
}
