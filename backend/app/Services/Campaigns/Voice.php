<?php

namespace App\Services\Campaigns;

use App\Models\Account;
use App\Models\AccountMemory;
use App\Models\Post;
use Illuminate\Support\Str;

/**
 * An account's voice, for any prompt that writes for it: the editorial profile, the rules the
 * operator wrote, posts someone liked, and what went out lately (so nothing repeats).
 */
class Voice
{
    private const LABELS = [
        'tone' => 'Tone', 'topics' => 'Topics', 'style' => 'Style', 'do' => 'Always',
        'avoid' => 'Never', 'language' => 'Language', 'hashtags' => 'Hashtags',
    ];

    public function context(Account $account): string
    {
        $lines = ["Account: @{$account->handle} on {$account->platform->label()}".($account->name ? " ({$account->name})" : '')];

        foreach (self::LABELS as $field => $label) {
            if (filled($account->profile[$field] ?? null)) {
                $lines[] = "{$label}: {$account->profile[$field]}";
            }
        }

        $memories = $account->memories()->latest('id')->get()->groupBy('kind');
        if ($rules = $memories->get('instruction')) {
            $lines[] = "Instructions from the operator:\n".$rules->map(fn (AccountMemory $m) => '- '.$m->content)->join("\n");
        }
        if ($liked = $memories->get('example')) {
            $lines[] = "Posts the operator liked (match their feel; don't copy them):\n".$liked->take(4)->map(fn (AccountMemory $m) => '- '.Str::limit($m->content, 400))->join("\n");
        }
        if ($history = $memories->get('history')) {
            $lines[] = "Recent posts on this account (don't repeat them):\n".$history->take(5)->map(fn (AccountMemory $m) => '- '.Str::limit($m->content, 200))->join("\n");
        }

        return implode("\n", $lines);
    }

    /** A published post joins the account's history. */
    public function published(Post $post): void
    {
        if (! $post->account_id) {
            return;
        }
        $post->account->memories()->create([
            'kind' => 'history',
            'content' => Str::limit($post->body, 1500),
            'source' => 'published',
            'meta' => ['post_id' => $post->id, 'post_url' => $post->post_url, 'at' => now()->toIso8601ZuluString()],
        ]);
    }
}
