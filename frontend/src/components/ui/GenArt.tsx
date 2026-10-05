import type { CSSProperties, ReactNode } from 'react'
import { NOISE } from '../../lib/noise'
import { cn } from '../../lib/cn'

export type ArtVariant = 'sun' | 'product' | 'orb' | 'topo' | 'dune' | 'rings'

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
}

const layer = (style: CSSProperties, className = '') => (
  <div aria-hidden className={cn('absolute', className)} style={style} />
)

export function GenArt({ variant, className, children }: { variant: ArtVariant; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('relative isolate overflow-hidden', className)} style={{ background: BACKDROP[variant] }}>
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
                'radial-gradient(circle at 34% 28%, #ffffff 0%, #d9dbff 6%, #8b93ff 24%, #4338ca 50%, #1a1745 78%, #0b0a1a 100%)',
              boxShadow: '0 30px 60px -20px rgb(99 102 241 / 0.5)',
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
              background: 'radial-gradient(closest-side, rgb(139 147 255 / 0.35), transparent)',
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

      {variant === 'rings' &&
        layer({ inset: 0, background: 'linear-gradient(135deg, transparent 40%, rgb(99 102 241 / 0.35) 100%)', mixBlendMode: 'multiply' })}

      <div aria-hidden className="absolute inset-0 opacity-40 mix-blend-overlay" style={{ backgroundImage: NOISE }} />
      {children}
    </div>
  )
}
