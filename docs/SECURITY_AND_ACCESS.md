# Security and access

CodeSense has two separate trust boundaries:

- The Express service analyzes untrusted C++ source. It must not hold a Supabase service-role key.
- The browser talks directly to Supabase with the public anonymous key. Every database and Storage operation must therefore be authorized by Row Level Security (RLS), grants, and Storage policies.

Frontend route guards are navigation controls only. They do not protect database rows. A user can call the Supabase REST API without loading the CodeSense UI.

## Secrets

Only these values belong in frontend configuration:

```text
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_ANON_KEY
VITE_API_BASE_URL=https://analysis-api.example
```

The anonymous key is intentionally public. Never put a Supabase service-role key, database password, JWT signing secret, SMTP credential, or private API key in a `VITE_` variable, repository file, browser bundle, or deployment log.

Store backend and deployment secrets in the hosting provider's encrypted environment settings. Use ignored `.env.local` files for local values. Run `npm run scan:secrets` before every release.

If a secret was committed, removing it from the latest commit is not enough. Revoke or rotate it first, then remove it from Git history if required.

## Authorization model

The expected roles are:

| Caller | Intended access |
| --- | --- |
| Anonymous visitor | Public quests, level information, patch notes, announcements intended for public display, and non-sensitive leaderboard fields |
| Authenticated user | Public data plus their own profile, reports, activity, mission progress, and avatar objects |
| Administrator | Administrative tables and mutations after `public.users.is_admin` is verified in the database |

Use `auth.uid()` to establish row ownership. Never accept a user ID supplied by the browser as proof of identity.

Administrator checks must use a database function or policy that reads `public.users.is_admin` for `auth.uid()`. Hiding the Admin route or trusting an `isAdmin` React value is insufficient.

## Username login caveat

The current login flow resolves an email address from a player name before calling Supabase Auth. A broad anonymous `SELECT` policy on `public.users` would expose more profile data than the login form needs.

For a public deployment, prefer one of these designs:

1. Sign in directly with email and remove the anonymous player-name lookup.
2. Put username-to-login resolution behind a rate-limited server endpoint that never returns the email address.

Do not solve username login by making every column of `public.users` anonymously readable. Public leaderboard data should come from a view or RPC that exposes only fields such as user ID, player name, XP, level, character type, and last-active time.

## Analysis API

The analysis service accepts untrusted text. Keep the existing controls enabled:

- JSON bodies limited to 1 MB.
- Exact CORS origins; never allow every hosting preview subdomain.
- Per-address API and analysis rate limits.
- Source logging disabled unless explicitly debugging request volume. Source code itself must never be logged.
- Security headers enabled on every response.

The analyzer parses source but does not compile or execute it. Do not add shell compilation or execution without a dedicated, isolated sandbox with strict CPU, memory, filesystem, process, and network limits.

## Operational checks

Before a production release:

1. Complete [SUPABASE_RLS_CHECKLIST.md](./SUPABASE_RLS_CHECKLIST.md).
2. Review [SUPABASE_RLS_POLICY_TEMPLATE.sql](./SUPABASE_RLS_POLICY_TEMPLATE.sql) against the live schema in a staging project.
3. Test one anonymous session, two unrelated user accounts, and one administrator account.
4. Confirm one normal user cannot read or mutate the other user's private rows.
5. Confirm a normal user cannot set `is_admin`, `is_banned`, XP, level, or another user's progress.
6. Confirm Storage rejects writes outside `{auth.uid()}/...`.
7. Run `npm run check` and inspect the deployment logs without exposing environment values.

## Incident response

If unauthorized access is suspected:

1. Disable the affected deployment or feature.
2. Rotate exposed credentials and invalidate sessions when appropriate.
3. Preserve provider audit logs.
4. Identify the missing policy or grant and reproduce it in staging.
5. Add an integration check for the affected authorization boundary.
6. Deploy the policy fix before restoring access.

