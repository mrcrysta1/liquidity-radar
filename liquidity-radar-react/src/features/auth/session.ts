// Accounts: email + password and Google sign-in through Supabase Auth, and
// the per-user settings that come with them (see sync.ts).
//
// The Supabase client is loaded only when it is needed — a stored session,
// a sign-in link landing, or the account dialog opening — so a signed-out
// visitor's first load is unchanged.
import { useSyncExternalStore } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { AUTH_KEY, AUTH_ON, AUTH_URL, authPending } from './config'
import { apply, collect, K, same, startSyncing, stopSyncing } from './sync'
import type { Profile } from './sync'
import { captureProfile, saveProfileEdit } from './profile'
import type { Profile as UserProfile, ProfileEdit } from './profile'

export interface Account {
  id: string
  email: string
  name: string
  avatar: string | null
  provider: string
}

type Status = 'off' | 'loading' | 'guest' | 'user'
interface AuthState {
  status: Status
  user: Account | null
  syncedAt: number | null
  saving: boolean
  error: string
  notice: string
  /** The dialog opens itself for a password-reset link. */
  recovery: boolean
  /** What is saved about the user (user_profiles), and why Google could not be read, if it could not. */
  profile: UserProfile | null
  profileError: string
}

let st: AuthState = { status: AUTH_ON ? 'loading' : 'off', user: null, syncedAt: null, saving: false, error: '', notice: '', recovery: false, profile: null, profileError: '' }
let version = 0
const listeners = new Set<() => void>()
function set(p: Partial<AuthState>): void {
  st = { ...st, ...p }
  version++
  listeners.forEach((f) => f())
}
export const getAuth = () => st
export function useAuth(): AuthState {
  useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => {
        listeners.delete(f)
      }
    },
    () => version,
  )
  return st
}

let client: SupabaseClient | null = null
let clientP: Promise<SupabaseClient> | null = null
function getClient(): Promise<SupabaseClient> {
  if (client) return Promise.resolve(client)
  if (!clientP)
    clientP = import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(AUTH_URL, AUTH_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      })
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') set({ recovery: true })
        if (session?.user) void signedIn(session.user, session.provider_token ?? null)
        else if (event === 'SIGNED_OUT') void signedOut()
      })
      return client
    })
  return clientP
}

function toAccount(u: User): Account {
  const m = (u.user_metadata || {}) as Record<string, string>
  return {
    id: u.id,
    email: u.email || '',
    name: m.full_name || m.name || (u.email || '').split('@')[0],
    avatar: m.avatar_url || m.picture || null,
    provider: (u.app_metadata?.provider as string) || 'email',
  }
}

// ---- settings ------------------------------------------------------------------

async function pull(uid: string): Promise<{ data: Profile; at: number } | null> {
  const c = await getClient()
  const { data, error } = await c.from('user_settings').select('data, updated_at').eq('user_id', uid).maybeSingle()
  if (error) throw error
  return data ? { data: (data.data || {}) as Profile, at: Date.parse(data.updated_at) } : null
}

let lastPushed: Profile | null = null
async function push(): Promise<void> {
  const u = st.user
  if (!u || !client) return
  const data = collect()
  // The engine rewrites unchanged values; nothing new means nothing to send.
  if (lastPushed && same(lastPushed, data)) return
  set({ saving: true })
  const at = new Date()
  const { error } = await client.from('user_settings').upsert({ user_id: u.id, data, updated_at: at.toISOString() })
  if (error) set({ saving: false, error: 'Could not save settings: ' + error.message })
  else {
    lastPushed = data
    localStorage.setItem(K.synced, String(at.getTime()))
    set({ saving: false, syncedAt: at.getTime(), error: '' })
  }
}
export const saveNow = () => push()

let handling = ''
async function signedIn(u: User, googleToken: string | null): Promise<void> {
  if (handling === u.id) return
  handling = u.id
  const acct = toAccount(u)
  const prev = localStorage.getItem(K.uid)
  // Google's token is only handed over right after sign-in: read the profile
  // now, and let it finish before any reload below.
  const prof = captureProfile(client!, u, googleToken)
    .then((r) => set({ profile: r.profile, profileError: r.error }))
    .catch((e) => set({ profileError: msg(e) }))
  try {
    const remote = await pull(u.id)
    if (prev !== u.id) {
      // Coming from the guest profile (or another account): put the guest's
      // settings aside, load this user's, and restart on them.
      if (!prev) localStorage.setItem(K.guest, JSON.stringify(collect()))
      apply(remote?.data ?? {})
      localStorage.setItem(K.uid, u.id)
      if (!remote) {
        // A new account starts from the defaults — no indicators, the default
        // look — and gets its row straight away.
        await client!.from('user_settings').upsert({ user_id: u.id, data: collect(), updated_at: new Date().toISOString() })
      }
      localStorage.setItem(K.synced, String(remote?.at ?? Date.now()))
      await prof
      reload()
      return
    }
    // Same user as last time: take newer settings saved from another device.
    const localAt = Number(localStorage.getItem(K.synced) || 0)
    if (remote && remote.at > localAt + 1000 && !same(remote.data, collect())) {
      apply(remote.data)
      localStorage.setItem(K.synced, String(remote.at))
      await prof
      reload()
      return
    }
    set({ status: 'user', user: acct, syncedAt: localAt || remote?.at || null, error: '' })
    if (remote && same(remote.data, collect())) lastPushed = remote.data
    startSyncing(push)
    if (!remote) void push()
  } catch (e) {
    set({ status: 'user', user: acct, error: 'Signed in, but settings could not load: ' + (e instanceof Error ? e.message : String(e)) })
  }
}

function restoreGuest(): void {
  let guest: Profile = {}
  try {
    guest = JSON.parse(localStorage.getItem(K.guest) || '{}')
  } catch {
    /* ignore */
  }
  apply(guest)
  localStorage.removeItem(K.guest)
  localStorage.removeItem(K.uid)
  localStorage.removeItem(K.synced)
}

async function signedOut(): Promise<void> {
  stopSyncing()
  handling = ''
  if (localStorage.getItem(K.uid)) {
    restoreGuest()
    reload()
    return
  }
  set({ status: 'guest', user: null, syncedAt: null, profile: null, profileError: '' })
}

function reload(): void {
  // Drop any sign-in parameters so a reload does not replay them.
  const url = location.origin + location.pathname
  location.replace(url)
}

// ---- actions -------------------------------------------------------------------

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function signIn(email: string, password: string): Promise<void> {
  set({ error: '', notice: '' })
  const c = await getClient()
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) set({ error: error.message })
}

export async function signUp(email: string, password: string, name: string): Promise<void> {
  set({ error: '', notice: '' })
  const c = await getClient()
  const { data, error } = await c.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: location.origin },
  })
  if (error) return set({ error: error.message })
  if (!data.session) set({ notice: `Almost there — we sent a confirmation link to ${email}. Open it to finish signing up.` })
}

export async function signInWithGoogle(): Promise<void> {
  set({ error: '', notice: '' })
  try {
    const c = await getClient()
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin,
        // Only Google's basic scopes (name, email, photo): nothing sensitive,
        // so Google shows no "unverified app" screen. The rest of the profile
        // is entered by the user in the account dialog.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) set({ error: error.message })
  } catch (e) {
    set({ error: msg(e) })
  }
}

export async function resetPassword(email: string): Promise<void> {
  set({ error: '', notice: '' })
  const c = await getClient()
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
  if (error) set({ error: error.message })
  else set({ notice: `If an account exists for ${email}, a reset link is on its way.` })
}

export async function setNewPassword(password: string): Promise<void> {
  set({ error: '', notice: '' })
  const c = await getClient()
  const { error } = await c.auth.updateUser({ password })
  if (error) set({ error: error.message })
  else set({ recovery: false, notice: 'Password updated.' })
}

export async function signOut(): Promise<void> {
  await push().catch(() => {})
  const c = await getClient()
  await c.auth.signOut()
}

/** Make sure the client is loaded (the dialog calls this on open). */
export function warmAuth(): void {
  if (AUTH_ON) void getClient().then(settle)
}

async function settle(c: SupabaseClient): Promise<void> {
  const { data } = await c.auth.getSession()
  if (!data.session && st.status === 'loading') {
    // Signed out on this device — but a profile left from a session that has
    // since expired must not leak into the guest's settings.
    if (localStorage.getItem(K.uid)) {
      restoreGuest()
      reload()
      return
    }
    set({ status: 'guest' })
  }
}

/** Called once at boot. */
export function initAuth(): void {
  if (!AUTH_ON) return
  if (authPending()) void getClient().then(settle)
  else if (localStorage.getItem(K.uid)) {
    // Signed in before, but the session token is gone: back to the guest profile.
    restoreGuest()
    reload()
  } else set({ status: 'guest' })
}

/** Save the profile details the user entered in the account dialog. */
export async function updateProfile(e: ProfileEdit): Promise<void> {
  const u = st.user
  if (!u) return
  const c = await getClient()
  set({ profileError: '' })
  try {
    set({ profile: await saveProfileEdit(c, u.id, e) })
  } catch (err) {
    set({ profileError: 'Could not save profile: ' + msg(err) })
    throw err
  }
}
