// The once-per-session flag behind the automatic "sign in" invite for guests.
// Any open of the sign-in dialog marks it — the automatic popup and a manual
// click alike — so a guest who already opened the dialog is not invited again.
// Blocked or missing storage counts as already invited: never nag.
export const INVITED = 'lr-auth-invited'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function session(): Store | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

export function wasInvited(s: Store | null = session()): boolean {
  if (!s) return true
  try {
    return !!s.getItem(INVITED)
  } catch {
    return true
  }
}

export function markInvited(s: Store | null = session()): void {
  if (!s) return
  try {
    s.setItem(INVITED, '1')
  } catch {
    /* storage blocked: wasInvited already reports true */
  }
}
