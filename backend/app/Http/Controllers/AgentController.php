<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\PublishingRun;
use App\Services\Publishing\Publisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The agent API: how the automation service (the Python dev) works its phones. Bearer-token
 * auth (EnsureAgentToken). The loop is: ask for the next job on your phone, drive it with the
 * phone-control API, report steps and screenshots as you go, then finish — with proof, with
 * a failure, or honestly uncertain.
 */
class AgentController extends Controller
{
    /**
     * The agent says which phones it can drive right now. New ones appear on the Phones page as
     * HTTP phones (named by their model, renameable), known ones are marked seen; the address of
     * the agent's live view is kept so the dashboard can open it.
     */
    public function hello(Request $request): JsonResponse
    {
        $data = $request->validate([
            'phones' => ['present', 'array', 'max:50'],
            'phones.*.ref' => ['required', 'string', 'max:120'],
            'phones.*.name' => ['nullable', 'string', 'max:80'],
            'phones.*.model' => ['nullable', 'string', 'max:80'],
            'phones.*.android' => ['nullable', 'string', 'max:20'],
            'phones.*.width' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'phones.*.height' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'phones.*.kind' => ['nullable', Rule::in(['adb', 'emulator', 'simulator', 'remote'])],
            'mirror_url' => ['nullable', 'url', 'max:200'],
            'agent' => ['nullable', 'array'],
            'agent.host' => ['nullable', 'string', 'max:120'],
            'agent.os' => ['nullable', 'string', 'max:40'],
            'agent.version' => ['nullable', 'string', 'max:20'],
            'agent.adb' => ['nullable', 'boolean'],
            'agent.scrcpy' => ['nullable', 'boolean'],
        ]);
        $user = $request->user();
        // The agent itself, so the Phones page knows where to scan even before any phone exists.
        // Merged into what's there, so what FlowAI keeps about the agent (hidden phones) survives.
        $user->forceFill(['agent' => array_merge($user->agent ?? [], $data['agent'] ?? [], [
            'url' => $data['mirror_url'] ?? null,
            'seen_at' => now()->toIso8601ZuluString(),
        ])])->save();

        // Phones deleted here while connected stay deleted: not registered again until shown.
        $hidden = $user->hiddenPhones();
        $phones = collect($data['phones'])->reject(fn (array $p) => in_array($p['ref'], $hidden, true))->map(function (array $p) use ($user, $data) {
            $device = $user->devices()->firstOrNew(['driver' => 'http', 'ref' => $p['ref']]);
            $device->name ??= $p['name'] ?? $p['model'] ?? $p['ref'];
            $device->status = $device->booked_run_id ? 'busy' : 'idle';
            $device->last_seen_at = now();
            $device->meta = array_merge($device->meta ?? [], array_filter([
                'model' => $p['model'] ?? null,
                'android' => $p['android'] ?? null,
                'screen' => ($p['width'] ?? 0) && ($p['height'] ?? 0) ? [$p['width'], $p['height']] : null,
                'kind' => $p['kind'] ?? 'adb',
                'mirror_url' => $data['mirror_url'] ?? null,
            ], fn ($v) => $v !== null));
            $device->save();

            return ['ref' => $device->ref, 'id' => $device->id, 'name' => $device->name, 'paused' => $device->isPaused()];
        });

        return response()->json(['phones' => $phones->values()]);
    }

    /** An idle phone's screen, so the Phones page shows what it's on between runs. */
    public function screen(Request $request, string $ref): JsonResponse
    {
        $device = $request->user()->devices()->where('driver', 'http')->where('ref', $ref)->first();
        abort_unless($device, 404, 'No HTTP phone of yours has that device ID.');
        $request->validate(['file' => ['required', 'image', 'max:10240']]);
        $path = "devices/{$device->user_id}/{$device->id}/screen.png";
        Storage::disk('local')->put($path, (string) file_get_contents($request->file('file')->getRealPath()));
        // During a run the run's own screenshots are the ones that count.
        if (! $device->booked_run_id) {
            $device->update(['last_screenshot' => $path]);
        }
        $device->update(['last_seen_at' => now()]);

        return response()->json(['ok' => true]);
    }

    /** The run booked on one of the caller's phones, with everything needed to drive it. 204 when idle. */
    public function nextJob(Request $request, Publisher $publisher): JsonResponse
    {
        $device = $request->user()->devices()->where('driver', 'http')->where('ref', $request->query('device_ref'))->first();
        abort_unless($device, 404, 'No HTTP phone of yours has that device ID.');
        $job = $publisher->nextJob($device);

        return $job ? response()->json($job) : response()->json(null, 204);
    }

    /** Steps as they happen; each call is also the run's heartbeat against the sweep. */
    public function steps(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        abort_unless($run->isRunning(), 409, 'This run already ended.');
        abort_if(count($run->steps ?? []) + count($request->input('steps', [])) > (int) config('publishing.step_budget'), 422, 'Step budget exceeded (R7). End the run.');
        $data = $request->validate([
            'steps' => ['required', 'array', 'min:1'],
            'steps.*.action' => ['required', 'string', 'max:60'],
            'steps.*.ok' => ['required', 'boolean'],
            'steps.*.ms' => ['required', 'integer', 'min:0', 'max:600000'],
            'steps.*.note' => ['nullable', 'string', 'max:200'],
        ]);
        $publisher->addSteps($run, $data['steps']);

        return response()->json(['steps' => count($run->steps ?? [])]);
    }

    /** A screenshot: kept as evidence, and shown as the phone's latest on the Devices page. */
    public function screenshot(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        abort_unless($run->isRunning(), 409, 'This run already ended.');
        $request->validate(['file' => ['required', 'image', 'max:10240']]);
        $asset = $publisher->attachScreenshot($run, (string) file_get_contents($request->file('file')->getRealPath()), $request->file('file')->getMimeType() ?? 'image/png');

        return response()->json(['asset_id' => $asset->id, 'url' => "/api/assets/{$asset->id}/file"], 201);
    }

    /**
     * End the run. confirmed needs proof (a post URL, or a screenshot already uploaded);
     * uncertain is the honest answer when the command was sent but nothing confirms it.
     */
    public function finish(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        $data = $request->validate([
            'outcome' => ['required', Rule::in(['confirmed', 'failed', 'uncertain'])],
            'post_url' => ['nullable', 'url', 'max:500'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        abort_if($data['outcome'] === 'confirmed' && ! ($data['post_url'] ?? null) && ! $run->screenshot_id, 422, 'Confirmed needs proof: a post_url, or upload a screenshot first.');
        $publisher->finish($run, $data['outcome'], $data['post_url'] ?? null, $data['note'] ?? null);

        return response()->json(['outcome' => $run->fresh()->status]);
    }

    /** The media for a job, so it can be copied to the phone before the job starts. */
    public function assetFile(Request $request, Asset $asset): BinaryFileResponse
    {
        abort_unless($asset->user()->is($request->user()), 404);

        return response()->file(Storage::disk('local')->path($asset->path), ['Content-Type' => $asset->mime]);
    }

    private function ownRun(Request $request, PublishingRun $run): void
    {
        abort_unless($run->user()->is($request->user()), 404);
    }
}
