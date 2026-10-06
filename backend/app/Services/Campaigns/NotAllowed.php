<?php

namespace App\Services\Campaigns;

use RuntimeException;

/**
 * A campaign step that can't happen yet, with a message for the person who tried.
 */
class NotAllowed extends RuntimeException {}
