// The Learning library, in reading order. To add a topic: add an entry to the
// matching section file, add a line to WHATS_NEW (basics.ts), and bump
// LEARN_UPDATED. The Settings page and the PDF are both built from this.
import { RISK, START, TECH, WHATS_NEW } from './basics'
import { CONCEPTS } from './concepts'
import { INDICATORS } from './indicators'
import { MODELS } from './models'
import { PATTERNS } from './patterns'
import type { LearnSection } from './types'

export const LEARN_UPDATED = '2026-10-03'

export const LEARN_SECTIONS: LearnSection[] = [START, MODELS, INDICATORS, CONCEPTS, PATTERNS, RISK, TECH]

export { WHATS_NEW }

/** Entries matching a search, across every section (title, summary, tags, id). */
export function searchLearn(query: string): LearnSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return LEARN_SECTIONS
  return LEARN_SECTIONS.map((s) => ({
    ...s,
    entries: s.entries.filter((e) =>
      (e.title + ' ' + e.summary + ' ' + e.id + ' ' + (e.tags ?? []).join(' ')).toLowerCase().includes(q),
    ),
  })).filter((s) => s.entries.length)
}

export function entryCount(): number {
  return LEARN_SECTIONS.reduce((a, s) => a + s.entries.length, 0)
}
