import { useEffect } from 'react'
import { Shell } from './components/Shell'

// Root component. The app shell is a 1:1 port of the original index.html body
// (see src/components/Shell.tsx). The engine (src/engine) expects the full DOM
// at evaluation time (it wires listeners at the top level, exactly like the
// vanilla script at the end of <body>), so it is imported dynamically AFTER
// React has mounted the shell — preserving the original boot order.
export default function App() {
  useEffect(() => {
    import('./engine/app').then(({ initApp }) => initApp())
  }, [])

  return <Shell />
}
