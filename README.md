# CodeSense

CodeSense is a browser-based C++ logic analysis mentor for students. It combines a TypeScript/Express analysis backend with a React/Vite frontend for code analysis, flow graph visualization, tutorials, campaign quests, progress tracking, and admin tools.

Frontend: [pr-codesense.netlify.app](https://pr-codesense.netlify.app/).

## Prerequisites

- Node.js 18 or newer
- npm
- Git

## Setup

Install dependencies for the backend and frontend:

```bash
npm --prefix backend install
npm --prefix frontend install
```

Create local environment files from the examples:

```bash
copy backend\.env.example backend\.env.local
copy frontend\.env.example frontend\.env.local
```

Keep real secrets and deployment values in ignored `.env.local` files or hosting-provider environment settings.

Registration requires Google reCAPTCHA v3 keys and a Supabase **Before User Created** HTTP hook pointing to `https://YOUR_BACKEND/api/auth/before-user-created`. Enable that hook and set its signing secret as `AUTH_HOOK_SECRET` on the backend, including the `v1,whsec_` prefix.

Set `VITE_RECAPTCHA_SITE_KEY` in the frontend build environment. Set `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES`, and `RECAPTCHA_MIN_SCORE` on the backend as shown in `backend/.env.example`. Allowed hostnames must match the frontend hosts registered with Google. Keep private keys on the backend; Supabase must be able to reach the hook over HTTPS.

Backend environment values:

```text
PORT=3000
CORS_ORIGINS=https://pr-codesense.netlify.app
LOG_ANALYSIS_REQUESTS=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
RATE_LIMIT_MAX_ANALYZE_REQUESTS=20
```

`CORS_ORIGINS` must contain exact trusted browser origins. Do not allow whole hosting suffixes such as every `.vercel.app` or `.netlify.app` preview domain.

`LOG_ANALYSIS_REQUESTS=true` only logs request size metadata. It does not log submitted source code.

### Admin live preview and help

The Users tab includes an offline read-only snapshot of learner profile, all
quest-progress rows, analysis reports (with saved code opened on demand), and
activity history. Live Preview & Help shows the learner's actual CodeSense tab
only after that learner approves sharing and control. The learner sees an admin
cursor and can stop the session at any time. Browser-protected password fields,
file pickers, and external links remain learner-only actions.

Live help requires deployed support tables and RPCs, private Realtime
authorization, and an action audit that records clicks, dropdown changes, and
text-field changes without storing typed text. Administrator read policies for
learner progress, reports, and activity must be configured on tables with
row-level security enabled. Review existing table grants and policies in
staging before enabling the feature. This deployment source assumes the
existing Supabase database is already provisioned.

Live video and remote controls use the existing private Supabase Realtime
channel. Set `VITE_SUPPORT_ENABLED=true` in Netlify's production build environment
alongside the existing Supabase URL and public key, then rebuild the frontend.
No TURN provider, TURN credentials, ICE configuration, or Vercel video endpoint
is required. The Vercel backend continues to serve the other application APIs.

The learner's browser encodes continuous WebM/VP8 video at up to 24 fps and a
target bitrate of 1 Mbps. Packets are capped at 64 KB of base64, below Supabase's
256 KB Free-plan message limit. Playback has a short buffer, so remote control
has more viewing delay than a direct WebRTC call. Bandwidth and Realtime message
usage count toward the Supabase project's quotas; a one-hour session at the
target bitrate can transfer roughly 600 MB after base64 overhead. Screen chunks
are broadcast in memory, not stored as recordings. Unsupported browsers,
missing packets, excessive buffering, and disconnected channels stop the
connection with an error. Use current desktop Chrome or Edge on both sides.

Test with separate admin and learner accounts over HTTPS: request help, accept
sharing the CodeSense tab, verify video/cursor/navigation and a harmless profile
edit, then stop sharing and confirm control ends. The learner must explicitly
choose the CodeSense browser tab; other tabs are not controllable. A current
browser that reports the selected tab as a browser capture surface is required.

## Run Locally

Backend:

```bash
npm --prefix backend run dev
```

The backend defaults to `http://localhost:3000`.

Frontend:

```bash
npm --prefix frontend run dev
```

The frontend defaults to `http://localhost:5173`.

## Verification

Run the full project health check:

```bash
npm run check
```

This runs:

- secret scanning
- frontend lint
- frontend production build
- backend production build

Useful individual commands:

```bash
npm run lint
npm run build
npm run build:frontend
npm run build:backend
```

## Project Structure

```text
backend/
  grammar/              PEG grammar for the C++ parser
  src/analysis/         lexer, parser output, CFG, scoring, translation, checks
  src/gamification/     XP and reward logic
  src/routes/           API routes

frontend/
  src/App.tsx           route shell and route guards
  src/pages/public/     public pages such as landing, login, signup, docs
  src/pages/app/        authenticated/guest app pages
  src/pages/admin/      admin-only page
  src/components/       shared UI components
  src/services/         API, Supabase, data isolation, code services
  src/campaign/         quest and hint helpers
  src/games/            interactive quest games
  src/types/            shared frontend types

scripts/
  scan-secrets.mjs       release secret scan

```

## Frontend Imports

The frontend uses `@` as an alias for `frontend/src`.

```ts
import { supabase } from '@/services/supabase'
import { SandboxPage } from '@/pages/app/SandboxPage'
```

Use local relative imports for sibling files when that reads better, such as `./normalizeMCQ`.

## Security Notes

- Do not commit `.env`, `.env.local`, private keys, service-role keys, exported user data, logs, or generated response dumps.
- Repository viewers can see every tracked file. Do not treat folders or frontend route guards as secret storage.
- Admin-only data must be enforced with backend checks or Supabase Row Level Security policies, not just hidden UI links.
- Verify database grants, RLS, and Storage policies with separate user and administrator accounts before deployment.
