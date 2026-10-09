<?php

namespace App\Http\Controllers;

use App\Http\Resources\DeviceResource;
use App\Models\ActionLog;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The phones that publish: the built-in simulator, or phones on the phone-control service.
 */
class DeviceController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return DeviceResource::collection($request->user()->devices()->with('accounts')->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $device = $request->user()->devices()->create($this->validated($request));
        ActionLog::record($request->user(), 'you', 'device.created', $device, "Added the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'))->response()->setStatusCode(201);
    }

    public function update(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);

        $device->update($this->validated($request, $device));

        return DeviceResource::make($device->load('accounts'));
    }

    /**
     * Delete a phone. Its accounts are unlinked and its publishing history stays. A phone the
     * agent is still reporting would be registered again at its next check-in, so it's also
     * hidden until brought back (`hidden` in the answer says so).
     */
    public function destroy(Request $request, Device $device): JsonResponse
    {
        Gate::authorize('delete', $device);
        abort_if($device->booked_run_id !== null, 409, 'This phone is running a job. Stop it first.');

        $user = $request->user();
        $hidden = $device->driver === 'http' && $device->ref && $device->last_seen_at?->gt(now()->subSeconds(90));
        if ($hidden) {
            $user->hidePhone($device->ref);
        }
        ActionLog::record($user, 'you', 'device.deleted', $device, "Deleted the phone “{$device->name}”.");
        $device->accounts()->update(['device_id' => null]);
        $device->delete();

        return response()->json(['hidden' => (bool) $hidden]);
    }

    /** Phones deleted while the agent still reported them, so they stay off this page. */
    public function hidden(Request $request): JsonResponse
    {
        return response()->json(['refs' => $request->user()->hiddenPhones()]);
    }

    /** Bring a hidden phone back: it's registered again at the agent's next check-in. */
    public function unhide(Request $request, string $ref): JsonResponse
    {
        $request->user()->showPhone($ref);

        return response()->json(['refs' => $request->user()->hiddenPhones()]);
    }

    /** A paused phone starts nothing new; the run already on it still finishes. */
    public function pause(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);
        $device->update(['paused_at' => now()]);
        ActionLog::record($request->user(), 'you', 'device.paused', $device, "Paused the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'));
    }

    public function resume(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);
        $device->update(['paused_at' => null]);
        ActionLog::record($request->user(), 'you', 'device.resumed', $device, "Resumed the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'));
    }

    /** The phone's latest screenshot, from its most recent run. */
    public function screenshot(Device $device): BinaryFileResponse
    {
        Gate::authorize('view', $device);
        abort_unless($device->last_screenshot, 404, 'This phone has no screenshot yet.');

        return response()->file(Storage::disk('local')->path($device->last_screenshot), ['Content-Type' => 'image/png']);
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?Device $device = null): array
    {
        $partial = $device !== null;
        $driver = $request->input('driver', $device?->driver);

        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:60'],
            'driver' => [$partial ? 'sometimes' : 'required', Rule::in(Device::DRIVERS)],
            // The phone-control service addresses each phone by its device ID.
            'ref' => [$driver === 'http' && ! $partial ? 'required' : 'nullable', 'string', 'max:120'],
            'profile' => ['sometimes', Rule::in(Device::PROFILES)],
        ], [
            'ref.required' => 'Enter the device ID the phone-control service uses for this phone.',
        ]);
    }
}
