// Google Identity Services: the "Sign in with Google" button and One Tap,
// running on this site's own origin. Google hands back an ID token in a
// popup (or the One Tap bubble) and Supabase verifies it directly
// (signInWithIdToken) — no full-page redirect through supabase.co, so it is
// faster and Google shows this site, not the Supabase project, as the app.
//
// Needs VITE_GOOGLE_CLIENT_ID (public) and this site listed under the OAuth
// client's "Authorized JavaScript origins". Without them the dialog keeps the
// redirect sign-in.
const env = import.meta.env as Record<string, string | undefined>
export const GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID || ''

type Gis = {
  accounts: {
    id: {
      initialize: (o: Record<string, unknown>) => void
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
      prompt: (cb?: (n: unknown) => void) => void
      cancel: () => void
    }
  }
}
const gis = () => (window as unknown as { google?: Gis }).google

let scriptP: Promise<Gis> | null = null
export function loadGis(): Promise<Gis> {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('Google sign-in is not configured'))
  if (!scriptP)
    scriptP = new Promise<Gis>((resolve, reject) => {
      if (gis()) return resolve(gis() as Gis)
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => (gis() ? resolve(gis() as Gis) : reject(new Error('Google sign-in failed to load')))
      s.onerror = () => {
        scriptP = null
        reject(new Error('Google sign-in failed to load'))
      }
      document.head.appendChild(s)
    })
  return scriptP
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
}

let ready: Promise<void> | null = null
let rawNonce = ''
let onToken: ((token: string, nonce: string) => void) | null = null

/** Initialise once; every credential Google returns goes to `handler`. */
export function initGis(handler: (token: string, nonce: string) => void): Promise<void> {
  onToken = handler
  if (!ready)
    ready = (async () => {
      const g = await loadGis()
      // Google puts the hashed nonce in the ID token; Supabase checks it against the raw one.
      rawNonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce: await sha256Hex(rawNonce),
        callback: (r: { credential?: string }) => r.credential && onToken?.(r.credential, rawNonce),
        auto_select: true,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
        itp_support: true,
        context: 'signin',
      })
    })().catch((e) => {
      ready = null
      throw e
    })
  return ready
}

export async function renderGoogleButton(el: HTMLElement, width: number, dark: boolean): Promise<void> {
  await ready
  gis()?.accounts.id.renderButton(el, {
    type: 'standard',
    theme: dark ? 'filled_black' : 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width: Math.max(200, Math.min(400, Math.round(width))),
  })
}

/** One Tap: returning Google users sign in with a single click. */
export async function oneTap(): Promise<void> {
  await ready
  gis()?.accounts.id.prompt()
}
