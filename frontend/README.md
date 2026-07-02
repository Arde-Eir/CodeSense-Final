# CodeSense Frontend

React, TypeScript, Vite, Vitest, and Supabase power the CodeSense frontend.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
```

From the repository root, prefer:

```bash
npm run check
```

## Environment

Use `frontend/.env.local` for real local values. It is ignored by Git.

Required keys:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=
```

`VITE_SUPABASE_ANON_KEY` is browser-exposed by design. Never put Supabase service-role keys or other private server credentials in frontend env files.

## Source Layout

```text
src/
  App.tsx
  main.tsx
  layout.css
  pages/
    public/
    app/
    admin/
  components/
  services/
  campaign/
  games/
  types/
```

## Imports

`@` maps to `src`.

```ts
import { useAuth } from '@/components/AuthContext'
import { analyzeCode } from '@/services/api'
```

Use sibling relative imports for local helper files in the same folder.
