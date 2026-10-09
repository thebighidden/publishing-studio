<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Board;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Boards in the Creative Lab gallery: make, rename, delete (its files move to "no board"),
 * and move files between them.
 */
class BoardController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $visible = fn ($q) => $q->where('source', '!=', 'mask')->where('source', '!=', 'screenshot');
        $covers = Asset::query()->whereIn('id', $user->assets()->where($visible)->whereNotNull('board_id')->selectRaw('max(id)')->groupBy('board_id'))
            ->get()->keyBy('board_id');

        return response()->json([
            'data' => $user->boards()->withCount(['assets' => $visible])->orderBy('name')->get()->map(fn (Board $b) => [
                'id' => $b->id,
                'name' => $b->name,
                'count' => $b->assets_count,
                'cover_url' => $covers->get($b->id)?->posterUrl(),
            ]),
            'unfiled' => $user->assets()->where($visible)->whereNull('board_id')->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $board = $request->user()->boards()->create($this->validated($request));

        return response()->json(['id' => $board->id, 'name' => $board->name, 'count' => 0, 'cover_url' => null], 201);
    }

    public function update(Request $request, Board $board): JsonResponse
    {
        abort_unless($board->user_id === $request->user()->id, 404);
        $board->update($this->validated($request, $board));

        return response()->json(['id' => $board->id, 'name' => $board->name]);
    }

    public function destroy(Request $request, Board $board): Response
    {
        abort_unless($board->user_id === $request->user()->id, 404);
        $board->assets()->update(['board_id' => null]);
        $request->user()->generations()->where('board_id', $board->id)->update(['board_id' => null]);
        $board->delete();

        return response()->noContent();
    }

    /** Put files on a board, or take them off every board (`board_id` null). */
    public function move(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer'],
            'board_id' => ['present', 'nullable', Rule::exists('boards', 'id')->where('user_id', $user->id)],
        ]);
        $moved = $user->assets()->whereIn('id', $data['ids'])->update(['board_id' => $data['board_id']]);

        return response()->json(['moved' => $moved]);
    }

    /**
     * @return array{name: string}
     */
    private function validated(Request $request, ?Board $board = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:60', Rule::unique('boards', 'name')->where('user_id', $request->user()->id)->ignore($board?->id)],
        ], ['name.unique' => 'You already have a board with that name.']);
    }
}
