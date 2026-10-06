<?php

namespace App\Policies;

use App\Models\Account;
use App\Models\User;

class AccountPolicy
{
    public function view(User $user, Account $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function update(User $user, Account $model): bool
    {
        return $model->user_id === $user->id;
    }

    public function delete(User $user, Account $model): bool
    {
        return $model->user_id === $user->id;
    }
}
