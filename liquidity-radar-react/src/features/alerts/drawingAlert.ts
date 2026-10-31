// "Add alert" on a selected drawing (the drawing toolbar): opens the alerts
// modal on a Conditions rule already set to that drawing — a cross of its
// line, or entering its channel — as "Use selected drawing" there does.
import { openModal } from '../../utils/dom'

let pending = false

/** Open the alerts modal pre-filled for the drawing selected on the chart. */
export function openAlertForSelectedDrawing(): void {
  pending = true
  openModal('alModal')
}

/** The modal, as it opens: whether to pre-fill from the selection (once). */
export function takeDrawingAlertRequest(): boolean {
  const v = pending
  pending = false
  return v
}

/** Drawing types an alert can follow (features/alerts/conditions drawingLines). */
export const ALERTABLE_DRAWINGS = [
  'trend',
  'arrow',
  'infoline',
  'ray',
  'extended',
  'hline',
  'hray',
  'parallel',
  'flatchannel',
]
