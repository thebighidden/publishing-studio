<?php

namespace App\Services\Publishing;

use App\Models\Device;

/**
 * The built-in phone: no hardware, no phone-control service, and the whole publishing loop
 * still runs — steps, screenshot, verification and all. Its truthfulness is the device's
 * profile: reliable does what it's told and shows the post live; flaky mostly works but its
 * screen sometimes proves nothing; broken can't open the app.
 *
 * Tests and demos rig the die with SimulatorPhone::rig('ok' | 'uncertain' | 'fail').
 */
class SimulatorPhone implements PhoneDriver
{
    /** @var null|'ok'|'uncertain'|'fail' */
    private static ?string $rigged = null;

    /** What ended up on the screen, which is all the verification ever trusts. */
    private string $screen = '';

    public function __construct(private readonly Device $device, private readonly string $caption) {}

    /** Rig the die: 'ok' posts, 'uncertain' posts but proves nothing, 'fail' loses a step. */
    public static function rig(?string $outcome): void
    {
        self::$rigged = $outcome;
    }

    public function transfer(string $contents, string $name, string $mime): void
    {
        $this->act('transfer');
    }

    public function appStart(string $package): void
    {
        $this->act('app-start');
        $this->screen = "{$package} home";
    }

    public function tap(string $target): void
    {
        $this->act("tap:{$target}");
        if ($target === 'compose-button') {
            $this->screen = 'composer';
        }
    }

    public function type(string $text): void
    {
        $this->act('type');
        if ($this->luck() !== 'fail') {
            // What a person would see after tapping Publish: the caption, live on the account.
            $this->screen = 'posted: '.$text;
        }
    }

    public function screenshot(): array
    {
        $this->act('screenshot');
        $text = match ($this->luck()) {
            'fail', 'uncertain' => 'home screen', // nothing here proves anything
            default => $this->screen,
        };

        return ['png' => $this->png($text), 'text' => $text];
    }

    private function act(string $what): void
    {
        if ($this->device->profile === 'broken' || ($this->device->profile === 'flaky' && $this->luck() === 'fail')) {
            throw new PhoneFailed("The simulator couldn't {$what}: this phone is {$this->device->profile}.");
        }
    }

    /** @return 'ok'|'uncertain'|'fail' */
    private function luck(): string
    {
        if (self::$rigged) {
            return self::$rigged;
        }

        return match ($this->device->profile) {
            'broken' => 'fail',
            'flaky' => random_int(0, 1) ? 'uncertain' : 'ok',
            default => 'ok',
        };
    }

    /** A small dark PNG with the screen's text in it, so the record has something to show. */
    private function png(string $text): string
    {
        $im = imagecreatetruecolor(540, 960);
        imagefill($im, 0, 0, imagecolorallocate($im, 18, 18, 22));
        imagestring($im, 4, 24, 24, 'Simulator · '.$this->device->name, imagecolorallocate($im, 160, 160, 170));
        foreach (str_split(wordwrap($text, 42, "\n") ?: ' ', 900) as $i => $line) {
            imagestring($im, 3, 24, 64 + $i * 18, $line, imagecolorallocate($im, 235, 235, 240));
        }
        ob_start();
        imagepng($im);
        imagedestroy($im);

        return (string) ob_get_clean();
    }
}
