<?php

namespace App\Models;

use Database\Factories\AssetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * An image or video in the media library. Files live on the private disk and are only
 * served to their owner.
 */
#[Fillable(['kind', 'source', 'name', 'path', 'poster_path', 'mime', 'size', 'width', 'height', 'duration', 'meta', 'board_id'])]
class Asset extends Model
{
    /** @use HasFactory<AssetFactory> */
    use HasFactory;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'duration' => 'float',
            'meta' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::deleted(fn (Asset $asset) => Storage::disk('local')->delete(array_filter([$asset->path, $asset->poster_path])));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function url(): string
    {
        return "/api/assets/{$this->id}/file";
    }

    public function posterUrl(): ?string
    {
        return $this->kind === 'image' ? $this->url() : ($this->poster_path ? "/api/assets/{$this->id}/poster" : null);
    }

    /** Width ÷ height, when known. */
    public function ratio(): ?float
    {
        return $this->width && $this->height ? $this->width / $this->height : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'source' => $this->source,
            'name' => $this->name,
            'url' => $this->url(),
            'poster_url' => $this->posterUrl(),
            'mime' => $this->mime,
            'size' => $this->size,
            'width' => $this->width,
            'height' => $this->height,
            'duration' => $this->duration,
            'board_id' => $this->board_id,
            // What a voiceover says, so it can be read alongside the player.
            'script' => $this->kind === 'audio' ? ($this->meta['prompt'] ?? null) : null,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
