<?php

namespace App\Enums;

enum Platform: string
{
    case Instagram = 'instagram';
    case TikTok = 'tiktok';
    case X = 'x';
    case LinkedIn = 'linkedin';
    case Facebook = 'facebook';
    case YouTube = 'youtube';
    case Pinterest = 'pinterest';

    public function label(): string
    {
        return match ($this) {
            self::Instagram => 'Instagram',
            self::TikTok => 'TikTok',
            self::X => 'X',
            self::LinkedIn => 'LinkedIn',
            self::Facebook => 'Facebook',
            self::YouTube => 'YouTube',
            self::Pinterest => 'Pinterest',
        };
    }

    /**
     * The longest caption or post body each network accepts.
     */
    public function characterLimit(): int
    {
        return match ($this) {
            self::X => 280,
            self::Pinterest => 500,
            self::Instagram, self::TikTok => 2200,
            self::LinkedIn => 3000,
            self::YouTube => 5000,
            self::Facebook => 63206,
        };
    }
}
