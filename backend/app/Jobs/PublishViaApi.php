<?php

namespace App\Jobs;

use App\Models\PublishingRun;
use App\Services\Publishing\Publisher;
use App\Services\Social\ApiPublisher;
use App\Services\Social\SocialApiError;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Publish one post through its account's platform API (Meta for Instagram and Facebook, X). */
class PublishViaApi implements ShouldQueue
{
    use Queueable;

    // Instagram can take minutes to process a video before it can publish.
    public int $timeout = 900;

    public int $tries = 1;

    public function __construct(public int $runId)
    {
        $this->onQueue('publishing');
    }

    public function handle(ApiPublisher $api, Publisher $publisher): void
    {
        $run = PublishingRun::with('post.account.apiConnection')->find($this->runId);
        if (! $run || ! $run->isRunning()) {
            return;
        }
        $connection = $run->post->account?->apiConnection;
        if (! $connection) {
            $publisher->finishApi($run, null, 'The account isn’t connected to its platform’s API any more.');

            return;
        }
        try {
            $publisher->finishApi($run, $api->publish($run, $connection));
        } catch (SocialApiError $e) {
            if ($e->expired) {
                $connection->update(['status' => 'expired', 'error' => 'Connect the account again: its access has ended.']);
            }
            $publisher->finishApi($run, null, $e->getMessage(), $e->retry);
        }
    }
}
