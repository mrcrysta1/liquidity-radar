import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAuth } from './features/auth/session'

// Start restoring the session (or finishing a sign-in link) before the first
// render, so a signed-in visitor is recognised as early as possible.
initAuth()

// NOTE: StrictMode deliberately omitted — it double-runs effects in dev and
// would open duplicate WebSocket streams and duplicate chart instances.
createRoot(document.getElementById('root')!).render(<App />)
