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
    |
    | A model is offered only when it can actually run: credentials set, and
    | for Higgsfield also an API route, a place in your plan, and a connector
    | test that passed (POST /api/models/test/higgsfield).
    |
    */

    // What the composer and the generators start on.
    'default_text' => 'anthropic/claude-opus-5',

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

        // Any OpenAI-compatible endpoint: a team gateway, OpenRouter, vLLM, LM Studio.
        // Text models are discovered from GET {url}/models; list image models by id.
        'gateway' => [
            'reach' => 'Gateway',
            'url' => env('AI_GATEWAY_URL'),
            'key' => env('AI_GATEWAY_KEY'),
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
            // The models your Higgsfield plan includes.
            'plan' => array_values(array_filter(explode(',', (string) env('HIGGSFIELD_PLAN', 'ideogram-4,wan-2-7-i2v,soul-v2,soul,soul-cinema,grok-image-2,kling-3-pro,seedance-2,hailuo-2-3')))),
            // route: the model's endpoint. image_field: where an input image goes. params: what may be passed through.
            // price: dollars per output, from your plan, for the usage numbers (null if unknown).
            'models' => [
                'ideogram-4' => ['label' => 'Ideogram 4.0', 'kind' => 'image', 'route' => '/ideogram/v4.0',
                    'image_field' => 'image_url', 'params' => ['aspect_ratio', 'rendering_speed', 'image_weight'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:5', '9:16', '16:9'], 'resolutions' => [], 'max_inputs' => 1, 'input_optional' => true],
                    'purpose' => 'Photos and graphics from a prompt; remix a product photo'],
                'wan-2-7-i2v' => ['label' => 'Wan 2.7 · image to video', 'kind' => 'video', 'route' => '/wan/v2.7/image-to-video',
                    'image_field' => 'image_url', 'requires_image' => true, 'params' => ['duration', 'resolution', 'negative_prompt', 'seed'], 'price' => null,
                    'capabilities' => ['durations' => [5, 10, 15], 'resolutions' => ['720p', '1080p'], 'max_inputs' => 1, 'requires_image' => true],
                    'purpose' => 'Short clips that bring a still to life'],
                'soul-v2' => ['label' => 'Higgsfield Soul 2', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/v2/standard',
                    'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 0, 'seed' => true, 'max_outputs' => 4],
                    'purpose' => 'High-end social photography and editorial portraits'],
                'soul' => ['label' => 'Higgsfield Soul', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/standard',
                    'reference_field' => 'image_reference_url', 'reference_list' => false, 'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 1, 'input_optional' => true, 'seed' => true, 'max_outputs' => 4],
                    'purpose' => 'Fashion-grade portraits with an optional reference'],
                'soul-cinema' => ['label' => 'Soul Cinema', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/cinema',
                    'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 0, 'seed' => true, 'max_outputs' => 4],
                    'purpose' => 'Cinematic campaign stills and key art'],
                'grok-image-2' => ['label' => 'Grok Imagine Image 2', 'kind' => 'image', 'route' => '/xai/grok-imagine-image-2.0',
                    'reference_field' => 'image_urls', 'reference_list' => true, 'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size', 'quality'], 'extra' => ['quality' => 'medium'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['1k', '2k'], 'default_resolution' => '2k', 'max_inputs' => 10, 'input_optional' => true, 'seed' => true, 'max_outputs' => 4],
                    'purpose' => 'Fast, flexible social visuals with up to ten references'],
                'kling-3-pro' => ['label' => 'Kling 3 Pro', 'kind' => 'video', 'route' => '/kling-video/v3.0/pro/text-to-video', 'i2v_route' => '/kling-video/v3.0/pro/image-to-video',
                    'image_field' => 'image_url', 'end_frame_field' => 'last_image_url', 'audio_field' => 'sound', 'audio_values' => ['on', 'off'], 'params' => ['aspect_ratio', 'duration', 'seed'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['16:9', '9:16', '1:1'], 'durations' => [5, 8, 10, 15], 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'seed' => true],
                    'purpose' => 'Cinematic text-to-video or first/last-frame animation'],
                'seedance-2' => ['label' => 'Seedance 2', 'kind' => 'video', 'route' => '/bytedance/seedance-2.0/text-to-video', 'i2v_route' => '/bytedance/seedance-2.0/image-to-video',
                    'image_field' => 'image_url', 'end_frame_field' => 'end_image_url', 'audio_field' => 'generate_audio', 'params' => ['aspect_ratio', 'duration', 'resolution', 'seed'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], 'durations' => [5, 8, 10, 15], 'resolutions' => ['480p', '720p', '1080p', '4k'], 'default_resolution' => '1080p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'seed' => true],
                    'purpose' => 'Social video with sound, from text or first/last frames'],
                'hailuo-2-3' => ['label' => 'Hailuo 2.3', 'kind' => 'video', 'route' => '/minimax/hailuo-2.3/standard/text-to-video', 'i2v_route' => '/minimax/hailuo-2.3/standard/image-to-video',
                    'image_field' => 'image_url', 'params' => ['duration', 'seed'], 'extra' => ['prompt_optimizer' => true], 'price' => null,
                    'capabilities' => ['durations' => [6, 10], 'max_inputs' => 1, 'input_optional' => true, 'seed' => true],
                    'purpose' => 'Fast text-to-video or image animation for short-form content'],
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
        'model' => 'anthropic/claude-opus-5-5',
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
    */

    'intake' => [
        'model' => 'claude-opus-5-5',
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
