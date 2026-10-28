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
  void googleToken // name, email and photo already arrive with the sign-in; no extra call to Google
  const row = basics(u)
  const { data: existing } = await c.from('user_profiles').select('*').eq('user_id', u.id).maybeSingle()
  // Empty provider values never blank a field.
  const patch = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== ''))
  // A name already on the profile may be the user's own edit: keep it.
  if (existing?.name) delete patch.name
  // Nothing new since last time: no write.
  if (existing && Object.entries(patch).every(([k, v]) => JSON.stringify(existing[k]) === JSON.stringify(v)))
    return { profile: existing as Profile, error: '' }
  const { data, error } = await c
    .from('user_profiles')
    .upsert({ user_id: u.id, ...patch, updated_at: new Date().toISOString() })
    .select('*')
    .single()
  return { profile: (data as Profile) ?? (existing as Profile) ?? null, error: error ? error.message : '' }
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
