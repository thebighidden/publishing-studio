import type { ReactNode } from 'react'
import { Bookmark, Camera, Heart, MessageCircle, Music2, Repeat2, Send, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '../../lib/cn'

type Overlay = 'reels' | 'tiktok' | 'shorts' | 'story' | null

/**
 * The piece on a phone, the way someone scrolling sees it. With `overlay`, the platform's own
 * buttons and caption sit on top, so a subject hidden under the like button shows up before
 * the post does. The dashed box is the area every one of those apps leaves clear.
 */
export function PhoneFrame({ aspect, overlay, showOverlay, children, className }: { aspect: string; overlay: Overlay; showOverlay: boolean; children: ReactNode; className?: string }) {
  const [w, h] = aspect.split(':').map(Number)
  // Only full-screen shapes (9:16 and close) fill it; a 4:5 feed post sits in the middle.
  const vertical = h / w >= 1.6
  return (
    <div className={cn('relative mx-auto aspect-[9/19.5] h-full max-h-[min(72vh,760px)] rounded-[38px] border border-line-2 bg-black p-2.5 shadow-[0_40px_120px_-40px_rgb(0_0_0_/_0.9)]', className)}>
      <div className="relative size-full overflow-hidden rounded-[30px] bg-[#0b0b0c]">
        {/* The media fills a vertical screen; other shapes sit in the middle, as the app shows them. */}
        <div className={cn('absolute inset-x-0', vertical ? 'inset-y-0' : 'top-1/2 -translate-y-1/2')} style={vertical ? undefined : { aspectRatio: `${w} / ${h}` }}>
          {children}
        </div>
        {showOverlay && overlay && <PlatformOverlay kind={overlay} />}
        <div className="pointer-events-none absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
      </div>
    </div>
  )
}

function Rail({ items }: { items: Array<{ icon: typeof Heart; label?: string }> }) {
  return (
    <div className="absolute bottom-[17%] right-2 flex flex-col items-center gap-3.5">
      {items.map(({ icon: Icon, label }, i) => (
        <span key={i} className="flex flex-col items-center gap-0.5 text-white drop-shadow">
          <Icon className="size-[22px]" strokeWidth={1.75} />
          {label && <span className="text-[9px] font-medium">{label}</span>}
        </span>
      ))}
    </div>
  )
}

function Caption({ handle, lines, extra }: { handle: string; lines: string[]; extra?: ReactNode }) {
  return (
    <div className="absolute inset-x-3 bottom-[5%] right-14 text-white drop-shadow">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold">
        <span className="size-5 rounded-full bg-white/80" />
        {handle}
        {extra}
      </p>
      {lines.map((l) => (
        <p key={l} className="mt-1 truncate text-[10px] text-white/90">
          {l}
        </p>
      ))}
    </div>
  )
}

function PlatformOverlay({ kind }: { kind: NonNullable<Overlay> }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Clear of every app's buttons, caption and header. */}
      <div className="absolute inset-x-[6%] bottom-[24%] top-[13%] right-[17%] rounded-lg border border-dashed border-white/35" />
      <span className="absolute left-[7%] top-[13.5%] rounded bg-black/50 px-1.5 py-px font-mono text-[8.5px] text-white/80">safe zone</span>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />

      {kind === 'reels' && (
        <>
          <p className="absolute left-4 top-9 flex w-[calc(100%-2rem)] items-center justify-between text-[13px] font-semibold text-white drop-shadow">
            Reels <Camera className="size-4" strokeWidth={1.75} />
          </p>
          <Rail items={[{ icon: Heart, label: '12.4K' }, { icon: MessageCircle, label: '318' }, { icon: Send }, { icon: Bookmark }]} />
          <Caption handle="your_brand" lines={['Your caption shows here…', '♫ Original audio']} extra={<span className="rounded border border-white/70 px-1.5 text-[9px]">Follow</span>} />
        </>
      )}
      {kind === 'tiktok' && (
        <>
          <p className="absolute inset-x-0 top-9 flex justify-center gap-4 text-[12px] font-semibold text-white/70 drop-shadow">
            Following <span className="text-white underline decoration-2 underline-offset-4">For You</span>
          </p>
          <Rail items={[{ icon: Heart, label: '98K' }, { icon: MessageCircle, label: '1,204' }, { icon: Bookmark, label: '5K' }, { icon: Share2, label: 'Share' }, { icon: Music2 }]} />
          <Caption handle="@your_brand" lines={['Your caption and #hashtags…', '♫ original sound']} />
        </>
      )}
      {kind === 'shorts' && (
        <>
          <p className="absolute left-4 top-9 text-[12px] font-semibold text-white drop-shadow">Shorts</p>
          <Rail items={[{ icon: ThumbsUp, label: '24K' }, { icon: ThumbsDown }, { icon: MessageCircle, label: '402' }, { icon: Share2 }, { icon: Repeat2 }]} />
          <Caption handle="@your_brand" lines={['Your title goes here']} extra={<span className="rounded-full bg-white px-2 text-[9px] text-black">Subscribe</span>} />
        </>
      )}
      {kind === 'story' && (
        <>
          <div className="absolute inset-x-3 top-8 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn('h-0.5 flex-1 rounded-full', i === 0 ? 'bg-white' : 'bg-white/40')} />
            ))}
          </div>
          <p className="absolute left-3 top-11 flex items-center gap-1.5 text-[11px] font-semibold text-white drop-shadow">
            <span className="size-5 rounded-full bg-white/80" /> your_brand <span className="font-normal text-white/70">2h</span>
          </p>
          <div className="absolute inset-x-3 bottom-[4%] flex items-center gap-2">
            <span className="flex-1 rounded-full border border-white/60 px-3 py-1.5 text-[10px] text-white/80">Send message</span>
            <Heart className="size-5 text-white" strokeWidth={1.75} />
            <Send className="size-5 text-white" strokeWidth={1.75} />
          </div>
        </>
      )}
    </div>
  )
}
