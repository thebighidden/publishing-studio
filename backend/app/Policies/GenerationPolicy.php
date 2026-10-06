<?php

namespace App\Policies;

use App\Models\Generation;
use App\Models\User;

class GenerationPolicy
{
    public function view(User $user, Generation $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function update(User $user, Generation $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function delete(User $user, Generation $model): bool
    {
        return $model->user_id === $user->id;
    }
}
