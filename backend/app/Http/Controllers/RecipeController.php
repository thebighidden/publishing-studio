<?php

namespace App\Http\Controllers;

use App\Http\Resources\GenerationResource;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\Models\Recipes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RecipeController extends Controller
{
    /**
     * Start a media recipe. Its later steps start on their own as each one finishes.
     */
    public function run(Request $request, string $recipe, Recipes $recipes, ModelRegistry $models): JsonResponse
    {
        $definition = $recipes->all()[$recipe] ?? abort(404);
        $user = $request->user();
        $available = fn (string $kind) => collect($models->all($kind))->where('available', true)->reject(fn (array $m) => $m['capabilities']->upscale ?? false)->pluck('id')->all();
        $needs = fn (string $kind) => in_array($kind, $definition['steps'], true);

        $data = $request->validate([
            'prompt' => ['required', 'string', 'max:2000'],
            'motion' => ['nullable', 'string', 'max:1000'],
            'image_model' => [$needs('image') ? 'required' : 'nullable', Rule::in($available('image'))],
            'video_model' => [$needs('video') ? 'required' : 'nullable', Rule::in($available('video'))],
            'asset_id' => [$definition['needs'] ? 'required' : 'nullable', Rule::exists('assets', 'id')->where('user_id', $user->id)->where('kind', 'image')],
            'aspect_ratio' => ['nullable', 'string', 'max:8'],
            'duration' => ['nullable', 'integer', 'min:2', 'max:15'],
            'project_id' => ['nullable', Rule::exists('projects', 'id')->where('user_id', $user->id)],
        ], [
            'image_model.required' => 'Pick an image model. If none is listed, set one up under Models.',
            'video_model.required' => 'Pick a video model. If none is listed, set one up under Models.',
            'image_model.in' => 'That image model isn’t available.',
            'video_model.in' => 'That video model isn’t available.',
            'asset_id.required' => 'Pick the image to start from.',
        ]);

        return GenerationResource::make($recipes->start($user, $recipe, $data))->response()->setStatusCode(201);
    }
}
