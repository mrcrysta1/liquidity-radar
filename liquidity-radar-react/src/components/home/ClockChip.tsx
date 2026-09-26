// Date and local time beside the search bar, with a live dot — ticks once a
// minute on the minute rather than every second.
import { useEffect, useState } from 'react'

export function ClockChip() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>
    const arm = () => {
      const d = new Date()
      id = setTimeout(
        () => {
          setNow(new Date())
          arm()
        },
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50,
      )
    }
    arm()
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="clock-chip" aria-label="Local date and time">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="3.5"
          y="5"
          width="17"
          height="15"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M3.5 10h17M8 3v4M16 3v4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span>{now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <i className="clock-dot" />
      <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</b>
    </div>
  )
}
