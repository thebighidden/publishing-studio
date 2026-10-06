<?php

namespace App\Jobs;

use App\Models\User;
use App\Services\Ai\Models\ModelEvals;
use App\Services\Ai\UsageMeter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Run the eval suite against one model. */
class RunModelEvals implements ShouldQueue
{
    use Queueable;

    public int $timeout = 900;

    public function __construct(public string $model, public int $userId)
    {
        $this->onQueue('default');
    }

    public function handle(ModelEvals $evals, UsageMeter $usage): void
    {
        $usage->within(User::find($this->userId), null, 'evals', fn () => $evals->run($this->model));
    }
}
