<?php

namespace App\Jobs;

use App\Models\Generation;
use App\Services\Ai\Media\GenerationRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Send an image or video generation to its provider. */
class RunGeneration implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public function __construct(public int $generationId)
    {
        $this->onQueue('media');
    }

    public function handle(GenerationRunner $runner): void
    {
        $generation = Generation::find($this->generationId);
        if ($generation && $generation->status === 'queued') {
            $runner->start($generation);
        }
    }

    /**
     * The job died before the generation could say so: a crash, or the queue couldn't claim it.
     * If the provider already has it, keep polling; otherwise fail it visibly so it can be retried.
     */
    public function failed(?Throwable $e): void
    {
        $generation = Generation::find($this->generationId);
        if (! $generation || ! in_array($generation->status, ['queued', 'running'], true)) {
            return;
        }
        if ($generation->external_id) {
            PollGeneration::dispatch($generation->id)->delay(now()->addSeconds(5));

            return;
        }
        report($e);
        $generation->update(['status' => 'failed', 'error' => 'It couldn’t be started: the server was busy. Nothing was sent to the model; try again.', 'finished_at' => now()]);
    }
}
