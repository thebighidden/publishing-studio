<?php

namespace App\Policies;

use App\Models\Campaign;
use App\Models\User;

class CampaignPolicy
{
    public function view(User $user, Campaign $campaign): bool
    {
        return $campaign->user()->is($user);
    }

    public function update(User $user, Campaign $campaign): bool
    {
        return $campaign->user()->is($user);
    }

    public function delete(User $user, Campaign $campaign): bool
    {
        return $campaign->user()->is($user);
    }
}
