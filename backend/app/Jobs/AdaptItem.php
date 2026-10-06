<?php

namespace App\Jobs;

use App\Models\CampaignItem;
use App\Services\Campaigns\Pipeline;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** An item whose media arrived after review started: versions for its accounts, checked and QA'd. */
class AdaptItem implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public function __construct(public int $itemId)
    {
        $this->onQueue('agents');
    }

    public function handle(Pipeline $pipeline): void
    {
        if ($item = CampaignItem::with('campaign')->find($this->itemId)) {
            $pipeline->adaptItems($item->campaign, collect([$item]));
        }
    }
}
