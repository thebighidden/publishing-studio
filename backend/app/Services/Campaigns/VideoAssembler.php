<?php

namespace App\Services\Campaigns;

use App\Models\Asset;
use App\Models\User;
use App\Services\Media\AssetStore;
use App\Services\Media\MediaInspector;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * Joins a video's shots into one clip with ffmpeg: every shot scaled and padded to the first
 * one's frame, at 24 fps. Without ffmpeg, the shots stay separate.
 */
class VideoAssembler
{
    public function __construct(private readonly MediaInspector $inspector, private readonly AssetStore $assets) {}

    /**
     * @param  Collection<int, Asset>  $clips
     */
    public function concat(User $user, Collection $clips, string $name): ?Asset
    {
        if ($clips->count() < 2 || ! $this->inspector->canReadVideo()) {
            return $clips->count() === 1 ? $clips->first() : null;
        }

        $disk = Storage::disk('local');
        $w = ($clips->first()->width ?? 1080) & ~1;
        $h = ($clips->first()->height ?? 1920) & ~1;
        $inputs = $clips->flatMap(fn (Asset $a) => ['-i', $disk->path($a->path)])->all();
        $filters = $clips->values()->map(fn ($a, $i) => "[{$i}:v]scale={$w}:{$h}:force_original_aspect_ratio=decrease,pad={$w}:{$h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v{$i}]")->join(';');
        $chain = $clips->keys()->map(fn ($i) => "[v{$i}]")->join('').'concat=n='.$clips->count().':v=1:a=0[out]';
        $out = tempnam(sys_get_temp_dir(), 'film').'.mp4';

        $run = Process::timeout(600)->run(['ffmpeg', '-y', '-v', 'error', ...$inputs, '-filter_complex', "{$filters};{$chain}", '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', $out]);
        if (! $run->successful() || ! is_file($out)) {
            report(new \RuntimeException('Couldn’t join the shots: '.$run->errorOutput()));

            return null;
        }

        $asset = $this->assets->fromContents($user, file_get_contents($out), 'video/mp4', "{$name}.mp4", 'generated', ['shots' => $clips->pluck('id')->all()]);
        @unlink($out);

        return $asset;
    }
}
