<?php

namespace App\Enums;

enum PostStatus: string
{
    case Draft = 'draft';
    case Scheduled = 'scheduled';
    // A phone is running the post right now.
    case Publishing = 'publishing';
    // The phone was told to post, but nothing proves it went live yet.
    case Submitted = 'submitted';
    // Proven live: a post URL, or a verified screenshot.
    case Published = 'published';
    // Every attempt failed; it waits for someone to take over.
    case Failed = 'failed';

    /** What someone can choose in the composer; the others come from publishing runs. */
    public static function chosenByHand(): array
    {
        return [self::Draft, self::Scheduled, self::Published];
    }
}
