<?php

namespace App\Policies;

use App\Models\Device;
use App\Models\User;

class DevicePolicy
{
    public function view(User $user, Device $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function update(User $user, Device $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function delete(User $user, Device $model): bool
    {
        return $model->user_id === $user->id;
    }
}
