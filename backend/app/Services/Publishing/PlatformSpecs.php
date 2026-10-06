<?php

namespace App\Services\Publishing;

use App\Enums\Platform;
use App\Models\Asset;
use Illuminate\Support\Collection;

/**
 * The platform spec table (config/platforms.php) and the pre-export check: every output is held
 * against its placement before it can be approved, scheduled or exported. A failure blocks;
 * a warning is shown but doesn't.
 */
class PlatformSpecs
{
    /**
     * @return array<string, array<string, array<string, mixed>>>
     */
    public function all(): array
    {
        return config('platforms');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function spec(Platform $platform, string $placement): ?array
    {
        return config("platforms.{$platform->value}.{$placement}");
    }

    /**
     * The placement a post of this kind goes to when nobody picked one.
     *
     * @param  Collection<int, Asset>  $assets
     */
    public function defaultPlacement(Platform $platform, Collection $assets): string
    {
        $video = $assets->contains('kind', 'video');
        $tall = $assets->isNotEmpty() && ($assets->first()->ratio() ?? 1) < 0.7;

        return match ($platform) {
            Platform::Instagram => $video ? 'reel' : 'feed',
            Platform::TikTok => $video ? 'video' : 'photo',
            Platform::Facebook => $video && $tall ? 'reel' : 'feed',
            Platform::YouTube => $video && ! $tall ? 'video' : 'short',
            Platform::Pinterest => 'pin',
            Platform::X, Platform::LinkedIn => 'post',
        };
    }

    /**
     * @param  Collection<int, Asset>  $assets
     * @return array{ok: bool, platform: string, placement: string, label: string, checks: list<array{key: string, status: string, label: string, detail: string}>}
     */
    public function check(Platform $platform, ?string $placement, string $caption, Collection $assets): array
    {
        $placement = $placement && $this->spec($platform, $placement) ? $placement : $this->defaultPlacement($platform, $assets);
        $spec = $this->spec($platform, $placement);
        $name = $platform->label().' '.strtolower($spec['label']);
        $checks = [];
        $add = function (string $key, string $status, string $label, string $detail = '') use (&$checks) {
            $checks[] = compact('key', 'status', 'label', 'detail');
        };

        // How much media, and what kind.
        [$min, $max] = $spec['items'];
        $n = $assets->count();
        if ($n < $min || $n > $max) {
            $want = $min === $max ? "exactly {$min}" : ($min === 0 ? "up to {$max}" : "{$min} to {$max}");
            $add('items', 'fail', 'Media count', "{$name} takes {$want} ".($max === 1 ? 'file' : 'files').", this has {$n}.");
        } else {
            $add('items', 'pass', 'Media count', $n === 0 ? 'Text only.' : "{$n} ".($n === 1 ? 'file' : 'files').'.');
        }
        $wrong = $assets->reject(fn (Asset $a) => in_array($a->kind, $spec['media'], true));
        if ($wrong->isNotEmpty()) {
            $add('kind', 'fail', 'Media type', "{$name} doesn’t take ".$wrong->first()->kind.'s.');
        }

        // The caption.
        $length = mb_strlen($caption);
        if ($spec['caption'] === 0 && trim($caption) !== '') {
            $add('caption', 'warn', 'Caption', "{$name}s don’t show a caption; put the words on the media.");
        } elseif ($spec['caption'] > 0) {
            $add('caption', $length > $spec['caption'] ? 'fail' : 'pass', 'Caption length', number_format($length).' of '.number_format($spec['caption']).' characters.');
        }
        $tags = preg_match_all('/(?<![\w#])#[\p{L}\p{N}_]+/u', $caption);
        if (isset($spec['hashtags']) && $tags > $spec['hashtags']) {
            $add('hashtags', 'fail', 'Hashtags', "{$tags} hashtags; {$platform->label()} allows {$spec['hashtags']}.");
        } elseif (isset($spec['hashtags_soft']) && $tags > $spec['hashtags_soft']) {
            $add('hashtags', 'warn', 'Hashtags', "{$tags} hashtags; more than {$spec['hashtags_soft']} tends to look like spam here.");
        } elseif ($tags > 0) {
            $add('hashtags', 'pass', 'Hashtags', "{$tags} hashtags.");
        }

        // Each file.
        foreach ($assets->values() as $i => $asset) {
            $which = $n > 1 ? 'File '.($i + 1).': ' : '';
            $ratio = $asset->ratio();
            [$lo, $hi] = $spec['ratio'];
            if ($ratio === null) {
                $add("ratio.{$i}", 'warn', 'Shape', "{$which}couldn’t read the size of this file.");
            } elseif ($ratio < $lo - 0.005 || $ratio > $hi + 0.005) {
                $add("ratio.{$i}", $spec['ratio_strict'] ? 'fail' : 'warn', 'Shape', "{$which}{$asset->width} × {$asset->height} is off for {$name}; aim for {$spec['ratio_hint']}.");
            } else {
                $add("ratio.{$i}", 'pass', 'Shape', "{$which}{$asset->width} × {$asset->height}.");
            }
            if ($asset->width && $asset->width < $spec['min_width']) {
                $add("width.{$i}", 'warn', 'Resolution', "{$which}{$asset->width} px wide; under {$spec['min_width']} px looks soft once the platform scales it up.");
            }

            $cap = $asset->kind === 'video' ? ($spec['video_mb'] ?? null) : ($spec['image_mb'] ?? null);
            if ($cap && $asset->size > $cap * 1024 * 1024) {
                $add("size.{$i}", 'fail', 'File size', $which.round($asset->size / 1048576, 1)." MB; the limit is {$cap} MB.");
            }

            if ($asset->kind === 'video' && isset($spec['duration'])) {
                [$dmin, $dmax] = $spec['duration'];
                if ($asset->duration === null) {
                    $add("duration.{$i}", 'warn', 'Length', "{$which}couldn’t read how long this video is.");
                } elseif ($asset->duration < $dmin || $asset->duration > $dmax) {
                    $add("duration.{$i}", 'fail', 'Length', "{$which}".round($asset->duration, 1)." s; {$name} takes {$dmin}–{$dmax} s.");
                } else {
                    $add("duration.{$i}", 'pass', 'Length', "{$which}".round($asset->duration, 1).' s.');
                }
            }
        }

        return [
            'ok' => collect($checks)->doesntContain('status', 'fail'),
            'platform' => $platform->value,
            'placement' => $placement,
            'label' => $name,
            'checks' => $checks,
        ];
    }
}
