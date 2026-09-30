// Loading placeholders for the dashboard tiles. Each shape mirrors the layout
// the tile renders once its data lands, so the card does not jump when it
// fills in. The caption says what is being waited on (screen readers get it
// through role="status").
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type SkelShape = 'price' | 'list' | 'score' | 'big' | 'bars' | 'news'

/** One shimmering block. */
export function Sk({
  w = '100%',
  h = 10,
  round,
}: {
  w?: number | string
  h?: number
  round?: boolean
}) {
  return <i className={'sk' + (round ? ' round' : '')} style={{ width: w, height: h }} />
}

function KvRows({ n }: { n: number }) {
  return (
    <div className="sk-kv">
      {Array.from({ length: n }, (_, i) => (
        <span key={i}>
          <Sk w={56 + (i % 2) * 14} />
          <Sk w={72 - (i % 3) * 10} />
        </span>
      ))}
    </div>
  )
}

function Shape({ shape, rows }: { shape: SkelShape; rows: number }) {
  switch (shape) {
    case 'price':
      return (
        <>
          <div className="sk-line">
            <Sk w="58%" h={30} />
            <Sk w={64} h={14} />
          </div>
          <div className="sk-split">
            <Sk h={58} />
            <KvRows n={3} />
          </div>
        </>
      )
    case 'list':
      return (
        <div className="sk-rows">
          {Array.from({ length: rows }, (_, i) => (
            <span key={i}>
              <Sk w={20} h={20} round />
              <Sk w={42} h={12} />
              <Sk w={`${38 - (i % 3) * 8}%`} />
              <Sk w={40} h={12} />
            </span>
          ))}
        </div>
      )
    case 'score':
      return (
        <>
          <Sk w={92} h={34} />
          <Sk h={8} />
          <KvRows n={rows} />
        </>
      )
    case 'big':
      return (
        <>
          <div className="sk-line">
            <Sk w={110} h={32} />
            <Sk w="40%" />
          </div>
          <KvRows n={rows} />
        </>
      )
    case 'bars':
      return (
        <div className="sk-bars">
          {Array.from({ length: 12 }, (_, i) => (
            <Sk key={i} h={14 + ((i * 37) % 44)} />
          ))}
        </div>
      )
    case 'news':
      return (
        <div className="sk-rows news">
          {Array.from({ length: rows }, (_, i) => (
            <span key={i}>
              <Sk w={48} h={40} />
              <span className="sk-stack">
                <Sk w={`${92 - (i % 3) * 12}%`} h={12} />
                <Sk w="34%" />
              </span>
              <Sk w={54} h={18} />
            </span>
          ))}
        </div>
      )
  }
}

/** After this long a loading tile stops shimmering and says it is slow. */
const STALL_MS = 25_000

/**
 * A tile's loading state. `still` stops the shimmer — for a feed that may
 * legitimately stay quiet (liquidations), where a forever-shimmer would read as
 * broken. Any other tile goes still by itself once `stallMs` passes without data.
 */
export function TileSkeleton({
  shape,
  rows = 3,
  still,
  stallMs = STALL_MS,
  children,
}: {
  shape: SkelShape
  rows?: number
  still?: boolean
  /** How long a normal wait may take before the tile admits it is slow. */
  stallMs?: number
  children: ReactNode
}) {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (still) return
    const t = setTimeout(() => setStalled(true), stallMs)
    return () => clearTimeout(t)
  }, [still, stallMs])
  const quiet = still || stalled
  return (
    <div className={'sk-tile' + (quiet ? ' still' : '')} role="status" aria-busy={!quiet}>
      <Shape shape={shape} rows={rows} />
      <p className="sk-cap">
        {still && <b className="sk-live" aria-hidden="true" />}
        {children}
        {stalled && ' Taking longer than usual.'}
      </p>
    </div>
  )
}
