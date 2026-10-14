// The account button in the top bar and its dialog: sign in or create an
// account with email and password, continue with Google, reset a password,
// and — once signed in — see what is saved to the account and sign out.
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  resetPassword,
  saveNow,
  setNewPassword,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
  updateProfile,
  useAuth,
  warmAuth,
} from '../../features/auth/session'
import { useFavorites } from '../../features/favorites/favorites'
import { toEdit } from '../../features/auth/profile'
import type { ProfileEdit } from '../../features/auth/profile'
import { getIndicators } from '../../features/charts/indicators/store'
import { useTick } from '../useTick'

type Mode = 'in' | 'up' | 'forgot'

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.8" />
      <path d="M4.6 20.2c1.3-3.6 4.2-5.4 7.4-5.4s6.1 1.8 7.4 5.4" />
    </svg>
  )
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function Avatar({ src, name, size = 30 }: { src: string | null; name: string; size?: number }) {
  const [bad, setBad] = useState(false)
  if (src && !bad)
    return <img className="acct-av" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBad(true)} />
  return <span className="acct-av acct-av-t" style={{ width: size, height: size, fontSize: size * 0.42 }}>{(name || '?').slice(0, 1).toUpperCase()}</span>
}

const ago = (t: number | null, now: number) => {
  if (!t) return 'not yet'
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'
}

const GENDERS = ['', 'Male', 'Female', 'Non-binary', 'Prefer not to say']

function ProfileForm({ done }: { done: () => void }) {
  const a = useAuth()
  const [f, setF] = useState<ProfileEdit>(() => toEdit(a.profile))
  const [busy, setBusy] = useState(false)
  const field = (k: keyof ProfileEdit, label: string, props: Record<string, string> = {}) => (
    <label>
      {label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  )
  return (
    <form
      className="acct-form acct-pform"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await updateProfile(f)
          done()
        } catch {
          /* the error is shown below */
        } finally {
          setBusy(false)
        }
      }}
    >
      {field('name', 'Full name', { autoComplete: 'name' })}
      <div className="acct-2">
        {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel', placeholder: '+92 300 1234567' })}
        {field('birthday', 'Birthday', { type: 'date', autoComplete: 'bday' })}
      </div>
      <label>
        Gender
        <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
          {GENDERS.map((g) => <option key={g} value={g}>{g || 'Not set'}</option>)}
        </select>
      </label>
      {field('address', 'Address', { autoComplete: 'street-address', placeholder: 'Street, area' })}
      <div className="acct-2">
        {field('city', 'City', { autoComplete: 'address-level2' })}
        {field('country', 'Country', { autoComplete: 'country-name' })}
      </div>
      <div className="acct-2">
        {field('title', 'Job title', { autoComplete: 'organization-title' })}
        {field('organization', 'Company / organization', { autoComplete: 'organization' })}
      </div>
      {a.profileError && <p className="acct-err">{a.profileError}</p>}
      <div className="acct-row">
        <button type="button" className="acct-btn ghost" onClick={done}>Cancel</button>
        <button type="submit" className="acct-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
      <p className="acct-note">Every field is optional. Only you and the site owner can see your profile.</p>
    </form>
  )
}

function ProfileCard() {
  const a = useAuth()
  const [edit, setEdit] = useState(false)
  const p = a.profile
  if (edit) return <ProfileForm done={() => setEdit(false)} />
  const rows: Array<[string, string | null]> = [
    ['Name', p?.name ?? null],
    ['Email', p?.email ? p.email + (p.email_verified ? ' ✓' : '') : null],
    ['Phone', p?.phones?.map((x) => x.value).join(', ') || null],
    ['Birthday', p?.birthday ? p.birthday.replace(/^-/, '') : null],
    ['Gender', p?.gender ?? null],
    ['Address', p?.addresses?.map((x) => [x.formatted, x.city, x.country].filter(Boolean).join(', ')).filter(Boolean).join(' · ') || null],
    ['Work', p?.organizations?.map((o) => [o.title, o.name].filter(Boolean).join(' at ')).filter(Boolean).join(' · ') || null],
  ]
  return (
    <div className="acct-prof">
      <div className="acct-prof-h">
        <b>Your profile</b>
        <button type="button" className="acct-edit" onClick={() => setEdit(true)}>✎ Edit profile</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className={v ? '' : 'none'}>{v || 'not set'}</dd></div>
        ))}
      </dl>
      {a.profileError && <p className="acct-err">{a.profileError}</p>}
    </div>
  )
}

function SignedIn({ close }: { close: () => void }) {
  const a = useAuth()
  const now = useTick(5000)
  const favs = useFavorites()
  const u = a.user!
  const ind = getIndicators().length
  const [busy, setBusy] = useState(false)
  return (
    <div className="acct-body">
      <div className="acct-who">
        <Avatar src={a.profile?.photo_url || u.avatar} name={a.profile?.name || u.name} size={52} />
        <span>
          <b>{a.profile?.name || u.name}</b>
          <small>{u.email}</small>
          <em>{u.provider === 'google' ? 'Google account' : 'Email account'}</em>
        </span>
      </div>
      <div className={'acct-sync' + (a.error ? ' err' : '')}>
        <i />
        {a.error ? a.error : a.saving ? 'Saving your settings…' : `Settings saved to your account · ${ago(a.syncedAt, now)}`}
      </div>
      <ProfileCard />
      <ul className="acct-list">
        <li><b>{ind}</b><span>chart indicator{ind === 1 ? '' : 's'}</span></li>
        <li><b>{favs.length}</b><span>favorite coin{favs.length === 1 ? '' : 's'}</span></li>
        <li><b>✓</b><span>theme, palette &amp; layout</span></li>
        <li><b>✓</b><span>alerts &amp; paper trades</span></li>
      </ul>
      <p className="acct-note">Everything you change is saved to this account and follows you to any device you sign in on.</p>
      <div className="acct-row">
        <button type="button" className="acct-btn ghost" onClick={() => void saveNow()}>Save now</button>
        <button
          type="button"
          className="acct-btn danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await signOut()
            close()
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}

function SignInForm() {
  const a = useAuth()
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'in') await signIn(email.trim(), pw)
      else if (mode === 'up') await signUp(email.trim(), pw, name.trim())
      else await resetPassword(email.trim())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="acct-body">
      {mode !== 'forgot' && (
        <div className="acct-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
        </div>
      )}
      {mode !== 'forgot' && (
        <>
          <button type="button" className="acct-google" onClick={() => void signInWithGoogle()}>
            <GoogleG /> Continue with Google
          </button>
          <p className="acct-note acct-perm">Google shares only your name, email and profile photo.</p>
          <div className="acct-or"><span>or with email</span></div>
        </>
      )}
      <form className="acct-form" onSubmit={submit}>
        {mode === 'up' && (
          <label>Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" /></label>
        )}
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></label>
        {mode !== 'forgot' && (
          <label>
            Password
            <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'} placeholder={mode === 'up' ? 'At least 6 characters' : 'Your password'} />
          </label>
        )}
        {a.error && <p className="acct-err">{a.error}</p>}
        {a.notice && <p className="acct-ok">{a.notice}</p>}
        <button type="submit" className="acct-btn primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="acct-foot">
        {mode === 'in' && <button type="button" onClick={() => setMode('forgot')}>Forgot password?</button>}
        {mode === 'forgot' && <button type="button" onClick={() => setMode('in')}>← Back to sign in</button>}
      </div>
      <p className="acct-note">
        Signed in, your indicators, theme, favorite coins, layout and trade records are saved to your own account.
        New accounts start clean — no indicators on the chart.
      </p>
    </div>
  )
}

function NewPassword() {
  const a = useAuth()
  const [pw, setPw] = useState('')
  return (
    <form className="acct-body acct-form" onSubmit={(e) => { e.preventDefault(); void setNewPassword(pw) }}>
      <p className="acct-note">Choose a new password for {a.user?.email ?? 'your account'}.</p>
      <label>New password<input type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
      {a.error && <p className="acct-err">{a.error}</p>}
      <button type="submit" className="acct-btn primary">Set password</button>
    </form>
  )
}

function Dialog({ close }: { close: () => void }) {
  const a = useAuth()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  const title = a.recovery ? 'Reset password' : a.status === 'user' ? 'Your account' : 'Welcome to Liquidity Radar'
  return createPortal(
    <div className="acct-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="acct-card">
        <header>
          <h2>{title}</h2>
          <button type="button" className="acct-x" aria-label="Close" onClick={close}>✕</button>
        </header>
        {a.status === 'off' ? (
          <div className="acct-body">
            <p className="acct-note">
              Sign-in is not switched on for this site yet. The owner needs to add the Supabase project URL and
              public key (<code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>) to the deployment.
              Until then everything still works, saved in this browser.
            </p>
          </div>
        ) : a.status === 'loading' ? (
          <div className="acct-body"><p className="acct-note">Checking your session…</p></div>
        ) : a.recovery ? (
          <NewPassword />
        ) : a.status === 'user' ? (
          <SignedIn close={close} />
        ) : (
          <SignInForm />
        )}
      </div>
    </div>,
    document.body,
  )
}

export function AccountMenu() {
  const a = useAuth()
  const [open, setOpen] = useState(false)
  // A password-reset link opens the dialog on its own.
  const show = open || a.recovery
  const u = a.user
  return (
    <>
      <button
        type="button"
        className={'theme-btn icon-btn acct-trigger' + (u ? ' on' : '')}
        title={u ? u.name + ' · account' : 'Sign in'}
        aria-label={u ? 'Account: ' + u.name : 'Sign in'}
        onClick={() => {
          warmAuth()
          setOpen(true)
        }}
      >
        {u ? <Avatar src={u.avatar} name={u.name} size={26} /> : <UserIcon />}
      </button>
      {show && <Dialog close={() => setOpen(false)} />}
    </>
  )
}
