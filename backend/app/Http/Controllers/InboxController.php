<?php

namespace App\Http\Controllers;

use App\Services\Studio\Inbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InboxController extends Controller
{
    public function __invoke(Request $request, Inbox $inbox): JsonResponse
    {
        return response()->json($inbox->items($request->user()));
    }
}
