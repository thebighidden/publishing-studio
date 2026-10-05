<?php

namespace App\Http\Controllers;

use App\Http\Requests\WritePostRequest;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\TextGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\StreamedEvent;
use Symfony\Component\HttpFoundation\StreamedResponse;

class WritingController extends Controller
{
    /**
     * Whether the composer can offer AI writing, and with which models.
     */
    public function options(TextGenerator $generator): JsonResponse
    {
        return response()->json([
            'enabled' => $generator->enabled(),
            'models' => collect(config('ai.models'))
                ->map(fn (string $label, string $id) => ['id' => $id, 'label' => $label])
                ->values(),
        ]);
    }

    /**
     * Write a post, or rewrite the draft, as server-sent events: `delta` events carry the text
     * as it's written, then one `done`, or an `error` with a message to show.
     */
    public function write(WritePostRequest $request, TextGenerator $generator): StreamedResponse|JsonResponse
    {
        if (! $generator->enabled()) {
            return response()->json(['message' => 'AI writing isn’t switched on yet.'], 503);
        }

        $prompt = $request->prompt();
        $model = $request->model();

        return response()->eventStream(function () use ($generator, $prompt, $model) {
            try {
                foreach ($generator->stream($model, $prompt->system(), $prompt->user()) as $text) {
                    yield new StreamedEvent('delta', ['text' => $text]);
                }

                yield new StreamedEvent('done', ['model' => $model]);
            } catch (GenerationFailed $e) {
                yield new StreamedEvent('error', ['message' => $e->getMessage()]);
            }
        }, endStreamWith: null);
    }
}
