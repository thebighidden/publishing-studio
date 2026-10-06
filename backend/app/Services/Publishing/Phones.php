<?php

namespace App\Services\Publishing;

use App\Models\Device;

/**
 * Which driver a run uses. Simulator phones are driven in-process by the queue worker;
 * HTTP phones are driven by the external automation agent (the Python service), which picks
 * the run up from the agent API — so there is nothing to construct here for them.
 */
class Phones
{
    public static function simulator(Device $device, string $caption): PhoneDriver
    {
        return new SimulatorPhone($device, $caption);
    }
}
