<?php

namespace App\Jobs;

use App\Models\WorkflowRun;
use App\Services\Ai\Workflows\WorkflowRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Start a workflow run's current step. */
class AdvanceWorkflow implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public function __construct(public int $runId)
    {
        $this->onQueue('media');
    }

    public function handle(WorkflowRunner $runner): void
    {
        $run = WorkflowRun::find($this->runId);
        if ($run && $run->status === 'running') {
            $runner->advance($run);
        }
    }
}
