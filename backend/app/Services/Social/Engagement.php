<?php

namespace App\Services\Social;

use App\Models\AccountConnection;
use App\Models\Comment;
use App\Models\Post;
use App\Models\PostMetric;

/**
 * Brings engagement back from the platforms' APIs: each published post's likes, comments,
 * shares, saves, views, reach and (Facebook) reactions, and its comments into the inbox. Replies
 * approved in the inbox go back the same way.
 *
 * X is read on a phone instead (its API charges for reading), so it isn't here.
 */
class Engagement
{
    /** Facebook's reaction types, counted one by one. */
    private const REACTIONS = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'ANGRY', 'CARE'];

    public function __construct(private readonly MetaClient $meta) {}

    /**
     * The posts worth asking about: published through the API in the last 30 days, on an
     * account whose connection still works. Returns how many were refreshed.
     */
    public function refreshRecent(): int
    {
        $posts = Post::with(['account.apiConnection'])
            ->whereNotNull('external_id')->where('published_via', 'api')
            ->where('published_at', '>=', now()->subDays(30))
            ->latest('published_at')->limit(200)->get()
            ->filter(fn (Post $p) => $p->account?->apiConnection?->usable() && $p->account->apiConnection->provider === 'meta');
        $done = 0;
        foreach ($posts as $post) {
            try {
                $this->refresh($post);
                $done++;
            } catch (SocialApiError $e) {
                $this->recordError($post, $e);
            }
        }

        return $done;
    }

    /** One post's numbers and comments, now. */
    public function refresh(Post $post): PostMetric
    {
        $connection = $post->account?->apiConnection ?? throw new SocialApiError('This account isn’t connected to its platform’s API.');
        if (! $post->external_id) {
            throw new SocialApiError('This post wasn’t published through the API, so there is nothing to ask about.');
        }
        $numbers = match ($connection->kind) {
            'instagram' => $this->instagram($post, $connection),
            'facebook_page' => $this->facebook($post, $connection),
            default => throw new SocialApiError('Engagement for this platform is read on a phone, not through an API.'),
        };
        $this->importComments($post, $connection);
        $connection->update(['checked_at' => now(), 'status' => 'ok', 'error' => null]);

        return PostMetric::updateOrCreate(['post_id' => $post->id], $numbers + ['source' => 'api', 'error' => null, 'fetched_at' => now()]);
    }

    /** Send an approved reply under the platform comment it answers. */
    public function reply(Comment $comment, string $text): ?string
    {
        $connection = $comment->account?->apiConnection;
        if (! $comment->external_id || ! $connection || $connection->provider !== 'meta') {
            return null; // a comment typed in by hand: nothing to send it to
        }
        $path = $connection->kind === 'instagram' ? "{$comment->external_id}/replies" : "{$comment->external_id}/comments";

        return (string) ($this->meta->post($path, $connection->access_token, ['message' => $text])['id'] ?? '');
    }

    /**
     * @return array<string, mixed>
     */
    private function instagram(Post $post, AccountConnection $c): array
    {
        $node = $this->meta->get($post->external_id, $c->access_token, ['fields' => 'like_count,comments_count,media_product_type']);
        // Metric names differ by media type and change over time; ask for each on its own, so one
        // that a post doesn't have can't hide the others.
        $insights = [];
        foreach (['reach', 'saved', 'shares', 'views'] as $metric) {
            try {
                $data = $this->meta->get("{$post->external_id}/insights", $c->access_token, ['metric' => $metric])['data'] ?? [];
                $insights[$metric] = $data[0]['values'][0]['value'] ?? $data[0]['total_value']['value'] ?? null;
            } catch (SocialApiError $e) {
                if ($e->expired) {
                    throw $e;
                }
            }
        }

        return [
            'likes' => $node['like_count'] ?? null,
            'comments' => $node['comments_count'] ?? null,
            'shares' => $insights['shares'] ?? null,
            'saves' => $insights['saved'] ?? null,
            'views' => $insights['views'] ?? null,
            'reach' => $insights['reach'] ?? null,
            'reactions' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function facebook(Post $post, AccountConnection $c): array
    {
        $types = collect(self::REACTIONS)->map(fn ($t) => "reactions.type({$t}).limit(0).summary(total_count).as(r_".strtolower($t).')')->implode(',');
        $node = $this->meta->get($post->external_id, $c->access_token, [
            'fields' => "comments.limit(0).summary(true),reactions.limit(0).summary(total_count),{$types}".($post->placement === 'reel' ? '' : ',shares'),
        ]);
        $reactions = collect(self::REACTIONS)->mapWithKeys(fn ($t) => [strtolower($t) => (int) ($node['r_'.strtolower($t)]['summary']['total_count'] ?? 0)])
            ->filter()->all();
        $views = null;
        if (in_array($post->placement, ['reel', 'story'], true) || $post->assets()->where('kind', 'video')->exists()) {
            try {
                $data = $this->meta->get("{$post->external_id}/video_insights", $c->access_token, ['metric' => 'blue_reels_play_count,total_video_views'])['data'] ?? [];
                $views = collect($data)->map(fn ($m) => $m['values'][0]['value'] ?? null)->filter(fn ($v) => is_numeric($v))->max();
            } catch (SocialApiError $e) {
                if ($e->expired) {
                    throw $e;
                }
            }
        }

        return [
            'likes' => $node['reactions']['summary']['total_count'] ?? null,
            'comments' => $node['comments']['summary']['total_count'] ?? null,
            'shares' => $node['shares']['count'] ?? null,
            'saves' => null,
            'views' => $views,
            'reach' => null,
            'reactions' => $reactions ?: null,
        ];
    }

    /** New comments land in the inbox, once each; FlowAI's own replies are skipped. */
    private function importComments(Post $post, AccountConnection $c): void
    {
        $ig = $c->kind === 'instagram';
        $fields = $ig ? 'id,text,username,timestamp' : 'id,message,from{name},created_time';
        $items = $this->meta->get("{$post->external_id}/comments", $c->access_token, ['fields' => $fields, 'limit' => 50])['data'] ?? [];
        $sent = Comment::where('user_id', $post->user_id)->whereNotNull('reply_external_id')->pluck('reply_external_id')->all();
        foreach ($items as $item) {
            if (in_array($item['id'], $sent, true)) {
                continue;
            }
            Comment::firstOrCreate(
                ['user_id' => $post->user_id, 'external_id' => $item['id']],
                [
                    'account_id' => $post->account_id,
                    'post_id' => $post->id,
                    'author' => mb_substr((string) ($ig ? ($item['username'] ?? 'someone') : ($item['from']['name'] ?? 'someone')), 0, 120),
                    'body' => mb_substr((string) ($ig ? ($item['text'] ?? '') : ($item['message'] ?? '')), 0, 2000),
                    'post_ref' => $post->post_url,
                    'posted_at' => $item['timestamp'] ?? $item['created_time'] ?? null,
                    'status' => 'new',
                ],
            );
        }
    }

    private function recordError(Post $post, SocialApiError $e): void
    {
        PostMetric::updateOrCreate(['post_id' => $post->id], ['error' => mb_substr($e->getMessage(), 0, 250), 'fetched_at' => now()]);
        if ($e->expired) {
            $post->account?->apiConnection?->update(['status' => 'expired', 'error' => 'Connect the account again: its access has ended.']);
        }
    }
}
