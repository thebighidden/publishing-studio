<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Models\Account;
use App\Models\AccountConnection;
use App\Models\ActionLog;
use App\Models\User;
use App\Services\Social\MetaClient;
use App\Services\Social\SocialApiError;
use App\Services\Social\XClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Connecting accounts through the platforms' official sign-in: Meta (Facebook Pages and their
 * Instagram professional accounts) and X. The round trip runs on web routes because the callback
 * needs the session that started it. Tokens are stored encrypted; nothing is posted here.
 */
class ConnectController extends Controller
{
    public const PROVIDERS = ['meta', 'x'];

    public function redirect(Request $request, string $provider, MetaClient $meta, XClient $x): RedirectResponse
    {
        abort_unless($request->user(), 401);
        $state = Str::random(40);
        $request->session()->put("connect.{$provider}.state", $state);

        if ($provider === 'meta') {
            if (! $meta->configured()) {
                return $this->back('connect_error', 'Meta isn’t set up yet: add META_APP_ID and META_APP_SECRET.');
            }

            return redirect()->away($meta->authorizeUrl($state));
        }
        if (! $x->configured()) {
            return $this->back('connect_error', 'X isn’t set up yet: add X_CLIENT_ID.');
        }
        $verifier = Str::random(64);
        $request->session()->put('connect.x.verifier', $verifier);

        return redirect()->away($x->authorizeUrl($state, $verifier));
    }

    public function callback(Request $request, string $provider, MetaClient $meta, XClient $x): RedirectResponse
    {
        $user = $request->user();
        abort_unless($user, 401);
        if ($request->filled('error')) {
            return $this->back('connect_error', 'Not connected: '.Str::limit((string) ($request->input('error_description') ?: $request->input('error')), 160));
        }
        $expected = $request->session()->pull("connect.{$provider}.state");
        if (! $expected || ! hash_equals($expected, (string) $request->input('state'))) {
            return $this->back('connect_error', 'That sign-in expired. Try connecting again.');
        }

        try {
            $connected = $provider === 'meta'
                ? $this->meta($user, $meta, (string) $request->input('code'))
                : $this->x($user, $x, (string) $request->input('code'), (string) $request->session()->pull('connect.x.verifier'));
        } catch (SocialApiError $e) {
            return $this->back('connect_error', $e->getMessage());
        }

        ActionLog::record($user, 'you', 'connect.'.$provider, null, 'Connected '.implode(', ', $connected).' through the official API.');

        return $this->back('connected', implode(', ', $connected));
    }

    /**
     * Every Page the person manages, and the Instagram account linked to each.
     *
     * @return list<string> what was connected, for the message
     */
    private function meta(User $user, MetaClient $meta, string $code): array
    {
        $token = $meta->exchangeCode($code);
        $pages = $meta->pages($token['token']);
        if (! $pages) {
            throw new SocialApiError('No Facebook Page came back. Pick at least one Page (and its Instagram account) when Facebook asks.');
        }
        $connected = [];
        foreach ($pages as $page) {
            $handle = $page['username'] ?? Str::slug($page['name'] ?? $page['id']);
            $this->store($user, 'meta', 'facebook_page', (string) $page['id'], $page['name'] ?? null, $handle, (string) $page['access_token'], null, null, ['tasks' => $page['tasks'] ?? []]);
            $connected[] = 'Facebook “'.($page['name'] ?? $page['id']).'”';
            if ($ig = $page['instagram_business_account'] ?? null) {
                // An Instagram account is reached with its Page's token, which doesn't expire.
                $this->store($user, 'meta', 'instagram', (string) $ig['id'], $ig['name'] ?? null, $ig['username'] ?? null, (string) $page['access_token'], null, null, ['page_id' => $page['id']]);
                $connected[] = 'Instagram @'.($ig['username'] ?? $ig['id']);
            }
        }

        return $connected;
    }

    /**
     * @return list<string>
     */
    private function x(User $user, XClient $x, string $code, string $verifier): array
    {
        $token = $x->exchangeCode($code, $verifier);
        $me = $x->me($token['access_token']);
        $this->store($user, 'x', 'x', (string) ($me['id'] ?? throw new SocialApiError('X didn’t say which account this is.')), $me['name'] ?? null, $me['username'] ?? null,
            $token['access_token'], $token['refresh_token'], $token['expires_at'], [], $token['scopes']);

        return ['X @'.($me['username'] ?? $me['id'])];
    }

    /**
     * Save the connection and link it to the FlowAI account for the same handle, making one if
     * there isn't any yet. Connecting again refreshes the tokens.
     *
     * @param  array<string, mixed>  $meta
     * @param  list<string>|null  $scopes
     */
    private function store(User $user, string $provider, string $kind, string $externalId, ?string $name, ?string $username, string $token, ?string $refresh, $expires, array $meta, ?array $scopes = null): AccountConnection
    {
        $platform = $kind === 'facebook_page' ? Platform::Facebook : Platform::from($kind);
        $handle = ltrim((string) ($username ?: $name ?: $externalId), '@');
        $account = $user->accounts()->where('platform', $platform->value)->where('handle', $handle)->first()
            ?? $user->accounts()->create(['platform' => $platform->value, 'handle' => $handle, 'name' => $name]);

        return AccountConnection::updateOrCreate(
            ['user_id' => $user->id, 'kind' => $kind, 'external_id' => $externalId],
            [
                'account_id' => $account->id, 'provider' => $provider, 'name' => $name, 'username' => $username,
                'access_token' => $token, 'refresh_token' => $refresh, 'token_expires_at' => $expires,
                'scopes' => $scopes ?? config("services.{$provider}.scopes"), 'meta' => $meta,
                'status' => 'ok', 'error' => null, 'checked_at' => now(),
            ],
        );
    }

    private function back(string $key, string $message): RedirectResponse
    {
        return redirect()->away(rtrim((string) config('app.frontend_url'), '/').'/dashboard/accounts?'.http_build_query([$key => $message]));
    }
}
