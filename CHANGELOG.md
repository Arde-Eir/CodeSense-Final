# CodeSense Changelog

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
