// React view of the self-learning engine's state.
import { useSyncExternalStore } from 'react'
import { getSL, onSLChange, slVersion } from './engine'

export function useSL() {
  useSyncExternalStore(onSLChange, slVersion)
  return getSL()
}
