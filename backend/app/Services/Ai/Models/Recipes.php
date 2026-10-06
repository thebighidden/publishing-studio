<?php

namespace App\Services\Ai\Models;

use App\Jobs\RunGeneration;
use App\Models\Generation;
use App\Models\User;

/**
 * Four ready-made media pipelines. Each step is a generation; when one succeeds its output
 * becomes the next step's input, so a recipe runs to the end on its own.
 */
class Recipes
{
    /**
     * steps: the kind each step makes. needs: an input image to start from.
     *
     * @return array<string, array{label: string, body: string, needs: string|null, steps: list<string>}>
     */
    public function all(): array
    {
        return [
            'text_to_image' => ['label' => 'Text → image', 'body' => 'Describe it; get a photo or graphic.', 'needs' => null, 'steps' => ['image']],
            'image_to_video' => ['label' => 'Image → video', 'body' => 'Bring a still to life with a few seconds of motion.', 'needs' => 'image', 'steps' => ['video']],
            'text_to_video' => ['label' => 'Text → image → video', 'body' => 'An image from your prompt, then a clip that starts from it.', 'needs' => null, 'steps' => ['image', 'video']],
            'product_scene' => ['label' => 'Product → new scene', 'body' => 'Keep the product exactly as it is; change everything around it.', 'needs' => 'image', 'steps' => ['image']],
        ];
    }

    /**
     * @param  array{prompt: string, motion?: string|null, image_model?: string|null, video_model?: string|null, asset_id?: int|null, aspect_ratio?: string|null, duration?: int|null, project_id?: int|null}  $input
     */
    public function start(User $user, string $recipe, array $input): Generation
    {
        $steps = $this->all()[$recipe]['steps'];
        $kind = $steps[0];
        $prompt = $recipe === 'product_scene'
            ? "Place this exact product in a new scene: {$input['prompt']}. Keep the product's shape, label, colours and proportions identical; change only the setting, light and props."
            : $input['prompt'];

        $generation = $user->generations()->create([
            'project_id' => $input['project_id'] ?? null,
            'kind' => $kind,
            'model' => $kind === 'video' ? $input['video_model'] : $input['image_model'],
            'prompt' => $kind === 'video' ? ($input['motion'] ?? $input['prompt']) : $prompt,
            'params' => array_filter([
                'aspect_ratio' => $input['aspect_ratio'] ?? null,
                'duration' => $input['duration'] ?? null,
                // What later steps will need.
                'motion' => $input['motion'] ?? null,
                'video_model' => $input['video_model'] ?? null,
            ], fn ($v) => $v !== null),
            'input_asset_ids' => isset($input['asset_id']) ? [(int) $input['asset_id']] : null,
            'recipe' => $recipe,
            'recipe_step' => 0,
        ]);
        RunGeneration::dispatch($generation->id);

        return $generation;
    }

    /**
     * A recipe step finished: start the next one from its output.
     */
    public function advance(Generation $done): ?Generation
    {
        $steps = $done->recipe ? ($this->all()[$done->recipe]['steps'] ?? []) : [];
        $next = ($done->recipe_step ?? 0) + 1;
        if (! isset($steps[$next])) {
            return null;
        }

        $generation = $done->user->generations()->create([
            'project_id' => $done->project_id,
            'kind' => $steps[$next],
            'model' => $done->params['video_model'],
            'prompt' => $done->params['motion'] ?? 'Slow, gentle camera movement; keep the subject as it is.',
            'params' => array_filter(['duration' => $done->params['duration'] ?? null], fn ($v) => $v !== null),
            'input_asset_ids' => array_slice($done->output_asset_ids ?? [], 0, 1),
            'recipe' => $done->recipe,
            'recipe_step' => $next,
            'parent_id' => $done->id,
        ]);
        RunGeneration::dispatch($generation->id);

        return $generation;
    }
}
