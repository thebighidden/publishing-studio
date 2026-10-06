<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Services\Publishing\PlatformSpecs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The platform spec table, and the pre-export check against it.
 */
class SpecController extends Controller
{
    public function index(PlatformSpecs $specs): JsonResponse
    {
        return response()->json($specs->all());
    }

    /**
     * Check a caption and its media for one or more platforms before it goes anywhere.
     */
    public function check(Request $request, PlatformSpecs $specs): JsonResponse
    {
        $data = $request->validate([
            'platforms' => ['required', 'array', 'min:1'],
            'platforms.*' => [Rule::enum(Platform::class)],
            'placements' => ['nullable', 'array'],
            'placements.*' => ['nullable', 'string', 'max:20'],
            'caption' => ['nullable', 'string', 'max:70000'],
            'asset_ids' => ['nullable', 'array', 'max:40'],
            'asset_ids.*' => ['integer'],
        ]);

        $ids = $data['asset_ids'] ?? [];
        $assets = $request->user()->assets()->whereIn('id', $ids)->get()->sortBy(fn ($a) => array_search($a->id, $ids))->values();

        return response()->json(collect($data['platforms'])->map(fn (string $p) => $specs->check(
            Platform::from($p),
            $data['placements'][$p] ?? null,
            $data['caption'] ?? '',
            $assets,
        ))->values());
    }
}
