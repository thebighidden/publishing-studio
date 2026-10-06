<?php

namespace App\Jobs;

use App\Models\PublishingRun;
use App\Services\Publishing\Publisher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Drive one simulator run to its end. HTTP phones are driven by the automation agent instead. */
class PublishPost implements ShouldQueue
{
    use Queueable;

    // R7: the worker kills the run past this, and the sweep ends it honestly.
    public int $timeout = 600;

    public int $tries = 1;

    public function __construct(public int $runId)
    {
        $this->onQueue('publishing');
    }

    public function handle(Publisher $publisher): void
    {
        $run = PublishingRun::find($this->runId);
        if (! $run || ! $run->isRunning()) {
            return;
        }
        $publisher->runOnSimulator($run);
    }
}
