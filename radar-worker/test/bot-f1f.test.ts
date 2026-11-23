// Experimental strategy F1F (src/bot/f1f.ts): training rows, the stored
// model, and parity between the live take / skip and the research inputs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bar } from '../src/bot/features.ts'
import { F1F, F1F_INPUTS, f1fDecide, f1fProb, f1fRows, f1fState, f1fTick, fitF1F, trainF1F } from '../src/bot/f1f.ts'
import type { F1FModel } from '../src/bot/f1f.ts'
import { f1FlatAt } from '../src/bot/c6.ts'
import { F1F_STRATEGY, STRATEGIES, parseStrategies } from '../src/bot/strategies.ts'
import type { BotStore } from '../src/bot/store.ts'

const STEP = 14_400_000
const T0 = Date.UTC(2019, 0, 1)

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

/** Trending random walk with regime changes (F1 trades of every kind). */
function market(n: number, seed: number): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) drift = (r() - 0.45) * 0.01
    const o = p
    const c = o * (1 + drift + (r() - 0.5) * 0.025)
    const v = 100 + r() * 100
    out.push({ t: T0 + i * STEP, o, h: Math.max(o, c) * (1 + r() * 0.01), l: Math.min(o, c) * (1 - r() * 0.01), c, v, tb: v / 2 })
    p = c
  }
  return out
}

const BARS: Record<string, Bar[]> = { BTCUSDT: market(3500, 1), AAAUSDT: market(3500, 2), BBBUSDT: market(3500, 3), CCCUSDT: market(3500, 4) }

function fakeStore(state: Record<string, unknown> = {}) {
  const events: string[] = []
  const store = {
    getState: async (k: string, d: unknown) => (k in state ? state[k] : d),
    setState: async (k: string, v: unknown) => void (state[k] = v),
    event: async (_l: string, _s: string | null, m: string) => void events.push(m),
  } as unknown as BotStore
  return { store, state, events }
}

test('F1F is registered as a rule strategy with F1 entries and exits, no health bands', () => {
  assert.equal(STRATEGIES.f1f, F1F_STRATEGY)
  assert.equal(F1F_STRATEGY.health, undefined, 'never promoted')
  assert.deepEqual(F1F_STRATEGY.refs, ['BTCUSDT'])
  assert.equal(parseStrategies('f1:live,f1f:shadow')![1].state, 'shadow')
  assert.equal(F1F_INPUTS.length, 16)
})

test('rows: every F1 trade with 16 inputs and a net result; model fits only on trades closed before the embargo', () => {
  const rows = f1fRows(BARS, {}, STEP)
  assert.ok(rows.length > 20, `${rows.length} rows`)
  assert.ok(rows.every((r) => r.x.length === 16 && r.x.every(Number.isFinite) && Number.isFinite(r.r)))
  const keep = F1F.minRows
  F1F.minRows = 5
  try {
    const cut = rows[Math.floor(rows.length / 2)].tExit + F1F.embargoMs + 1
    const m = fitF1F(rows, cut)!
    assert.equal(m.n, rows.filter((r) => r.tExit < cut - F1F.embargoMs).length)
    assert.ok(m.base > 0 && m.base < 1)
    assert.equal(fitF1F(rows, rows[0].tExit), null, 'nothing closed yet')
  } finally {
    F1F.minRows = keep
  }
})

test('live decision equals the research inputs on the same bars', async () => {
  const rows = f1fRows(BARS, {}, STEP)
  const keep = F1F.minRows
  F1F.minRows = 5
  f1fState.reset()
  try {
    const m = fitF1F(rows, Infinity) as F1FModel
    const { store } = fakeStore({ [F1F.stateKey]: m })
    let checked = 0
    for (const r of rows.filter((x) => x.sym === 'AAAUSDT')) {
      const b = BARS.AAAUSDT.slice(0, r.i + 1)
      if (!f1FlatAt(b, r.i)) continue
      const T = b[r.i].t
      f1fState.loaded = false
      f1fState.symbols = Object.keys(BARS)
      f1fState.bars = async (s, _i, n) => BARS[s].filter((x) => x.t <= T).slice(-n)
      f1fState.funding = async () => []
      const d = await f1fDecide(store, 'AAAUSDT', b, r.i, BARS.BTCUSDT.filter((x) => x.t <= T), STEP)
      assert.ok(d.p != null, d.note)
      assert.ok(Math.abs(d.p! - f1fProb(m, r.x)) < 1e-6, `live ${d.p} vs research ${f1fProb(m, r.x)}`)
      assert.equal(d.take, f1fProb(m, r.x) >= m.base)
      if (++checked >= 3) break
    }
    assert.ok(checked > 0, 'no candidate bar checked')
  } finally {
    F1F.minRows = keep
    f1fState.reset()
  }
})

test('no model: skips with a note; training stores the model and tick does not retrain a fresh one', async () => {
  f1fState.reset()
  const { store, state, events } = fakeStore()
  const b = BARS.AAAUSDT
  const none = await f1fDecide(store, 'AAAUSDT', b, b.length - 1, BARS.BTCUSDT, STEP)
  assert.equal(none.take, false)
  const keep = F1F.minRows
  F1F.minRows = 5
  try {
    f1fState.bars = async (s) => BARS[s] ?? []
    f1fState.funding = async () => []
    const m = await trainF1F(store, Object.keys(BARS), { stepMs: STEP, now: b.at(-1)!.t + 30 * 86_400_000 })
    assert.ok(m && state[F1F.stateKey] === m)
    assert.match(events.at(-1)!, /^f1f: model trained on \d+ F1 trades of \d markets/)
    f1fState.loaded = false
    const heavy = { at: 0, spacingMs: 0 }
    await f1fTick(store, Object.keys(BARS), { stepMs: STEP, heavy, now: m!.createdAt + 1000 })
    assert.equal(f1fState.training, null, 'a fresh model is not retrained')
  } finally {
    F1F.minRows = keep
    f1fState.reset()
  }
})
