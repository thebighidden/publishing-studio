<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Http\Requests\SavePostRequest;
use App\Http\Resources\PostResource;
use App\Models\Post;
use App\Models\User;
use App\Services\PostQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class PostController extends Controller
{
    public function __construct(private readonly PostQueue $queue) {}

    /**
     * The library and the calendar both read from here: filter by status, platform and
     * text, or by a scheduled_at window for a calendar week.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::enum(PostStatus::class)],
            'platform' => ['nullable', 'string'],
            'q' => ['nullable', 'string', 'max:100'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after:from'],
            'sort' => ['nullable', Rule::in(['updated', 'scheduled'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $posts = $request->user()->posts()
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($filters['platform'] ?? null, fn ($q, $platform) => $q->whereJsonContains('platforms', $platform))
            ->when($filters['q'] ?? null, fn ($q, $text) => $q->where(fn ($q) => $q
                ->where('title', 'like', "%{$text}%")
                ->orWhere('body', 'like', "%{$text}%")))
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('scheduled_at', '>=', Carbon::parse($from)))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('scheduled_at', '<', Carbon::parse($to)))
            ->when(
                ($filters['sort'] ?? 'updated') === 'scheduled',
                fn ($q) => $q->orderBy('scheduled_at'),
                fn ($q) => $q->latest('updated_at'),
            )
            ->paginate($filters['per_page'] ?? 30);

        return PostResource::collection($posts);
    }

    public function store(SavePostRequest $request): JsonResponse
    {
        $post = $request->user()->posts()->make();
        $this->fill($post, $request);
        $post->save();

        return PostResource::make($post)->response()->setStatusCode(201);
    }

    public function show(Post $post): PostResource
    {
        Gate::authorize('view', $post);

        return PostResource::make($post);
    }

    public function update(SavePostRequest $request, Post $post): PostResource
    {
        Gate::authorize('update', $post);

        $this->fill($post, $request);
        $post->save();

        return PostResource::make($post);
    }

    public function destroy(Post $post): Response
    {
        Gate::authorize('delete', $post);

        $post->delete();

        return response()->noContent();
    }

    public function duplicate(Post $post): JsonResponse
    {
        Gate::authorize('view', $post);

        $copy = $post->replicate(['scheduled_at', 'published_at']);
        $copy->status = PostStatus::Draft;
        $copy->title = $post->title ? str($post->title)->limit(113, '')->append(' (copy)')->value() : null;
        $copy->save();

        return PostResource::make($copy)->response()->setStatusCode(201);
    }

    /**
     * @throws ValidationException
     */
    private function fill(Post $post, SavePostRequest $request): void
    {
        $post->fill($request->safe()->only(['title', 'body', 'format', 'platforms', 'status']));
        $post->scheduled_at = $request->input('scheduled_at') ? Carbon::parse($request->input('scheduled_at')) : null;

        if ($request->boolean('queue')) {
            /** @var User $user */
            $user = $request->user();
            $slot = $this->queue->nextFree($user, $post->exists ? $post->id : null);

            if (! $slot) {
                throw ValidationException::withMessages([
                    'queue' => 'Your queue has no posting times yet. Add some under Automations.',
                ]);
            }

            $post->status = PostStatus::Scheduled;
            $post->scheduled_at = $slot;
        }

        $post->published_at = $post->status === PostStatus::Published
            ? ($post->published_at ?? now())
            : null;
    }
}
