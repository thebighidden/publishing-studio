<?php

namespace App\Http\Controllers;

use App\Models\AccountConnection;
use App\Models\ActionLog;
use App\Models\Post;
use App\Services\Social\Engagement;
use App\Services\Social\MetaClient;
use App\Services\Social\SocialApiError;
use App\Services\Social\XClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * The accounts connected through the platforms' official APIs: list, relink, disconnect, and
 * fetch a post's engagement now instead of at the next hourly round.
 */
class ConnectionController extends Controller
{
    public function index(Request $request, MetaClient $meta, XClient $x): JsonResponse
    {
        return response()->json([
            'data' => $request->user()->connections()->latest('id')->get()->map->summary(),
            'available' => ['meta' => $meta->configured(), 'x' => $x->configured()],
            'public_media' => filled(config('services.meta.public_media_url')),
        ]);
    }

    /** Link a connection to another FlowAI account of the same platform. */
    public function update(Request $request, AccountConnection $connection): JsonResponse
    {
        abort_unless($connection->user_id === $request->user()->id, 404);
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)->where('platform', $connection->platform())],
        ], ['account_id.exists' => 'Pick an account on the same platform.']);
        $connection->update($data);

        return response()->json($connection->summary());
    }

    /** Forget the tokens. Posts already published stay; the account goes back to its phone. */
    public function destroy(Request $request, AccountConnection $connection): Response
    {
        abort_unless($connection->user_id === $request->user()->id, 404);
        ActionLog::record($request->user(), 'you', 'connect.removed', null, "Disconnected {$connection->kind} “".($connection->username ?: $connection->name).'”.');
        $connection->delete();

        return response()->noContent();
    }

    public function refreshPost(Request $request, Post $post, Engagement $engagement): JsonResponse
    {
        abort_unless($post->user_id === $request->user()->id, 404);
        try {
            return response()->json($engagement->refresh($post)->summary());
        } catch (SocialApiError $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }
}
