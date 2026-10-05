<?php

namespace Database\Factories;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\Post;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Post>
 */
class PostFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => fake()->sentence(4),
            'body' => fake()->sentence(18),
            'format' => PostFormat::Text,
            'platforms' => [Platform::LinkedIn->value],
            'status' => PostStatus::Draft,
        ];
    }

    public function scheduled(?\DateTimeInterface $at = null): static
    {
        return $this->state(fn () => [
            'status' => PostStatus::Scheduled,
            'scheduled_at' => $at ?? now()->addDay(),
        ]);
    }

    public function published(): static
    {
        return $this->state(fn () => [
            'status' => PostStatus::Published,
            'scheduled_at' => now()->subDay(),
            'published_at' => now()->subDay(),
        ]);
    }
}
