<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use Illuminate\Support\Collection;

/**
 * Makes images and videos. Either finishes at once (`outputs`), or hands back an id and a
 * status URL to poll.
 */
interface MediaProvider
{
    /**
     * @param  array<string, mixed>  $model  the registry/config entry
     * @param  Collection<int, Asset>  $inputs
     * @return array{external_id?: string, status_url?: string, outputs?: list<array{url?: string, b64?: string, mime: string}>}
     */
    public function submit(array $model, Generation $generation, Collection $inputs): array;

    /**
     * @return array{status: string, outputs?: list<array{url?: string, b64?: string, mime: string}>, error?: string}
     */
    public function poll(Generation $generation): array;
}
