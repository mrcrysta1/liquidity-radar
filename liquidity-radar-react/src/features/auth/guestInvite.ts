// A guest who has not signed in is invited to do so a few seconds after the
// app settles. The invite re-uses the account dialog (Sign in / Create
// account / Continue with Google) by opening the existing account button's
// dialog once per browser session. Nothing else changes: guests keep full
// access and can keep browsing after closing it.
//
// Kept out of AccountMenu.tsx on purpose: the dialog stays untouched and the
// invite logic stays small, testable, and impossible to regress.

/** sessionStorage flag so the invite never nags twice in one session. */
const SEEN_KEY = 'lr-auth-invite-seen'
/** How long to wait after boot before showing the invite. */
const DELAY_MS = 3000

let armed = false

function alreadyShown(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // Private browsing: never block the invite, never nag a second time.
    return true
  }
}

function markShown(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** True once the session check has settled and the visitor is a guest. */
function guestReady(getAuth: () => { status: string }): boolean {
  return getAuth().status === 'guest'
}

/**
 * Arm the invite. Called once at boot (see App.tsx). The invite only fires
 * if the visitor is a guest once the auth session has settled; it never
 * fires for a signed-in user, an unconfigured site, or while the session
 * check is still running.
 */
export function armGuestInvite(
  getAuth: () => { status: string },
  warmAuth: () => void,
  openAccountDialog: () => void,
): void {
  if (armed) return
  armed = true
  if (!guestReady(getAuth)) return
  if (alreadyShown()) return
  const t = setTimeout(() => {
    // Re-check in case the visitor signed in (e.g. in another tab) while the
    // timer was running, or the session settled to a user meanwhile.
    if (getAuth().status !== 'guest') return
    markShown()
    warmAuth()
    openAccountDialog()
  }, DELAY_MS)
  // If the component unmounts or the app tears down, drop the timer.
  return void t as void
}
