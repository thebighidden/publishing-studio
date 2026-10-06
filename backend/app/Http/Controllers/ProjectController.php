<?php

namespace App\Http\Controllers;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Studio projects: a named canvas you arrange by hand.
 */
class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json($request->user()->projects()->withCount('generations')->latest('updated_at')->get()
            ->map(fn (Project $p) => $this->summary($p)));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:80']]);
        $project = $request->user()->projects()->create($data + ['canvas' => ['nodes' => [], 'edges' => [], 'view' => ['x' => 0, 'y' => 0, 'zoom' => 1]]]);

        return response()->json($this->full($project), 201);
    }

    public function show(Project $project): JsonResponse
    {
        Gate::authorize('view', $project);

        return response()->json($this->full($project));
    }

    /**
     * Rename, or save the canvas (the page saves a moment after every change).
     */
    public function update(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('update', $project);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:80'],
            'canvas' => ['sometimes', 'array'],
            'canvas.nodes' => ['present_with:canvas', 'array', 'max:400'],
            'canvas.nodes.*.id' => ['required', 'string', 'max:40'],
            'canvas.nodes.*.type' => ['required', 'in:note,text,asset,generation'],
            'canvas.nodes.*.x' => ['required', 'numeric'],
            'canvas.nodes.*.y' => ['required', 'numeric'],
            'canvas.nodes.*.text' => ['nullable', 'string', 'max:20000'],
            'canvas.nodes.*.ref' => ['nullable', 'integer'],
            'canvas.edges' => ['nullable', 'array', 'max:800'],
            'canvas.view' => ['nullable', 'array'],
        ]);
        $project->update($data);

        return response()->json($this->full($project));
    }

    public function destroy(Project $project): Response
    {
        Gate::authorize('delete', $project);
        $project->delete();

        return response()->noContent();
    }

    private function summary(Project $p): array
    {
        return [
            'id' => $p->id,
            'name' => $p->name,
            'nodes' => count($p->canvas['nodes'] ?? []),
            'generations' => $p->generations_count ?? $p->generations()->count(),
            'updated_at' => $p->updated_at?->toIso8601ZuluString(),
        ];
    }

    private function full(Project $p): array
    {
        return $this->summary($p) + ['canvas' => $p->canvas ?? ['nodes' => [], 'edges' => [], 'view' => ['x' => 0, 'y' => 0, 'zoom' => 1]]];
    }
}
