<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * One library file at a signed, short-lived address, for a platform that fetches media itself
 * (Instagram photos). The signature is checked by the route's middleware.
 */
class PublicMediaController extends Controller
{
    public function __invoke(Asset $asset): BinaryFileResponse
    {
        abort_unless(Storage::disk('local')->exists($asset->path), 404);

        return response()->file(Storage::disk('local')->path($asset->path), ['Content-Type' => $asset->mime, 'Cache-Control' => 'private, max-age=600']);
    }
}
