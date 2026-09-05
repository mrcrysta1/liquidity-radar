import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// NOTE: StrictMode deliberately omitted — it double-runs effects in dev and
// would open duplicate WebSocket streams and duplicate chart instances.
createRoot(document.getElementById('root')!).render(<App />)
