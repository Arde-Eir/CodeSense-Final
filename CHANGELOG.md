# CodeSense Changelog

## Session 4 — 2026-06-30

### Campaign Retake Fixes

#### Bug Fixes

**1. Stale activity completion badges during quest retakes** — `frontend/src/pages/app/lessonactivity.tsx`
- Retaken campaign quests now keep rendered activity badges in React state instead of relying only on a mutable ref, so tab checkmarks update when progress is loaded, reset, or synced from Supabase.
- Fixed stale completed activity state showing tabs such as Balloon Pop as already done after retake/reset transitions.

**2. Resume Quest retakes now start cleanly** — `frontend/src/pages/app/CampaignInside.tsx`, `frontend/src/pages/app/lessonactivity.tsx`
- `Resume Quest +20 XP` and the sidebar `Continue` button now open previously first-finished active quests with a retake marker.
- The lesson page consumes that marker, clears `mission_progress.completed_activities`, resets hint count, and then removes the marker from the URL.
- First-finish unlock history and XP accounting remain preserved through `first_completed_at` and existing XP fields.

### Publish Note

Supabase rejected direct publishing to `patch_notes` with row-level security from the local anon key. Use the Admin Panel or an admin/service-role Supabase session to publish:

**Announcement title:** Campaign Retake Fixes  
**Patch note title:** Campaign Retake Progress Fixes  
**Version:** v0.3.1

## Session 3 — 2026-05-26

### Full Test Verification

#### Cypress Status

**Location:** repository root  
**Runner:** Cypress 13.17.0  
**Command:** `.\node_modules\.bin\cypress.cmd run`  
**Result:** Unable to start on the current Windows environment

Cypress reached its installed executable but failed during startup:

```text
Cypress.exe: bad option: --smoke-test
Cypress.exe: bad option: --ping=951
```

This confirms the previously recorded Cypress Electron/V8 incompatibility. The maintained fallback suites below were run instead.

---

### Frontend Tests

**Location:** `frontend/`  
**Runner:** Vitest 4.1.0  
**Command:** `.\node_modules\.bin\vitest.cmd run --config=vitest.browser.config.ts`  
**Result:** 297/297 tests passing across 16 test files; no skipped tests

| Metric | Result |
|---|---|
| Test Files | 16 passed |
| Tests | 297 passed |
| Skipped | 0 |
| Failures | 0 |
| Duration | 23.53 seconds |

The PDF-content test in `src/admin/__tests__/questAutoGenerator.test.ts` now executes with a deterministic built-in lesson fixture by default and uses an external PDF when `CODESENSE_PDF_FIXTURE` is provided.

---

### Backend Tests

**Build Command:** `npm.cmd run build` (run from `backend/`)  
**Build Result:** Successful  
**Location:** `tests/run-integration-tests.mjs`  
**Runner:** Node.js native test runner (`node --test`)  
**Command:** `node --test tests/run-integration-tests.mjs` (with the built backend running on port 3000)  
**Result:** 50/50 passing across 14 suites

| Suite | Tests |
|---|---|
| Input Validation | 3 |
| Response Shape | 2 |
| Lexical Analysis | 3 |
| Syntactic Analysis | 3 |
| Semantic Analysis | 4 |
| Dependency Validation | 7 |
| Symbolic Execution | 6 |
| CFG Generation | 3 |
| Mentor Explanations | 3 |
| Gamification | 5 |
| Path Analysis | 2 |
| Health Check | 1 |
| Unsupported Feature Detection | 4 |
| Complexity Metrics | 4 |

---

### Supplemental Backend Validation

**Location:** `tests/run-testing-report.mjs`  
**Runner:** Root npm test report  
**Command:** `npm test`  
**Result:** 16/16 internal checks passing

The variable-declaration translation check now verifies the current output contract, and the report returns a nonzero exit code if any internal check fails.

---

## Session 2 — 2026-05-11

### Backend Fixes

#### Bug Fixes

**1. Logging middleware crash on non-string `sourceCode`** — `backend/src/server.ts`
- `.substring()` was called on `req.body.sourceCode` without checking its type. When `sourceCode` was a number (e.g. `42`), a `TypeError` was thrown before the route's 400 validation guard could run. Express 5 caught it and returned HTTP 200 instead of HTTP 400.
- Fix: added `typeof rawSrc === 'string'` guard before calling `.substring()`.

**2. Dead code after `return` analyzed by symbolic executor** — `backend/src/analysis/symbolicexe.ts`
- `visitFunctionDecl` used `Array.forEach` to iterate the function body, which has no early-exit mechanism. Statements after a `return` (dead code) were still visited and could trigger false `UNSAFE` safety checks (e.g. `int x = 10 / 0;` after `return 0;`).
- Fix: added a `returned` boolean flag; switched to `for...of` with `break` when `this.returned === true`; `visitReturnStatement` now sets the flag.

**3. Provably-false `if` branches not pruned** — `backend/src/analysis/symbolicexe.ts`
- `evalConcreteCondition` only handled simple comparison operators, not `&&`/`||`. For a condition like `if (x > 10 && x < 2)` with `x = 5`, the function returned `null` (unknown) instead of `false`, so the then-branch was still visited and could emit false safety errors.
- Fix: extended `evalConcreteCondition` with `&&` (short-circuits on first `false`) and `||` (short-circuits on first `true`) cases; `visitIfStatement` now skips the then-branch when the result is `false`.

**4. XP calculation always used cyclomatic score of 1** — `backend/src/routes/analyze.ts`
- `GameEngine.calculateReward` reads `(analysis as any).cyclomaticComplexity?.score`. The call site was passing `cyclomaticComplexity: cyclomaticResult.score` (a plain number), so `.score` on a number returned `undefined`, and the engine fell back to the default of `1`. Cyclomatic complexity never affected XP.
- Fix: changed to `cyclomaticComplexity: cyclomaticResult` to pass the full `CyclomaticResult` object.

**5. Level 5 "King" unreachable** — `backend/src/routes/analyze.ts`
- `currentLevel` was typed as `1 | 2 | 3 | 4` and the ternary chain had no branch for `5`. `GameEngine.getLevelTitle` supports levels 1–5 ("Squire" through "King").
- Fix: extended type to `1 | 2 | 3 | 4 | 5` and added `rawLevel === 5 ? 5` branch.

**6. Inconsistent error response shapes** — `backend/src/routes/analyze.ts`
- Five early-return error paths (400 no-source, lexical, syntactic, dependency, semantic, critical) were each missing different subsets of fields that `SandboxPage.tsx` reads: `cyclomaticComplexity`, `warnings`, `symbolTable`, `logs`, `gamification.levelTitle`.
- Fix: standardized every response path to always include all fields, with safe zero/empty defaults.

**7. Duplicate debug logging** — `backend/src/routes/analyze.ts`
- Both the `server.ts` request-logging middleware and the `analyze.ts` route handler logged an identical source-code snippet for every request.
- Fix: removed the redundant `console.log` block from `analyze.ts`.

---

### Test Suite

**Location:** `tests/run-integration-tests.mjs`
**Runner:** Node.js native test runner (`node --test`)
**Command:** `node --test tests/run-integration-tests.mjs` (requires backend running on port 3000)
**Result:** 42/42 passing across 14 suites

| Suite | Tests |
|---|---|
| Input Validation | 3 |
| Response Shape | 2 |
| Lexical Analysis | 3 |
| Syntactic Analysis | 3 |
| Semantic Analysis | 4 |
| Dependency Validation | 2 |
| Symbolic Execution | 6 |
| CFG Generation | 3 |
| Mentor Explanations | 3 |
| Gamification | 5 |
| Path Analysis | 2 |
| Health Check | 1 |
| Unsupported Feature Detection | 1 |
| Complexity Metrics | 4 |

---

### Cleanup

Removed unused test infrastructure that could not run on Windows 11 due to a Cypress Electron/V8 binary incompatibility:

- `cypress/` (entire folder — `.cy.ts` spec, `.api.ts` helper)
- `cypress.config.ts`
- `run-cypress.mjs`
- `playwright.config.ts`

Replaced by the Node.js native test runner at `tests/run-integration-tests.mjs`.
Root `package.json` updated: Cypress devDependencies and scripts removed; `"test"` script added.

---

## Session 1 — 2026-05-10

### Backend Fixes

Same as Bug 1, 2, 3 above (discovered during initial integration test run).

### Frontend Tests

**Location:** `frontend/`
**Runner:** Vitest
**Command:** `npx vitest run --config=vitest.browser.config.ts` (run from `frontend/`)
**Result:** 164/164 passing across 9 test files
