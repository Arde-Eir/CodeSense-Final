# CodeSense

CodeSense is a browser-based C++ logic analysis mentor for students. It combines a TypeScript/Express analysis backend with a React/Vite frontend for code analysis, flow graph visualization, tutorials, campaign quests, progress tracking, and admin tools.

## Prerequisites

- Node.js 18 or newer
- npm
- Git

## Setup

Install dependencies for the root test runner, backend, and frontend:

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

Create local environment files from the examples:

```bash
copy backend\.env.example backend\.env.local
copy frontend\.env.example frontend\.env.local
```

Keep real secrets and deployment values in ignored `.env.local` files or hosting-provider environment settings. See [docs/SECURITY_AND_ACCESS.md](docs/SECURITY_AND_ACCESS.md) and [docs/SUPABASE_RLS_CHECKLIST.md](docs/SUPABASE_RLS_CHECKLIST.md).

Registration requires Google reCAPTCHA v3 keys and a Supabase Auth hook. Follow [the reCAPTCHA setup guide](docs/RECAPTCHA_SETUP.md) before enabling registration.

Backend environment values:

```text
PORT=3000
CORS_ORIGINS=https://your-frontend.example
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

Live help is disabled until its database and network services are deployed. Apply
`supabase/migrations/202609170001_live_support_sessions.sql` with the Supabase
migration owner after reviewing the read-only `supabase/schema_preflight.sql`
results. The migration creates consented sessions, private Realtime
authorization, and an action audit that records clicks, dropdown changes, and
text-field changes without storing typed text. It also grants administrator
read policies for learner progress, reports, and activity when those tables
have row-level security enabled; review existing table grants and policies in
staging before enabling the feature.

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
- backend unit tests, frontend Vitest tests, the integration report, and the full 52-case API integration suite
- frontend production build
- backend production build

Useful individual commands:

```bash
npm run lint
npm test
npm run build
npm run build:frontend
npm run build:backend
npm run test:integration
```

The integration command starts and stops an isolated backend on an available local port; no separately running development server is required.

## Project Structure

```text
backend/
  grammar/              PEG grammar for the C++ parser
  src/analysis/         lexer, parser output, CFG, scoring, translation, checks
  src/gamification/     XP and reward logic
  src/routes/           API routes
  tests/                backend unit tests

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

tests/
  run-testing-report.mjs
  run-integration-tests.mjs

docs/
  SECURITY_AND_ACCESS.md
  SUPABASE_RLS_CHECKLIST.md
  SUPABASE_RLS_POLICY_TEMPLATE.sql
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
- Use the Supabase RLS checklist before opening the app to normal users or repository viewers.
