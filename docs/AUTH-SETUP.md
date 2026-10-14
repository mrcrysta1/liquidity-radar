# Sign-in setup (Supabase Auth: email + Google)

Accounts use the same Supabase project as the whale history. The table and
its security rules are already created (`radar-worker/sql/003_user_settings.sql`):
each signed-in user can read and write only their own settings row.

Until the two keys below are set, the site works exactly as before, signed out.

## 1. Public keys → Vercel

Supabase dashboard → **Project Settings → API**:

| Vercel variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL, e.g. `https://abcd.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **anon / publishable** key (never the service_role / secret key) |

Vercel → Project → Settings → **Environment Variables** → add both for
Production (and Preview), then **Redeploy**.

## 2. Allowed addresses

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://liquidity-radar-seven.vercel.app`
- **Redirect URLs:** `https://liquidity-radar-seven.vercel.app/**` and, for
  local testing, `http://localhost:5173/**`

## 3. Email + password

On by default (Authentication → Providers → Email). New users get a
confirmation email; turn off **Confirm email** there if you want sign-up to
work instantly.

## 4. Google

1. Google Cloud Console → APIs & Services → **Credentials** → Create
   credentials → **OAuth client ID** → Web application.
2. **Authorized redirect URI:** `https://<project-ref>.supabase.co/auth/v1/callback`
   (Supabase shows the exact value on its Google provider page).
3. Copy the Client ID and Client secret into Supabase → Authentication →
   Providers → **Google**, and enable it.
4. OAuth consent screen: app name "Liquidity Radar", your support email;
   publish it (or add test users while it is in testing).

## What is saved per user

Theme and palette, chart indicators (new accounts start with none), chart
layout, timeframe and overlay toggles, favourite coins, price alerts, and the
paper-trading / self-learning records. Signing in loads that user's settings;
signing out restores the browser's signed-out settings.
