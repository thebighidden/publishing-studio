<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Services\Media\AssetStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The media library: upload images and videos, list them, serve them to their owner.
 */
class AssetController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'kind' => ['nullable', Rule::in(['image', 'video', 'audio'])],
            'source' => ['nullable', Rule::in(['upload', 'generated', 'screenshot', 'intake'])],
            'q' => ['nullable', 'string', 'max:100'],
            'ids' => ['nullable', 'string', 'max:2000'],
            // A board's id, or "none" for files on no board.
            'board' => ['nullable', 'string', 'max:20'],
        ]);

        $assets = $request->user()->assets()
            ->when($filters['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->when($filters['source'] ?? null, fn ($q, $source) => $q->where('source', $source), fn ($q) => isset($filters['ids']) ? $q : $q->whereNotIn('source', ['screenshot', 'mask']))
            ->when($filters['board'] ?? null, fn ($q, $board) => $board === 'none' ? $q->whereNull('board_id') : $q->where('board_id', (int) $board))
            ->when($filters['q'] ?? null, fn ($q, $text) => $q->where('name', 'like', "%{$text}%"))
            ->when($filters['ids'] ?? null, fn ($q, $ids) => $q->whereIn('id', array_map('intval', explode(',', $ids))))
            ->latest()
            ->paginate(60);

        return response()->json([
            'data' => $assets->getCollection()->map->summary(),
            'meta' => ['current_page' => $assets->currentPage(), 'last_page' => $assets->lastPage(), 'per_page' => $assets->perPage(), 'total' => $assets->total()],
        ]);
    }

    public function store(Request $request, AssetStore $store): JsonResponse
    {
        $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:20'],
            'files.*' => ['file', 'mimetypes:'.implode(',', [...AssetStore::IMAGE_TYPES, ...AssetStore::VIDEO_TYPES]), 'max:204800'],
            'board_id' => ['nullable', Rule::exists('boards', 'id')->where('user_id', $request->user()->id)],
        ], [
            'files.*.mimetypes' => 'Use JPG, PNG, WebP or GIF images, or MP4, MOV or WebM videos.',
            'files.*.max' => 'Each file can be up to 200 MB.',
        ]);

        $assets = collect($request->file('files'))->map(fn ($file) => tap($store->fromUpload($request->user(), $file))
            ->update(['board_id' => $request->integer('board_id') ?: null]));

        return response()->json($assets->map->summary(), 201);
    }

    public function file(Asset $asset): BinaryFileResponse
    {
        Gate::authorize('view', $asset);

        // A file response, so browsers can seek in videos (range requests).
        return response()->file(Storage::disk('local')->path($asset->path), [
            'Content-Type' => $asset->mime,
            'Cache-Control' => 'private, max-age=604800',
        ]);
    }

    public function poster(Asset $asset): BinaryFileResponse
    {
        Gate::authorize('view', $asset);
        abort_unless($asset->poster_path, 404);

        return response()->file(Storage::disk('local')->path($asset->poster_path), [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'private, max-age=604800',
        ]);
    }

    public function destroy(Asset $asset): Response
    {
        Gate::authorize('delete', $asset);

        $asset->delete();

        return response()->noContent();
    }
}
