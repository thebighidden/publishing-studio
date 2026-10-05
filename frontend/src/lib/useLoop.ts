import { useEffect, useState } from 'react'

/**
 * Steps through `durations` one index at a time while `active` is true, then wraps.
 * Each entry is how long (ms) to hold that step before moving on.
 */
export function useLoop(durations: number[], active: boolean) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => setStep((s) => (s + 1) % durations.length), durations[step])
    return () => window.clearTimeout(t)
  }, [step, active, durations])

  return step
}
