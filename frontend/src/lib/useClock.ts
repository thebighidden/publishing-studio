import { useEffect, useState } from 'react'

/** The current local time, ticking once a second. */
export function useClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  return now
}

export const formatTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour12: false })
