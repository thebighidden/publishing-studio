import { NOISE } from '../../lib/noise'

/** Film grain over the whole page. Static, so it costs nothing after the first paint. */
export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-150 opacity-[0.045]"
      style={{ backgroundImage: NOISE }}
    />
  )
}
