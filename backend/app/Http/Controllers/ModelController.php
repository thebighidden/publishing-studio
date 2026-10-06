<?php

namespace App\Http\Controllers;

use App\Jobs\RunModelEvals;
use App\Models\ModelEval;
use App\Services\Ai\Models\ModelEvals;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\Models\Recipes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The model registry: every local and cloud model, how it's reached, whether it can run,
 * its eval scores; the connectors and their tests; the media recipes.
 */
class ModelController extends Controller
{
    public function index(ModelRegistry $models, Recipes $recipes): JsonResponse
    {
        return response()->json([
            'models' => $models->all(),
            'providers' => $models->providers(),
            'recipes' => $recipes->all(),
            'default_text' => $models->defaultText(),
        ]);
    }

    public function test(string $provider, ModelRegistry $models): JsonResponse
    {
        abort_unless(in_array($provider, ModelRegistry::PROVIDERS, true), 404);
        $test = $models->test($provider);

        return response()->json(['ok' => $test->ok, 'message' => $test->message, 'latency_ms' => $test->latency_ms]);
    }

    /**
     * Start the eval suite on a text model; results land in GET /models/evals.
     */
    public function runEvals(Request $request, ModelRegistry $models): JsonResponse
    {
        $data = $request->validate(['model' => ['required', Rule::in(collect($models->all('text'))->where('available', true)->pluck('id')->all())]], [
            'model.in' => 'That model isn’t available to evaluate.',
        ]);
        RunModelEvals::dispatch($data['model'], $request->user()->id);

        return response()->json(['queued' => true], 202);
    }

    public function evals(ModelEvals $evals): JsonResponse
    {
        $latest = ModelEval::whereIn('id', ModelEval::selectRaw('max(id)')->groupBy('model', 'task'))->get();

        return response()->json([
            'tasks' => collect($evals->tasks())->map(fn ($t) => $t['label']),
            'results' => $latest->groupBy('model')->map(fn ($rows) => $rows->mapWithKeys(fn (ModelEval $e) => [$e->task => [
                'score' => $e->score, 'detail' => $e->detail, 'output' => $e->output, 'at' => $e->created_at?->toIso8601ZuluString(),
            ]])),
        ]);
    }
}
