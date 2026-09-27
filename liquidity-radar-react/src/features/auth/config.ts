// Sign-in configuration. Supabase Auth, using the project's public URL and
// anon (publishable) key — both are safe in the browser; what a signed-in
// user can reach is decided by row-level security (radar-worker/sql/003).
// Falls back to the whale-history variables, which point at the same project.
const env = import.meta.env as Record<string, string | undefined>
export const AUTH_URL = (env.VITE_SUPABASE_URL || env.VITE_WHALE_DB_URL || '').replace(/\/+$/, '')
export const AUTH_KEY = env.VITE_SUPABASE_ANON_KEY || env.VITE_WHALE_DB_KEY || ''
/** False until both are set — the app then runs exactly as before, signed out. */
export const AUTH_ON = !!(AUTH_URL && AUTH_KEY)

/** A stored session, or an OAuth / email link landing — worth loading the client for. */
export function authPending(): boolean {
  if (!AUTH_ON) return false
  if (/[?&]code=|[#&]access_token=|[#&]error_description=/.test(location.search + location.hash)) return true
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return true
    }
  } catch {
    /* private mode */
  }
  return false
}
