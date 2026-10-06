<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\ActionLog;
use App\Models\AutonomyRule;
use App\Services\Studio\Autonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Autonomy per account: the mode (A: a person approves everything; B: approved rules run on
 * their own), the action matrix, the operator's rules, and the policy preview — what the
 * current setup would do with the things actually waiting, before anything is turned on.
 */
class AutonomyController extends Controller
{
    /** The account's mode, its rules, and the matrix with each action's current verdict. */
    public function show(Account $account, Autonomy $autonomy): JsonResponse
    {
        Gate::authorize('view', $account);

        return response()->json([
            'mode' => $account->autonomy,
            'matrix' => $autonomy->matrix($account),
            'rules' => $account->rules()->latest('id')->get()->map(fn (AutonomyRule $r) => $this->rule($r)),
        ]);
    }

    /** The policy preview: what the current mode and rules would do with what's waiting now. */
    public function preview(Account $account, Autonomy $autonomy): JsonResponse
    {
        Gate::authorize('view', $account);

        return response()->json(['items' => $autonomy->preview($account)]);
    }

    public function storeRule(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $data = $request->validate([
            'action' => ['required', Rule::in(Autonomy::RULEABLE)],
            'allow' => ['sometimes', 'boolean'],
            'conditions' => ['sometimes', 'nullable', 'array'],
            'conditions.max_per_day' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $rule = $account->rules()->create($data + ['created_by' => $request->user()->id]);
        ActionLog::record($request->user(), 'you', 'autonomy.rule_added', $account,
            ($rule->allow ? 'Allowed' : 'Blocked').' “'.Autonomy::ACTIONS[$rule->action]['label']."” on {$account->label()}.".($rule->conditions ? ' With limits.' : ''));

        return response()->json($this->rule($rule), 201);
    }

    public function destroyRule(Request $request, Account $account, AutonomyRule $rule): Response
    {
        Gate::authorize('update', $account);
        abort_unless($rule->account_id === $account->id, 404);
        $rule->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function rule(AutonomyRule $r): array
    {
        return [
            'id' => $r->id,
            'action' => $r->action,
            'label' => Autonomy::ACTIONS[$r->action]['label'] ?? $r->action,
            'allow' => $r->allow,
            'conditions' => $r->conditions,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
        ];
    }
}
