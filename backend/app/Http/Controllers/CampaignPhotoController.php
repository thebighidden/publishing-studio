<?php

namespace App\Http\Controllers;

use App\Http\Resources\CampaignResource;
use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Services\Ai\GenerationFailed;
use App\Services\Intake\Brief;
use App\Services\Intake\Interviewer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Reference photos for a campaign: of the person, the product, the place. Kept on the private
 * disk and served only to their owner.
 */
class CampaignPhotoController extends Controller
{
    public function store(Request $request, Campaign $campaign, Interviewer $interviewer): CampaignResource|JsonResponse
    {
        Gate::authorize('update', $campaign);

        $room = Brief::MAX_PHOTOS - $campaign->photos()->count();
        if ($room <= 0) {
            throw ValidationException::withMessages([
                'photos' => 'You’ve reached '.Brief::MAX_PHOTOS.' photos. Remove one to add another.',
            ]);
        }

        // 5 MB and 8000 px are what Claude accepts per image; the page scales photos down well before that.
        $request->validate([
            'photos' => ['required', 'array', 'min:1', "max:{$room}"],
            'photos.*' => ['image', 'mimes:jpeg,png,webp,gif', 'max:5120', 'dimensions:max_width=8000,max_height=8000'],
        ], [
            'photos.max' => "There’s room for {$room} more ".($room === 1 ? 'photo' : 'photos').' (up to '.Brief::MAX_PHOTOS.').',
            'photos.*.mimes' => 'Use JPG, PNG, WebP or GIF photos.',
            'photos.*.image' => 'Use JPG, PNG, WebP or GIF photos.',
            'photos.*.max' => 'Each photo can be up to 5 MB.',
        ]);

        try {
            $interviewer->addPhotos($campaign, $request->file('photos'));
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        return CampaignResource::make($campaign->fresh());
    }

    public function show(Campaign $campaign, CampaignPhoto $photo): StreamedResponse
    {
        Gate::authorize('view', $campaign);

        return Storage::disk('local')->response($photo->path, null, [
            'Content-Type' => $photo->mime,
            'Cache-Control' => 'private, max-age=604800',
        ]);
    }

    public function destroy(Campaign $campaign, CampaignPhoto $photo): CampaignResource
    {
        Gate::authorize('update', $campaign);

        Storage::disk('local')->delete($photo->path);
        $photo->delete();

        return CampaignResource::make($campaign->fresh());
    }
}
