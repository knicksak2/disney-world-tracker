# Execution & Verification Discipline

Always-on rules for implementing any spec/task in this repo, learned from real defects shipped here. These exist so a task can be trusted **without a human re-reviewing every step**. Follow them on every task, not just when asked.

## Verification is a hard gate — scaled to the change

Verification is mandatory, but the *amount* scales to blast radius. Two things are always true: typecheck is cheap and never optional, and you never report something done (or check its box) without having actually run the right verification for the change and seen it pass.

**Tiers — pick by what you touched, and don't over-run:**

- **While actively iterating on a file (the inner loop):** run only the single test file you're editing — `npx jest <file>` (mobile) or `npx vitest run <path>` (api/shared) — and `npm run typecheck` when you've touched types or contracts. This is what you run after each edit; it takes seconds. **Do NOT run a whole workspace suite, and never the full `npm run verify`, after every edit** — that is the single biggest time sink and it is unnecessary while you're still iterating on one file.
- **Once you think an area is done:** run the matching scoped script `npm run verify:api` / `verify:mobile` / `verify:shared` (full typecheck + that one workspace's tests) to catch anything you missed in the file-level loop. Once, not repeatedly.
- **As the final step before declaring the whole change done, before changing a shared or cross-cutting contract, or before a commit you intend to deploy:** run the **full** gate **once**:

  ```
  npm run verify
  ```

  which runs the full typecheck **and** the full test suite across every workspace (`apps/api`, `apps/mobile`, `packages/shared`). "Done" means it exits `0`.

**What "the whole change" means — do not run the full gate more often than this.** The unit that triggers the full `npm run verify` is the *entire change you were asked to make*, complete — every file it spans **and** its tests. It is emphatically **not** a single file, one of several files in the change, an internal sub-step you set yourself, or the code half of a code-plus-tests change. Concretely:

- A change that edits code **and then** its tests is **one** unit: do **not** run the full gate after the code edits and again after the tests — the code isn't "done" until its tests exist, so there is exactly one final gate, after the tests.
- A change spanning `apps/api` + `apps/mobile` + `packages/shared` is still **one** unit → **one** final full-gate run, not one per workspace or per file.
- If you find yourself running `npm run verify` more than once for a single requested change, you are over-running — use the file-level inner loop between edits instead.

Non-negotiable rules whenever you report done:

1. **Actually run the right tier.** Run the verification appropriate to the change as the last step before reporting — the full `npm run verify` for a completed task/checkpoint/spec. If you did not run it, you must say "I did not run verification" — never imply or state that it passed.
2. **Paste the literal tail of the output**, including the final `Tests: … passed`/`Test Files … passed` lines for each workspace **and** the shell exit code. A summary like "everything looks good" or "checks pass cleanly" is not acceptable evidence and, if the command actually failed, is a fabricated result — the single worst outcome here.
3. **Green means every workspace green.** A pass in one workspace while another fails to typecheck or test is a **red** run. `apps/mobile` typecheck is included in the root typecheck; do not skip it.
4. **You broke it, you own it.** The baseline is green before you start. Any typecheck error or failing test after your change is yours — including a test in another feature that your change regressed (e.g. a DTO field addition that breaks another suite's fixture, or a repo write that breaks another test's schema harness). Fix it; do not dismiss it as "pre-existing" unless it is genuinely red on a clean checkout and you say so explicitly.
5. **Unchecked > false-checked.** If any of this fails or is incomplete, leave the task unchecked and state plainly what is missing. A half-done task honestly marked is fine; a broken task marked done is not.
6. **A `vitest`/`jest` run is NOT the gate.** Test runners transpile each file in isolation and do **not** typecheck the program — a green `vitest --run` or `jest` can sit on top of code that fails `tsc` (undefined imports, missing exports, implicit `any`, contracts referenced but never defined). Only `npm run verify` — which runs `tsc` across every workspace **and** the tests — counts. Pasting test-runner output in place of the `npm run verify` typecheck+test output does not satisfy done, and claiming "the compiler runs clean" without having run `tsc`/`npm run verify` is a fabricated result.

The rest of this file explains what "real verification" and "real tests" mean. The gate above is how you prove it.

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

## Edit real source directly — no codegen scripts, no stray files

- **Never edit code by running a script** (a one-off `node`/`sed`/`awk` string-replacement, a `fix-*.js`/`update-*.js` helper, etc.). Editing source by blind string injection is how a wrong field name (`waitSnapshots` instead of the real `snapshots`) got baked into a route here. Edit the actual source files directly and deliberately.
- **Leave no stray or generated files behind.** When you report done, the working tree contains only the intended source changes — no throwaway scripts at the repo root, no scratch/generated files, no `.js` build artifacts checked in beside `.ts` sources. If you created a helper to explore, delete it before finishing.
- **Wire consumers against the real exported type, then typecheck immediately.** When you connect a route/handler to a service, or feed a value into another module (e.g. building the optimizer's `OptimizeInput`), open that module's exported interface and use its exact field and parameter names — do not guess or invent them. Run `npm run typecheck` right after wiring; a consumer built against an imagined shape is a compile error you must catch yourself, not leave for review. Also pass the data the interface actually requires (e.g. resolved coordinates), not just the fields that were easy to fill.

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
- **Mobile component** → a `@testing-library/react-native` render test that mocks only the network/query layer and covers **each primary user interaction the component adds, not just its initial render**. For every interactive flow — opening a modal, submitting a form, toggling a control, selecting from a picker, switching a tab/date — drive it with `fireEvent`/`waitFor` and assert **both** effects: the network call it triggers (correct endpoint and payload/args) **and** the resulting on-screen change. An initial-render snapshot plus one happy path is not sufficient when the component introduces add/edit/settings flows; if the component adds three user actions, the test exercises all three. Name any interactive flow you did not cover and why.

Coverage means **meaningful assertions**, not smoke tests. A test that passes regardless of whether the logic is correct (or whose fixture doesn't match real data) does not count as covering that code. When you finish a task, name what you added tests for; if any new code path is untested, say so explicitly rather than implying full coverage.

**Enforced coverage gate:** `apps/api` runs v8 coverage on every `npm run test`, with a threshold on `src/services/planning/**` (90% lines/functions/statements, 80% branches). If you add code there without covering it, the run fails with a `does not meet threshold` error. Fix it by **writing the missing tests** — never by lowering or removing the threshold, disabling coverage, or excluding the file. If you add a new pure module elsewhere that warrants the same protection, extend the threshold globs rather than weakening them.

## A bug fix is not done without a regression test at the layer that was wrong

When you fix a defect (not just add a feature), add a test that **would have failed against the buggy code and passes with your fix**, and put it at the **layer where the bug actually lived** — not an adjacent one. A test that passes regardless of the fix does not guard it.

- A repo/SQL bug (e.g. a column dropped from an `INSERT`, a wrong `WHERE`, a missing `ON CONFLICT` key) needs a **pg-mem repo test** that runs the real query and reads the row back to assert the affected columns/behavior. A mobile test asserting the client *sent* the field, or a route test with a **mocked** repo, does **not** cover a bug in the real SQL — the mock or the client payload was never the thing that was broken.
- A route/handler bug needs a `server.inject` test hitting the real handler; a pure-logic bug needs a unit/property test on that function.
- Concrete tell: this session's `addPlannedItem` fix (scheduling columns dropped from the INSERT so added items persisted with `planned_date = NULL`) was "green" because the only nearby test asserted the outgoing request body — it would still have passed with the bug present. The real guard is a pg-mem test that inserts via `addPlannedItem` and reads `planned_date`/`is_fixed`/… back.

Before calling a fix done, ask: **"Would this test have failed before my change?"** If not, you have not tested the fix — and remember a green `npm run verify` proves nothing is *broken*, never that new/changed behavior is *covered*.

**This litmus applies to every behavior change, not just bug fixes — including a new code path added to an already-tested module.** A module already having tests (e.g. `optimizer.ts` has property tests) does **not** exempt a new branch or behavior you add to it: add a test that specifically exercises the new path and would fail without it. Watch especially for a new branch gated on a condition your existing tests don't set — e.g. adding `if (isLightningLane && plannedTime) { …return-window logic… }` when every existing Lightning-Lane test uses `plannedTime: null`, so the new branch never runs and the suite stays green while the logic is entirely uncovered. If you add or change a conditional/behavior, a test must drive that specific condition.

## Self-review each checkpoint — produce a behavior→test map before reporting done

At every checkpoint, before saying "done," re-read your own diff adversarially: is anything stubbed or hardcoded? Does every new test assert real behavior with a realistic fixture? Did I run the right verification and see it pass?

Then, **in the same message where you report the work done, write an explicit behavior→test map** — a short list of every user-facing behavior or code path you added or changed in this task, each with the test *and the specific assertion* that covers it. For example:

- `time-wheel picks 3:00 PM` → `TripScheduleScreen.test.tsx` asserts the PATCH `plannedTime` is `15:00`
- `LL return window` → `optimizer.prop.test.ts` asserts arrival is clamped into `[start − 5, start + 75]`

Rules for the map:

- Every behavior you touched gets a row. A new UI control, a new branch, a new field in a payload, a changed calculation — each is a row.
- If a row has no test/assertion, the task is **not done**: write the test, or state plainly that behavior is untested and leave the task unchecked. Do not report done with an incomplete map.
- "It renders" / "the suite is green" is **not** a row. A row names the concrete assertion that would fail if that behavior were wrong.

**Why this step exists and a green run can't replace it:** a green `npm run verify` proves nothing is *broken*, never that new behavior is *covered*; and coverage counts a line as covered the moment any test merely **executes** it, so a new branch can pass the coverage gate while **no test asserts what it does** (the LL return-window branch did exactly this — executed by random property inputs, asserted by nothing; and the time-wheel picker shipped with its interactions unasserted while the suite stayed green). The behavior→test map is the one reliable check for this executed-but-unasserted gap — the recurring way tests get "missed" here.
