<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;

class ProjectPolicy
{
    public function view(User $user, Project $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function update(User $user, Project $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function delete(User $user, Project $model): bool
    {
        return $model->user_id === $user->id;
    }
}
