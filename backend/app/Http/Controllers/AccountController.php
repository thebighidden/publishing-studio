<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Http\Resources\AccountResource;
use App\Models\Account;
use App\Models\ActionLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The accounts the studio posts to: each on one platform, optionally linked to a phone.
 */
class AccountController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return AccountResource::collection(
            $request->user()->accounts()->with('device')->withCount('posts')->orderBy('platform')->orderBy('handle')->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $account = $request->user()->accounts()->create($this->validated($request));
        ActionLog::record($request->user(), 'you', 'account.created', $account, "Added {$account->label()}.");

        return AccountResource::make($account->load('device'))->response()->setStatusCode(201);
    }

    public function show(Account $account): AccountResource
    {
        Gate::authorize('view', $account);

        return AccountResource::make($account->load('device')->loadCount('posts'));
    }

    public function update(Request $request, Account $account): AccountResource
    {
        Gate::authorize('update', $account);

        $before = $account->only(['automation', 'autonomy', 'device_id']);
        // Once an account exists, its profile changes only through approved profile changes.
        $account->update(collect($this->validated($request, $account))->except('profile')->all());

        foreach (array_diff_assoc($account->only(array_keys($before)), $before) as $field => $value) {
            ActionLog::record($request->user(), 'you', "account.{$field}", $account, match ($field) {
                'automation' => $value ? "Allowed automated publishing on {$account->label()}." : "Stopped automated publishing on {$account->label()}.",
                'autonomy' => "Set {$account->label()} to ".($value === 'rules' ? 'mode B (approved rules run on their own).' : 'mode A (every action waits for approval).'),
                default => $value ? "Linked {$account->label()} to a phone." : "Unlinked {$account->label()} from its phone.",
            });
        }

        return AccountResource::make($account->load('device')->loadCount('posts'));
    }

    public function destroy(Account $account): Response
    {
        Gate::authorize('delete', $account);

        $account->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?Account $account = null): array
    {
        $user = $request->user();
        $partial = $account !== null;

        $data = $request->validate([
            'platform' => [$partial ? 'sometimes' : 'required', Rule::enum(Platform::class)],
            'handle' => [$partial ? 'sometimes' : 'required', 'string', 'max:60', 'regex:/^@?[\w.\-]+$/u',
                Rule::unique('accounts')->where(fn ($q) => $q->where('user_id', $user->id)->where('platform', $request->input('platform', $account?->platform?->value)))->ignore($account)],
            'name' => ['nullable', 'string', 'max:80'],
            'timezone' => ['nullable', 'timezone:all'],
            'device_id' => ['nullable', Rule::exists('devices', 'id')->where('user_id', $user->id)],
            'automation' => ['sometimes', 'boolean'],
            'autonomy' => ['sometimes', Rule::in(Account::AUTONOMY)],
            'min_gap_minutes' => ['sometimes', 'integer', 'min:10', 'max:1440'],
            'profile' => ['sometimes', 'nullable', 'array'],
            ...collect(Account::PROFILE_FIELDS)->mapWithKeys(fn (string $f) => ["profile.{$f}" => ['nullable', 'string', 'max:600']])->all(),
        ], [
            'handle.regex' => 'Use the handle as it appears on the platform: letters, numbers, dots, dashes and underscores.',
            'handle.unique' => 'That account is already in the studio.',
            'min_gap_minutes.min' => 'Leave at least 10 minutes between automated posts on one account.',
        ]);

        if (isset($data['handle'])) {
            $data['handle'] = ltrim($data['handle'], '@');
        }
        if (array_key_exists('profile', $data)) {
            $data['profile'] = collect($data['profile'] ?? [])->only(Account::PROFILE_FIELDS)->map(fn ($v) => trim((string) $v))->filter()->all() ?: null;
        }

        return $data;
    }
}
