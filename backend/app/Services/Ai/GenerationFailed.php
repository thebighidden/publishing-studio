<?php

namespace App\Services\Ai;

use RuntimeException;

/**
 * Generation stopped. The message is written for the person in the composer.
 */
class GenerationFailed extends RuntimeException {}
