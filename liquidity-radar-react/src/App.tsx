import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AUTH_ON } from './features/auth/config'
import { AccountMenu } from './components/auth/AccountMenu'
import { useAuth } from './features/auth/session'

function AuthGate() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'radial-gradient(circle at top, rgba(79, 118, 255, 0.18), rgba(10, 12, 19, 1) 46%)',
      color: '#f5f7ff',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        width: 'min(480px, 92vw)',
        padding: '28px 24px',
        borderRadius: '20px',
        border: '1px solid rgba(160, 181, 255, 0.24)',
        background: 'rgba(12, 16, 28, 0.9)',
        boxShadow: '0 24px 58px rgba(10, 15, 30, 0.56)',
        textAlign: 'center',
      }}>
        <h1 style={{ margin: '0 0 12px', fontSize: '2rem', lineHeight: 1.15 }}>Please sign in to continue</h1>
        <p style={{ margin: '0 0 22px', color: '#c8d3ff', lineHeight: 1.6 }}>
          This site is restricted to signed-in users. Log in first to unlock the dashboard, charts, alerts, and saved preferences.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <AccountMenu autoOpen />
        </div>
      </div>
    </div>
  )
}

// Root component. The app shell is a 1:1 port of the original index.html body
// (see src/components/Shell.tsx). The engine (src/engine) expects the full DOM
// at evaluation time (it wires listeners at the top level, exactly like the
// vanilla script at the end of <body>), so it is imported dynamically AFTER
// React has mounted the shell — preserving the original boot order.
export default function App() {
  const auth = useAuth()
  const canUseApp = !AUTH_ON || auth.status === 'user'

  useEffect(() => {
    if (!canUseApp) return
    import('./engine/app').then(({ initApp }) => initApp())
  }, [canUseApp])

  return (
    <ErrorBoundary name="Liquidity Radar">
      {canUseApp ? <Shell /> : <AuthGate />}
    </ErrorBoundary>
  )
}
