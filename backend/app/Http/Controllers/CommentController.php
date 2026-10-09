<?php

namespace App\Http\Controllers;

use App\Models\ActionLog;
use App\Models\Comment;
use App\Services\Community\Community;
use App\Services\Social\Engagement;
use App\Services\Social\SocialApiError;
use App\Services\Studio\Autonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * The comment inbox (area 11): comments come in per account, the AI triages each one —
 * reply, ignore, or send to a human — and a human approves every reply before it goes out,
 * unless a mode-B rule the operator approved covers it.
 */
class CommentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $comments = $request->user()->comments()->with('account:id,platform,handle')->latest('id')->limit(200)->get();

        return response()->json($comments->map(fn (Comment $c) => $this->out($c)));
    }

    /** A comment lands in the inbox (the connector's job in production; by hand here). */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'author' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:2000'],
            'post_ref' => ['nullable', 'string', 'max:300'],
        ]);

        $comment = $request->user()->comments()->create($data);

        return response()->json($this->out($comment->load('account')), 201);
    }

    /** AI triage: reply (drafted), ignore, or send to a human. Mode B may send replies itself. */
    public function triage(Request $request, Comment $comment, Community $community): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless($comment->status === 'new', 409, 'This comment was already triaged.');
        abort_unless($community->aiAvailable($request->user()), 502, 'Triage needs AI and a confirmed account.');

        $result = $community->triage($comment);
        $account = $comment->account;

        if ($result['decision'] === 'reply' && $result['draft']) {
            $comment->update(['triage' => ['decision' => 'reply', 'reason' => $result['reason']], 'draft' => $result['draft'], 'status' => 'drafted']);
            // Mode B: a rule the operator approved sends it without the per-reply approval.
            if (app(Autonomy::class)->decide($account, 'comment.send_reply', ['today' => $account->repliesSentToday()]) === 'run') {
                try {
                    $this->deliver($comment, $comment->draft);
                    ActionLog::record($request->user(), 'agent:autonomy', 'comment.auto_replied', $comment, "Replied to @{$comment->author} by a mode-B rule.", 'auto');
                } catch (SocialApiError) {
                    // The draft waits in the inbox for a person instead.
                }
            }
        } elseif ($result['decision'] === 'ignore') {
            $comment->update(['triage' => ['decision' => 'ignore', 'reason' => $result['reason']], 'status' => 'ignored']);
        } else {
            $comment->update(['triage' => ['decision' => 'human', 'reason' => $result['reason']], 'status' => 'human']);
        }

        return response()->json($this->out($comment->fresh('account')));
    }

    /** A human approves the reply (edited or not); only then is it sent. */
    public function send(Request $request, Comment $comment): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless(in_array($comment->status, ['drafted', 'human'], true), 409, 'Nothing to send on this comment.');
        $data = $request->validate(['reply' => ['required', 'string', 'max:1000']]);

        try {
            $this->deliver($comment, $data['reply']);
        } catch (SocialApiError $e) {
            abort(502, 'The platform didn’t take the reply: '.$e->getMessage());
        }
        ActionLog::record($request->user(), 'you', 'comment.replied', $comment, "Replied to @{$comment->author}.");

        return response()->json($this->out($comment->fresh('account')));
    }

    public function ignore(Request $request, Comment $comment): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless(in_array($comment->status, ['new', 'drafted', 'human'], true), 409);
        $comment->update(['status' => 'ignored']);

        return response()->json($this->out($comment->fresh('account')));
    }

    public function destroy(Request $request, Comment $comment): Response
    {
        $this->own($request, $comment);
        abort_if($comment->status === 'sent', 409, 'Sent replies stay on the record.');
        $comment->delete();

        return response()->noContent();
    }

    /**
     * The reply goes out: under the platform comment when it came in through a connected API,
     * otherwise only recorded. If the platform refuses, the comment stays unsent.
     */
    private function deliver(Comment $comment, string $reply): void
    {
        $sentId = app(Engagement::class)->reply($comment, $reply);
        $comment->update(['reply' => $reply, 'status' => 'sent', 'sent_at' => now(), 'reply_external_id' => $sentId ?: null]);
    }

    private function own(Request $request, Comment $comment): void
    {
        abort_unless($comment->user()->is($request->user()), 404);
    }

    /**
     * @return array<string, mixed>
     */
    private function out(Comment $c): array
    {
        return [
            'id' => $c->id,
            'author' => $c->author,
            'body' => $c->body,
            'post_ref' => $c->post_ref,
            'status' => $c->status,
            'triage' => $c->triage,
            'draft' => $c->draft,
            'reply' => $c->reply,
            'sent_at' => $c->sent_at?->toIso8601ZuluString(),
            'from_platform' => $c->external_id !== null,
            'posted_at' => $c->posted_at?->toIso8601ZuluString(),
            'account' => $c->relationLoaded('account') && $c->account ? ['id' => $c->account->id, 'platform' => $c->account->platform, 'handle' => $c->account->handle] : null,
            'created_at' => $c->created_at?->toIso8601ZuluString(),
        ];
    }
}
