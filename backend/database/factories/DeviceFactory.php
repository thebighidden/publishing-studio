<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Device>
 */
class DeviceFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => 'Phone '.fake()->unique()->numberBetween(1, 999),
            'driver' => 'simulator',
            'profile' => 'reliable',
            'status' => 'idle',
        ];
    }
}
