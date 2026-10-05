import { useEffect, useState } from 'react'

/** Reveals `text` one character at a time while `active`; resets when it goes false. */
export function useTypewriter(text: string, active: boolean, speed = 32) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!active) {
      setCount(0)
      return
    }
    if (count >= text.length) return
    // Small jitter so it reads like a person typing, not a metronome.
    const t = window.setTimeout(() => setCount((c) => c + 1), speed + Math.random() * speed * 0.9)
    return () => window.clearTimeout(t)
  }, [active, count, text, speed])

  return { value: text.slice(0, count), done: count >= text.length }
}
