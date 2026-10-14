import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// NOTE: StrictMode deliberately omitted — it double-runs effects in dev and
// would open duplicate WebSocket streams and duplicate chart instances.
createRoot(document.getElementById('root')!).render(<App />)

// Installable app + offline shell (public/sw.js). Production builds only: in
// dev a worker would sit between Vite and the browser. It never caches market
// data, and it does not force a reload when a new version takes over.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}
