<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\AccountMemory;
use App\Models\ActionLog;
use App\Models\ProfileChange;
use App\Services\Ai\GenerationFailed;
use App\Services\Campaigns\Agents;
use App\Services\Studio\Autonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * An account's editorial identity and memory. Memory comes in three kinds kept apart:
 * instructions, liked examples, post history. The profile only changes through approved
 * changes, whether a person or the AI proposed them.
 */
class AccountVoiceController extends Controller
{
    public function show(Account $account): JsonResponse
    {
        Gate::authorize('view', $account);

        return response()->json([
            'profile' => (object) ($account->profile ?? []),
            'memory' => collect(AccountMemory::KINDS)->mapWithKeys(fn (string $kind) => [$kind => $account->memories()->where('kind', $kind)->latest('id')->limit(50)->get()
                ->map(fn (AccountMemory $m) => ['id' => $m->id, 'content' => $m->content, 'source' => $m->source, 'meta' => $m->meta, 'created_at' => $m->created_at?->toIso8601ZuluString()])]),
            'changes' => $account->profileChanges()->latest('id')->limit(30)->get()->map(fn (ProfileChange $c) => $this->change($c)),
        ]);
    }

    /** Add an instruction or an example. History fills itself from published posts. */
    public function remember(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $data = $request->validate([
            'kind' => ['required', Rule::in(['instruction', 'example'])],
            'content' => ['required', 'string', 'max:2000'],
        ]);
        $memory = $account->memories()->create($data + ['source' => 'operator']);

        return response()->json(['id' => $memory->id], 201);
    }

    public function forget(Account $account, AccountMemory $memory): Response
    {
        Gate::authorize('update', $account);
        abort_unless($memory->account_id === $account->id, 404);
        $memory->delete();

        return response()->noContent();
    }

    /** Propose a change to one profile field. Nothing changes until it's approved. */
    public function propose(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $data = $request->validate([
            'field' => ['required', Rule::in(Account::PROFILE_FIELDS)],
            'to' => ['nullable', 'string', 'max:600'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $change = $account->profileChanges()->create($data + ['from' => $account->profile[$data['field']] ?? null, 'source' => 'operator']);

        return response()->json($this->change($change), 201);
    }

    /** Ask the AI what the profile should say, from what was liked and what was sent back. */
    public function suggest(Account $account, Agents $agents): JsonResponse
    {
        Gate::authorize('update', $account);
        try {
            $suggestions = $agents->suggestProfile($account);
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }
        if (! $suggestions) {
            throw ValidationException::withMessages(['suggest' => 'Nothing to learn from yet: like some posts, or send some back with a note.']);
        }

        return response()->json(collect($suggestions)->map(function ($s) use ($account) {
            $change = $account->profileChanges()->create([
                'field' => $s['field'], 'from' => $account->profile[$s['field']] ?? null, 'to' => $s['to'], 'reason' => $s['reason'], 'source' => 'ai',
            ]);
            // Mode B: a rule the operator approved lets matching changes apply on their own.
            if (app(Autonomy::class)->decide($account, 'profile.apply_ai_change') === 'run') {
                $profile = [...($account->profile ?? []), $change->field => $change->to];
                $account->update(['profile' => $profile]);
                $change->update(['status' => 'approved', 'decided_at' => now()]);
                ActionLog::record($account->user, 'agent:autonomy', 'profile.auto_applied', $account, "Mode B applied the {$change->field} change on {$account->label()}.", 'auto');
            }

            return $this->change($change->fresh());
        }), 201);
    }

    public function decide(Request $request, Account $account, ProfileChange $change): JsonResponse
    {
        Gate::authorize('update', $account);
        abort_unless($change->account_id === $account->id, 404);
        if ($change->status !== 'pending') {
            throw ValidationException::withMessages(['change' => 'That change was already decided.']);
        }
        $approve = $request->validate(['approve' => ['required', 'boolean']])['approve'];

        $change->update(['status' => $approve ? 'approved' : 'rejected', 'decided_by' => $request->user()->id, 'decided_at' => now()]);
        if ($approve) {
            $profile = $account->profile ?? [];
            if (filled($change->to)) {
                $profile[$change->field] = $change->to;
            } else {
                unset($profile[$change->field]);
            }
            $account->update(['profile' => $profile ?: null]);
        }
        ActionLog::record($request->user(), 'you', $approve ? 'profile.approved' : 'profile.rejected', $account,
            ($approve ? 'Changed' : 'Kept')." the {$change->field} of {$account->label()}".($approve ? " to “{$change->to}”." : '.'), $approve ? 'approved' : 'blocked');

        return response()->json($this->change($change));
    }

    private function change(ProfileChange $c): array
    {
        return [
            'id' => $c->id, 'field' => $c->field, 'from' => $c->from, 'to' => $c->to, 'reason' => $c->reason,
            'source' => $c->source, 'status' => $c->status, 'decided_at' => $c->decided_at?->toIso8601ZuluString(), 'created_at' => $c->created_at?->toIso8601ZuluString(),
        ];
    }
}
