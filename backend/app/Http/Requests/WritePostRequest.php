<?php

namespace App\Http\Requests;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Services\Ai\PostPrompt;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class WritePostRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'brief' => ['required', 'string', 'max:2000'],
            'draft' => ['nullable', 'string', 'max:5000'],
            'format' => ['required', Rule::enum(PostFormat::class)],
            'platforms' => ['required', 'array', 'min:1'],
            'platforms.*' => ['distinct', Rule::enum(Platform::class)],
            'tone' => ['nullable', Rule::in(PostPrompt::TONES)],
            'model' => ['nullable', Rule::in(array_keys(config('ai.models')))],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'brief.required' => 'Say what the post should be about.',
            'platforms.required' => 'Pick at least one platform.',
            'platforms.min' => 'Pick at least one platform.',
        ];
    }

    public function prompt(): PostPrompt
    {
        return new PostPrompt(
            brief: $this->string('brief')->value(),
            format: $this->enum('format', PostFormat::class),
            platforms: array_values(array_map(fn (string $p) => Platform::from($p), $this->input('platforms'))),
            tone: $this->input('tone'),
            draft: $this->input('draft'),
        );
    }

    public function model(): string
    {
        return $this->input('model') ?? array_key_first(config('ai.models'));
    }
}
