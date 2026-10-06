<?php

namespace App\Jobs;

use App\Models\Campaign;
use App\Services\Campaigns\Pipeline;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Writer and visual director: the plan for gate 6A. */
class PlanCampaign implements ShouldQueue
{
    use Queueable;

    public int $timeout = 900;

    public function __construct(public int $campaignId)
    {
        $this->onQueue('agents');
    }

    public function handle(Pipeline $pipeline): void
    {
        if ($campaign = Campaign::find($this->campaignId)) {
            $pipeline->plan($campaign);
        }
    }
}
