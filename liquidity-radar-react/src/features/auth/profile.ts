// Profile details for a signed-in user, stored in `user_profiles`.
//
// Google sign-ins request extra People API permissions; Google shows them on
// its consent screen and the user decides what to share. Right after the
// sign-in redirect, Supabase hands over Google's access token once
// (`provider_token`); that is when the profile is read and saved. Anything
// not shared, or never filled in on the Google account, stays empty.
import type { SupabaseClient, User } from '@supabase/supabase-js'

/** Asked for on top of Supabase's default `openid email profile`. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/user.phonenumbers.read',
  'https://www.googleapis.com/auth/user.birthday.read',
  'https://www.googleapis.com/auth/user.gender.read',
  'https://www.googleapis.com/auth/user.addresses.read',
  'https://www.googleapis.com/auth/user.organization.read',
].join(' ')

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

type Person = {
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string; metadata?: { primary?: boolean } }>
  emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean; verified?: boolean } }>
  phoneNumbers?: Array<{ value?: string; canonicalForm?: string; type?: string; formattedType?: string }>
  photos?: Array<{ url?: string; default?: boolean; metadata?: { primary?: boolean } }>
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number }; metadata?: { primary?: boolean } }>
  genders?: Array<{ value?: string; formattedValue?: string }>
  addresses?: Array<{ formattedValue?: string; type?: string; city?: string; region?: string; country?: string; postalCode?: string }>
  organizations?: Array<{ name?: string; title?: string; department?: string }>
  locales?: Array<{ value?: string }>
}

const FIELDS = 'names,emailAddresses,phoneNumbers,photos,birthdays,genders,addresses,organizations,locales'
const primary = <T extends { metadata?: { primary?: boolean } }>(a?: T[]) => a?.find((x) => x.metadata?.primary) ?? a?.[0]
const pad = (n: number) => String(n).padStart(2, '0')

/** Read the signed-in Google user's People API profile. Throws a readable message on failure. */
async function readGoogle(token: string): Promise<{ person: Person; scopes: string[] }> {
  const auth = { headers: { Authorization: 'Bearer ' + token } }
  const [r, info] = await Promise.all([
    fetch('https://people.googleapis.com/v1/people/me?personFields=' + FIELDS, auth),
    fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token)).then((x) => (x.ok ? x.json() : null)).catch(() => null),
  ])
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null
    const m = body?.error?.message || 'HTTP ' + r.status
    throw new Error(/has not been used|is disabled|SERVICE_DISABLED/i.test(m) ? 'The Google People API is not enabled for this app yet.' : m)
  }
  const scopes = String((info as { scope?: string } | null)?.scope || '').split(' ').filter(Boolean)
  return { person: (await r.json()) as Person, scopes }
}

function fromPerson(u: User, p: Person, scopes: string[]): Profile {
  const n = primary(p.names)
  const e = primary(p.emailAddresses)
  const photo = primary(p.photos)
  const b = p.birthdays?.find((x) => x.date?.year) ?? primary(p.birthdays)
  const d = b?.date
  const m = (u.user_metadata || {}) as Record<string, string>
  return {
    user_id: u.id,
    provider: 'google',
    name: n?.displayName ?? m.full_name ?? null,
    given_name: n?.givenName ?? null,
    family_name: n?.familyName ?? null,
    email: e?.value ?? u.email ?? null,
    email_verified: e?.metadata?.verified ?? null,
    phones: (p.phoneNumbers || []).filter((x) => x.value).map((x) => ({ value: x.canonicalForm || (x.value as string), type: x.formattedType || x.type })),
    photo_url: photo && !photo.default ? photo.url ?? null : m.avatar_url ?? null,
    birthday: d?.month && d.day ? (d.year ? d.year : '-') + '-' + pad(d.month) + '-' + pad(d.day) : null,
    gender: p.genders?.[0]?.formattedValue ?? p.genders?.[0]?.value ?? null,
    addresses: (p.addresses || []).map((a) => ({ formatted: a.formattedValue, type: a.type, city: a.city, region: a.region, country: a.country, postalCode: a.postalCode })),
    organizations: (p.organizations || []).map((o) => ({ name: o.name, title: o.title, department: o.department })),
    locale: p.locales?.[0]?.value ?? null,
    scopes,
  }
}

function basic(u: User): Profile {
  const m = (u.user_metadata || {}) as Record<string, string>
  return {
    user_id: u.id,
    provider: (u.app_metadata?.provider as string) || 'email',
    name: m.full_name || m.name || null,
    given_name: null,
    family_name: null,
    email: u.email ?? null,
    email_verified: !!u.email_confirmed_at,
    phones: u.phone ? [{ value: u.phone }] : [],
    photo_url: m.avatar_url || m.picture || null,
    birthday: null,
    gender: null,
    addresses: [],
    organizations: [],
    locale: null,
    scopes: [],
  }
}

/**
 * Save what can be known about this user. With a fresh Google token the full
 * People API profile is read; otherwise an existing row is left alone and a
 * new user gets the basics from their account. Returns the saved profile and,
 * if Google could not be read, why.
 */
export async function captureProfile(
  c: SupabaseClient,
  u: User,
  googleToken: string | null,
): Promise<{ profile: Profile | null; error: string }> {
  let error = ''
  if (googleToken) {
    try {
      const { person, scopes } = await readGoogle(googleToken)
      const row = fromPerson(u, person, scopes)
      await c.from('user_profiles').upsert({ ...row, raw: person, updated_at: new Date().toISOString() })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  const { data } = await c.from('user_profiles').select('*').eq('user_id', u.id).maybeSingle()
  if (data) return { profile: data as Profile, error }
  const row = basic(u)
  await c.from('user_profiles').upsert({ ...row, updated_at: new Date().toISOString() })
  return { profile: row, error }
}
