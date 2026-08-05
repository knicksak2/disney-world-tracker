# Execution & Verification Discipline

Always-on rules for implementing any spec/task in this repo, learned from real defects shipped here. These exist so a task can be trusted **without a human re-reviewing every step**. Follow them on every task, not just when asked.

## Verification is not optional — and it must be real

Before marking ANY task or checkpoint complete:

1. **Typecheck every affected package, not just one.** Run `npm run typecheck` from the repo root (it runs all workspaces). A change that touches `apps/api` and `packages/shared` must typecheck both. **`apps/mobile` must be typechecked separately with `npm run typecheck` in `apps/mobile`** — its Jest run does NOT typecheck.
2. **Run the FULL test suite, not a filtered path.** Run `npm run test` from the repo root (all workspaces). Do NOT conclude "green" from `vitest run <one-folder>` — that repeatedly hid compile errors and failures in other files. A change is "done" only when the whole suite is green.
3. **Paste the actual command output** (pass/fail counts, or the error). Never report "all green" from memory, a partial run, or an assumption. If you did not run it, say so.

If a genuinely unrelated, pre-existing failure exists, name it explicitly and explain why it is out of scope — do not let it hide new breakage.

## No stubs, no fakes, no false greens

- Code marked complete must be **fully implemented**. No `TODO`, no placeholder return values, no fabricated/hardcoded sample data standing in for real logic. If something cannot be implemented yet, leave the task **unchecked** and state plainly what is missing.
- **Tests must exercise real behavior against realistic inputs.** Fixtures must mirror the real data/markup/contract shapes (e.g. real HTML with its actual attributes, real DTO fields), not a simplified version that would never match production. A test that passes only because its fixture is unrealistic is worse than no test.
- Mobile component tests render the real component and assert real output; mock only the network/query layer.
- Write the property tests the design specifies (fast-check, ≥100 runs, tagged as the conventions describe).

## Verify external contracts before relying on them

- Before depending on an external or internal API's endpoint, id scheme, field names, or value scale, **confirm it against the real API or the spec's External Interfaces section** — do not assume. Unchecked assumptions about ids, paths, and encodings have caused silent whole-feature failures here.
- When integrating with another feature (e.g. consuming `predictionService`), read its actual exported interface and call it as-is. **Never invent a method or field that isn't on the real type.**

## Units, scales, and time — be explicit

- Keep **continuous internal values** vs **display projections** distinct (e.g. the crowd ratio where 1.0 = typical vs the display-only 1–10 `displayLevel`). Never feed a display-rounded value back into a calculation.
- Watch encodings that differ between sources: day-of-week ranges (JS `getDay` 0–6 vs BigQuery/ISO 1–7), money (store integer **cents**), and timestamps (store UTC `TIMESTAMPTZ`; parse zoneless upstream times deliberately, not in the server's local zone).

## Database

- Migrations are additive and idempotent; never edit an applied migration — add a new sequential one in `apps/api/migrations/`.
- Any `INSERT ... ON CONFLICT DO UPDATE` batch must be **deduped by its conflict key** before the query — Postgres refuses to update the same row twice in one command (error `21000`).

## Reuse, don't reinvent

Use the existing services rather than rebuilding them: `Live_Service` (waits/schedule/LL price), `themeParksDirectory.resolveEntityId`, `wdwClock`, trip `permissions`, and the crowd-calendar `predictionService` (`getDaySnapshot` / `getCrowdMultiplier`). Catalog park comes from `experiences.park`.

## Test coverage is part of "done" — not a separate optional task

A task that adds code is **not complete until that code has tests that pass**. Tests are never a "later" or "MVP-optional" step; if a spec ever labels test tasks optional, treat them as required anyway. Concretely, every new piece of code ships with its matching test in the same task:

- **Pure/domain module** (no I/O) → unit tests covering the main and edge paths, **plus** the property tests the design specifies (`fast-check`, ≥100 runs, tagged `Feature: <name>, Property N`). Assert real values/behavior, not just "it ran."
- **Route / endpoint** → a `server.inject` integration test covering the auth/permission gate, the happy path, and at least one validation/error path.
- **Repo / DB method** → a test against `pg-mem` or a test DB exercising the real SQL.
- **Migration** → a `migrationNNNN.test.ts` asserting the columns/constraints it adds (and any query behavior that depends on them).
- **Shared DTO / Zod schema** → a schema test with both a valid and an invalid case.
- **Mobile component** → a `@testing-library/react-native` render test asserting real output, mocking only the network/query layer.

Coverage means **meaningful assertions**, not smoke tests. A test that passes regardless of whether the logic is correct (or whose fixture doesn't match real data) does not count as covering that code. When you finish a task, name what you added tests for; if any new code path is untested, say so explicitly rather than implying full coverage.

**Enforced coverage gate:** `apps/api` runs v8 coverage on every `npm run test`, with a threshold on `src/services/planning/**` (90% lines/functions/statements, 80% branches). If you add code there without covering it, the run fails with a `does not meet threshold` error. Fix it by **writing the missing tests** — never by lowering or removing the threshold, disabling coverage, or excluding the file. If you add a new pure module elsewhere that warrants the same protection, extend the threshold globs rather than weakening them.

## Self-review each checkpoint

At every checkpoint, before saying "done," re-read your own diff adversarially and ask: is anything stubbed or hardcoded? Does every new test assert real behavior with a realistic fixture? Did I run the full typecheck + full test suite and see them pass? Only then proceed.
