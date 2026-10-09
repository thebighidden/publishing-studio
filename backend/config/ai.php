<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Model registry
    |--------------------------------------------------------------------------
    |
    | Every model the studio can use, local and cloud, in one list. Each
    | provider says how its models are reached; the model picker shows it.
    | Text models: Claude, any OpenAI-compatible gateway, Ollama on this
    | network. Images and video: Higgsfield, and gateway image models.
    | Speech: VoiceStudio (OmniVoice) on your own GPU.
    |
    | A model is offered only when it can actually run: credentials set, and
    | for Higgsfield also an API route, a place in your plan, and a connector
    | test that passed (POST /api/models/test/higgsfield).
    |
    */

    // What the composer and the generators start on.
    'default_text' => 'gateway/glm-5.3-flash',

    'providers' => [

        'anthropic' => [
            'reach' => 'Claude API',
            'local' => false,
            'models' => [
                'claude-opus-5' => ['label' => 'Claude Opus 5', 'purpose' => 'Writing and rewriting posts'],
                'claude-opus-5-5' => ['label' => 'Claude Opus 5.5', 'purpose' => 'Strategy, the agents and the content kit'],
                'claude-sonnet-5-5' => ['label' => 'Claude Sonnet 5.5', 'purpose' => 'Fast drafts, adaptations and triage'],
            ],
        ],

        // Any OpenAI-compatible endpoint: Ollama Cloud, a team gateway, OpenRouter, vLLM, LM Studio.
        // Text models are discovered from GET {url}/models; list image models by id.
        //
        // Reasoning models (glm-5.3, glm-5.3-flash, deepseek, kimi) are left on their default
        // thinking mode deliberately. Ollama Cloud accepts `think: false` and
        // `reasoning_effort: "none"` but neither stops the model reasoning — they only stop it
        // being separated out, so the monologue lands in `choices[].message.content`, in one case
        // with a literal `</think>` tag still in it. On the default, `content` holds the answer
        // alone and the reasoning stays in `message.reasoning`, which this app never reads. So
        // the default is both cleaner and the only mode that cannot leak thinking into a caption.
        //
        // To run GLM without thinking, set AI_GATEWAY_REASONING_EFFORT=low. Measured on Ollama
        // Cloud (glm-5.3-flash, 10 calls, captions and JSON): 0-19 characters of reasoning instead
        // of hundreds, clean content every time, valid JSON 5/5, about 1.5-2s a call. It applies
        // to every call on this gateway, overriding callers that ask for "medium".
        'gateway' => [
            // Whose gateway it is, for the model picker. Generic unless you say otherwise.
            'reach' => env('AI_GATEWAY_REACH', 'Gateway'),
            'url' => env('AI_GATEWAY_URL'),
            'key' => env('AI_GATEWAY_KEY'),
            // low, medium or high for every call; empty leaves each caller's choice.
            'reasoning_effort' => env('AI_GATEWAY_REASONING_EFFORT'),
            // Model-name prefixes that answer directly (e.g. gemma4): never sent reasoning_effort,
            // since any value switches their thinking on.
            'plain_models' => array_values(array_filter(array_map('trim', explode(',', (string) env('AI_GATEWAY_PLAIN_MODELS', ''))))),
            'image_models' => array_values(array_filter(explode(',', (string) env('AI_GATEWAY_IMAGE_MODELS', '')))),
            // Models the gateway serves from local hardware rather than a vendor.
            'local_models' => array_values(array_filter(explode(',', (string) env('AI_GATEWAY_LOCAL_MODELS', '')))),
        ],

        // Local models on Ollama, used through its OpenAI-compatible API.
        'ollama' => [
            'reach' => 'Ollama',
            'url' => env('OLLAMA_URL'),
            'local' => true,
        ],

        'higgsfield' => [
            'reach' => 'Higgsfield API',
            'local' => false,
            'url' => env('HIGGSFIELD_URL', 'https://api.higgsfield.ai'),
            'key_id' => env('HIGGSFIELD_KEY_ID'),
            'key_secret' => env('HIGGSFIELD_KEY_SECRET'),
            // The models your Higgsfield plan includes. Empty means every model below that has a route.
            'plan' => array_values(array_filter(explode(',', (string) env('HIGGSFIELD_PLAN', '')))),
            // Each entry mirrors the model's request schema on docs.higgsfield.ai (checked 2026-10):
            //   route         the text-to-image / text-to-video endpoint (null: none)
            //   image_route   video: the image-to-video endpoint, used when a start frame is given
            //   image_field   where input images go; image_list sends them as an array (up to max_images)
            //   end_field     video: the field for an optional last frame (the second input image)
            //   params        what the studio may pass through
            //   aspects / durations / resolutions   the values the endpoint accepts (nearest is sent)
            //   audio         'sound' ("on"/"off") or 'generate_audio' (bool); seed_range: [min, max]
            //   defaults      fixed fields sent with every request
            //   price         dollars per output, from your plan, for the usage numbers (null if unknown)
            'models' => [
                'soul-2' => ['label' => 'Soul 2', 'family' => 'Higgsfield Soul', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/v2/standard',
                    'params' => ['aspect_ratio', 'resolution', 'seed'], 'aspects' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
                    'resolutions' => ['720p', '1080p'], 'seed_range' => [1, 1000000], 'defaults' => ['resolution' => '1080p', 'batch_size' => 1], 'price' => null,
                    'purpose' => 'Photoreal fashion and editorial images with a shot-on-camera look'],
                'soul' => ['label' => 'Soul', 'family' => 'Higgsfield Soul', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/standard',
                    'image_field' => 'image_reference_url', 'params' => ['aspect_ratio', 'resolution', 'seed'], 'aspects' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
                    'resolutions' => ['720p', '1080p'], 'seed_range' => [1, 1000000], 'defaults' => ['resolution' => '1080p', 'batch_size' => 1], 'price' => null,
                    'purpose' => 'The original Soul; one reference image steers the look'],
                'soul-cinema' => ['label' => 'Soul Cinema', 'family' => 'Higgsfield Soul', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/cinema',
                    'params' => ['aspect_ratio', 'resolution', 'seed'], 'aspects' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
                    'resolutions' => ['720p', '1080p'], 'seed_range' => [1, 1000000], 'defaults' => ['resolution' => '1080p', 'batch_size' => 1], 'price' => null,
                    'purpose' => 'Cinematic stills: film lighting, lens character and grade'],
                'grok-image-2' => ['label' => 'Grok Image 2', 'family' => 'xAI Grok', 'kind' => 'image', 'route' => '/xai/grok-imagine-image-2.0',
                    'image_field' => 'image_urls', 'image_list' => true, 'max_images' => 10, 'params' => ['aspect_ratio', 'resolution'],
                    'aspects' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['1k', '2k'],
                    'defaults' => ['resolution' => '2k', 'quality' => 'medium'], 'price' => null,
                    'purpose' => 'Generates from text, or edits up to 10 reference images: product swaps, restyles'],
                'ideogram-4' => ['label' => 'Ideogram 4.0', 'family' => 'Ideogram', 'kind' => 'image', 'route' => '/ideogram/v4.0',
                    'image_field' => 'image_url', 'params' => ['aspect_ratio', 'rendering_speed', 'image_weight'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:5', '9:16', '16:9'], 'resolutions' => [], 'max_inputs' => 1, 'input_optional' => true],
                    'purpose' => 'Photos and graphics from a prompt; remix a product photo'],
                'kling-3-pro' => ['label' => 'Kling 3.0 Pro', 'family' => 'Kling', 'kind' => 'video',
                    'route' => '/kling-video/v3.0/pro/text-to-video', 'image_route' => '/kling-video/v3.0/pro/image-to-video',
                    'image_field' => 'image_url', 'end_field' => 'last_image_url', 'params' => ['aspect_ratio', 'duration', 'audio'],
                    'aspects' => ['16:9', '9:16', '1:1'], 'durations' => [5, 8, 10, 15], 'audio' => 'sound', 'price' => null,
                    'purpose' => 'Strong motion and physics with native sound, up to 15 s; start and end frames'],
                'seedance-2' => ['label' => 'Seedance 2.0', 'family' => 'ByteDance Seedance', 'kind' => 'video',
                    'route' => '/bytedance/seedance-2.0/text-to-video', 'image_route' => '/bytedance/seedance-2.0/image-to-video',
                    'image_field' => 'image_url', 'end_field' => 'end_image_url', 'params' => ['aspect_ratio', 'duration', 'resolution', 'audio'],
                    'aspects' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], 'durations' => [5, 8, 10, 15],
                    'resolutions' => ['480p', '720p', '1080p', '4k'], 'audio' => 'generate_audio', 'defaults' => ['resolution' => '1080p'], 'price' => null,
                    'purpose' => 'Cinematic shots with generated audio, up to 4K and 15 s; start and end frames'],
                'hailuo-2-3' => ['label' => 'Hailuo 2.3', 'family' => 'MiniMax Hailuo', 'kind' => 'video',
                    'route' => '/minimax/hailuo-2.3/standard/text-to-video', 'image_route' => '/minimax/hailuo-2.3/standard/image-to-video',
                    'image_field' => 'image_url', 'params' => ['duration'], 'durations' => [6, 10], 'defaults' => ['prompt_optimizer' => true], 'price' => null,
                    'purpose' => 'Fast, affordable 768p clips of 6 or 10 s; good for drafts'],
                'wan-2-7-i2v' => ['label' => 'Wan 2.7 · image to video', 'family' => 'Wan', 'kind' => 'video', 'route' => '/wan/v2.7/image-to-video',
                    'image_field' => 'image_url', 'requires_image' => true, 'params' => ['duration', 'resolution', 'negative_prompt', 'seed'],
                    'resolutions' => ['720p', '1080p'], 'price' => null,
                    'purpose' => 'Short clips that bring a still to life'],
                'seedance-2-5' => ['label' => 'Seedance 2.5', 'family' => 'ByteDance Seedance', 'kind' => 'video', 'route' => null, 'purpose' => 'Reference to video'],
            ],
        ],

        'google' => [
            'reach' => 'Google Gemini API',
            'local' => false,
            'url' => env('GOOGLE_GENAI_URL', 'https://generativelanguage.googleapis.com/v1beta'),
            'key' => env('GEMINI_API_KEY'),
            'models' => [
                'gemini-3.1-flash-image' => ['label' => 'Gemini 3.1 Flash Image', 'kind' => 'image', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], 'resolutions' => ['1K', '2K', '4K'], 'default_resolution' => '2K', 'max_inputs' => 10, 'input_optional' => true],
                    'purpose' => 'Google’s fast image model for generation and reference-based edits'],
                'veo-3.1-fast-generate-preview' => ['label' => 'Veo 3.1 Fast', 'kind' => 'video', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['9:16', '16:9'], 'durations' => [4, 6, 8], 'resolutions' => ['720p', '1080p', '4k'], 'default_resolution' => '720p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'audio_always_on' => true, 'seed' => true],
                    'purpose' => 'Vertical or landscape social video with native audio'],
                'veo-3.1-generate-preview' => ['label' => 'Veo 3.1', 'kind' => 'video', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['9:16', '16:9'], 'durations' => [4, 6, 8], 'resolutions' => ['720p', '1080p', '4k'], 'default_resolution' => '720p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'audio_always_on' => true, 'seed' => true],
                    'purpose' => 'Highest-quality Google video with native audio'],
            ],
        ],

        // Images from an InvokeAI server on your own GPU. Its installed models are read from
        // GET /api/v2/models; FlowAI builds Invoke's node graphs itself, so only model families
        // it has a graph for can run (z-image so far). Edits (inpaint, extend) go through the
        // same graphs Invoke's own canvas uses.
        'invoke' => [
            'reach' => env('INVOKE_REACH', 'InvokeAI'),
            'local' => true,
            'url' => env('INVOKE_URL'),
            'queue' => env('INVOKE_QUEUE', 'default'),
        ],

        // A ComfyUI server running exported workflows on your own GPU (start it with --listen).
        // From inside Docker, a server on this computer is http://host.docker.internal:8188.
        'comfyui' => [
            'reach' => 'ComfyUI',
            'local' => true,
            'url' => env('COMFYUI_URL'),
            'timeout_seconds' => 300,
            // label, purpose, and the workflow file in resources/comfyui/ with which of its inputs the studio sets.
            'workflows' => [
                'z-image-turbo' => ['label' => 'Z-Image Turbo', 'kind' => 'image', 'file' => 'z_image_turbo.json',
                    'unet' => 'z_image_turbo_bf16.safetensors', 'purpose' => 'Fast photoreal images on your own GPU, free per image',
                    'prompt' => ['57:27', 'text'], 'seed' => ['57:3', 'seed'], 'width' => ['57:13', 'width'], 'height' => ['57:13', 'height'], 'output' => '9'],
            ],
        ],

        // Speech from a VoiceStudio server (OmniVoice), through its OpenAI-compatible
        // POST /v1/audio/speech. Voices are the server's profiles, read from GET /v1/audio/voices;
        // engines that can't clone (cloning: false) only have the default voice. The server
        // quietly swaps an unknown voice for the default, so the voice is checked here first.
        'voicestudio' => [
            'reach' => env('OMNIVOICE_REACH', 'VoiceStudio'),
            'local' => true,
            'url' => env('OMNIVOICE_URL'),
            'key' => env('OMNIVOICE_API_KEY'),
            'models' => [
                'omnivoice' => ['label' => 'OmniVoice', 'kind' => 'audio', 'price' => null, 'cloning' => true,
                    'capabilities' => ['formats' => ['mp3', 'wav'], 'speeds' => [0.75, 1, 1.25, 1.5], 'max_inputs' => 0],
                    'purpose' => 'Voiceovers in your own cloned voices, 600+ languages'],
                'kittentts' => ['label' => 'KittenTTS', 'kind' => 'audio', 'price' => null, 'cloning' => false,
                    'capabilities' => ['formats' => ['mp3', 'wav'], 'speeds' => [0.75, 1, 1.25, 1.5], 'max_inputs' => 0],
                    'purpose' => 'A light English voice when the GPU is busy; slower to answer'],
            ],
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Campaign agents
    |--------------------------------------------------------------------------
    |
    | The writer, visual director, adapter and QA run on `model`. The media
    | team uses the first available image and video models from the registry,
    | preferring these when they can run.
    |
    */

    'agents' => [
        'model' => 'gateway/glm-5.3-flash',
        'image_model' => 'higgsfield/ideogram-4',
        'video_model' => 'higgsfield/wan-2-7-i2v',
    ],

    /*
    |--------------------------------------------------------------------------
    | Campaign intake
    |--------------------------------------------------------------------------
    |
    | The model behind the intake interview, reading reference photos, and
    | writing the content kit. Interview turns run at low effort so replies
    | come back quickly; the kit is the deliverable and gets more thought.
    |
    | A full "provider/model" id, like default_text and agents.model, and
    | resolved through the registry: if this one can't run the interview falls
    | back to another model that can, rather than to the fixed question list.
    |
    */

    'intake' => [
        'model' => 'gateway/glm-5.3-flash',
        'interview_effort' => 'low',
        'kit_effort' => 'medium',
    ],

    /*
    |--------------------------------------------------------------------------
    | Prices
    |--------------------------------------------------------------------------
    |
    | Dollars per million tokens, [input, output], for the usage numbers in
    | Operations and on every run record.
    |
    */

    'prices' => [
        'claude-opus-5-5' => [4, 20],
        'claude-opus-5' => [5, 25],
        'claude-sonnet-5-5' => [2, 10],
        'claude-haiku-4-5' => [1, 5],
    ],

];
