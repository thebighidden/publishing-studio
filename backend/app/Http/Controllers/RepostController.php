<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Repost;
use App\Services\Community\Community;
use App\Services\Studio\Autonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Repost from X to Instagram: pick X posts to reuse, record whether reuse is allowed and why
 * (always a person's call), adapt them into captions with hashtags, and credit the original
 * author on everything that goes out.
 */
class RepostController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $reposts = $request->user()->reposts()->with('account:id,platform,handle')->latest('id')->limit(100)->get();

        return response()->json($reposts->map(fn (Repost $r) => $this->out($r)));
    }

    /** Pick an X post to reuse. It can't be adapted until permission is recorded. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'source_url' => ['required', 'url', 'max:500'],
            'author' => ['required', 'string', 'max:120'],
            'source_text' => ['required', 'string', 'max:5000'],
        ]);
        $account = Account::findOrFail($data['account_id']);
        abort_unless($account->platform->value === 'instagram', 422, 'Reposts land on Instagram accounts. Pick one of yours.');

        $repost = $request->user()->reposts()->create($data);

        return response()->json($this->out($repost->load('account')), 201);
    }

    /** The permission check: whether reuse is allowed, and why. Always a person, never the AI. */
    public function permission(Request $request, Repost $repost): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'captured', 409, 'This repost already moved on.');
        $data = $request->validate([
            'decision' => ['required', Rule::in(['allowed', 'denied'])],
            'note' => ['required', 'string', 'max:500'],
            'attribution' => ['sometimes', 'boolean'],
        ]);
        $repost->update([
            'permission' => $data['decision'],
            'permission_note' => $data['note'],
            'attribution' => $data['attribution'] ?? $repost->attribution,
            'status' => $data['decision'] === 'denied' ? 'dropped' : 'captured',
        ]);
        ActionLog::record($request->user(), 'you', 'repost.permission', $repost,
            "Reuse of @{$repost->author}’s post {$data['decision']}: {$data['note']}", $data['decision'] === 'allowed' ? 'approved' : 'blocked');

        return response()->json($this->out($repost));
    }

    /** Turn it into an Instagram caption with hashtags. The credit line is added by the model. */
    public function adapt(Request $request, Repost $repost, Community $community): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'captured', 409, 'This repost already moved on.');
        abort_if($repost->permission === 'pending', 422, 'Record whether reuse is allowed first.');
        abort_if($repost->permission === 'denied', 422, 'Reuse was denied for this post.');
        abort_unless($community->aiAvailable($request->user()), 502, 'The adaptation needs AI and a confirmed account.');

        $adapted = $community->adapt($repost);
        $repost->update(['caption' => $adapted['caption'], 'hashtags' => $adapted['hashtags'], 'status' => 'adapted']);

        // Mode B: a rule the operator approved schedules it on its own.
        if (app(Autonomy::class)->decide($repost->account, 'repost.schedule') === 'run') {
            $this->schedule($request, $repost->fresh(), ['auto' => true]);
        }

        return response()->json($this->out($repost->fresh('account')));
    }

    /** Make it a real post: approved and scheduled (6B by the operator, here), ready to publish. */
    public function schedule(Request $request, Repost $repost, array $flags = []): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'adapted', 409, 'Adapt it first, or it’s already a post.');
        $data = $request->validate([
            'scheduled_at' => ['nullable', 'date', 'after:now'],
            'caption' => ['nullable', 'string', 'max:2200'],
        ]);

        $account = $repost->account;
        if (isset($data['caption'])) {
            $repost->update(['caption' => $data['caption']]);
        }
        $tags = collect($repost->hashtags ?? [])->map(fn (string $t) => '#'.$t)->implode(' ');
        $post = $request->user()->posts()->create([
            'title' => 'Repost of @'.ltrim($repost->author, '@'),
            'body' => $repost->creditedCaption().($tags ? "\n\n".$tags : ''),
            'format' => 'text',
            'platforms' => ['instagram'],
            'status' => PostStatus::Scheduled,
            'account_id' => $account->id,
            'scheduled_at' => $data['scheduled_at'] ?? now()->addHour(),
            'approved_at' => now(), // 6B: the operator reviewed the adaptation and scheduled it
            'approved_by' => $request->user()->id,
        ]);
        $repost->update(['status' => 'scheduled', 'post_id' => $post->id]);
        ActionLog::record($request->user(), ($flags['auto'] ?? false) ? 'agent:autonomy' : 'you', 'repost.scheduled', $post,
            "Repost of @{$repost->author} scheduled on {$account->label()}".(($flags['auto'] ?? false) ? ' by a mode-B rule.' : '.'), 'auto');

        return response()->json($this->out($repost->fresh('account')), 201);
    }

    public function destroy(Request $request, Repost $repost): Response
    {
        $this->own($request, $repost);
        abort_if($repost->status === 'scheduled', 409, 'It’s already a post. Delete the post instead.');
        $repost->delete();

        return response()->noContent();
    }

    private function own(Request $request, Repost $repost): void
    {
        abort_unless($repost->user()->is($request->user()), 404);
    }

    /**
     * @return array<string, mixed>
     */
    private function out(Repost $r): array
    {
        return [
            'id' => $r->id,
            'source_url' => $r->source_url,
            'author' => $r->author,
            'source_text' => $r->source_text,
            'permission' => $r->permission,
            'permission_note' => $r->permission_note,
            'status' => $r->status,
            'caption' => $r->caption,
            'caption_with_credit' => $r->caption ? $r->creditedCaption() : null,
            'hashtags' => $r->hashtags ?? [],
            'attribution' => $r->attribution,
            'post_id' => $r->post_id,
            'account' => $r->relationLoaded('account') && $r->account ? ['id' => $r->account->id, 'platform' => $r->account->platform, 'handle' => $r->account->handle] : null,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
        ];
    }
}
