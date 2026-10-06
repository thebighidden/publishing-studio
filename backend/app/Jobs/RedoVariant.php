<?php

namespace App\Jobs;

use App\Models\ItemVariant;
use App\Services\Campaigns\Pipeline;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** A variant rejected at gate 6B, rewritten by the adapter with the operator's note. */
class RedoVariant implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public function __construct(public int $variantId)
    {
        $this->onQueue('agents');
    }

    public function handle(Pipeline $pipeline): void
    {
        if ($variant = ItemVariant::with(['item.campaign', 'account'])->find($this->variantId)) {
            $pipeline->redo($variant);
        }
    }
}
