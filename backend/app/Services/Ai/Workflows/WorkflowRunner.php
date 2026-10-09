<?php

namespace App\Services\Ai\Workflows;

use App\Enums\Platform;
use App\Enums\PostStatus;
use App\Http\Controllers\GenerationController;
use App\Jobs\AdvanceWorkflow;
use App\Jobs\RunGeneration;
use App\Models\Asset;
use App\Models\Generation;
use App\Models\User;
use App\Models\WorkflowRun;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Runs a workflow: a chain of Creative Lab steps, one after another, each starting from what the
 * steps before it made. Media steps are ordinary generations (so they show in the queue and land
 * in the library); when one settles, the next step starts. Writing and drafting the post happen
 * in the worker directly.
 *
 * In prompts, {prompt} is what the run was started with and {caption} the latest text written.
 */
class WorkflowRunner
{
    public const MAX_STEPS = 8;

    /** What each step makes, and its label. */
    public const TYPES = [
        'image' => ['kind' => 'image', 'label' => 'Generate image'],
        'upscale' => ['kind' => 'image', 'label' => 'Upscale'],
        'video' => ['kind' => 'video', 'label' => 'Animate to video'],
        'voice' => ['kind' => 'audio', 'label' => 'Voiceover'],
        'write' => ['kind' => 'text', 'label' => 'Write caption'],
        'post' => ['kind' => null, 'label' => 'Post draft'],
    ];

    /** Ready-made chains to start from; models are filled in with ones that can run. */
    public const TEMPLATES = [
        ['name' => 'Product reel', 'body' => 'A photo, sharpened, brought to life, captioned and drafted as a post.', 'steps' => [
            ['type' => 'image', 'prompt' => '{prompt}', 'aspect_ratio' => '9:16'],
            ['type' => 'upscale', 'scale' => 2],
            ['type' => 'video', 'prompt' => 'Slow, gentle camera push in; keep the subject exactly as it is', 'duration' => 5],
            ['type' => 'write', 'prompt' => 'Write a short Instagram Reel caption with a strong first line for: {prompt}'],
            ['type' => 'post'],
        ]],
        ['name' => 'Narrated clip', 'body' => 'An image animated into a clip, a script written for it, and the voiceover read.', 'steps' => [
            ['type' => 'image', 'prompt' => '{prompt}', 'aspect_ratio' => '9:16'],
            ['type' => 'video', 'prompt' => 'Smooth cinematic motion that brings the scene to life', 'duration' => 5],
            ['type' => 'write', 'prompt' => 'Write a 2-sentence voiceover script, warm and spoken, for a short video about: {prompt}'],
            ['type' => 'voice', 'script' => '{caption}'],
        ]],
        ['name' => 'Print-ready photo', 'body' => 'Generate, then upscale 4× for print or a large hero banner.', 'steps' => [
            ['type' => 'image', 'prompt' => '{prompt}', 'aspect_ratio' => '1:1'],
            ['type' => 'upscale', 'scale' => 4],
        ]],
        ['name' => 'Caption a photo', 'body' => 'Start from one of your photos: upscale it, write the caption, draft the post.', 'needs_image' => true, 'steps' => [
            ['type' => 'upscale', 'scale' => 2],
            ['type' => 'write', 'prompt' => 'Write a short, friendly social caption for: {prompt}'],
            ['type' => 'post'],
        ]],
    ];

    public function __construct(private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    /**
     * Check a chain and return it tidied: only the fields each step uses. Also walks it, so a step
     * that needs an image is refused unless one comes before it.
     *
     * @param  array<int, mixed>  $steps
     * @return list<array<string, mixed>>
     *
     * @throws ValidationException
     */
    public function normalize(array $steps, bool $startsFromImage = false): array
    {
        $registry = collect($this->models->all())->keyBy('id');
        Validator::make(['steps' => $steps], [
            'steps' => ['required', 'array', 'min:1', 'max:'.self::MAX_STEPS],
            'steps.*.type' => ['required', Rule::in(array_keys(self::TYPES))],
            'steps.*.model' => ['nullable', 'string', 'max:200'],
            'steps.*.prompt' => ['nullable', 'string', 'max:2000'],
            'steps.*.script' => ['nullable', 'string', 'max:4000'],
            'steps.*.aspect_ratio' => ['nullable', 'string', 'max:8'],
            'steps.*.duration' => ['nullable', 'integer', 'min:2', 'max:30'],
            'steps.*.scale' => ['nullable', Rule::in([2, 4])],
            'steps.*.voice' => ['nullable', 'string', 'max:64'],
            'steps.*.use_previous' => ['nullable', 'boolean'],
            'steps.*.platforms' => ['nullable', 'array'],
            'steps.*.platforms.*' => [Rule::enum(Platform::class)],
        ], ['steps.min' => 'Add at least one step.', 'steps.max' => 'A workflow can have up to '.self::MAX_STEPS.' steps.'])->validate();

        $errors = [];
        $hasImage = $startsFromImage;
        $out = [];
        foreach (array_values($steps) as $i => $s) {
            $type = $s['type'];
            $label = 'Step '.($i + 1).' ('.self::TYPES[$type]['label'].')';
            $model = $registry->get($s['model'] ?? '');
            $caps = $model['capabilities'] ?? null;
            if ($type !== 'post') {
                $kind = self::TYPES[$type]['kind'];
                $upscaler = (bool) ($caps->upscale ?? false);
                if (! $model || $model['kind'] !== $kind || $upscaler !== ($type === 'upscale')) {
                    $errors["steps.{$i}.model"] = "{$label}: pick a ".($type === 'upscale' ? 'upscaler' : "{$kind} model").'.';
                }
            }
            if ($type === 'upscale' && ! $hasImage) {
                $errors["steps.{$i}.type"] = "{$label} needs an image before it: add Generate image first, or start from one of your photos.";
            }
            if ($type === 'video' && ($caps->requires_image ?? false) && ! $hasImage) {
                $errors["steps.{$i}.type"] = "{$label}: {$model['label']} starts from an image, so put Generate image before it.";
            }
            if (in_array($type, ['image', 'upscale'], true)) {
                $hasImage = true;
            }

            $out[] = array_filter([
                'type' => $type,
                'model' => $type === 'post' ? null : ($s['model'] ?? null),
                'prompt' => in_array($type, ['image', 'video', 'write'], true) ? trim((string) ($s['prompt'] ?? '')) ?: ($type === 'write' ? 'Write a short social caption for: {prompt}' : '{prompt}') : null,
                'script' => $type === 'voice' ? trim((string) ($s['script'] ?? '')) ?: '{caption}' : null,
                'aspect_ratio' => in_array($type, ['image', 'video'], true) ? ($s['aspect_ratio'] ?? null) : null,
                'duration' => $type === 'video' ? ($s['duration'] ?? null) : null,
                'scale' => $type === 'upscale' ? (int) ($s['scale'] ?? 2) : null,
                'voice' => $type === 'voice' ? ($s['voice'] ?? null) : null,
                'use_previous' => $type === 'image' ? (bool) ($s['use_previous'] ?? false) : null,
                'platforms' => $type === 'post' ? array_values($s['platforms'] ?? []) : null,
            ], fn ($v) => $v !== null && $v !== []);
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $steps  already normalized
     */
    public function start(User $user, array $steps, string $name, ?string $prompt, ?Asset $start = null, ?int $boardId = null, ?int $workflowId = null): WorkflowRun
    {
        // Every model has to be able to run now, not just exist.
        foreach ($steps as $i => $s) {
            $model = isset($s['model']) ? $this->models->find($s['model']) : null;
            if ($model && ! $model['available']) {
                throw ValidationException::withMessages(["steps.{$i}.model" => 'Step '.($i + 1).": {$model['label']} isn’t available: {$model['reason']}"]);
            }
        }

        $run = WorkflowRun::forceCreate([
            'user_id' => $user->id, 'workflow_id' => $workflowId, 'name' => $name, 'steps' => $steps,
            'prompt' => $prompt, 'start_asset_id' => $start?->id, 'board_id' => $boardId, 'status' => 'running', 'step' => 0, 'outputs' => [],
        ]);
        AdvanceWorkflow::dispatch($run->id);

        return $run;
    }

    /** Pick a failed run up again at the step that failed. */
    public function resume(WorkflowRun $run): void
    {
        $outputs = $run->outputs ?? [];
        unset($outputs[$run->step]);
        $run->update(['status' => 'running', 'error' => null, 'finished_at' => null, 'outputs' => $outputs]);
        AdvanceWorkflow::dispatch($run->id);
    }

    /**
     * Start the current step. Writing and posting finish here and the run moves straight on;
     * media steps start a generation and the run waits for it.
     */
    public function advance(WorkflowRun $run): void
    {
        try {
            while ($run->status === 'running') {
                $i = $run->step;
                $step = $run->steps[$i] ?? null;
                if (! $step) {
                    $run->update(['status' => 'succeeded', 'finished_at' => now()]);

                    return;
                }
                if (in_array($step['type'], ['write', 'post'], true)) {
                    $this->record($run, $i, $step['type'] === 'write' ? $this->write($run, $step) : $this->post($run, $step), next: true);

                    continue;
                }
                // Note which generation the run waits on before it starts: it can finish at once.
                $generation = $this->media($run, $step);
                $this->record($run, $i, ['generation_id' => $generation->id]);
                RunGeneration::dispatch($generation->id);

                return;
            }
        } catch (GenerationFailed $e) {
            $this->fail($run, $e->getMessage());
        } catch (Throwable $e) {
            report($e);
            $this->fail($run, 'Something went wrong on this step. Try it again.');
        }
    }

    /**
     * A step's generation finished: keep what it made and start the next step, or stop the run.
     */
    public function settled(Generation $generation): void
    {
        $run = WorkflowRun::find($generation->workflow_run_id);
        if (! $run || $run->status !== 'running' || ($run->outputs[$run->step]['generation_id'] ?? null) !== $generation->id) {
            return;
        }
        if ($generation->status === 'failed') {
            $this->fail($run, $generation->error ?? 'The model couldn’t make it.');

            return;
        }
        $this->record($run, $run->step, ['generation_id' => $generation->id, 'assets' => $generation->output_asset_ids ?? []], next: true);
        AdvanceWorkflow::dispatch($run->id);
    }

    /* ------------------------------------------------------------------ */

    /**
     * @param  array<string, mixed>  $step
     */
    private function media(WorkflowRun $run, array $step): Generation
    {
        $image = $this->latest($run, ['image']);
        $model = $this->models->find($step['model']) ?? throw new GenerationFailed('That model isn’t set up any more.');
        [$kind, $prompt, $params, $inputs] = match ($step['type']) {
            'image' => ['image', $this->fill($run, $step['prompt']), array_filter(['aspect_ratio' => $step['aspect_ratio'] ?? null]),
                ($step['use_previous'] ?? false) && $image && ($model['capabilities']->max_inputs ?? 0) > 0 ? [$image->id] : null],
            'upscale' => ['image', "Upscale {$step['scale']}×", ['mode' => 'upscale', 'scale' => $step['scale']],
                [($image ?? throw new GenerationFailed('There’s no image to upscale yet.'))->id]],
            'video' => ['video', $this->fill($run, $step['prompt']), array_filter(['duration' => $step['duration'] ?? null, 'aspect_ratio' => $step['aspect_ratio'] ?? null]),
                $image ? [$image->id] : null],
            'voice' => ['audio', $this->fill($run, $step['script']), array_filter(['voice' => $step['voice'] ?? null, 'format' => 'mp3']), null],
        };

        return $run->user->generations()->create([
            'kind' => $kind, 'model' => $step['model'], 'prompt' => mb_substr($prompt, 0, 4000), 'params' => $params,
            'input_asset_ids' => $inputs, 'status' => 'queued', 'board_id' => $run->board_id, 'workflow_run_id' => $run->id,
        ]);
    }

    /**
     * @param  array<string, mixed>  $step
     * @return array<string, mixed>
     */
    private function write(WorkflowRun $run, array $step): array
    {
        [$generator, $name] = $this->models->text($step['model']);
        $generation = $run->user->generations()->create([
            'kind' => 'text', 'model' => $step['model'], 'prompt' => $this->fill($run, $step['prompt']),
            'status' => 'running', 'started_at' => now(), 'workflow_run_id' => $run->id,
        ]);
        $text = '';
        $this->usage->push($run->user, $generation, 'studio');
        try {
            foreach ($generator->stream($name, GenerationController::TEXT_SYSTEM, $generation->prompt) as $chunk) {
                $text .= $chunk;
            }
        } catch (GenerationFailed $e) {
            $generation->update(['status' => 'failed', 'error' => $e->getMessage(), 'finished_at' => now()]);
            throw $e;
        } finally {
            $this->usage->pop();
        }
        $generation->update(['status' => 'succeeded', 'output_text' => trim($text), 'finished_at' => now()]);

        return ['generation_id' => $generation->id, 'text' => trim($text)];
    }

    /**
     * A draft post with the latest picture or clip and the latest caption. Drafts only: nothing
     * is scheduled or published without someone looking at it.
     *
     * @param  array<string, mixed>  $step
     * @return array<string, mixed>
     */
    private function post(WorkflowRun $run, array $step): array
    {
        $user = $run->user;
        $visual = $this->latest($run, ['video', 'image']);
        $post = $user->posts()->create([
            'body' => mb_substr($this->caption($run) ?? (string) $run->prompt, 0, 5000) ?: 'Made in Creative Lab',
            'format' => $visual?->kind ?? 'text',
            'platforms' => ($step['platforms'] ?? null) ?: (($user->preferences['platforms'] ?? null) ?: ['instagram']),
            'status' => PostStatus::Draft,
        ]);
        if ($visual) {
            $post->syncAssets([$visual->id]);
        }

        return ['post_id' => $post->id];
    }

    /**
     * @param  array<string, mixed>  $output
     */
    private function record(WorkflowRun $run, int $i, array $output, bool $next = false): void
    {
        $outputs = $run->outputs ?? [];
        $outputs[$i] = $output + ($next ? ['done' => true] : []);
        $run->update(['outputs' => $outputs, 'step' => $next ? $i + 1 : $i]);
    }

    private function fail(WorkflowRun $run, string $error): void
    {
        $run->update(['status' => 'failed', 'error' => 'Step '.($run->step + 1).' ('.(self::TYPES[$run->steps[$run->step]['type'] ?? '']['label'] ?? 'step').'): '.$error, 'finished_at' => now()]);
    }

    /**
     * The newest file of these kinds made so far in the run, or the photo it started from.
     *
     * @param  list<string>  $kinds
     */
    private function latest(WorkflowRun $run, array $kinds): ?Asset
    {
        $ids = collect($run->outputs ?? [])->sortKeys()->pluck('assets')->flatten()->filter()->reverse()->values()->all();
        if ($run->start_asset_id) {
            $ids[] = $run->start_asset_id;
        }
        foreach ($ids as $id) {
            $asset = Asset::where('user_id', $run->user_id)->find($id);
            if ($asset && in_array($asset->kind, $kinds, true)) {
                return $asset;
            }
        }

        return null;
    }

    private function caption(WorkflowRun $run): ?string
    {
        return collect($run->outputs ?? [])->sortKeys()->pluck('text')->filter()->last();
    }

    private function fill(WorkflowRun $run, string $template): string
    {
        $prompt = (string) $run->prompt;
        $text = trim(strtr($template, ['{prompt}' => $prompt, '{caption}' => $this->caption($run) ?? $prompt]));

        return $text !== '' ? $text : $prompt;
    }
}
