<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\AccountConnection;
use App\Models\Asset;
use App\Models\Comment;
use App\Models\Post;
use App\Models\User;
use App\Services\Publishing\Publisher;
use App\Services\Social\Engagement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Publishing and engagement through the platforms' official APIs (Meta, X), against faked
 * HTTP: no real account is ever called.
 */
class SocialApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    /** @var list<HttpRequest> */
    private array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'services.meta.app_id' => 'app', 'services.meta.app_secret' => 'secret', 'services.meta.graph_version' => 'v24.0',
            'services.meta.public_media_url' => 'https://media.example.com',
            'services.x.client_id' => 'x-client', 'services.x.client_secret' => null,
        ]);
        $this->user = User::factory()->create();
    }

    /**
     * Answer by method and path: `'POST ig1/media' => [...]`. Graph paths are given without the
     * host and version; other hosts in full. Anything unexpected fails the test loudly.
     *
     * @param  array<string, array<string, mixed>|callable(HttpRequest): array<string, mixed>>  $routes
     */
    private function fake(array $routes): void
    {
        Http::fake(function (HttpRequest $request) use ($routes) {
            $this->sent[] = $request;
            $url = strtok($request->url(), '?');
            $path = str_starts_with($url, 'https://graph.facebook.com/v24.0/') ? substr($url, strlen('https://graph.facebook.com/v24.0/')) : $url;
            $answer = $routes["{$request->method()} {$path}"] ?? null;
            if ($answer === null) {
                return Http::response(['error' => ['message' => "unexpected {$request->method()} {$path}"]], 500);
            }
            $answer = is_callable($answer) ? $answer($request) : $answer;

            return Http::response($answer['__body'] ?? $answer, $answer['__status'] ?? 200);
        });
    }

    /** @return array<string, mixed> */
    private function queryOf(HttpRequest $request): array
    {
        parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

        return $query;
    }

    /** @return list<HttpRequest> */
    private function sentTo(string $needle): array
    {
        return array_values(array_filter($this->sent, fn (HttpRequest $r) => str_contains($r->url(), $needle)));
    }

    private function connected(string $kind, array $attributes = []): Account
    {
        $platform = $kind === 'facebook_page' ? 'facebook' : $kind;
        $account = Account::factory()->for($this->user)->automated()->create(['platform' => $platform, 'handle' => 'maisoncire']);
        AccountConnection::create([
            'user_id' => $this->user->id, 'account_id' => $account->id, 'provider' => $kind === 'x' ? 'x' : 'meta', 'kind' => $kind,
            'external_id' => ['instagram' => 'ig1', 'facebook_page' => 'pg1', 'x' => 'x1'][$kind], 'username' => 'maisoncire',
            'access_token' => 'page-tok', 'status' => 'ok', ...$attributes,
        ]);

        return $account;
    }

    private function asset(bool $video = false, int $width = 1080, int $height = 1350): Asset
    {
        $factory = Asset::factory()->for($this->user);
        $asset = ($video ? $factory->video($width, $height) : $factory->sized($width, $height))->create();
        Storage::disk('local')->put($asset->path, $video ? 'video-bytes' : 'jpeg-bytes');

        return $asset;
    }

    private function duePost(Account $account, array $assets = [], array $overrides = []): Post
    {
        $post = Post::factory()->for($this->user)->for($account)->scheduled(now()->subMinute())->create([
            'approved_at' => now(), 'body' => 'A warm caption for the evening ritual.', 'platforms' => [$account->platform->value], ...$overrides,
        ]);
        $post->syncAssets(array_map(fn (Asset $a) => $a->id, $assets));

        return $post;
    }

    /* ------------------------------------------------------------------ */
    /* Connecting */
    /* ------------------------------------------------------------------ */

    public function test_connecting_meta_stores_each_page_and_its_instagram_with_encrypted_tokens(): void
    {
        $this->fake([
            'GET oauth/access_token' => ['access_token' => 'user-tok', 'expires_in' => 5184000],
            'GET me/accounts' => ['data' => [[
                'id' => 'pg1', 'name' => 'Maison Cire', 'username' => 'maisoncire', 'access_token' => 'page-tok', 'tasks' => ['CREATE_CONTENT'],
                'instagram_business_account' => ['id' => 'ig1', 'username' => 'maisoncire.studio', 'name' => 'Maison Cire'],
            ]]],
        ]);

        $this->actingAs($this->user)->withSession(['connect.meta.state' => 'state-1'])
            ->get('/oauth/connect/meta/callback?code=the-code&state=state-1')
            ->assertRedirectContains('http://localhost:5173/dashboard/accounts?connected=');

        $connections = $this->user->connections()->orderBy('kind')->get();
        $this->assertSame(['facebook_page', 'instagram'], $connections->pluck('kind')->all());
        $this->assertSame('page-tok', $connections[1]->access_token);
        $this->assertNotSame('page-tok', DB::table('account_connections')->where('kind', 'instagram')->value('access_token'));

        // Each one has a FlowAI account to publish from.
        $this->assertSame('maisoncire.studio', $connections[1]->account->handle);
        $this->assertSame('instagram', $connections[1]->account->platform->value);
        $this->assertSame('facebook', $connections[0]->account->platform->value);

        // The list never shows tokens.
        $this->actingAs($this->user)->getJson('/api/connections')
            ->assertOk()->assertJsonPath('available.meta', true)->assertJsonCount(2, 'data')
            ->assertDontSee('page-tok');
    }

    public function test_a_callback_without_the_matching_state_connects_nothing(): void
    {
        $this->fake([]);

        $this->actingAs($this->user)->withSession(['connect.meta.state' => 'state-1'])
            ->get('/oauth/connect/meta/callback?code=the-code&state=forged')
            ->assertRedirectContains('/dashboard/accounts?connect_error=');

        $this->assertSame(0, AccountConnection::count());
        $this->assertSame([], $this->sent);
    }

    public function test_connecting_without_app_credentials_says_what_is_missing(): void
    {
        config(['services.meta.app_id' => null]);

        $this->actingAs($this->user)->get('/oauth/connect/meta/redirect')
            ->assertRedirectContains('/dashboard/accounts?connect_error=Meta');
    }

    public function test_connect_redirect_asks_x_with_pkce(): void
    {
        $location = $this->actingAs($this->user)->get('/oauth/connect/x/redirect')->assertRedirect()->headers->get('Location');

        $this->assertStringStartsWith('https://x.com/i/oauth2/authorize?', $location);
        $this->assertStringContainsString('code_challenge_method=S256', $location);
        $this->assertStringContainsString('tweet.write', urldecode($location));
    }

    /* ------------------------------------------------------------------ */
    /* Publishing */
    /* ------------------------------------------------------------------ */

    public function test_an_instagram_photo_publishes_through_the_api_with_its_permalink_as_proof(): void
    {
        $account = $this->connected('instagram');
        $post = $this->duePost($account, [$this->asset()]);
        $this->fake([
            'POST ig1/media' => ['id' => 'c1'],
            'GET c1' => ['status_code' => 'FINISHED'],
            'POST ig1/media_publish' => ['id' => 'm1'],
            'GET m1' => ['permalink' => 'https://www.instagram.com/p/abc/'],
        ]);

        $this->assertSame(1, app(Publisher::class)->dispatchDue());

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status, (string) $post->error);
        $this->assertSame('m1', $post->external_id);
        $this->assertSame('api', $post->published_via);
        $this->assertSame('https://www.instagram.com/p/abc/', $post->post_url);
        $run = $post->runs()->sole();
        $this->assertSame('confirmed', $run->status);
        $this->assertNull($run->device_id);
        $this->assertSame(['api:container', 'api:processed', 'api:publish'], collect($run->steps)->pluck('action')->all());

        // Instagram fetched the photo from a signed public address, which serves the file.
        $container = $this->sentTo('ig1/media')[0]->data();
        $this->assertSame('A warm caption for the evening ritual.', $container['caption']);
        $this->assertStringStartsWith('https://media.example.com/media/', $container['image_url']);
        $this->get(substr($container['image_url'], strlen('https://media.example.com')))->assertOk();
        $this->get(strtok(substr($container['image_url'], strlen('https://media.example.com')), '?'))->assertForbidden();
    }

    public function test_an_instagram_reel_uploads_its_video_resumably(): void
    {
        $account = $this->connected('instagram');
        $post = $this->duePost($account, [$this->asset(video: true)]);
        $this->fake([
            'POST ig1/media' => ['id' => 'c2'],
            'POST https://rupload.facebook.com/ig-api-upload/v24.0/c2' => ['success' => true],
            'GET c2' => ['status_code' => 'FINISHED'],
            'POST ig1/media_publish' => ['id' => 'm2'],
            'GET m2' => ['permalink' => 'https://www.instagram.com/reel/xyz/'],
        ]);

        app(Publisher::class)->dispatchDue();

        $this->assertSame('m2', $post->fresh()->external_id);
        $container = $this->sentTo('ig1/media')[0]->data();
        $this->assertSame(['REELS', 'resumable'], [$container['media_type'], $container['upload_type']]);
        $this->assertArrayNotHasKey('image_url', $container);
        $upload = $this->sentTo('rupload.facebook.com')[0];
        $this->assertSame('OAuth page-tok', $upload->header('Authorization')[0]);
        $this->assertSame('video-bytes', $upload->body());
    }

    public function test_an_instagram_story_needs_no_caption(): void
    {
        $account = $this->connected('instagram');
        $post = $this->duePost($account, [$this->asset(false, 1080, 1920)], ['placement' => 'story']);
        $this->fake([
            'POST ig1/media' => ['id' => 'c3'],
            'GET c3' => ['status_code' => 'FINISHED'],
            'POST ig1/media_publish' => ['id' => 'm3'],
            'GET m3' => [],
        ]);

        app(Publisher::class)->dispatchDue();

        $this->assertSame(PostStatus::Published, $post->fresh()->status);
        $container = $this->sentTo('ig1/media')[0]->data();
        $this->assertSame('STORIES', $container['media_type']);
        $this->assertArrayNotHasKey('caption', $container);
    }

    public function test_a_facebook_photo_posts_to_the_page(): void
    {
        $account = $this->connected('facebook_page');
        $post = $this->duePost($account, [$this->asset()]);
        $this->fake([
            'POST pg1/photos' => ['id' => 'ph1', 'post_id' => 'pg1_99'],
            'GET pg1_99' => ['permalink_url' => 'https://www.facebook.com/maisoncire/posts/99'],
        ]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status, (string) $post->error);
        $this->assertSame('pg1_99', $post->external_id);
        $this->assertSame('https://www.facebook.com/maisoncire/posts/99', $post->post_url);
    }

    public function test_a_tall_facebook_video_goes_out_as_a_reel(): void
    {
        $account = $this->connected('facebook_page');
        $post = $this->duePost($account, [$this->asset(video: true, height: 1920)]);
        $this->fake([
            'POST pg1/video_reels' => fn (HttpRequest $r) => $r->data()['upload_phase'] === 'start'
                ? ['video_id' => 'v1', 'upload_url' => 'https://rupload.facebook.com/video-upload/v24.0/v1']
                : ['success' => true],
            'POST https://rupload.facebook.com/video-upload/v24.0/v1' => ['success' => true],
        ]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status, (string) $post->error);
        $this->assertSame('v1', $post->external_id);
        $this->assertSame('https://www.facebook.com/reel/v1', $post->post_url);
        $finish = $this->sentTo('pg1/video_reels')[1]->data();
        $this->assertSame(['finish', 'PUBLISHED'], [$finish['upload_phase'], $finish['video_state']]);
    }

    public function test_x_posts_with_a_photo_after_refreshing_an_expired_token(): void
    {
        $account = $this->connected('x', ['token_expires_at' => now()->subMinute(), 'refresh_token' => 'refresh-1']);
        $long = str_repeat('Candles for slow evenings and long talks. ', 10);
        $post = $this->duePost($account, [$this->asset()], ['body' => $long]);
        $this->fake([
            'POST https://api.x.com/2/oauth2/token' => ['access_token' => 'fresh-tok', 'refresh_token' => 'refresh-2', 'expires_in' => 7200],
            'POST https://api.x.com/2/media/upload' => ['data' => ['id' => 'mx1']],
            'POST https://api.x.com/2/tweets' => ['data' => ['id' => 't1', 'text' => '…']],
        ]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status, (string) $post->error);
        $this->assertSame('https://x.com/maisoncire/status/t1', $post->post_url);
        $tweet = $this->sentTo('2/tweets')[0];
        $this->assertSame('Bearer fresh-tok', $tweet->header('Authorization')[0]);
        $this->assertSame(['mx1'], $tweet->data()['media']['media_ids']);
        $this->assertLessThanOrEqual(280, mb_strlen($tweet->data()['text']));
        $this->assertStringEndsWith('…', $tweet->data()['text']);
        $connection = $account->apiConnection()->first();
        $this->assertSame(['fresh-tok', 'refresh-2'], [$connection->access_token, $connection->refresh_token]);
    }

    public function test_an_expired_meta_token_fails_the_post_and_marks_the_connection(): void
    {
        $account = $this->connected('facebook_page');
        $post = $this->duePost($account);
        $this->fake(['POST pg1/feed' => ['__status' => 400, '__body' => ['error' => ['code' => 190, 'message' => 'Session has expired']]]]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Failed, $post->status);
        $this->assertStringContainsString('Session has expired', $post->error);
        $this->assertSame('expired', $account->apiConnection()->first()->status);

        // With no phone either, the next due post says why instead of waiting forever.
        $next = $this->duePost($account);
        app(Publisher::class)->dispatchDue();
        $this->assertSame(PostStatus::Failed, $next->fresh()->status);
        $this->assertSame(0, $next->runs()->count());
    }

    public function test_a_rate_limited_post_is_tried_again_later(): void
    {
        $account = $this->connected('facebook_page');
        $post = $this->duePost($account);
        $this->fake(['POST pg1/feed' => ['__status' => 400, '__body' => ['error' => ['code' => 4, 'message' => 'Application request limit reached']]]]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Scheduled, $post->status);
        $this->assertTrue($post->scheduled_at->isFuture());
        $this->assertSame('failed', $post->runs()->sole()->status);
    }

    public function test_instagram_photos_need_a_public_address(): void
    {
        config(['services.meta.public_media_url' => 'http://localhost:8000']);
        $account = $this->connected('instagram');
        $post = $this->duePost($account, [$this->asset()]);
        $this->fake([]);

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Failed, $post->status);
        $this->assertStringContainsString('META_PUBLIC_MEDIA_URL', $post->error);
        $this->assertSame([], $this->sent);
    }

    public function test_publish_via_phone_keeps_a_connected_account_on_its_phone(): void
    {
        $account = $this->connected('instagram');
        $account->update(['publish_via' => 'phone']);
        $post = $this->duePost($account, [$this->asset()]);
        $this->fake([]);

        $this->assertSame(0, app(Publisher::class)->dispatchDue());
        $this->assertSame(PostStatus::Scheduled, $post->fresh()->status);
        $this->assertSame([], $this->sent);

        $this->actingAs($this->user)->patchJson("/api/accounts/{$account->id}", ['publish_via' => 'sideways'])->assertUnprocessable();
    }

    /* ------------------------------------------------------------------ */
    /* Engagement */
    /* ------------------------------------------------------------------ */

    private function publishedPost(Account $account, string $externalId, array $overrides = []): Post
    {
        return Post::factory()->for($this->user)->for($account)->published()->create([
            'external_id' => $externalId, 'published_via' => 'api', 'published_at' => now()->subHours(3),
            'post_url' => 'https://www.instagram.com/p/abc/', 'platforms' => [$account->platform->value], ...$overrides,
        ]);
    }

    public function test_instagram_engagement_and_comments_come_back(): void
    {
        $account = $this->connected('instagram');
        $post = $this->publishedPost($account, 'm1');
        $this->fake([
            'GET m1' => ['like_count' => 42, 'comments_count' => 2, 'media_product_type' => 'FEED'],
            'GET m1/insights' => fn (HttpRequest $r) => match ($this->queryOf($r)['metric']) {
                'reach' => ['data' => [['name' => 'reach', 'values' => [['value' => 800]]]]],
                'saved' => ['data' => [['name' => 'saved', 'total_value' => ['value' => 9]]]],
                'views' => ['data' => [['name' => 'views', 'total_value' => ['value' => 1500]]]],
                // A metric this post doesn't have mustn't hide the others.
                default => ['__status' => 400, '__body' => ['error' => ['code' => 100, 'message' => 'unsupported metric']]],
            },
            'GET m1/comments' => ['data' => [
                ['id' => 'cm1', 'text' => 'Where can I buy this?', 'username' => 'ana', 'timestamp' => '2026-10-08T10:00:00+0000'],
                ['id' => 'cm2', 'text' => 'Beautiful', 'username' => 'leo', 'timestamp' => '2026-10-08T11:00:00+0000'],
            ]],
        ]);

        $this->assertSame(1, app(Engagement::class)->refreshRecent());
        app(Engagement::class)->refreshRecent(); // the next hour: no duplicate comments

        $metric = $post->metric()->sole();
        $this->assertSame([42, 2, null, 9, 1500, 800], [$metric->likes, $metric->comments, $metric->shares, $metric->saves, $metric->views, $metric->reach]);
        $this->assertSame('api', $metric->source);
        $comments = Comment::orderBy('external_id')->get();
        $this->assertSame(['cm1', 'cm2'], $comments->pluck('external_id')->all());
        $this->assertSame(['ana', $post->id, 'new'], [$comments[0]->author, $comments[0]->post_id, $comments[0]->status]);

        // The post and the analytics show it.
        $this->actingAs($this->user)->getJson("/api/posts/{$post->id}")->assertJsonPath('metrics.likes', 42);
        $this->actingAs($this->user)->getJson('/api/analytics?range=7')
            ->assertJsonPath('engagement.totals.likes', 42)
            ->assertJsonPath('engagement.totals.views', 1500)
            ->assertJsonPath('engagement.top.0.id', $post->id);
    }

    public function test_facebook_reactions_are_counted_by_type(): void
    {
        $account = $this->connected('facebook_page');
        $post = $this->publishedPost($account, 'pg1_99');
        $this->fake([
            'GET pg1_99' => [
                'reactions' => ['summary' => ['total_count' => 15]], 'comments' => ['summary' => ['total_count' => 1]], 'shares' => ['count' => 3],
                'r_like' => ['summary' => ['total_count' => 10]], 'r_love' => ['summary' => ['total_count' => 5]], 'r_angry' => ['summary' => ['total_count' => 0]],
            ],
            'GET pg1_99/comments' => ['data' => [['id' => 'fc1', 'message' => 'Nice', 'from' => ['name' => 'Sam'], 'created_time' => '2026-10-08T10:00:00+0000']]],
        ]);

        $this->actingAs($this->user)->postJson("/api/posts/{$post->id}/engagement")
            ->assertOk()->assertJsonPath('likes', 15)->assertJsonPath('shares', 3)
            ->assertJsonPath('reactions', ['like' => 10, 'love' => 5]);
        $this->assertSame('Sam', Comment::sole()->author);
    }

    public function test_an_approved_reply_goes_back_under_the_platform_comment(): void
    {
        $account = $this->connected('instagram');
        $comment = Comment::create(['user_id' => $this->user->id, 'account_id' => $account->id, 'author' => 'ana', 'body' => 'Where can I buy this?', 'external_id' => 'cm1', 'status' => 'human']);
        $this->fake(['POST cm1/replies' => ['id' => 'r1']]);

        $this->actingAs($this->user)->postJson("/api/comments/{$comment->id}/send", ['reply' => 'At maisoncire.com, link in bio!'])
            ->assertOk()->assertJsonPath('status', 'sent');

        $this->assertSame('r1', $comment->fresh()->reply_external_id);
        $this->assertSame('At maisoncire.com, link in bio!', $this->sentTo('cm1/replies')[0]->data()['message']);
    }

    public function test_a_reply_the_platform_refuses_stays_unsent(): void
    {
        $account = $this->connected('instagram');
        $comment = Comment::create(['user_id' => $this->user->id, 'account_id' => $account->id, 'author' => 'ana', 'body' => 'Hi', 'external_id' => 'cm1', 'status' => 'human']);
        $this->fake(['POST cm1/replies' => ['__status' => 400, '__body' => ['error' => ['code' => 10, 'message' => 'Comment was deleted']]]]);

        $this->actingAs($this->user)->postJson("/api/comments/{$comment->id}/send", ['reply' => 'Thanks!'])->assertStatus(502);

        $this->assertSame('human', $comment->fresh()->status);
        $this->assertNull($comment->fresh()->sent_at);
    }

    public function test_connections_can_be_relinked_and_removed_only_by_their_owner(): void
    {
        $account = $this->connected('instagram');
        $connection = $account->apiConnection()->first();
        $other = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'second']);
        $facebook = Account::factory()->for($this->user)->create(['platform' => 'facebook', 'handle' => 'page']);

        $this->actingAs($this->user)->patchJson("/api/connections/{$connection->id}", ['account_id' => $facebook->id])->assertUnprocessable();
        $this->actingAs($this->user)->patchJson("/api/connections/{$connection->id}", ['account_id' => $other->id])->assertOk()->assertJsonPath('account_id', $other->id);

        $stranger = User::factory()->create();
        $this->actingAs($stranger)->deleteJson("/api/connections/{$connection->id}")->assertNotFound();
        $this->actingAs($this->user)->deleteJson("/api/connections/{$connection->id}")->assertNoContent();
        $this->assertSame(0, AccountConnection::count());
    }
}
