<?php

namespace App\Services\Publishing;

use RuntimeException;

/** A step on the phone didn't work. The run records it and the post tries again later. */
class PhoneFailed extends RuntimeException {}
