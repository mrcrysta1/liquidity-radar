// A guest who has not signed in is invited to do so a few seconds after the
// app settles. The invite opens the existing account dialog (Sign in / Create
// account / Continue with Google) by clicking the account button in the top
// bar, once per browser session. Guests keep full access and can keep
// browsing after closing it.
//
// Kept out of AccountMenu.tsx on purpose: the dialog stays untouched and the
// invite stays small and impossible to regress.
import { getAuth, warmAuth } from './session'

/** sessionStorage flag so the invite never nags twice in one session. */
const SEEN_KEY = 'lr-auth-invite-seen'
/** How long to wait after the session settles before showing the invite. */
const DELAY_MS = 3000
/** How often to re-check while the auth session is still loading. */
const POLL_MS = 300
/** Give up on the invite if the session never settles. */
const MAX_WAIT_MS = 20000

let armed = false

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // Private browsing: never show it rather than nag on every page.
    return true
  }
}

function markSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** The account button in the top bar (see AccountMenu.tsx). Clicking it opens the dialog. */
function openAccountDialog(): boolean {
  const btn = document.querySelector<HTMLButtonElement>('.acct-trigger')
  if (!btn) return false
  btn.click()
  return true
}

function invite(): void {
  if (getAuth().status !== 'guest') return
  markSeen()
  warmAuth()
  if (!openAccountDialog()) {
    // The top bar is not there (yet): try again shortly.
    setTimeout(() => void openAccountDialog(), POLL_MS)
  }
}

/**
 * Arm the invite. Called once at boot (see App.tsx). Waits for the auth
 * session to settle, then invites a guest once per browser session. Never
 * fires for a signed-in user or when auth is not configured.
 */
export function armGuestInvite(): void {
  if (armed) return
  armed = true
  if (seen()) return
  const start = Date.now()
  const t = setInterval(() => {
    const status = getAuth().status
    if (status === 'guest') {
      clearInterval(t)
      setTimeout(invite, DELAY_MS)
    } else if (status !== 'loading' || Date.now() - start > MAX_WAIT_MS) {
      // Signed in, auth off, or the check never settles: no invite.
      clearInterval(t)
    }
  }, POLL_MS)
}
