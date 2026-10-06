<?php

namespace App\Policies;

use App\Models\Asset;
use App\Models\User;

class AssetPolicy
{
    public function view(User $user, Asset $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function update(User $user, Asset $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function delete(User $user, Asset $model): bool
    {
        return $model->user_id === $user->id;
    }
}
