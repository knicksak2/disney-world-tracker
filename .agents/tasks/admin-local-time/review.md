# Admin panel timestamps in viewer-local time

Every true-instant timestamp in `routes.ts` and `photoRoutes.ts` now goes through a new `localTime()` helper in `html.ts`. The helper emits `<time data-local-time datetime=ISO title=ISO>` with a UTC fallback text. One inline script in `renderPage` rewrites that text to the browser's zone. The two UTC calendar-day buckets are left alone, and the admin-panel spec was amended additively. I audited the diff and the recorded evidence. I did not re-run any suite.

Watch for: the spec-format diagnostics were never run (the implementer says so), and the recorded `npm run verify` tail is a condensed per-workspace summary rather than raw output. Neither blocks approval.

**Verdict**: APPROVED

## High-level view

Every `<time>` element is built server-side from `new Date(value).toISOString()`, never from the raw input. The browser only reformats visible text, so the exact UTC instant stays in `datetime` and `title`. Without JS, the page shows the UTC fallback.

All 14 inventoried spots are converted. A grep sweep of `routes.ts` and `photoRoutes.ts` finds no remaining raw-instant rendering. What remains is relative durations (`hours ago`, `Nm ago`), park-calendar dates, minute-of-day showtimes, and the two UTC bucket columns. All of these are non-instants and were deliberately left.

No CSP, helmet or nonce mechanism exists anywhere in `apps/api/src`, so a plain inline `<script>` is permitted. The design notes that a nonce is needed if a CSP is introduced.

The spec amendment is additive: Requirement 16 (16.1 to 16.6), design section 2a, Properties 9 and 10, a Testing Strategy bullet, task 23 with waves 10 to 12. Tests cover the helper, a fast-check property, the script run through `node:vm`, and route-level `server.inject` assertions.

<details>
<summary>Issues (2)</summary>

1. **Spec diagnostics not run (possible, non-blocking)** — the Kiro spec-format diagnostics were not run on the three spec files. I hand-checked the headings, `**Validates:**` lines, `_Requirements:_` lines, checkbox markers and the JSON waves, and they match the existing style. Run the diagnostics once when convenient.
2. **Cosmetic font size on the photo Created cell (possible, non-blocking)** — `.mono` now applies to the inner `<time>`, so the cell renders slightly larger than the old 0.75rem. The implementer already flagged this as unchecked visually.

</details>

<details>
<summary>Details</summary>

### Gate 1: every instant converted

I walked every `localTime` call site in the diff:

- Sync runs Started/Completed, the catalog last-synced text, and directory Built At.
- Sampling Started/Completed, derived-stats Last Success/Last Error At, and notifications Occurred At.
- User Created At, push registration Updated At, pin Unlocked/Claimed At, and the photo queue Created column.

A regex sweep of both files for `toISOString`, `toLocale*`, `_at`, `At`, `createdAt`, `updatedAt` and `header: ...(Time|Date|Day|At|...)` found nothing unconverted. The two remaining `toISOString` uses are the `Day (UTC)` bucket cell in `photoRoutes.ts` and the `html.ts` helper. `String(r.*_at)` no longer appears (confirmed).

The sampling "Completed At" cell used to render unconditionally, so a null showed "null". It now shows `-`. That is an improvement and is mentioned in code-status.

### Gate 2: UTC buckets preserved deliberately

`Date (UTC)` at `routes.ts` L1742 and `Day (UTC)` at `photoRoutes.ts` L194 to 195 are untouched, with their headers intact (confirmed). The decision is documented in the `localTime` doc comment, design section 2a, and Requirement 16.4. Converting a bare `YYYY-MM-DD` would shift the bucket day. `routes.test.ts` and `photoRoutes.test.ts` carry tests tagged Property 10 asserting the header and the bare date with no `<time>`.

### Gate 3: XSS and CSP

`localTime` builds `datetime` and `title` from `toISOString()` and also passes them through `escapeHtml`. The fallback text is escaped too. Invalid input renders `escapeHtml(String(value))` in a span with no `<time>`. The `Date` constructor and `String()` are wrapped in try/catch, and the year bound keeps the `slice(0, 19)` fallback well-formed.

The `cacheAgeDisplay` string is now interpolated unescaped, which is the highest-risk edit. Its parts are `escapeHtml(hours.toFixed(2))`, a literal, and `localTime(...)`, plus the constant `No cache recorded`. It is safe (confirmed). The directory `builtAtHtml` is `localTime(...)` or the constant `Not built`, so it is also safe.

`LOCAL_TIME_SCRIPT` is a constant with no interpolation and no `</script`. A grep for CSP, helmet and nonce found no policy in non-test source.

### Gates 4, 5 and 6: spec, tests, verify

- **Spec (additive):** the numstat shows 0 deletions in `requirements.md` and `design.md`. In `tasks.md` the only removed line is the wave 9 JSON line, which gained a trailing comma. Checkboxes are `[x]` only.
- **Tests fail on old code:** the old code has no `<time>`, no script and no footnote, so the exact-markup assertions would fail against it. The `routes.test.ts` diff has zero removed lines, so no existing assertion was weakened. The fast-check tests use `numRuns: 100` and carry the Feature/Property tag. The script test uses `node:vm` with a stub document instead of jsdom, which is a reasonable choice because jsdom is not a declared `apps/api` dependency.
- **Verify:** code-status records `npm run verify` with exit 0 and every workspace green (api 3498 passed, mobile 2559, shared 581). It also records one earlier red run caused by TypeScript errors in the new tests, which were fixed before the green run. I did not re-run it.

</details>

<details>
<summary>File map</summary>

- `html.ts`: `localTime`, `LOCAL_TIME_SCRIPT`, footnote and script in `renderPage`.
- `routes.ts`: 13 call sites converted.
- `photoRoutes.ts`: Created column converted.
- `__tests__/html.test.ts`, `routes.test.ts`, `photoRoutes.test.ts`: extended.
- `__tests__/html.prop.test.ts`, `localTimeScript.test.ts`: new.
- `.kiro/specs/admin-panel/{requirements,design,tasks}.md`: additive amendments.

Full diff: `git diff`.

</details>
