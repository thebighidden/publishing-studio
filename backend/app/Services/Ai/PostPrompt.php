<?php

namespace App\Services\Ai;

use App\Enums\Platform;
use App\Enums\PostFormat;

/**
 * What the model is told when someone asks it to write, or rewrite, a post.
 */
final class PostPrompt
{
    /** Mirrored by TONES in the composer. */
    public const TONES = ['professional', 'friendly', 'bold', 'playful'];

    private const SYSTEM = <<<'TXT'
        You write social media posts. Each request gives you a brief, the networks the post will go to, what kind of post it is, and a character limit. Reply with the post and nothing else: no preamble, no notes, no options to choose from, no quotation marks around it. Your reply goes straight into the post editor.

        Write plain text. Social networks don't render Markdown, so leave out asterisks, headings and bullet syntax; use line breaks for structure, and emoji only where they suit the tone.

        Write one version that works on every network listed. Use hashtags only if those networks use them, and keep to a few.

        The character limit is the strictest network's maximum, and the editor rejects anything longer, so stay well inside it. It is a ceiling, not a target: write the length the brief and the networks call for.

        Don't make up specifics the brief doesn't give you: names, numbers, prices, dates, quotes, links. Write around them, or, if the post can't work without one, leave a short placeholder in square brackets, like [link], for the writer to fill in. If the post is a caption for an image or video, don't describe the media beyond what the brief says about it.

        If the request includes a current draft, the brief says how to change it: rewrite the draft to match, and keep whatever the brief doesn't ask you to change.
        TXT;

    /**
     * @param  non-empty-list<Platform>  $platforms
     */
    public function __construct(
        public readonly string $brief,
        public readonly PostFormat $format,
        public readonly array $platforms,
        public readonly ?string $tone = null,
        public readonly ?string $draft = null,
    ) {}

    public function system(): string
    {
        return self::SYSTEM;
    }

    public function user(): string
    {
        $lines = [
            'Networks: '.implode(', ', array_map(fn (Platform $p) => $p->label(), $this->platforms)),
            'Post: '.match ($this->format) {
                PostFormat::Text => 'a text post',
                PostFormat::Image => 'the caption for an image the writer will attach',
                PostFormat::Video => 'the caption for a video the writer will attach',
            },
            $this->tone ? "Tone: {$this->tone}" : null,
            'Character limit: '.$this->limit(),
            '',
            'Brief: '.trim($this->brief),
        ];

        $request = implode("\n", array_filter($lines, fn (?string $line) => $line !== null));

        return filled($this->draft)
            ? "<draft>\n".trim($this->draft)."\n</draft>\n\n".$request
            : $request;
    }

    /**
     * The strictest limit among the networks the post is going to.
     */
    public function limit(): int
    {
        return min(array_map(fn (Platform $p) => $p->characterLimit(), $this->platforms));
    }
}
