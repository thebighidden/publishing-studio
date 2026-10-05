<?php

namespace App\Enums;

enum PostFormat: string
{
    case Text = 'text';
    case Image = 'image';
    case Video = 'video';
}
