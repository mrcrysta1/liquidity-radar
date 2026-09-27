// Profile details for a signed-in user, stored in `user_profiles`.
//
// Google sign-in asks only for name, email and photo — Google's non-sensitive
// scopes — so there is no "unverified app" screen. Everything else (phone,
// birthday, gender, address, work) the user fills in themselves in the
// account dialog. A Google sign-in refreshes only the fields Google provides
// and never overwrites what the user typed.
import type { SupabaseClient, User } from '@supabase/supabase-js'

export interface Profile {
  user_id: string
  provider: string
  name: string | null
  given_name: string | null
  family_name: string | null
  email: string | null
  email_verified: boolean | null
  phones: Array<{ value: string; type?: string }>
  photo_url: string | null
  birthday: string | null
  gender: string | null
  addresses: Array<{ formatted?: string; type?: string; city?: string; region?: string; country?: string; postalCode?: string }>
  organizations: Array<{ name?: string; title?: string; department?: string }>
  locale: string | null
  scopes: string[]
  updated_at?: string
}

/** What the user can edit in the account dialog. */
export interface ProfileEdit {
  name: string
  phone: string
  birthday: string
  gender: string
  address: string
  city: string
  country: string
  title: string
  organization: string
}

type Person = {
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string; metadata?: { primary?: boolean } }>
  emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean; verified?: boolean } }>
  photos?: Array<{ url?: string; default?: boolean; metadata?: { primary?: boolean } }>
  locales?: Array<{ value?: string }>
}

// Readable with the default `profile email` scopes.
const FIELDS = 'names,emailAddresses,photos,locales'
const primary = <T extends { metadata?: { primary?: boolean } }>(a?: T[]) => a?.find((x) => x.metadata?.primary) ?? a?.[0]

/** The Google-provided part of the profile: from the People API when it answers, else the sign-in data. */
async function googleBasics(u: User, token: string | null): Promise<{ row: Partial<Profile>; raw: Person | null }> {
  const m = (u.user_metadata || {}) as Record<string, string>
  const row: Partial<Profile> = {
    provider: 'google',
    name: m.full_name || m.name || null,
    email: u.email ?? null,
    email_verified: !!u.email_confirmed_at || null,
    photo_url: m.avatar_url || m.picture || null,
  }
  if (!token) return { row, raw: null }
  try {
    const r = await fetch('https://people.googleapis.com/v1/people/me?personFields=' + FIELDS, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!r.ok) return { row, raw: null }
    const p = (await r.json()) as Person
    const n = primary(p.names)
    const e = primary(p.emailAddresses)
    const photo = primary(p.photos)
    return {
      raw: p,
      row: {
        ...row,
        name: n?.displayName ?? row.name,
        given_name: n?.givenName ?? null,
        family_name: n?.familyName ?? null,
        email: e?.value ?? row.email,
        email_verified: e?.metadata?.verified ?? row.email_verified,
        photo_url: photo && !photo.default && photo.url ? photo.url : row.photo_url,
        locale: p.locales?.[0]?.value ?? null,
      },
    }
  } catch {
    return { row, raw: null }
  }
}

function basics(u: User): Partial<Profile> {
  const m = (u.user_metadata || {}) as Record<string, string>
  return {
    provider: (u.app_metadata?.provider as string) || 'email',
    name: m.full_name || m.name || null,
    email: u.email ?? null,
    email_verified: !!u.email_confirmed_at,
    photo_url: m.avatar_url || m.picture || null,
  }
}

/**
 * Create or refresh the signed-in user's profile. Only the account fields are
 * written (a partial upsert updates just the columns it names), so anything
 * the user entered themselves is kept.
 */
export async function captureProfile(
  c: SupabaseClient,
  u: User,
  googleToken: string | null,
): Promise<{ profile: Profile | null; error: string }> {
  const google = (u.app_metadata?.provider as string) === 'google'
  const { row, raw } = google ? await googleBasics(u, googleToken) : { row: basics(u), raw: null }
  const { data: existing } = await c.from('user_profiles').select('*').eq('user_id', u.id).maybeSingle()
  // Empty provider values never blank a field.
  const patch = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== ''))
  // A name already on the profile may be the user's own edit: keep it.
  if (existing?.name) delete patch.name
  const { error } = await c
    .from('user_profiles')
    .upsert({ user_id: u.id, ...patch, ...(raw ? { raw } : {}), updated_at: new Date().toISOString() })
  const { data } = await c.from('user_profiles').select('*').eq('user_id', u.id).maybeSingle()
  return { profile: (data as Profile) ?? null, error: error ? error.message : '' }
}

export function toEdit(p: Profile | null): ProfileEdit {
  const a = p?.addresses?.[0]
  const o = p?.organizations?.[0]
  return {
    name: p?.name ?? '',
    phone: p?.phones?.[0]?.value ?? '',
    birthday: p?.birthday && /^\d{4}-\d{2}-\d{2}$/.test(p.birthday) ? p.birthday : '',
    gender: p?.gender ?? '',
    address: a?.formatted ?? '',
    city: a?.city ?? '',
    country: a?.country ?? '',
    title: o?.title ?? '',
    organization: o?.name ?? '',
  }
}

/** Save the details the user typed. Empty fields clear. */
export async function saveProfileEdit(c: SupabaseClient, uid: string, e: ProfileEdit): Promise<Profile> {
  const t = (s: string) => s.trim()
  const row = {
    user_id: uid,
    name: t(e.name) || null,
    phones: t(e.phone) ? [{ value: t(e.phone), type: 'Mobile' }] : [],
    birthday: t(e.birthday) || null,
    gender: t(e.gender) || null,
    addresses:
      t(e.address) || t(e.city) || t(e.country)
        ? [{ formatted: t(e.address) || undefined, city: t(e.city) || undefined, country: t(e.country) || undefined }]
        : [],
    organizations: t(e.title) || t(e.organization) ? [{ title: t(e.title) || undefined, name: t(e.organization) || undefined }] : [],
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await c.from('user_profiles').upsert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as Profile
}
