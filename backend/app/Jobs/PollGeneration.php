<?php

namespace App\Jobs;

use App\Models\Generation;
use App\Services\Ai\Media\GenerationRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Ask the provider how a generation is doing; ask again a little later until it's done. */
class PollGeneration implements ShouldQueue
{
    use Queueable;

    private const MAX_RETRIES = 60;

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

    /**
     * A poll that dies doesn't stop the provider making it: ask again a little later. The runner
     * gives up on its own after its time limit; this cap only stops a poll that always crashes.
     */
    public function failed(?Throwable $e): void
    {
        $generation = Generation::find($this->generationId);
        if (! $generation || ! in_array($generation->status, ['queued', 'running'], true)) {
            return;
        }
        report($e);
        if ($this->attempt < self::MAX_RETRIES) {
            self::dispatch($this->generationId, $this->attempt + 1)->delay(now()->addSeconds(20));

            return;
        }
        $generation->update(['status' => 'failed', 'error' => 'Lost track of it at the provider. Try again.', 'finished_at' => now()]);
    }
}
