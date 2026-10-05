<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Models\Post;
use App\Models\QueueSlot;
use App\Models\User;
use App\Services\PostQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class QueueSlotController extends Controller
{
    public function __construct(private readonly PostQueue $queue) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->payload($request->user()));
    }

    /**
     * Replace the whole weekly schedule in one go; the editor always sends all of it.
     */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'slots' => ['present', 'array', 'max:84'],
            'slots.*.weekday' => ['required', 'integer', 'between:1,7'],
            'slots.*.time' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
        ], [
            'slots.*.time.regex' => 'Use a 24-hour time like 09:30.',
        ]);

        /** @var User $user */
        $user = $request->user();
        $slots = collect($data['slots'])
            ->unique(fn (array $s) => $s['weekday'].'@'.$s['time'])
            ->values();

        DB::transaction(function () use ($user, $slots) {
            $user->queueSlots()->delete();
            $user->queueSlots()->createMany($slots->all());
        });

        return response()->json($this->payload($user));
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(User $user): array
    {
        $upcoming = $this->queue->upcoming($user, 8);

        $filled = $upcoming
            ? $user->posts()
                ->where('status', PostStatus::Scheduled)
                ->whereIn('scheduled_at', $upcoming)
                ->get(['id', 'title', 'body', 'platforms', 'scheduled_at'])
                ->keyBy(fn (Post $p) => $p->scheduled_at->getTimestamp())
            : collect();

        return [
            'timezone' => $user->timezoneOrUtc(),
            'slots' => $user->queueSlots()
                ->orderBy('weekday')
                ->orderBy('time')
                ->get()
                ->map(fn (QueueSlot $s) => ['id' => $s->id, 'weekday' => $s->weekday, 'time' => $s->time]),
            'upcoming' => collect($upcoming)->map(function ($at) use ($filled) {
                $post = $filled->get($at->getTimestamp());

                return [
                    'at' => $at->toIso8601ZuluString(),
                    'post' => $post ? [
                        'id' => $post->id,
                        'title' => $post->title ?: str($post->body)->limit(60)->value(),
                        'platforms' => $post->platforms,
                    ] : null,
                ];
            }),
            'next_free' => $this->queue->nextFree($user)?->toIso8601ZuluString(),
        ];
    }
}
