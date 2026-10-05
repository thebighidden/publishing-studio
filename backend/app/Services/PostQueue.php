<?php

namespace App\Services;

use App\Enums\PostStatus;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Works out when "Add to queue" should publish: the next weekly slot, in the user's own
 * timezone, that doesn't already have a post scheduled at that exact minute.
 */
class PostQueue
{
    /** How far ahead to look before giving up on finding a free slot. */
    private const WEEKS_AHEAD = 52;

    public function nextFree(User $user, ?int $ignorePostId = null): ?CarbonImmutable
    {
        $taken = $user->posts()
            ->where('status', PostStatus::Scheduled)
            ->where('scheduled_at', '>', now())
            ->when($ignorePostId, fn ($q) => $q->whereKeyNot($ignorePostId))
            ->pluck('scheduled_at')
            ->mapWithKeys(fn (CarbonInterface $at) => [$at->getTimestamp() => true]);

        foreach ($this->occurrences($user, self::WEEKS_AHEAD * 7) as $at) {
            if (! $taken->has($at->getTimestamp())) {
                return $at;
            }
        }

        return null;
    }

    /**
     * Upcoming slot times in UTC, soonest first, whether or not something is already in them.
     *
     * @return list<CarbonImmutable>
     */
    public function upcoming(User $user, int $count): array
    {
        return array_slice($this->occurrences($user, 14, $count), 0, $count);
    }

    /**
     * @return list<CarbonImmutable>
     */
    private function occurrences(User $user, int $days, ?int $limit = null): array
    {
        $slots = $user->queueSlots()->orderBy('weekday')->orderBy('time')->get();

        if ($slots->isEmpty()) {
            return [];
        }

        $now = CarbonImmutable::now($user->timezoneOrUtc());
        $weekStart = $now->startOfWeek(CarbonInterface::MONDAY);
        $out = [];

        for ($week = 0; $week * 7 < $days + 7; $week++) {
            foreach ($slots as $slot) {
                [$h, $m] = array_map('intval', explode(':', $slot->time));
                $at = $weekStart->addWeeks($week)->addDays($slot->weekday - 1)->setTime($h, $m);

                if ($at->greaterThan($now)) {
                    $out[] = $at->utc();

                    if ($limit !== null && count($out) >= $limit) {
                        return $out;
                    }
                }
            }
        }

        return $out;
    }
}
