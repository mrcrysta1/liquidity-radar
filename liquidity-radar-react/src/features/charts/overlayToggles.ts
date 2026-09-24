// On/off state for the chart overlays this session adds: Delta (CVD) pane,
// Whale-print bubbles, Volume Profile, multi-timeframe confluence strip,
// order-book imbalance gauge, and the ML prediction panel. Kept separate
// from the indicator store on purpose — these aren't user-configurable
// indicators, just layers to show or hide.
import { storageGet, storageSet } from '../../services/storage'

const DELTA_KEY = 'lr-showDelta'
const WHALE_KEY = 'lr-showWhaleBubbles'
const VP_KEY = 'lr-showVolumeProfile'
const MTF_KEY = 'lr-showConfluence'
const OB_KEY = 'lr-showObGauge'
const ML_KEY = 'lr-showMLPrediction'
const RL_KEY = 'lr-showRLPolicy'

let showDelta = storageGet<boolean>(DELTA_KEY, true)
let showWhales = storageGet<boolean>(WHALE_KEY, true)
let showVP = storageGet<boolean>(VP_KEY, true)
let showConfluence = storageGet<boolean>(MTF_KEY, true)
let showObGauge = storageGet<boolean>(OB_KEY, true)
let showMLPrediction = storageGet<boolean>(ML_KEY, true)
let showRLPolicy = storageGet<boolean>(RL_KEY, false)

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onOverlayTogglesChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getShowDelta(): boolean {
  return showDelta
}
export function setShowDelta(v: boolean): void {
  showDelta = v
  storageSet(DELTA_KEY, v)
  emit()
}

export function getShowWhaleBubbles(): boolean {
  return showWhales
}
export function setShowWhaleBubbles(v: boolean): void {
  showWhales = v
  storageSet(WHALE_KEY, v)
  emit()
}

export function getShowVolumeProfile(): boolean {
  return showVP
}
export function setShowVolumeProfile(v: boolean): void {
  showVP = v
  storageSet(VP_KEY, v)
  emit()
}

export function getShowConfluence(): boolean {
  return showConfluence
}
export function setShowConfluence(v: boolean): void {
  showConfluence = v
  storageSet(MTF_KEY, v)
  emit()
}

export function getShowOBGauge(): boolean {
  return showObGauge
}
export function setShowOBGauge(v: boolean): void {
  showObGauge = v
  storageSet(OB_KEY, v)
  emit()
}

export function getShowMLPrediction(): boolean {
  return showMLPrediction
}
export function setShowMLPrediction(v: boolean): void {
  showMLPrediction = v
  storageSet(ML_KEY, v)
  emit()
}

export function getShowRLPolicy(): boolean {
  return showRLPolicy
}
export function setShowRLPolicy(v: boolean): void {
  showRLPolicy = v
  storageSet(RL_KEY, v)
  emit()
}
