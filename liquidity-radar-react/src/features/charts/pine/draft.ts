// What the Pine editor holds — kept across tab switches and menu close/open
// (for the session; saved scripts are the persistent copy).
import { getIndicators } from '../indicators/store'
import type { IndicatorInstance } from '../indicators/store'
import { PINE_TEMPLATE } from './examples'
import { scriptTitle } from './indicator'

export interface PineDraft {
  code: string
  name: string
  /** Saved script being edited (Save overwrites it). */
  savedId?: string
  /** On-chart instance being edited (Update applies to it). */
  uid?: string
}

let draft: PineDraft = { code: PINE_TEMPLATE, name: 'My Indicator' }

export function getDraft(): PineDraft {
  return draft
}
export function setDraft(next: Partial<PineDraft>, replace = false): void {
  draft = replace ? { code: '', name: '', ...next } : { ...draft, ...next }
}

/** Point the editor at an existing on-chart script (of the chart whose
 *  instances are `items`; the main chart's by default). */
export function editPineInstance(uid: string, items: IndicatorInstance[] = getIndicators()): void {
  const inst = items.find((i) => i.uid === uid)
  if (!inst) return
  draft = { code: inst.script || '', name: inst.title || scriptTitle(inst.script || ''), uid }
}
