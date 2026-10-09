<?php

namespace App\Services\Social;

use App\Enums\Platform;
use App\Models\AccountConnection;
use App\Models\Asset;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Services\Publishing\PlatformSpecs;
use Illuminate\Support\Facades\Storage;

/**
 * Publishing through the platforms' official APIs instead of a phone.
 *
 *   Instagram  photo, video (as a Reel), Reel, Story (photo or video), carousel of up to 10
 *   Facebook   text, photo(s), video, Reel, Story (photo or video), on a Page
 *   X          text with up to 4 photos or 1 video
 *
 * Every call is a step on the run's record, like a phone's taps. The answer is the platform's
 * id for the post and its address: proof, so the run is confirmed.
 */
class ApiPublisher
{
    /** How long to wait for Instagram to process a video before giving up. */
    private const PROCESSING_SECONDS = 300;

    public function __construct(private readonly MetaClient $meta, private readonly XClient $x, private readonly MediaLinks $links) {}

    /**
     * @return array{external_id: string, url: string|null}
     */
    public function publish(PublishingRun $run, AccountConnection $connection): array
    {
        $post = $run->post()->with('assets')->first();

        return match ($connection->kind) {
            'instagram' => $this->instagram($run, $post, $connection),
            'facebook_page' => $this->facebook($run, $post, $connection),
            'x' => $this->tweet($run, $post, $connection),
            default => throw new SocialApiError("FlowAI can’t publish to {$connection->kind} through an API yet."),
        };
    }

    /* ------------------------------------------------------------------ */
    /* Instagram (a professional account, through its Facebook Page) */
    /* ------------------------------------------------------------------ */

    /**
     * @return array{external_id: string, url: string|null}
     */
    private function instagram(PublishingRun $run, Post $post, AccountConnection $c): array
    {
        $ig = $c->external_id;
        $token = $c->access_token;
        $media = $post->assets;
        if ($media->isEmpty()) {
            throw new SocialApiError('An Instagram post needs a photo or a video.');
        }
        $placement = $this->placement($post, 'instagram');
        $caption = $post->body;

        if ($placement === 'story') {
            $container = $this->igContainer($run, $ig, $token, $media->first(), ['media_type' => 'STORIES']);
        } elseif ($placement === 'reel' || ($media->count() === 1 && $media->first()->kind === 'video')) {
            $container = $this->igContainer($run, $ig, $token, $media->first(), ['media_type' => 'REELS', 'caption' => $caption, 'share_to_feed' => 'true']);
        } elseif ($media->count() > 1) {
            $children = $media->take(10)->map(fn (Asset $a) => $this->igContainer($run, $ig, $token, $a,
                ['is_carousel_item' => 'true'] + ($a->kind === 'video' ? ['media_type' => 'VIDEO'] : [])))->all();
            $container = $this->step($run, 'api:carousel', fn () => $this->meta->post("{$ig}/media", $token, [
                'media_type' => 'CAROUSEL', 'children' => implode(',', $children), 'caption' => $caption,
            ])['id']);
        } else {
            $container = $this->igContainer($run, $ig, $token, $media->first(), ['caption' => $caption]);
        }

        $this->igWait($run, $container, $token);
        $id = (string) $this->step($run, 'api:publish', fn () => $this->meta->post("{$ig}/media_publish", $token, ['creation_id' => $container])['id']);
        $url = $this->quietly(fn () => $this->meta->get($id, $token, ['fields' => 'permalink'])['permalink'] ?? null);

        return ['external_id' => $id, 'url' => $url];
    }

    /**
     * One media container. Photos are fetched by Instagram from a public address; videos are
     * sent as bytes to a resumable upload, so no public address is needed for them.
     *
     * @param  array<string, string>  $fields
     */
    private function igContainer(PublishingRun $run, string $ig, string $token, Asset $asset, array $fields): string
    {
        if ($asset->kind === 'video') {
            $fields['upload_type'] = 'resumable';
            $fields['media_type'] ??= 'VIDEO';
            $id = (string) $this->step($run, 'api:container', fn () => $this->meta->post("{$ig}/media", $token, $fields)['id']);
            $this->step($run, 'api:upload', fn () => $this->meta->uploadBytes(
                'https://rupload.facebook.com/ig-api-upload/'.config('services.meta.graph_version')."/{$id}", $token, $this->bytes($asset)));

            return $id;
        }
        $fields['image_url'] = $this->links->url($asset);

        return (string) $this->step($run, 'api:container', fn () => $this->meta->post("{$ig}/media", $token, $fields)['id']);
    }

    /** Wait until Instagram has processed the media (videos take a while); then it can publish. */
    private function igWait(PublishingRun $run, string $container, string $token): void
    {
        $deadline = time() + self::PROCESSING_SECONDS;
        do {
            $status = $this->meta->get($container, $token, ['fields' => 'status_code,status']);
            $code = $status['status_code'] ?? 'FINISHED';
            if ($code === 'FINISHED' || $code === 'PUBLISHED') {
                $run->step('api:processed', true, 0);
                $run->save();

                return;
            }
            if ($code === 'ERROR' || $code === 'EXPIRED') {
                throw new SocialApiError('Instagram couldn’t process the media: '.($status['status'] ?? $code));
            }
            sleep(3);
        } while (time() < $deadline);

        throw new SocialApiError('Instagram took too long to process the video.', retry: true);
    }

    /* ------------------------------------------------------------------ */
    /* Facebook Page */
    /* ------------------------------------------------------------------ */

    /**
     * @return array{external_id: string, url: string|null}
     */
    private function facebook(PublishingRun $run, Post $post, AccountConnection $c): array
    {
        $page = $c->external_id;
        $token = $c->access_token;
        $media = $post->assets;
        $placement = $this->placement($post, 'facebook');
        $first = $media->first();

        if ($placement === 'story') {
            if (! $first) {
                throw new SocialApiError('A Facebook story needs a photo or a video.');
            }
            if ($first->kind === 'video') {
                $id = $this->fbVideoUpload($run, "{$page}/video_stories", $token, $first, []);

                return ['external_id' => $id, 'url' => null];
            }
            $photo = $this->step($run, 'api:upload', fn () => $this->meta->upload("{$page}/photos", $token, $this->bytes($first), $this->filename($first), ['published' => 'false'])['id']);
            $id = (string) $this->step($run, 'api:publish', fn () => $this->meta->post("{$page}/photo_stories", $token, ['photo_id' => $photo])['post_id'] ?? $photo);

            return ['external_id' => $id, 'url' => null];
        }

        if ($first && $first->kind === 'video') {
            if ($placement === 'reel') {
                $id = $this->fbVideoUpload($run, "{$page}/video_reels", $token, $first, ['video_state' => 'PUBLISHED', 'description' => $post->body]);

                return ['external_id' => $id, 'url' => "https://www.facebook.com/reel/{$id}"];
            }
            $id = (string) $this->step($run, 'api:upload', fn () => $this->meta->upload(
                'https://graph-video.facebook.com/'.config('services.meta.graph_version')."/{$page}/videos", $token, $this->bytes($first), $this->filename($first), ['description' => $post->body])['id']);

            return ['external_id' => $id, 'url' => "https://www.facebook.com/{$page}/videos/{$id}"];
        }

        if ($media->count() === 1) {
            $r = $this->step($run, 'api:publish', fn () => $this->meta->upload("{$page}/photos", $token, $this->bytes($first), $this->filename($first), ['caption' => $post->body]));
            $id = (string) ($r['post_id'] ?? $r['id']);
        } elseif ($media->count() > 1) {
            $photos = $media->take(10)->map(fn (Asset $a) => $this->step($run, 'api:upload', fn () => $this->meta->upload(
                "{$page}/photos", $token, $this->bytes($a), $this->filename($a), ['published' => 'false'])['id']))->values();
            $fields = ['message' => $post->body] + $photos->mapWithKeys(fn ($pid, $i) => ["attached_media[{$i}]" => json_encode(['media_fbid' => $pid])])->all();
            $id = (string) $this->step($run, 'api:publish', fn () => $this->meta->post("{$page}/feed", $token, $fields)['id']);
        } else {
            $id = (string) $this->step($run, 'api:publish', fn () => $this->meta->post("{$page}/feed", $token, ['message' => $post->body])['id']);
        }
        $url = $this->quietly(fn () => $this->meta->get($id, $token, ['fields' => 'permalink_url'])['permalink_url'] ?? null);

        return ['external_id' => $id, 'url' => $url];
    }

    /**
     * Reels and video Stories: start an upload, send the bytes, finish it.
     *
     * @param  array<string, string>  $finish
     */
    private function fbVideoUpload(PublishingRun $run, string $endpoint, string $token, Asset $video, array $finish): string
    {
        $start = $this->step($run, 'api:start', fn () => $this->meta->post($endpoint, $token, ['upload_phase' => 'start']));
        $id = (string) ($start['video_id'] ?? throw new SocialApiError('Facebook didn’t start the upload.'));
        $this->step($run, 'api:upload', fn () => $this->meta->uploadBytes((string) $start['upload_url'], $token, $this->bytes($video)));
        $done = $this->step($run, 'api:publish', fn () => $this->meta->post($endpoint, $token, ['upload_phase' => 'finish', 'video_id' => $id] + $finish));

        return (string) ($done['post_id'] ?? $id);
    }

    /* ------------------------------------------------------------------ */
    /* X */
    /* ------------------------------------------------------------------ */

    /**
     * @return array{external_id: string, url: string|null}
     */
    private function tweet(PublishingRun $run, Post $post, AccountConnection $c): array
    {
        $token = $this->x->freshToken($c);
        $media = $post->assets;
        $videos = $media->where('kind', 'video');
        $chosen = $videos->isNotEmpty() ? $videos->take(1) : $media->take(4);
        $ids = $chosen->map(fn (Asset $a) => $this->step($run, 'api:upload', fn () => $this->x->uploadMedia($token, $this->bytes($a), $a->mime)))->values()->all();
        $id = $this->step($run, 'api:publish', fn () => $this->x->tweet($token, $this->xText($post->body), $ids));

        return ['external_id' => $id, 'url' => 'https://x.com/'.($c->username ?: 'i').'/status/'.$id];
    }

    /** X counts 280 characters; a longer caption is cut on a word, never mid-word. */
    private function xText(string $body): string
    {
        $body = trim($body);
        if (mb_strlen($body) <= 280) {
            return $body;
        }
        $cut = mb_substr($body, 0, 279);

        return rtrim(mb_substr($cut, 0, (int) (mb_strrpos($cut, ' ') ?: 279))).'…';
    }

    /* ------------------------------------------------------------------ */

    private function placement(Post $post, string $platform): string
    {
        return $post->placement ?: app(PlatformSpecs::class)->defaultPlacement(Platform::from($platform), $post->assets);
    }

    private function bytes(Asset $asset): string
    {
        return (string) Storage::disk('local')->get($asset->path);
    }

    private function filename(Asset $asset): string
    {
        return $asset->name ?: basename($asset->path);
    }

    /** One API call as a step on the run's record, timed, with the reason when it fails. */
    private function step(PublishingRun $run, string $action, callable $call): mixed
    {
        $started = microtime(true);
        try {
            $out = $call();
            $run->step($action, true, (int) round((microtime(true) - $started) * 1000));
            $run->save();

            return $out;
        } catch (SocialApiError $e) {
            $run->step($action, false, (int) round((microtime(true) - $started) * 1000), $e->getMessage());
            $run->save();

            throw $e;
        }
    }

    /** Nice to have (an address for the post): never worth failing a published post over. */
    private function quietly(callable $call): ?string
    {
        try {
            return $call();
        } catch (SocialApiError) {
            return null;
        }
    }
}
