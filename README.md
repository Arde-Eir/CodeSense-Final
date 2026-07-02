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

Backend environment values:

```text
PORT=3000
CORS_ORIGINS=https://your-frontend.example
LOG_ANALYSIS_REQUESTS=false
```

`CORS_ORIGINS` must contain exact trusted browser origins. Do not allow whole hosting suffixes such as every `.vercel.app` or `.netlify.app` preview domain.

`LOG_ANALYSIS_REQUESTS=true` only logs request size metadata. It does not log submitted source code.

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

- frontend lint
- backend unit tests, frontend Vitest tests, and integration report
- frontend production build
- backend production build

Useful individual commands:

```bash
npm run lint
npm test
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
