<?php

namespace Database\Factories;

use App\Enums\Platform;
use App\Models\Account;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Account>
 */
class AccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'platform' => Platform::Instagram,
            'handle' => fake()->unique()->userName(),
            'name' => fake()->company(),
            'automation' => false,
            'autonomy' => 'approve_all',
            'min_gap_minutes' => 60,
        ];
    }

    public function automated(): static
    {
        return $this->state(fn () => ['automation' => true]);
    }
}
