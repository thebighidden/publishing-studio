<?php

namespace App\Http\Requests\Auth;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique(User::class)],
            'password' => ['required', 'string', Password::defaults()],
            'timezone' => ['nullable', 'timezone:all'],
            'platforms' => ['array'],
            'platforms.*' => ['distinct', Rule::enum(Platform::class)],
            'formats' => ['array'],
            'formats.*' => ['distinct', Rule::enum(PostFormat::class)],
            'terms' => ['accepted'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'email.unique' => 'There’s already an account with this email. Try logging in instead.',
            'terms.accepted' => 'Please accept the terms to continue.',
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge(['email' => mb_strtolower(trim((string) $this->input('email')))]);
    }
}
