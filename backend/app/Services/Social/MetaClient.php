<?php

namespace App\Services\Social;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Meta's Graph API: signing in (Facebook Login), the Pages a person manages and the Instagram
 * professional accounts linked to them, and the calls for publishing, insights and comments.
 */
class MetaClient
{
    public function configured(): bool
    {
        return filled(config('services.meta.app_id')) && filled(config('services.meta.app_secret'));
    }

    public function graph(string $path = ''): string
    {
        return 'https://graph.facebook.com/'.config('services.meta.graph_version').'/'.ltrim($path, '/');
    }

    public function authorizeUrl(string $state): string
    {
        return 'https://www.facebook.com/'.config('services.meta.graph_version').'/dialog/oauth?'.http_build_query([
            'client_id' => config('services.meta.app_id'),
            'redirect_uri' => config('services.meta.redirect'),
            'state' => $state,
            'scope' => implode(',', config('services.meta.scopes')),
            'response_type' => 'code',
        ]);
    }

    /**
     * The code from the sign-in, swapped for a long-lived user token (about 60 days). Page tokens
     * fetched with it don't expire.
     *
     * @return array{token: string, expires_at: Carbon|null}
     */
    public function exchangeCode(string $code): array
    {
        $short = $this->get('oauth/access_token', null, [
            'client_id' => config('services.meta.app_id'), 'client_secret' => config('services.meta.app_secret'),
            'redirect_uri' => config('services.meta.redirect'), 'code' => $code,
        ])['access_token'] ?? throw new SocialApiError('Meta didn’t return a token.');
        $long = $this->get('oauth/access_token', null, [
            'grant_type' => 'fb_exchange_token', 'client_id' => config('services.meta.app_id'),
            'client_secret' => config('services.meta.app_secret'), 'fb_exchange_token' => $short,
        ]);

        return ['token' => $long['access_token'] ?? $short, 'expires_at' => isset($long['expires_in']) ? now()->addSeconds((int) $long['expires_in']) : null];
    }

    /**
     * The Pages the person manages, each with its own token and its Instagram account, if any.
     *
     * @return list<array<string, mixed>>
     */
    public function pages(string $userToken): array
    {
        return $this->get('me/accounts', $userToken, [
            'fields' => 'id,name,username,access_token,tasks,instagram_business_account{id,username,name}',
            'limit' => 100,
        ])['data'] ?? [];
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function get(string $path, ?string $token, array $query = []): array
    {
        return $this->call(fn (PendingRequest $http) => $http->get($this->url($path), $query + ($token ? ['access_token' => $token] : [])));
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    public function post(string $path, string $token, array $fields = []): array
    {
        return $this->call(fn (PendingRequest $http) => $http->asForm()->post($this->url($path), $fields + ['access_token' => $token]));
    }

    /**
     * A file in the request body (Page photos and videos).
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    public function upload(string $path, string $token, string $contents, string $filename, array $fields = []): array
    {
        return $this->call(fn (PendingRequest $http) => $http->timeout(600)->attach('source', $contents, $filename)
            ->post($this->url($path), $fields + ['access_token' => $token]));
    }

    /**
     * The bytes of a video, sent to a resumable-upload address (Instagram Reels and Stories,
     * Facebook Reels and video Stories): no public URL needed.
     *
     * @return array<string, mixed>
     */
    public function uploadBytes(string $url, string $token, string $contents): array
    {
        return $this->call(fn (PendingRequest $http) => $http->timeout(600)->withHeaders([
            'Authorization' => "OAuth {$token}", 'offset' => '0', 'file_size' => (string) strlen($contents),
        ])->withBody($contents, 'application/octet-stream')->post($url));
    }

    private function url(string $path): string
    {
        return Str::startsWith($path, 'https://') ? $path : $this->graph($path);
    }

    /**
     * @param  callable(PendingRequest): Response  $send
     * @return array<string, mixed>
     */
    private function call(callable $send): array
    {
        if (! $this->configured()) {
            throw new SocialApiError('Meta isn’t set up: add META_APP_ID and META_APP_SECRET.');
        }
        try {
            $r = $send(Http::timeout(60)->acceptJson());
        } catch (ConnectionException) {
            throw new SocialApiError('Couldn’t reach Meta. Try again in a minute.', retry: true);
        }
        if ($r->successful()) {
            return $r->json() ?? [];
        }
        $error = $r->json('error') ?? [];
        $code = (int) ($error['code'] ?? 0);
        $message = (string) ($error['error_user_msg'] ?? $error['message'] ?? "Meta answered {$r->status()}.");

        throw new SocialApiError(
            'Meta: '.Str::limit($message, 300),
            retry: in_array($code, [1, 2, 4, 17, 32, 341, 368, 613], true) || $r->status() >= 500,
            expired: $code === 190 || in_array((int) ($error['error_subcode'] ?? 0), [458, 460, 463, 467], true),
        );
    }
}
