<?php

namespace App\Jobs;

use App\Models\Investigation;
use App\Services\Investigation\Investigator;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Run one investigation through its pipeline: collect → compare → validate → report. */
class RunInvestigation implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public int $tries = 1;

    public function __construct(public int $investigationId) {}

    public function handle(Investigator $investigator): void
    {
        $investigation = Investigation::with(['user', 'account'])->find($this->investigationId);
        if (! $investigation || $investigation->status !== 'running') {
            return;
        }
        $investigator->run($investigation);
    }
}
