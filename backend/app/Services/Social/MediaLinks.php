<?php

namespace App\Services\Social;

use App\Models\Asset;
use Illuminate\Support\Facades\URL;

/**
 * A short-lived public address for one library file, for platforms that fetch media themselves
 * (Instagram photos). Signed, so only that file, only for a couple of hours. It must be served on
 * an address the platform can reach: META_PUBLIC_MEDIA_URL (a domain or a tunnel), not localhost.
 */
class MediaLinks
{
    public function url(Asset $asset): string
    {
        $base = rtrim((string) (config('services.meta.public_media_url') ?: config('app.url')), '/');
        if (preg_match('#^https?://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)#', $base)) {
            throw new SocialApiError('Instagram fetches photos from a public address, and this server is only reachable locally. Set META_PUBLIC_MEDIA_URL to a public address for this API (a domain or a tunnel such as cloudflared).');
        }

        return $base.URL::temporarySignedRoute('public.media', now()->addHours(2), ['asset' => $asset->id], absolute: false);
    }
}
