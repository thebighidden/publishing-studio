<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * One eval task's score (0–100) for one model.
 */
#[Fillable(['model', 'task', 'score', 'detail', 'output'])]
class ModelEval extends Model
{
    public const UPDATED_AT = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['score' => 'integer'];
    }
}
