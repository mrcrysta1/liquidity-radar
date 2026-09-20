// Bar-replay transport for the price-action chart. The toolbar button arms
// replay; the bar below the chart scrubs it.
import { useEffect, useState } from 'react'
import {
  SPEEDS,
  exitReplay,
  playPause,
  replayInfo,
  restart,
  seek,
  setSpeed,
  step,
  subscribeReplay,
  toggleReplay,
} from '../../features/charts/replay'

function useReplay() {
  const [, force] = useState(0)
  useEffect(() => subscribeReplay(() => force((n) => n + 1)), [])
  return replayInfo()
}

/** Toolbar button — sits beside the chart-style controls. */
export function ReplayButton() {
  const r = useReplay()
  return (
    <button
      type="button"
      className={'tv-chip replay-btn' + (r.on ? ' on' : '')}
      aria-pressed={r.on}
      title={r.on ? 'Exit bar replay' : 'Bar replay — step through history'}
      onClick={toggleReplay}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path
          d="M11 5 4 12l7 7M20 5l-7 7 7 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Replay
    </button>
  )
}

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d={d}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0.6 : 2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const PLAY = 'M8 5.5 18.5 12 8 18.5Z'
const PAUSE = 'M9 5.5h2.6v13H9zM12.9 5.5h2.6v13h-2.6z'

/** The transport itself — rendered under the chart, only while replay is on. */
export function ReplayBar() {
  const r = useReplay()
  if (!r.on) return null
  const at = r.at
  const stamp = at
    ? new Date(at.t).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
  const done = r.idx >= r.total

  return (
    <div className="replay-bar" role="group" aria-label="Bar replay">
      <div className="replay-transport">
        <button type="button" title="Back to start" onClick={restart} aria-label="Back to start">
          <Icon d="M7 5.5v13M18.5 5.5 9.5 12l9 6.5Z" />
        </button>
        <button type="button" title="Step back" onClick={() => step(-1)} aria-label="Step back">
          <Icon d="M15.5 5.5 6.5 12l9 6.5Z" />
        </button>
        <button
          type="button"
          className={'replay-play' + (r.playing ? ' on' : '')}
          onClick={playPause}
          title={r.playing ? 'Pause' : done ? 'Replay from the middle' : 'Play'}
          aria-label={r.playing ? 'Pause' : 'Play'}
        >
          <Icon d={r.playing ? PAUSE : PLAY} filled />
        </button>
        <button
          type="button"
          title="Step forward"
          onClick={() => step(1)}
          aria-label="Step forward"
        >
          <Icon d="M8.5 5.5 17.5 12l-9 6.5Z" />
        </button>
      </div>

      <input
        className="replay-scrub"
        type="range"
        min={1}
        max={Math.max(1, r.total)}
        value={r.idx}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Replay position"
      />

      <div className="replay-meta">
        <span className="replay-at">{stamp}</span>
        <span className="replay-count">
          {r.idx}/{r.total}
        </span>
      </div>

      <select
        className="replay-speed"
        value={r.speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        aria-label="Replay speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <button type="button" className="replay-exit" onClick={exitReplay}>
        Exit
      </button>
    </div>
  )
}
