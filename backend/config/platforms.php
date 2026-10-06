<?php

/*
|--------------------------------------------------------------------------
| Platform specs
|--------------------------------------------------------------------------
|
| What each platform accepts, per placement. The pre-export check holds every
| output against these before it can be approved, scheduled or exported.
|
| media:      kinds accepted; items: [min, max] pieces of media (0 = text post).
| ratio:      [min, max] width ÷ height, with `ratio_hint` the size to aim for.
|             `ratio_strict` false means outside the range is a warning, not a failure.
| min_width:  below this the platform upscales and it looks soft (warning).
| image_mb / video_mb: file size caps. duration: [min, max] seconds for video.
| caption:    character limit (0 = no caption). hashtags: hard cap; hashtags_soft: warn above.
|
*/

$square_to_landscape = [0.8, 1.91];

return [

    'instagram' => [
        'feed' => ['label' => 'Feed post', 'media' => ['image', 'video'], 'items' => [1, 10],
            'ratio' => $square_to_landscape, 'ratio_hint' => '1080 × 1350 (4:5)', 'ratio_strict' => true,
            'min_width' => 1080, 'image_mb' => 8, 'video_mb' => 650, 'duration' => [3, 60],
            'caption' => 2200, 'hashtags' => 30],
        'reel' => ['label' => 'Reel', 'media' => ['video'], 'items' => [1, 1],
            'ratio' => [0.54, 0.58], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => true,
            'min_width' => 720, 'video_mb' => 1000, 'duration' => [3, 90],
            'caption' => 2200, 'hashtags' => 30],
        'story' => ['label' => 'Story', 'media' => ['image', 'video'], 'items' => [1, 1],
            'ratio' => [0.54, 0.58], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => true,
            'min_width' => 720, 'image_mb' => 30, 'video_mb' => 250, 'duration' => [1, 60],
            'caption' => 0, 'hashtags' => 10],
    ],

    'tiktok' => [
        'video' => ['label' => 'Video', 'media' => ['video'], 'items' => [1, 1],
            'ratio' => [0.54, 0.58], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => false,
            'min_width' => 720, 'video_mb' => 287, 'duration' => [3, 600],
            'caption' => 2200, 'hashtags_soft' => 5],
        'photo' => ['label' => 'Photo carousel', 'media' => ['image'], 'items' => [1, 35],
            'ratio' => [0.54, 1.0], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => false,
            'min_width' => 720, 'image_mb' => 20,
            'caption' => 2200, 'hashtags_soft' => 5],
    ],

    'x' => [
        'post' => ['label' => 'Post', 'media' => ['image', 'video'], 'items' => [0, 4],
            'ratio' => [0.5, 2.0], 'ratio_hint' => '1600 × 900 (16:9)', 'ratio_strict' => false,
            'min_width' => 600, 'image_mb' => 5, 'video_mb' => 512, 'duration' => [0.5, 140],
            'caption' => 280, 'hashtags_soft' => 2],
    ],

    'linkedin' => [
        'post' => ['label' => 'Post', 'media' => ['image', 'video'], 'items' => [0, 20],
            'ratio' => [0.5, 2.4], 'ratio_hint' => '1200 × 1200 (1:1)', 'ratio_strict' => false,
            'min_width' => 552, 'image_mb' => 8, 'video_mb' => 5000, 'duration' => [3, 600],
            'caption' => 3000, 'hashtags_soft' => 5],
    ],

    'facebook' => [
        'feed' => ['label' => 'Feed post', 'media' => ['image', 'video'], 'items' => [0, 10],
            'ratio' => [0.5, 1.91], 'ratio_hint' => '1080 × 1350 (4:5)', 'ratio_strict' => false,
            'min_width' => 600, 'image_mb' => 30, 'video_mb' => 4000, 'duration' => [1, 14400],
            'caption' => 63206, 'hashtags_soft' => 5],
        'reel' => ['label' => 'Reel', 'media' => ['video'], 'items' => [1, 1],
            'ratio' => [0.54, 0.58], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => true,
            'min_width' => 540, 'video_mb' => 1000, 'duration' => [3, 90],
            'caption' => 2200, 'hashtags_soft' => 5],
        'story' => ['label' => 'Story', 'media' => ['image', 'video'], 'items' => [1, 1],
            'ratio' => [0.54, 0.58], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => true,
            'min_width' => 500, 'image_mb' => 30, 'video_mb' => 4000, 'duration' => [1, 60],
            'caption' => 0],
    ],

    'youtube' => [
        'short' => ['label' => 'Short', 'media' => ['video'], 'items' => [1, 1],
            'ratio' => [0.54, 1.0], 'ratio_hint' => '1080 × 1920 (9:16)', 'ratio_strict' => true,
            'min_width' => 720, 'video_mb' => 2000, 'duration' => [1, 180],
            'caption' => 5000, 'hashtags' => 15],
        'video' => ['label' => 'Video', 'media' => ['video'], 'items' => [1, 1],
            'ratio' => [1.7, 1.8], 'ratio_hint' => '1920 × 1080 (16:9)', 'ratio_strict' => false,
            'min_width' => 1280, 'video_mb' => 256000, 'duration' => [1, 43200],
            'caption' => 5000, 'hashtags' => 15],
    ],

    'pinterest' => [
        'pin' => ['label' => 'Pin', 'media' => ['image', 'video'], 'items' => [1, 5],
            'ratio' => [0.5, 1.0], 'ratio_hint' => '1000 × 1500 (2:3)', 'ratio_strict' => false,
            'min_width' => 600, 'image_mb' => 20, 'video_mb' => 2000, 'duration' => [4, 900],
            'caption' => 500, 'hashtags_soft' => 5],
    ],

];
