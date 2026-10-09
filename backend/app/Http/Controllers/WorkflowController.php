<?php

namespace App\Http\Controllers;

use App\Models\Workflow;
use App\Models\WorkflowRun;
use App\Services\Ai\Workflows\WorkflowRunner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Workflows in the Creative Lab: save a chain of steps, run it (saved or not), watch its runs,
 * and pick a failed run up again where it stopped.
 */
class WorkflowController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $request->user()->workflows()->latest('updated_at')->get()->map(fn (Workflow $w) => $this->summary($w)),
            'templates' => WorkflowRunner::TEMPLATES,
            'types' => collect(WorkflowRunner::TYPES)->map(fn (array $t, string $id) => ['id' => $id] + $t)->values(),
        ]);
    }

    public function store(Request $request, WorkflowRunner $runner): JsonResponse
    {
        $data = $this->validated($request, $runner);
        $workflow = $request->user()->workflows()->create($data);

        return response()->json($this->summary($workflow), 201);
    }

    public function update(Request $request, Workflow $workflow, WorkflowRunner $runner): JsonResponse
    {
        abort_unless($workflow->user_id === $request->user()->id, 404);
        $workflow->update($this->validated($request, $runner));

        return response()->json($this->summary($workflow));
    }

    public function destroy(Request $request, Workflow $workflow): Response
    {
        abort_unless($workflow->user_id === $request->user()->id, 404);
        $workflow->delete();

        return response()->noContent();
    }

    /** Run a chain: the steps as they are in the builder, saved or not. */
    public function run(Request $request, WorkflowRunner $runner): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:80'],
            'workflow_id' => ['nullable', Rule::exists('workflows', 'id')->where('user_id', $user->id)],
            'steps' => ['required', 'array'],
            'prompt' => ['nullable', 'string', 'max:2000'],
            'start_asset_id' => ['nullable', Rule::exists('assets', 'id')->where('user_id', $user->id)->where('kind', 'image')],
            'board_id' => ['nullable', Rule::exists('boards', 'id')->where('user_id', $user->id)],
        ]);
        $steps = $runner->normalize($data['steps'], startsFromImage: isset($data['start_asset_id']));
        $usesPrompt = str_contains(json_encode($steps), '{prompt}') || collect($steps)->contains(fn ($s) => in_array($s['type'], ['write', 'voice'], true));
        if ($usesPrompt && blank($data['prompt'] ?? null)) {
            return response()->json(['message' => 'Describe what to make.', 'errors' => ['prompt' => ['Describe what to make.']]], 422);
        }

        $run = $runner->start($user, $steps, $data['name'] ?? 'Workflow', $data['prompt'] ?? null,
            isset($data['start_asset_id']) ? $user->assets()->find($data['start_asset_id']) : null, $data['board_id'] ?? null, $data['workflow_id'] ?? null);

        return response()->json($run->fresh()->summary(), 201);
    }

    public function runs(Request $request): JsonResponse
    {
        return response()->json(
            WorkflowRun::where('user_id', $request->user()->id)->latest('id')->limit(20)->get()->map->summary(),
        );
    }

    public function resume(Request $request, WorkflowRun $run, WorkflowRunner $runner): JsonResponse
    {
        abort_unless($run->user_id === $request->user()->id, 404);
        abort_unless($run->status === 'failed', 422, 'Only a failed run can be picked up again.');
        $runner->resume($run);

        return response()->json($run->fresh()->summary());
    }

    /**
     * @return array{name: string, steps: list<array<string, mixed>>}
     */
    private function validated(Request $request, WorkflowRunner $runner): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'steps' => ['required', 'array'],
            'starts_from_image' => ['nullable', 'boolean'],
        ], ['name.required' => 'Name the workflow.']);

        return ['name' => $data['name'], 'steps' => $runner->normalize($data['steps'], (bool) ($data['starts_from_image'] ?? false))];
    }

    /**
     * @return array<string, mixed>
     */
    private function summary(Workflow $w): array
    {
        return ['id' => $w->id, 'name' => $w->name, 'steps' => $w->steps, 'updated_at' => $w->updated_at?->toIso8601ZuluString()];
    }
}
