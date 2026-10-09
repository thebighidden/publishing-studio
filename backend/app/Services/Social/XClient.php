<?php

namespace App\Services\Social;

use App\Models\AccountConnection;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * X's API v2: signing in (OAuth 2.0 with PKCE), refreshing the token, uploading media and posting.
 * The free tier posts; reading metrics needs a paid tier, so FlowAI doesn't ask X for them.
 */
class XClient
{
    private const API = 'https://api.x.com/2/';

    public function configured(): bool
    {
        return filled(config('services.x.client_id'));
    }

    public function authorizeUrl(string $state, string $verifier): string
    {
        return 'https://x.com/i/oauth2/authorize?'.http_build_query([
            'response_type' => 'code',
            'client_id' => config('services.x.client_id'),
            'redirect_uri' => config('services.x.redirect'),
            'scope' => implode(' ', config('services.x.scopes')),
            'state' => $state,
            'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='),
            'code_challenge_method' => 'S256',
        ]);
    }

    /**
     * @return array{access_token: string, refresh_token: string|null, expires_at: Carbon|null, scopes: list<string>}
     */
    public function exchangeCode(string $code, string $verifier): array
    {
        return $this->token(['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => config('services.x.redirect'), 'code_verifier' => $verifier]);
    }

    /** A token that is about to run out is refreshed and saved, so calls just work. */
    public function freshToken(AccountConnection $connection): string
    {
        if ($connection->token_expires_at && $connection->token_expires_at->isAfter(now()->addMinutes(2))) {
            return $connection->access_token;
        }
        if (! $connection->refresh_token) {
            $connection->update(['status' => 'expired', 'error' => 'X needs you to connect the account again.']);
            throw new SocialApiError('X needs you to connect the account again.', expired: true);
        }
        $t = $this->token(['grant_type' => 'refresh_token', 'refresh_token' => $connection->refresh_token]);
        $connection->update(['access_token' => $t['access_token'], 'refresh_token' => $t['refresh_token'] ?? $connection->refresh_token, 'token_expires_at' => $t['expires_at'], 'status' => 'ok', 'error' => null]);

        return $t['access_token'];
    }

    /**
     * @return array<string, mixed>
     */
    public function me(string $token): array
    {
        return $this->call(fn (PendingRequest $http) => $http->withToken($token)->get(self::API.'users/me', ['user.fields' => 'username,name']))['data'] ?? [];
    }

    /** Upload a photo (one request) or a video (in chunks, then wait for X to process it). */
    public function uploadMedia(string $token, string $contents, string $mime): string
    {
        if (str_starts_with($mime, 'image/')) {
            return (string) ($this->call(fn (PendingRequest $http) => $http->withToken($token)->timeout(120)
                ->attach('media', $contents, 'media')->post(self::API.'media/upload', ['media_category' => 'tweet_image']))['data']['id']
                ?? throw new SocialApiError('X didn’t accept the photo.'));
        }

        $id = (string) ($this->call(fn (PendingRequest $http) => $http->withToken($token)->post(self::API.'media/upload/initialize', [
            'media_type' => $mime, 'total_bytes' => strlen($contents), 'media_category' => 'tweet_video',
        ]))['data']['id'] ?? throw new SocialApiError('X didn’t start the video upload.'));
        foreach (str_split($contents, 4 * 1024 * 1024) as $i => $chunk) {
            $this->call(fn (PendingRequest $http) => $http->withToken($token)->timeout(300)
                ->attach('media', $chunk, 'chunk')->post(self::API."media/upload/{$id}/append", ['segment_index' => $i]));
        }
        $state = $this->call(fn (PendingRequest $http) => $http->withToken($token)->post(self::API."media/upload/{$id}/finalize"))['data']['processing_info'] ?? null;
        for ($tries = 0; $state && in_array($state['state'] ?? '', ['pending', 'in_progress'], true) && $tries < 60; $tries++) {
            sleep(max(1, (int) ($state['check_after_secs'] ?? 3)));
            $state = $this->call(fn (PendingRequest $http) => $http->withToken($token)->get(self::API.'media/upload', ['command' => 'STATUS', 'media_id' => $id]))['data']['processing_info'] ?? null;
        }
        if (($state['state'] ?? 'succeeded') === 'failed') {
            throw new SocialApiError('X couldn’t process the video: '.($state['error']['message'] ?? 'unknown reason'));
        }

        return $id;
    }

    /**
     * @param  list<string>  $mediaIds
     */
    public function tweet(string $token, string $text, array $mediaIds = []): string
    {
        $body = ['text' => $text] + ($mediaIds ? ['media' => ['media_ids' => $mediaIds]] : []);

        return (string) ($this->call(fn (PendingRequest $http) => $http->withToken($token)->post(self::API.'tweets', $body))['data']['id']
            ?? throw new SocialApiError('X didn’t return the post.'));
    }

    /**
     * @param  array<string, string>  $fields
     * @return array{access_token: string, refresh_token: string|null, expires_at: Carbon|null, scopes: list<string>}
     */
    private function token(array $fields): array
    {
        $r = $this->call(function (PendingRequest $http) use ($fields) {
            $http = $http->asForm();
            // A confidential client signs with its secret; a public one sends its id in the body.
            $http = filled(config('services.x.client_secret'))
                ? $http->withBasicAuth((string) config('services.x.client_id'), (string) config('services.x.client_secret'))
                : $http;

            return $http->post(self::API.'oauth2/token', $fields + ['client_id' => config('services.x.client_id')]);
        });

        return [
            'access_token' => (string) ($r['access_token'] ?? throw new SocialApiError('X didn’t return a token.')),
            'refresh_token' => $r['refresh_token'] ?? null,
            'expires_at' => isset($r['expires_in']) ? now()->addSeconds((int) $r['expires_in']) : null,
            'scopes' => array_values(array_filter(explode(' ', (string) ($r['scope'] ?? '')))),
        ];
    }

    /**
     * @param  callable(PendingRequest): Response  $send
     * @return array<string, mixed>
     */
    private function call(callable $send): array
    {
        if (! $this->configured()) {
            throw new SocialApiError('X isn’t set up: add X_CLIENT_ID (and X_CLIENT_SECRET).');
        }
        try {
            $r = $send(Http::timeout(60)->acceptJson());
        } catch (ConnectionException) {
            throw new SocialApiError('Couldn’t reach X. Try again in a minute.', retry: true);
        }
        if ($r->successful()) {
            return $r->json() ?? [];
        }
        $message = (string) ($r->json('detail') ?? $r->json('errors.0.message') ?? $r->json('error_description') ?? $r->json('title') ?? "X answered {$r->status()}.");

        throw new SocialApiError('X: '.Str::limit($message, 300), retry: $r->status() === 429 || $r->status() >= 500, expired: $r->status() === 401);
    }
}
