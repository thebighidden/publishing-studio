<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * One try of a provider connector: did the credentials work, and how fast.
 */
#[Fillable(['provider', 'ok', 'message', 'latency_ms'])]
class ConnectorTest extends Model
{
    public const UPDATED_AT = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['ok' => 'boolean', 'latency_ms' => 'integer'];
    }

    public static function latestFor(string $provider): ?self
    {
        return static::where('provider', $provider)->latest('id')->first();
    }
}
