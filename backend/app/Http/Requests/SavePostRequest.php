<?php

namespace App\Http\Requests;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Enums\PostStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class SavePostRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // Picking a time by hand means it has to be in the future; the queue picks its own.
        $scheduling = $this->input('status') === PostStatus::Scheduled->value && ! $this->boolean('queue');

        return [
            'title' => ['nullable', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:5000'],
            'format' => ['required', Rule::enum(PostFormat::class)],
            'platforms' => ['required', 'array', 'min:1'],
            'platforms.*' => ['distinct', Rule::enum(Platform::class)],
            'status' => ['required', Rule::enum(PostStatus::class)],
            'queue' => ['sometimes', 'boolean'],
            'scheduled_at' => $scheduling ? ['required', 'date', 'after:now'] : ['nullable', 'date'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'platforms.required' => 'Pick at least one platform.',
            'platforms.min' => 'Pick at least one platform.',
            'scheduled_at.required' => 'Pick a date and time to publish.',
            'scheduled_at.after' => 'That time has already passed. Pick one in the future.',
        ];
    }

    /**
     * A post has to fit the strictest network it's going to.
     *
     * @return array<int, callable>
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $length = mb_strlen((string) $this->input('body'));

                foreach ((array) $this->input('platforms') as $value) {
                    $platform = Platform::tryFrom((string) $value);

                    if ($platform && $length > $platform->characterLimit()) {
                        $validator->errors()->add(
                            'body',
                            "{$platform->label()} allows {$platform->characterLimit()} characters. This post has {$length}."
                        );
                    }
                }
            },
        ];
    }
}
