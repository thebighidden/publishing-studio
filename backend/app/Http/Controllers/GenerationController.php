<?php

namespace App\Http\Controllers;

use App\Http\Resources\GenerationResource;
use App\Jobs\RunGeneration;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Campaigns\Voice;
use App\Services\Media\AssetStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\StreamedEvent;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The generators: text (streamed as it's written), photos, videos and speech (queued, then polled).
 * Anything that fails can be retried as it was, on another model, or with an edited prompt.
 */
class GenerationController extends Controller
{
    public const TEXT_SYSTEM = 'You write content for a brand studio: posts, captions, scripts, hooks and ideas. Reply with the content only, in plain text: no preamble, no notes, no Markdown.';

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'kind' => ['nullable', Rule::in(Generation::KINDS)],
            'project_id' => ['nullable', 'integer'],
            'ids' => ['nullable', 'string'],
        ]);

        return GenerationResource::collection($request->user()->generations()
            ->when($filters['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->when($filters['project_id'] ?? null, fn ($q, $id) => $q->where('project_id', $id))
            ->when($filters['ids'] ?? null, fn ($q, $ids) => $q->whereIn('id', array_map('intval', explode(',', $ids))))
            ->latest('id')
            ->limit(60)
            ->get());
    }

    public function show(Generation $generation): GenerationResource
    {
        Gate::authorize('view', $generation);

        return GenerationResource::make($generation);
    }

    /**
     * A photo, video or voiceover: queued, then made by the provider in the background.
     */
    public function store(Request $request, ModelRegistry $models, AssetStore $store): JsonResponse
    {
        $data = $this->validated($request, $models);
        abort_if($data['kind'] === 'text', 422, 'Text streams from POST /generations/text.');
        if (in_array($data['params']['mode'] ?? null, ['inpaint', 'outpaint'], true)) {
            $data = $this->editInputs($request, $data, $store);
        }
        unset($data['mask'], $data['image']);

        $generation = $request->user()->generations()->create($data + ['status' => 'queued']);
        RunGeneration::dispatch($generation->id);

        return GenerationResource::make($generation)->response()->setStatusCode(201);
    }

    /**
     * Text, streamed as server-sent events: `start` (the generation's id), `delta`s, then `done`,
     * or `error` with a message to show. The result is kept either way.
     */
    public function text(Request $request, ModelRegistry $models, UsageMeter $usage): StreamedResponse|JsonResponse
    {
        $data = $this->validated($request, $models, text: true);
        $generation = $request->user()->generations()->create($data + ['kind' => 'text', 'status' => 'running', 'started_at' => now()]);

        try {
            [$generator, $name] = $models->text($data['model']);
        } catch (GenerationFailed $e) {
            $generation->update(['status' => 'failed', 'error' => $e->getMessage(), 'finished_at' => now()]);

            return response()->json(['message' => $e->getMessage(), 'generation' => GenerationResource::make($generation)], 503);
        }
        $user = $request->user();
        $account = $request->filled('account_id') ? $user->accounts()->find($request->input('account_id')) : null;
        $system = self::TEXT_SYSTEM.($account ? "\n\nWrite for this account, in its voice; its rules win over everything else:\n".app(Voice::class)->context($account) : '');

        return response()->eventStream(function () use ($generation, $generator, $name, $usage, $user, $system) {
            yield new StreamedEvent('start', ['id' => $generation->id]);
            $text = '';
            $usage->push($user, $generation, 'studio');
            try {
                foreach ($generator->stream($name, $system, $generation->prompt) as $chunk) {
                    $text .= $chunk;
                    yield new StreamedEvent('delta', ['text' => $chunk]);
                }
                $generation->update(['status' => 'succeeded', 'output_text' => trim($text), 'finished_at' => now()]);
                yield new StreamedEvent('done', ['id' => $generation->id]);
            } catch (GenerationFailed $e) {
                $generation->update(['status' => 'failed', 'error' => $e->getMessage(), 'output_text' => trim($text) ?: null, 'finished_at' => now()]);
                yield new StreamedEvent('error', ['message' => $e->getMessage(), 'id' => $generation->id]);
            } finally {
                $usage->pop();
            }
        }, endStreamWith: null);
    }

    /**
     * Try again: as it was, on another model (`model`), or with an edited prompt (`prompt`).
     * Text retries go through POST /generations/text with `retry_of`.
     */
    public function retry(Request $request, Generation $generation, ModelRegistry $models): JsonResponse
    {
        Gate::authorize('update', $generation);
        abort_if($generation->kind === 'text', 422, 'Retry text through POST /generations/text with retry_of.');

        $request->merge(['kind' => $generation->kind] + array_filter([
            'model' => $request->input('model', $generation->model),
            'prompt' => $request->input('prompt', $generation->prompt),
        ]) + ['params' => $request->input('params', $generation->params), 'input_asset_ids' => $request->input('input_asset_ids', $generation->input_asset_ids), 'project_id' => $generation->project_id, 'board_id' => $generation->board_id]);
        $data = $this->validated($request, $models);

        $retry = $request->user()->generations()->create($data + [
            'status' => 'queued', 'retry_of' => $generation->id,
            'recipe' => $generation->recipe, 'recipe_step' => $generation->recipe_step, 'parent_id' => $generation->parent_id,
        ]);
        RunGeneration::dispatch($retry->id);

        return GenerationResource::make($retry)->response()->setStatusCode(201);
    }

    public function destroy(Generation $generation): Response
    {
        Gate::authorize('delete', $generation);
        $generation->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ModelRegistry $models, bool $text = false): array
    {
        $kind = $text ? 'text' : $request->input('kind');
        $known = collect($models->all())->where('kind', $kind)->pluck('id')->all();
        $user = $request->user();

        $data = $request->validate([
            'kind' => $text ? [] : ['required', Rule::in(['image', 'video', 'audio'])],
            'model' => ['nullable', Rule::in($known)],
            'prompt' => ['required', 'string', 'max:4000'],
            'params' => ['nullable', 'array'],
            'params.aspect_ratio' => ['nullable', 'string', 'max:8'],
            'params.duration' => ['nullable', 'integer', 'min:2', 'max:30'],
            'params.resolution' => ['nullable', Rule::in(['480p', '720p', '1080p', '4k', '1k', '2k', '1K', '2K', '4K'])],
            'params.rendering_speed' => ['nullable', Rule::in(['TURBO', 'DEFAULT', 'QUALITY'])],
            'params.negative_prompt' => ['nullable', 'string', 'max:500'],
            'params.seed' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'params.batch_size' => ['nullable', 'integer', 'min:1', 'max:4'],
            'params.audio' => ['nullable', 'boolean'],
            'params.voice' => ['nullable', 'string', 'max:64'],
            'params.speed' => ['nullable', 'numeric', 'min:0.5', 'max:2'],
            'params.format' => ['nullable', Rule::in(['mp3', 'wav'])],
            'params.steps' => ['nullable', 'integer', 'min:1', 'max:100'],
            'params.guidance' => ['nullable', 'numeric', 'min:0', 'max:30'],
            // Edits: regenerate the painted area (inpaint), or also fill transparent edges (outpaint).
            'params.mode' => ['nullable', Rule::in(['inpaint', 'outpaint', 'upscale'])],
            'params.scale' => ['nullable', Rule::in([2, 4])],
            'params.strength' => ['nullable', 'numeric', 'min:0.05', 'max:1'],
            'mask' => ['nullable', 'string', 'max:25000000'],
            'image' => ['nullable', 'string', 'max:50000000'],
            'board_id' => ['nullable', Rule::exists('boards', 'id')->where('user_id', $user->id)],
            'input_asset_ids' => ['nullable', 'array', 'max:10'],
            'input_asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $user->id)],
            'project_id' => ['nullable', Rule::exists('projects', 'id')->where('user_id', $user->id)],
            'retry_of' => ['nullable', Rule::exists('generations', 'id')->where('user_id', $user->id)],
            'account_id' => ['nullable', Rule::exists('accounts', 'id')->where('user_id', $user->id)],
        ], [
            'prompt.required' => $kind === 'audio' ? 'Write the script to read.' : 'Describe what you want.',
            'model.in' => 'Pick a model that makes '.(['video' => 'videos', 'image' => 'images', 'audio' => 'speech'][$kind] ?? 'text').'.',
        ]);

        unset($data['account_id']);
        $upscaling = ($data['params']['mode'] ?? null) === 'upscale';
        $candidates = collect($models->all($kind))->filter(fn (array $m) => (bool) ($m['capabilities']->upscale ?? false) === $upscaling);
        $data['model'] ??= $kind === 'text'
            ? $models->defaultText()
            : ($candidates->firstWhere('available', true)['id'] ?? $candidates->first()['id'] ?? null);
        if (! $data['model']) {
            abort(422, 'No model can make that yet. Set one up under Models.');
        }
        $caps = $models->find($data['model'])['capabilities'] ?? null;
        $mode = $data['params']['mode'] ?? null;
        if (in_array($mode, ['inpaint', 'outpaint'], true) && ! ($caps->edit ?? false)) {
            throw ValidationException::withMessages(['model' => 'Pick a model that can edit images.']);
        }
        // Upscalers only upscale, and only upscalers do.
        if (($mode === 'upscale') !== (bool) ($caps->upscale ?? false)) {
            throw ValidationException::withMessages(['model' => $mode === 'upscale' ? 'Pick an upscaler.' : 'An upscaler needs an image to upscale: use Upscale.']);
        }
        if ($mode === 'upscale' && ! $user->assets()->where('kind', 'image')->whereKey($data['input_asset_ids'][0] ?? 0)->exists()) {
            throw ValidationException::withMessages(['input_asset_ids' => 'Pick the image to upscale.']);
        }

        return $data;
    }

    /**
     * An edit's inputs, kept as library files the generation points at: the image (as it is, or
     * padded with transparent edges to extend it) and the painted mask, same size, opaque where
     * it should change. Both are working files, hidden from the library.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function editInputs(Request $request, array $data, AssetStore $store): array
    {
        $user = $request->user();
        $mask = $this->png((string) $request->input('mask'), 'mask', 'Paint the area to change.');
        if ($request->filled('image')) {
            $image = $this->png((string) $request->input('image'), 'image', 'The image to edit didn’t come through.');
            $source = $store->fromContents($user, $image['bytes'], 'image/png', 'edit-canvas.png', 'mask');
        } else {
            $source = $user->assets()->where('kind', 'image')->find($data['input_asset_ids'][0] ?? null)
                ?? throw ValidationException::withMessages(['input_asset_ids' => 'Pick the image to edit.']);
        }
        if ([$source->width, $source->height] !== $mask['size']) {
            throw ValidationException::withMessages(['mask' => 'The painted area has to be the same size as the image.']);
        }
        $maskAsset = $store->fromContents($user, $mask['bytes'], 'image/png', 'edit-mask.png', 'mask');

        return ['input_asset_ids' => [$source->id, $maskAsset->id]] + $data;
    }

    /**
     * @return array{bytes: string, size: array{0: int, 1: int}}
     */
    private function png(string $dataUrl, string $field, string $missing): array
    {
        $bytes = preg_match('#^data:image/png;base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m) ? base64_decode($m[1], true) : false;
        $size = $bytes ? @getimagesizefromstring($bytes) : false;
        if (! $size || ($size['mime'] ?? null) !== 'image/png') {
            throw ValidationException::withMessages([$field => $missing]);
        }

        return ['bytes' => $bytes, 'size' => [$size[0], $size[1]]];
    }
}
