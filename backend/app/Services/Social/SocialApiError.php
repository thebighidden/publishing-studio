<?php

namespace App\Services\Social;

use RuntimeException;

/**
 * A platform API said no, or couldn't be reached. The message is written for a person; `retry`
 * says whether trying again later could help (rate limits, outages), and `expired` whether the
 * account has to be connected again.
 */
class SocialApiError extends RuntimeException
{
    public function __construct(string $message, public readonly bool $retry = false, public readonly bool $expired = false)
    {
        parent::__construct($message);
    }
}
