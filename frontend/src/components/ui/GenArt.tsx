import type { CSSProperties, ReactNode } from 'react'
import { NOISE } from '../../lib/noise'
import { cn } from '../../lib/cn'

export type ArtVariant =
  | 'sun'
  | 'product'
  | 'orb'
  | 'topo'
  | 'dune'
  | 'rings'
  | 'bloom'
  | 'bauhaus'
  | 'arch'
  | 'night'
  | 'ceramic'
  | 'stripes'

/**
 * Stand-ins for AI-generated images, painted with CSS so the page ships no stock photos.
 * Each one is meant to read as a different kind of output: landscape, product shot, 3D render…
 */
const BACKDROP: Record<ArtVariant, string> = {
  sun: 'linear-gradient(180deg, #17142c 0%, #4a2a4f 38%, #c0643f 64%, #f2a064 70%, #2a1512 71%, #0f0807 100%)',
  product: 'radial-gradient(120% 90% at 50% 20%, #e7e1d6 0%, #cfc6b7 55%, #a89e8d 100%)',
  orb: 'radial-gradient(90% 70% at 50% 100%, #1b1a2e 0%, #0b0b12 60%, #050508 100%)',
  topo: 'repeating-radial-gradient(circle at 30% 115%, #26301f 0 5%, #3e5134 5% 10%, #6f8a5a 10% 15%, #a9bb8d 15% 20%, #d9dfc4 20% 25%)',
  dune: 'linear-gradient(180deg, #f1e4d2 0%, #e9c9a3 40%, #d99b6c 58%, #9a4f2f 59%, #5b2a19 100%)',
  rings: 'repeating-radial-gradient(circle at 70% 30%, #0e0e0f 0 9px, #e9e7e1 9px 10px)',
  bloom:
    'radial-gradient(60% 55% at 22% 30%, #ff9f7a 0%, transparent 70%), radial-gradient(55% 60% at 80% 72%, #7c5cff 0%, transparent 70%), radial-gradient(50% 50% at 70% 18%, #ff5f8f 0%, transparent 70%), #2a1238',
  bauhaus: '#ece3d1',
  arch: '#e6d8c3',
  night: 'radial-gradient(120% 80% at 50% 110%, #24335f 0%, #111a33 45%, #070a14 100%)',
  ceramic: 'linear-gradient(180deg, #d9cbb6 0%, #d9cbb6 66%, #c4b49c 66%, #b9a78d 100%)',
  stripes:
    'linear-gradient(180deg, #f6d8a8 0 18%, #f1b27a 18% 34%, #e27d55 34% 50%, #b84b3e 50% 66%, #6e2a3a 66% 82%, #2c1530 82% 100%)',
}

const layer = (style: CSSProperties, className = '') => (
  <div aria-hidden className={cn('absolute', className)} style={style} />
)

export function GenArt({
  variant,
  className,
  style,
  children,
}: {
  variant: ArtVariant
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div className={cn('relative isolate overflow-hidden', className)} style={{ ...style, background: BACKDROP[variant] }}>
      {variant === 'sun' && (
        <>
          {layer({
            left: '50%',
            bottom: '30%',
            width: '70%',
            height: '40%',
            transform: 'translateX(-50%)',
            background: 'radial-gradient(50% 60% at 50% 100%, rgb(255 170 100 / 0.55), transparent)',
          })}
          {/* Sits on the horizon line (30% from the bottom) with its lower half clipped away. */}
          {layer({
            left: '50%',
            bottom: '30%',
            width: '38%',
            aspectRatio: '1',
            transform: 'translate(-50%, 50%)',
            borderRadius: '9999px',
            background: 'radial-gradient(circle at 50% 30%, #fff3dd 0%, #ffc48a 40%, #f47b43 100%)',
            clipPath: 'inset(0 0 50% 0)',
          })}
        </>
      )}

      {variant === 'product' && (
        <>
          {layer(
            {
              left: '50%',
              bottom: '12%',
              width: '52%',
              height: '7%',
              transform: 'translateX(-50%)',
              borderRadius: '50%',
              background: 'radial-gradient(closest-side, rgb(40 30 20 / 0.45), transparent)',
              filter: 'blur(4px)',
            },
          )}
          {layer(
            {
              left: '50%',
              top: '14%',
              width: '34%',
              height: '70%',
              transform: 'translateX(-50%) rotate(-8deg)',
              borderRadius: '14%/8%',
              background: 'linear-gradient(160deg, #2a2a2e 0%, #0f0f11 100%)',
              boxShadow: 'inset 0 0 0 2px #3a3a3f, 12px 18px 30px -10px rgb(50 35 20 / 0.45)',
            },
          )}
          {layer(
            {
              left: '50%',
              top: '17%',
              width: '28%',
              height: '63%',
              transform: 'translateX(-50%) rotate(-8deg)',
              borderRadius: '11%/6%',
              background: 'linear-gradient(200deg, #f5b58a 0%, #8b7cf6 55%, #2b2a6e 100%)',
            },
          )}
        </>
      )}

      {variant === 'orb' && (
        <>
          {layer(
            {
              left: '50%',
              top: '44%',
              width: '58%',
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              borderRadius: '9999px',
              background:
                'radial-gradient(circle at 34% 28%, #ffffff 0%, color-mix(in oklab, var(--color-accent-soft) 40%, #fff) 6%, var(--color-accent-soft) 24%, color-mix(in oklab, var(--color-accent) 75%, #000) 50%, color-mix(in oklab, var(--color-accent) 22%, #000) 78%, var(--color-ink) 100%)',
              boxShadow: '0 30px 60px -20px color-mix(in oklab, var(--color-accent) 50%, transparent)',
            },
          )}
          {layer(
            {
              left: '50%',
              bottom: '10%',
              width: '50%',
              height: '6%',
              transform: 'translateX(-50%)',
              borderRadius: '50%',
              background: 'radial-gradient(closest-side, color-mix(in oklab, var(--color-accent) 35%, transparent), transparent)',
              filter: 'blur(6px)',
            },
          )}
        </>
      )}

      {variant === 'dune' &&
        layer(
          {
            left: '-20%',
            right: '-20%',
            top: '46%',
            height: '80%',
            borderRadius: '50% 50% 0 0 / 30% 30% 0 0',
            background: 'linear-gradient(180deg, #c98556 0%, #8f4a2c 40%, #4e2415 100%)',
          },
        )}

      {variant === 'bauhaus' && (
        <>
          {layer({ left: '-18%', top: '-14%', width: '78%', aspectRatio: '1', borderRadius: '9999px', background: '#d4553a' })}
          {layer({ right: '0', bottom: '0', width: '56%', height: '46%', background: '#1f2b59' })}
          {layer({
            right: '8%',
            top: '16%',
            width: '30%',
            aspectRatio: '1',
            borderRadius: '9999px 9999px 0 0',
            background: '#e5b13a',
          })}
          {layer({ left: '10%', bottom: '12%', width: '38%', height: '3%', background: '#121212' })}
        </>
      )}

      {variant === 'arch' && (
        <>
          {/* A doorway cut into a plaster wall, sky behind it. */}
          {layer({
            left: '22%',
            right: '22%',
            top: '16%',
            bottom: '0',
            borderRadius: '9999px 9999px 0 0',
            background: 'linear-gradient(180deg, #8fb6e0 0%, #c9d7e6 48%, #f4c9a6 82%, #eaa98a 100%)',
            boxShadow: 'inset 10px 0 18px -8px rgb(80 50 20 / 0.35)',
          })}
          {layer({
            left: '44%',
            bottom: '22%',
            width: '14%',
            aspectRatio: '1',
            borderRadius: '9999px',
            background: 'radial-gradient(circle at 40% 35%, #fff6e8, #ffc58f)',
          })}
          {layer({ left: '0', right: '0', bottom: '0', height: '12%', background: '#cdb89b' })}
        </>
      )}

      {variant === 'night' && (
        <>
          {layer({
            inset: 0,
            backgroundImage:
              'radial-gradient(1px 1px at 18% 22%, #fff 99%, transparent), radial-gradient(1px 1px at 72% 14%, #fff 99%, transparent), radial-gradient(1.5px 1.5px at 44% 38%, #fff 99%, transparent), radial-gradient(1px 1px at 86% 44%, #fff 99%, transparent), radial-gradient(1px 1px at 30% 60%, #ffffffaa 99%, transparent), radial-gradient(1px 1px at 62% 56%, #ffffffaa 99%, transparent)',
          })}
          {layer({
            right: '20%',
            top: '16%',
            width: '22%',
            aspectRatio: '1',
            borderRadius: '9999px',
            background: '#f3ead6',
            boxShadow: '0 0 40px 6px rgb(243 234 214 / 0.25)',
          })}
          {layer({
            left: '-10%',
            right: '-10%',
            bottom: '-30%',
            height: '62%',
            borderRadius: '50% 50% 0 0',
            background: '#0a0f1f',
          })}
        </>
      )}

      {variant === 'ceramic' && (
        <>
          {layer({
            left: '50%',
            bottom: '30%',
            width: '58%',
            height: '8%',
            transform: 'translate(-50%, 50%)',
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgb(70 45 25 / 0.4), transparent)',
            filter: 'blur(3px)',
          })}
          {/* A vase: round belly, narrow neck. */}
          {layer({
            left: '50%',
            bottom: '30%',
            width: '40%',
            height: '42%',
            transform: 'translateX(-50%)',
            borderRadius: '46% 46% 40% 40% / 58% 58% 42% 42%',
            background: 'radial-gradient(circle at 34% 30%, #e99a74 0%, #c8603d 45%, #7d3420 100%)',
          })}
          {layer({
            left: '50%',
            bottom: '66%',
            width: '16%',
            height: '16%',
            transform: 'translateX(-50%)',
            borderRadius: '30% 30% 10% 10%',
            background: 'linear-gradient(90deg, #8e3d25, #cf6e48 40%, #8e3d25)',
          })}
        </>
      )}

      {variant === 'stripes' &&
        layer({
          left: '50%',
          top: '22%',
          width: '46%',
          aspectRatio: '1',
          transform: 'translateX(-50%)',
          borderRadius: '9999px',
          background: 'linear-gradient(180deg, #fff1d6 0%, #ffd19a 100%)',
          mixBlendMode: 'soft-light',
        })}

      {variant === 'rings' &&
        layer({ inset: 0, background: 'linear-gradient(135deg, transparent 40%, color-mix(in oklab, var(--color-accent) 35%, transparent) 100%)', mixBlendMode: 'multiply' })}

      <div aria-hidden className="absolute inset-0 opacity-40 mix-blend-overlay" style={{ backgroundImage: NOISE }} />
      {children}
    </div>
  )
}
