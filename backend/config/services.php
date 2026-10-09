<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('APP_URL').'/oauth/google/callback',
    ],

    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('APP_URL').'/oauth/github/callback',
    ],

    // Instagram (professional accounts) and Facebook Pages through Meta's Graph API: publishing,
    // insights, comments. A Meta app from developers.facebook.com; its redirect URI must be
    // {APP_URL}/oauth/connect/meta/callback. Instagram fetches photos from a public address,
    // so META_PUBLIC_MEDIA_URL is where Meta can reach this API (a domain or a tunnel).
    'meta' => [
        'app_id' => env('META_APP_ID'),
        'app_secret' => env('META_APP_SECRET'),
        'graph_version' => env('META_GRAPH_VERSION', 'v24.0'),
        'redirect' => env('APP_URL').'/oauth/connect/meta/callback',
        'public_media_url' => env('META_PUBLIC_MEDIA_URL'),
        'scopes' => [
            'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_read_user_content', 'pages_manage_engagement',
            'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights', 'business_management',
        ],
    ],

    // X through its API v2 (OAuth 2.0 with PKCE). The free tier can post; reading likes and
    // replies needs a paid tier, so FlowAI reads those on a phone instead.
    'x' => [
        'client_id' => env('X_CLIENT_ID'),
        'client_secret' => env('X_CLIENT_SECRET'),
        'redirect' => env('APP_URL').'/oauth/connect/x/callback',
        'scopes' => ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
    ],

    // AI writing in the composer. Blank keeps it switched off; the composer says so.
    'anthropic' => [
        'key' => env('ANTHROPIC_API_KEY'),
    ],

];
