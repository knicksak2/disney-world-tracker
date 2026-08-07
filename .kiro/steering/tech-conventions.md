# Tech & Repo Conventions

Repo-wide conventions for implementing any spec in this project. Applies to all work unless a spec says otherwise.

## Monorepo layout

- `apps/api` — Node.js + Fastify backend (TypeScript). Services live in `apps/api/src/services/<name>/`.
- `apps/mobile` — React Native + Expo client (TypeScript). React Navigation, TanStack Query, Zustand.
- `packages/shared` — `@dwt/shared`: DTOs, Zod schemas, enums, error-code catalog. Single source of truth for wire contracts; both apps import from it so they cannot drift.

## Backend conventions

- **Service shape:** a service folder typically has pure domain modules (no I/O — property-testable), a `repo.ts` (DB), and `routes.ts` (Fastify). Keep business logic in pure modules; pass data in.
- **Wiring:** services are constructed and wired in `apps/api/src/composeServices.ts` via constructor injection (structural port interfaces, not concrete imports), so tests can substitute fakes.
- **Migrations:** sequential SQL files `apps/api/migrations/NNNN_name.sql`, wrapped in `BEGIN/COMMIT`, using `gen_random_uuid()`, `TIMESTAMPTZ`, `CHECK` constraints, `ON DELETE CASCADE`. They are idempotent-on-reapply and run in the deploy build step. Never edit an already-applied migration; add a new one.
- **Errors:** use the existing `AppError`/`ErrorCode` envelope; routes gate auth with the existing session/permission helpers.

## Reuse these — do not reinvent

- **Live data:** the existing `Live_Service` (ThemeParks.wiki) for live waits, forecast, operating hours, and the `/entity/{id}/schedule` feed. It is keyed by an Experience's `Enterprise_Id` (== ThemeParks `externalId`); the ThemeParks entity **GUID** is resolved from that via `themeParksDirectory.resolveEntityId(enterpriseId)` (cached). A raw join on `upstream_entity_id` does NOT equal the GUID.
- **WDW time:** `apps/api/src/services/trips/wdwClock.ts` for the `America/New_York` park calendar. Store timestamps as UTC `TIMESTAMPTZ`.
- **Trip authorization:** `apps/api/src/services/trips/permissions.ts` role/action matrix; add new actions there rather than inventing auth.
- **Catalog data:** `experiences.upstream_entity_id` (Enterprise_Id), `experiences.latitude/longitude` (nullable — handle nulls), `experiences.park`.

## Testing

- **Test runners (per app — do not mix):**
  - `apps/api` uses **Vitest** — run `npx vitest run <path>` (or the workspace `test` script). `server.inject` for Fastify route integration tests; test DB or `pg-mem` for repos.
  - `apps/mobile` uses **Jest** (`jest-expo`) with `@testing-library/react-native` — run via `npm run test` in `apps/mobile`; type-check with `npm run typecheck`. **Never** use Vitest for React Native component tests; they must render under the RN/jest-expo preset.
  - `packages/shared` uses Vitest.
- **Property tests:** `fast-check`, minimum 100 runs, tagged `// Feature: <feature-name>, Property N: <text>`. Run pure modules directly; stateful logic against an in-memory model with integration tests pinning the real repo.
- **Mobile component tests:** render the real component with `@testing-library/react-native` and assert real output; mock only the network/query layer, not the component under test.
- **Repos/migrations:** migration tests named `migrationNNNN.test.ts`.

## Hosting constraints (free tier — design within these)

- **Render** web service sleeps after ~15 min idle. **No always-on background worker** (a BullMQ `Worker` polls Redis continuously and would exhaust the Redis budget). Drive scheduled work from the existing external keep-alive cron hitting an authenticated endpoint that returns fast (`202`) and does work async in-process.
- **Neon** Postgres ~0.5 GB — keep stores bounded (fixed-shape aggregates; prune raw rows to a recent window).
- **Upstash** Redis ~10k commands/day — avoid continuous polling.
- The keep-alive cron currently runs every ~10 minutes, ~7 AM–1 AM ET.

## Mobile conventions

- Bottom tabs: Home, Catalog, Trips, Friends, Profile. `ExperienceDetail` is a root-stack screen above the tabs. Feature screens live in the relevant stack (e.g., `TripsStack`, `CatalogStack`).
- TanStack Query for reads/mutations; Zustand `sessionStore` for session scope; themed component kit.
- Accessibility: label visuals; never rely on color alone.

## Modeling conventions

- Prefer **continuous** internal values (e.g., minute-level waits, continuous indices); apply human-friendly rounding (e.g., a 1–10 level) as a **display-only** projection that is never fed back into calculations.
- Recency-weighted updates (EMA / capped sample count) so recent data dominates.

## Spec-authoring standard

Every spec (`.kiro/specs/<feature>/`) should be **self-sufficient for a cold-start executor** (task execution does not carry chat context). In addition to the format the validator enforces (requirements EARS; design with Architecture / Components and Interfaces / Data Models / Correctness Properties as `### Property N` with a `**Validates:**` line / Error Handling / Testing Strategy; tasks as `# Implementation Plan` with `## Tasks` / `## Notes` / `## Task Dependency Graph`), include:

- A **Configuration & Constants** section with concrete defaults and env var names (secrets, base URLs, thresholds, cadences, retention windows) — nothing left as "tuning" without a default.
- An **External Interfaces** section whenever integrating an external or undocumented API: the endpoints used, the response fields relied on, and any id-mapping.
- Concrete starting formulas for any model/heuristic (not just "a weighted model"), so it isn't reinvented divergently.
- Explicit cross-spec dependencies and build order.

## When you MUST update the spec before/with the code

If the user asks for behavior that is not already covered by the feature's `requirements.md`, you must amend the spec **as part of the same change** — before or alongside the code, never after. "The user asked for it" is the trigger to update the spec, not a reason to skip it. Concretely, you must add a backing requirement (and its design **Correctness Property** and a task) when your change introduces any of:

- a new user-facing behavior or UI control not described in requirements,
- a new persisted field / column / DTO field, or a change to how an existing one is modeled (e.g. moving a per-trip column to a per-date structure),
- a new branch or input flag in a spec'd engine (e.g. a new `OptimizeInput` field or optimizer window rule).

A broadly worded existing requirement (e.g. "a settings modal") does NOT already cover a specific new capability added under it. If you conclude no spec update is needed, state the specific requirement number that already covers each new behavior; if you can't cite one, the spec needs the amendment. Reflect new scope into `tasks.md` too — do not implement net-new behavior only from an ad-hoc plan while `tasks.md` stays silent. This rule is about net-new behavior; it does not fire on ordinary bug fixes or refactors that stay within existing requirements.

## Editing an existing spec — additive by default

When you revise a spec that already exists, **add or amend; do not delete or renumber existing requirements, acceptance criteria, or design sections** unless you were explicitly asked to remove them. Requirements are referenced by number across the spec (design Correctness Properties' `Validates:` lines, tasks' `_Requirements:_` lines), so silently dropping or renumbering one orphans every reference to it. If a requirement is genuinely obsolete, call it out and confirm before removing. After any spec edit, re-run the spec validator (the Kiro Spec Format diagnostics) and confirm every file is clean — this also catches malformed checkboxes (`- [ ]`/`- [x]` only; never `- [/]` or other markers).
