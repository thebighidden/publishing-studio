import type { ReactNode } from 'react'
import { Bookmark, ChartNoAxesColumn, Globe, Heart, MessageCircle, Music2, Play, Repeat2, Send, Share2, ThumbsUp } from 'lucide-react'
import { GenArt, type ArtVariant } from '../components/ui/GenArt'
import { PLATFORMS, type PlatformId } from '../components/ui/PlatformIcon'
import type { PostFormat, User } from '../lib/api'
import { cn } from '../lib/cn'
import { CHAR_LIMIT } from './data'
import { Avatar } from './ui'

type Props = { platform: PlatformId; title: string; body: string; format: PostFormat; user: User }

const handleOf = (user: User) => user.email.split('@')[0].replace(/[^a-z0-9_.]/gi, '').toLowerCase()

/** Text up to the network's limit as normal, anything past it marked the way X marks overflow. */
function Body({ text, limit, className, clamp }: { text: string; limit: number; className?: string; clamp?: number }) {
  const chars = [...text]
  const ok = chars.slice(0, limit).join('')
  const over = chars.slice(limit).join('')
  const shown = clamp && ok.length > clamp ? ok.slice(0, clamp) : null

  if (!text.trim()) return <p className={cn('text-dim', className)}>Start writing to see the preview.</p>
  return (
    <p className={cn('whitespace-pre-wrap break-words', className)}>
      {shown ?? ok}
      {shown && <span className="text-dim">… see more</span>}
      {!shown && over && <mark className="rounded-[2px] bg-fail/25 text-fg">{over}</mark>}
    </p>
  )
}

/**
 * Media is a stand-in: the post's format says what kind of asset it will carry, and the
 * preview shows where it sits. Uploads aren't part of the composer yet.
 */
function Media({ format, variant, ratio, className }: { format: PostFormat; variant: ArtVariant; ratio: string; className?: string }) {
  return (
    <GenArt variant={variant} className={cn('w-full', ratio, className)}>
      {format === 'video' && (
        <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur">
          <Play className="size-4 translate-x-px" fill="currentColor" />
        </span>
      )}
      <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/85 backdrop-blur">
        {format === 'video' ? 'Video' : 'Image'} placeholder
      </span>
    </GenArt>
  )
}

export function PostPreview({ platform, title, body, format, user }: Props) {
  const limit = CHAR_LIMIT[platform]
  const handle = handleOf(user)
  const text = body
  const hasMedia = format !== 'text'

  if (platform === 'x') {
    return (
      <div className="flex gap-3 p-4">
        <Avatar user={user} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="truncate text-dim">@{handle} · now</span>
          </p>
          <Body text={text} limit={limit} className="mt-1 text-[13.5px] leading-snug" />
          {hasMedia && <Media format={format} variant="sun" ratio="aspect-video" className="mt-3 rounded-2xl border border-line" />}
          <div className="mt-3 flex justify-between pr-6 text-dim">
            <MessageCircle className="size-4" strokeWidth={1.5} />
            <Repeat2 className="size-4" strokeWidth={1.5} />
            <Heart className="size-4" strokeWidth={1.5} />
            <ChartNoAxesColumn className="size-4" strokeWidth={1.5} />
            <Share2 className="size-4" strokeWidth={1.5} />
          </div>
        </div>
      </div>
    )
  }

  if (platform === 'instagram') {
    return (
      <div>
        <div className="flex items-center gap-2.5 p-3">
          <Avatar user={user} className="size-7 ring-2 ring-[#e87ba4]/60 ring-offset-2 ring-offset-[#0b0b0c]" />
          <span className="text-[12.5px] font-semibold">{handle}</span>
        </div>
        <Media format={hasMedia ? format : 'image'} variant={format === 'video' ? 'orb' : 'dune'} ratio="aspect-[4/5]" />
        <div className="flex items-center gap-3.5 px-3 pt-3 text-fg">
          <Heart className="size-[18px]" strokeWidth={1.5} />
          <MessageCircle className="size-[18px]" strokeWidth={1.5} />
          <Send className="size-[18px]" strokeWidth={1.5} />
          <Bookmark className="ml-auto size-[18px]" strokeWidth={1.5} />
        </div>
        <div className="px-3 pb-4 pt-2 text-[12.5px] leading-snug">
          <span className="font-semibold">{handle}</span> <Body text={text} limit={limit} clamp={125} className="inline" />
        </div>
        {!hasMedia && <Note>Instagram posts need an image or a video.</Note>}
      </div>
    )
  }

  if (platform === 'tiktok' || platform === 'youtube') {
    return (
      <div className="p-3">
        <div className="relative overflow-hidden rounded-lg">
          <Media format="video" variant={platform === 'tiktok' ? 'orb' : 'sun'} ratio={platform === 'tiktok' ? 'aspect-[9/14]' : 'aspect-video'} />
          {platform === 'tiktok' && (
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-3 pt-10 text-white">
              <p className="text-[12.5px] font-semibold">@{handle}</p>
              <Body text={text} limit={limit} clamp={90} className="mt-1 text-[12px] leading-snug" />
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/80">
                <Music2 className="size-3" /> Original sound · {user.name}
              </p>
            </div>
          )}
        </div>
        {platform === 'youtube' && (
          <div className="mt-3 flex gap-2.5">
            <Avatar user={user} className="size-8" />
            <div className="min-w-0">
              <p className="line-clamp-2 text-[13px] font-medium leading-snug">{title || 'Untitled video'}</p>
              <p className="mt-0.5 text-[11.5px] text-dim">{user.name} · Just now</p>
              <Body text={text} limit={limit} clamp={110} className="mt-2 text-[12px] leading-snug text-muted" />
            </div>
          </div>
        )}
        {format !== 'video' && <Note>{PLATFORMS[platform].name} is video-first. Switch the format to Video.</Note>}
      </div>
    )
  }

  if (platform === 'pinterest') {
    return (
      <div className="p-3">
        <Media format={hasMedia ? format : 'image'} variant="topo" ratio="aspect-[2/3]" className="rounded-2xl" />
        <p className="mt-3 line-clamp-2 text-[13.5px] font-semibold leading-snug">{title || 'Untitled pin'}</p>
        <Body text={text} limit={limit} clamp={140} className="mt-1 text-[12px] leading-snug text-muted" />
        <p className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
          <Avatar user={user} className="size-5 text-[8px]" /> {user.name}
        </p>
        {!hasMedia && <Note>Pins need an image.</Note>}
      </div>
    )
  }

  // LinkedIn and Facebook share a shape: author row, text, optional media, reactions.
  return (
    <div>
      <div className="flex items-center gap-2.5 p-4 pb-0">
        <Avatar user={user} className="size-9" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{user.name}</p>
          <p className="flex items-center gap-1 text-[11px] text-dim">
            Just now · <Globe className="size-3" />
          </p>
        </div>
      </div>
      <Body text={text} limit={limit} clamp={platform === 'linkedin' ? 210 : 480} className="px-4 pt-3 text-[13px] leading-[1.5]" />
      {hasMedia && <Media format={format} variant="product" ratio="aspect-[4/3]" className="mt-3" />}
      <div className="mx-4 mt-3 flex justify-between border-t border-line py-2.5 text-[11.5px] text-dim">
        <span className="flex items-center gap-1.5">
          <ThumbsUp className="size-3.5" strokeWidth={1.5} /> Like
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle className="size-3.5" strokeWidth={1.5} /> Comment
        </span>
        <span className="flex items-center gap-1.5">
          {platform === 'linkedin' ? <Repeat2 className="size-3.5" strokeWidth={1.5} /> : <Share2 className="size-3.5" strokeWidth={1.5} />}
          {platform === 'linkedin' ? 'Repost' : 'Share'}
        </span>
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mx-3 mb-3 flex items-center gap-2 rounded-md border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[11.5px] text-warn">
      {children}
    </p>
  )
}
