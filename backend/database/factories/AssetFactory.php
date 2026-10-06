<?php

namespace Database\Factories;

use App\Models\Asset;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Asset>
 */
class AssetFactory extends Factory
{
    /**
     * An image record without a file behind it; tests that serve files store one.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'kind' => 'image',
            'source' => 'upload',
            'name' => 'photo.jpg',
            'path' => 'assets/test/'.fake()->uuid().'.jpg',
            'mime' => 'image/jpeg',
            'size' => 200_000,
            'width' => 1080,
            'height' => 1350,
        ];
    }

    public function video(int $width = 1080, int $height = 1920, float $duration = 20): static
    {
        return $this->state(fn () => [
            'kind' => 'video', 'mime' => 'video/mp4', 'name' => 'clip.mp4',
            'path' => 'assets/test/'.fake()->uuid().'.mp4',
            'width' => $width, 'height' => $height, 'duration' => $duration, 'size' => 8_000_000,
        ]);
    }

    public function sized(int $width, int $height): static
    {
        return $this->state(fn () => ['width' => $width, 'height' => $height]);
    }
}
