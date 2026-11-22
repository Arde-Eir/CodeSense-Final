# CodeSense

CodeSense is a browser-based C++ logic analysis mentor for students. This CS Expo source submission contains a React frontend, an Express analysis API, and automated tests with SQL fixtures. It requires internet access and a provisioned Supabase project for the full application; it is not a self-contained offline DVD application.

## Main features

Separate Word manuals are available in [Codebase User Manual](manuals/CodeSense_Codebase_User_Manual.docx) and [Website User Manual](manuals/CodeSense_Website_User_Manual.docx).

- C++ lexical and syntax analysis, type checks, control-flow graphs, symbolic execution, complexity scores, and explanations.
- A sandbox with Monaco code editing, token/AST/flow visualization, and XP rewards.
- Campaign lessons, hints, quizzes, matching, ordering, code-fill, and balloon-pop games.
- Player accounts, profiles, progress, leaderboards, and notifications.
- Administrator tools for users, quests (including PDF text import), announcements, settings, audits, and consent-based live learner help.

## Technologies

- Frontend: React 19, TypeScript 5.9, Vite 7, React Router 7, Monaco Editor, React Flow (@xyflow/react), CSS/PostCSS/Autoprefixer, and PDF.js.
- Backend: Node.js, Express 5, TypeScript, Peggy 3 (C++ grammar), and Standard Webhooks (registration signature verification).
- Services: Supabase Auth, PostgreSQL, Storage, and Realtime; Google reCAPTCHA v3; optional Sentry error reporting and source-map uploads.
- Checks: ESLint, TypeScript, Node's test runner, jsdom/Vite component tests, and PGlite PostgreSQL integration tests.

Exact dependency versions are recorded in the three package-lock.json files. There is no C++ compiler dependency: the backend analyzes the supported grammar rather than compiling arbitrary C++ programs. Unsupported C++ syntax may be rejected.

## Project structure and entry points

```text
.github/workflows/check.yml   CI installation, secret scan, lint, build, backend/security tests
package.json                 root verification/build scripts and PGlite test dependency
backend/
  .env.example               backend configuration template
  grammar/cpp.pegjs           C++ parser grammar (source of parser.js)
  src/server.ts              Express API entry point and serverless app export
  src/instrument.ts          optional Sentry initialization
  src/analysis/              lexer, generated parser, CFG, scoring, translation, checks
  src/gamification/          XP and rewards
  src/routes/                analysis, player login, and registration hook endpoints
  src/types/                 analysis data types
  tests/                     backend API integration tests (use built dist/)
frontend/
  .env.example               frontend and optional source-map upload configuration
  index.html                 HTML entry point
  netlify.toml               frontend build and SPA redirects
  vite.config.ts             React plugin, @ alias, API proxy, chunks, optional Sentry upload
  public/CodeSense.png        application logo/favicon
  src/main.tsx               React entry point
  src/App.tsx                lazy routes and route guards
  src/pages/{public,app,admin}/
  src/components/            shared UI, editor, visualizers, dashboards, live help
  src/services/              API, Supabase, data isolation, code generation, support
  src/admin/                 quest authoring, PDF extraction, and audit helpers
  src/campaign/              quest, hint, and XP helpers
  src/games/                 interactive quest games
  src/types/                 frontend data types
  tests/                     component and notification integration tests
scripts/scan-secrets.mjs      source secret-pattern scan (does not scan real local env files)
tests/                       profile access and shared login limit integration tests
  fixtures/sql/              SQL required by the database integration tests
```

The frontend alias @ resolves to frontend/src. The generated backend/src/analysis/parser.js is intentionally included: analysis imports it and every backend build regenerates it from the grammar.

## Prerequisites and installation

Use Node.js 24 LTS (verified here with 24.13.0) and npm. Installed Vite/jsdom versions also accept Node 20.19+ or 22.12+ within their supported major versions. Git is only needed to clone the repository, not to run the extracted ZIP. There are three separate npm projects, not an npm workspace.

From the extracted project root:

```sh
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

Install root dependencies as well: the database integration tests need PGlite. Keep all three lockfiles. Dependency installation and remotely loaded browser resources require internet access.

## Environment setup

In PowerShell, copy the templates once, then edit the new files with your own project settings:

```powershell
Copy-Item backend/.env.example backend/.env.local
Copy-Item frontend/.env.example frontend/.env.local
```

On macOS/Linux use cp in place of Copy-Item. Do not overwrite existing local environment files. Placeholder values document the required configuration and do not provide a working account or service.

### Frontend variables

| Variable | Purpose |
| --- | --- |
| VITE_SUPABASE_URL | Required Supabase project URL; the client initializes even for guest pages. |
| VITE_SUPABASE_ANON_KEY | Required public anon/publishable client key; never a secret or service-role key. |
| VITE_API_BASE_URL | Backend origin without /api. The template uses http://localhost:3000. Required in production builds for analysis and player login; development can also use an empty value with Vite's /api proxy. |
| VITE_RECAPTCHA_SITE_KEY | Public Google reCAPTCHA v3 site key required for registration. |
| VITE_SUPPORT_ENABLED | Keep false unless support tables, RPCs, and private Realtime policies are provisioned. |
| VITE_SENTRY_DSN | Optional React Sentry DSN; leave empty to disable locally. |
| SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN | Optional build-only source-map upload settings; provide all three together or leave all empty. The token must never use a VITE_ prefix. |

Vite embeds VITE_ values into browser assets at build time. Restart the dev server or rebuild after changing them. The code also recognizes VITE_API_URL as a legacy alias; use VITE_API_BASE_URL for new setup.

### Backend variables

| Variable | Purpose |
| --- | --- |
| PORT | Local listening port, default 3000. |
| CORS_ORIGINS | Additional comma-separated exact browser origins. Local ports 5173/4173 and existing deployment origins are already allowed in server.ts. Use exact trusted deployment origins, never wildcard hosting suffixes. |
| SUPABASE_URL, SUPABASE_SECRET_KEY | Required for player-name login; use a backend-only sb_secret_ API key and enable Supabase Auth IP Address Forwarding. |
| AUTH_HOOK_SECRET | Supabase Before User Created HTTP hook signing secret, including its v1,whsec_ prefix. Required for registration verification. |
| RECAPTCHA_SECRET_KEY | Backend-only Google reCAPTCHA v3 secret required for registration. |
| RECAPTCHA_ALLOWED_HOSTNAMES | Required comma-separated frontend hostnames for registration, without schemes, ports, or paths. |
| RECAPTCHA_MIN_SCORE | Required registration threshold between 0 and 1; template uses 0.5. |
| LOG_ANALYSIS_REQUESTS | Defaults to false; true logs submitted source length, not source text. |
| RATE_LIMIT_WINDOW_MS | Positive integer rate-limit window; default 60000 milliseconds. |
| RATE_LIMIT_MAX_REQUESTS | Positive integer API limit per window; default 60. |
| RATE_LIMIT_MAX_ANALYZE_REQUESTS | Positive integer analysis limit per window; default 20. |
| SENTRY_DSN | Optional Express Sentry DSN; leave empty to disable locally. |
| SENTRY_ENVIRONMENT, SENTRY_RELEASE | Optional Sentry environment and release metadata. |

Backend dev/start scripts load backend/.env.local when present. Hosting environments can supply variables directly. The analysis API can run without Supabase credentials; player login and registration cannot.

## Database and external services

**Database bootstrap is incomplete in this repository.** It assumes an existing Supabase application schema, policies, functions, triggers, and content. No full baseline schema or sanitized lesson/quest seed is supplied, so the SQL test fixtures alone cannot initialize the full application. Obtain a reviewed schema-only baseline and non-personal demonstration content from the project maintainers before attempting a new full installation. Do not use test fixture tables as the application schema.

Source references include users, player_profiles, quests, mission_progress, reports, activity_log, announcements, system_settings, level_info, admin_audit_log, notification_receipts, and support_sessions, plus related RPCs and policies. Profile media uses the Avatars Storage bucket. Accounts require Supabase Auth; frontend route guards must be backed by database RLS and Storage policies.

The tests/fixtures/sql directory contains the notification receipts and private-profile SQL needed by the retained PostgreSQL integration tests. These fixtures are executed only against the synthetic test databases; no supabase/ deployment folder is included. They do not supply the full application schema or provision a Supabase project.

Registration requires Google reCAPTCHA v3 keys registered for the frontend hosts and a Supabase **Before User Created** HTTP hook pointing to https://YOUR_BACKEND/api/auth/before-user-created. Supabase must reach this backend endpoint over HTTPS; localhost alone is not reachable from the hosted hook. Configure Supabase Auth site/redirect URLs for your local or deployed frontend. Account email verification and delivery depend on your Supabase Auth configuration, which is not included here.

Google Fonts, jsDelivr admin styling/icons, Google reCAPTCHA, and the Monaco loader's CDN resources require network access. Sentry is optional. Live support also requires database objects not fully defined by the SQL test fixtures.

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

## Run locally

Run in two terminals from the project root:

```sh
npm --prefix backend run dev
```

```sh
npm --prefix frontend run dev
```

Open http://localhost:5173 (or the URL Vite prints if that port is occupied). The backend defaults to http://localhost:3000; GET / returns an online message. Main API endpoints are POST /api/analyze, POST /api/auth/login, and POST /api/auth/before-user-created (signed Supabase hook only). No local database process is started by these commands.

For a production build and local preview:

```sh
npm run build
npm --prefix backend start
# In another terminal:
npm --prefix frontend run preview
```

Preview normally uses http://localhost:4173. Keep VITE_API_BASE_URL set to the running backend origin when building: the development proxy does not provide a backend for production assets. Vite preview is for inspection, not production hosting.

## Build and verification commands

| Command (from project root) | Effect |
| --- | --- |
| npm run check | Secret scan, frontend lint, frontend/backend builds (including TypeScript checks), backend API tests, profile-security database tests, and frontend tests. |
| npm run scan:secrets | Scan source for selected secret patterns; this is not a complete credential audit. |
| npm run lint | Frontend ESLint. No separate backend lint command is defined. |
| npm run build | Build frontend/dist and backend/dist, regenerating the parser. |
| npm run build:frontend | Frontend TypeScript project check and Vite production build. |
| npm run build:backend | Clean backend/dist, regenerate parser, compile TypeScript, and copy parser output. |
| npm --prefix backend test | Backend HTTP integration tests; build the backend first. |
| npm --prefix frontend test | Frontend component tests and notification receipt PostgreSQL tests. |
| npm run test:security | Profile isolation, admin permissions, and login limit PostgreSQL tests. |
| npm --prefix backend run build:parser | Regenerate the committed parser from grammar/cpp.pegjs. |

Database tests use in-process PGlite with synthetic fixtures; no hosted Supabase credentials or running PostgreSQL server are needed. Frontend tests load placeholder configuration from frontend/.env.example; install backend dependencies as well for the local API workflow tests. The workflow tests replace browser-only editor/graph surfaces and simulate the authentication context; they do not verify a real browser or hosted login. These checks do not verify a deployed database, reCAPTCHA, email delivery, Storage, or live support. CI runs npm run check, including frontend tests. HTTP integration tests start local listeners, so those tests require permission to bind local ports.

The analyzer supports simple object-like numeric macros, not a complete C++ preprocessor. Numerical analysis uses a simplified model rather than a target compiler ABI. sizeof results remain symbolic with an explicit warning; no target-specific byte size is assumed.

## Deployment and submission

Submission status: **needs further work for a self-contained DVD installation**. The full Supabase baseline and demonstration content are not included, and real-browser/hosted-account acceptance remains unverified. See [review findings and verification scope](manuals/CodeSense_Review_Findings.json) for confirmed fixes, reproductions, test results, and remaining requirements.

Existing deployment wiring is preserved: frontend/netlify.toml publishes dist with an SPA redirect (frontend is the build base); backend/src/server.ts exports the Express app for serverless use and listens when launched directly. Source comments refer to Vercel and existing hosted origins, but no dedicated backend hosting manifest is present. Actual hosting dashboard settings and service provisioning cannot be confirmed from this source. Do not infer a complete backend deployment recipe from those comments.

The submission ZIP contains source, the generated parser, required logo, all dependency manifests/lockfiles, configuration, CI workflow, tests and their SQL fixtures, and these environment templates. It excludes Git history, node_modules, dist/build output, caches, local logs, real environment files, secrets/, private/, and credentials/backups. The local-only files are preserved on the original machine. Install dependencies and build after extraction; the ZIP does not contain a runnable prebuilt application.

Never distribute backend keys, real user data, database dumps, or production credentials. No real service credentials are supplied. Configure your own services to demonstrate account-dependent features. Review grants, RLS, Storage policies, and admin access with separate learner/admin accounts before using a provisioned environment.
