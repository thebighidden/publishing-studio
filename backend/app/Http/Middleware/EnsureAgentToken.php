<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The automation service (the Python agent) isn't a person with a session: it signs every
 * call with the studio's agent token, shown on the Devices page. `Authorization: Bearer …`.
 */
class EnsureAgentToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        $user = $token ? User::where('agent_token', $token)->first() : null;
        abort_unless($user, 401, 'A valid agent token is required. Find it on the Devices page.');

        $request->setUserResolver(fn () => $user);

        return $next($request);
    }
}
