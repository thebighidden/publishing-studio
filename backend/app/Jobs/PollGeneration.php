<?php

namespace App\Jobs;

use App\Models\Generation;
use App\Services\Ai\Media\GenerationRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Ask the provider how a generation is doing; ask again a little later until it's done. */
class PollGeneration implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public function __construct(public int $generationId, public int $attempt = 0)
    {
        $this->onQueue('media');
    }

    public function handle(GenerationRunner $runner): void
    {
        $generation = Generation::find($this->generationId);
        if (! $generation || $runner->poll($generation)) {
            return;
        }

        // Every 5 seconds at first, easing off to every 20.
        self::dispatch($this->generationId, $this->attempt + 1)->delay(now()->addSeconds(min(20, 5 + $this->attempt * 2)));
    }
}
