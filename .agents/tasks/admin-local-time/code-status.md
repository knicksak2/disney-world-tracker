# Code status: admin panel viewer-local timestamps (iteration 1)

No `review.json` existed, so this is a from-scratch implementation. Nothing committed (per instructions).

## Timestamp spots converted (all via `localTime()` from `admin/html.ts`)

| # | Page | Spot |
|---|---|---|
| 1 | `/admin/catalog` | "last synced" inside cache age (`cacheAgeDisplay` is now built as safe HTML: hours text escaped, instant via `localTime`; interpolated without a second `escapeHtml`) |
| 2-3 | `/admin/catalog` | sync runs Started At / Completed At (null completed -> `-`) |
| 4 | `/admin/disney-transport` | directory Built At (`builtAtMs` epoch ms; `Not built` text kept when null) |
| 5-6 | `/admin/intelligence/sampling` | sampling runs Started At / Completed At |
| 7-8 | `/admin/intelligence/derived-stats` | Last Success / Last Error At |
| 9 | `/admin/notifications` | Occurred At |
| 10 | `/admin/users?email=` | account Created At (metric card) |
| 11 | `/admin/users?email=` | push registration Updated At |
| 12-13 | `/admin/users/:id/pins` | Unlocked At (`Locked` kept when null) / Claimed At |
| 14 | `/admin/photos` (photoRoutes.ts) | queue Created |

Also in `html.ts`: `LOCAL_TIME_SCRIPT` (one inline script before `</body>` in `renderPage`), plus a footnote
(`.admin-footnote`) saying timestamps are in the browser's time zone and hover shows UTC. Every admin page
(error, confirmation and photo pages included) goes through `renderPage`, so one edit covers all.

CSP/nonce: grep found none, so a plain inline `<script>` is allowed. Noted in design 2a that a nonce is
needed if a CSP is added.

Sweep after edits: `toISOString()` in `admin/*.ts` non-test code remains only in `html.ts localTime`, the
photoRoutes `Day (UTC)` bucket cell, and `repo.ts` dateKeys (UTC bucket keys). No `String(r.*_at)` left.

Behavior change worth knowing: the old sync/sampling/derived cells printed `String(Date)` (server-zone text like
`Thu Oct 01 ... GMT+0000`), and sampling "Completed At" rendered unconditionally. Now null shows `-`.

## Intentionally left as UTC / not converted

- `Date (UTC)` (growth daily table) and `Day (UTC)` (photo usage table): UTC-day aggregation buckets (reqs 13.2 / 15.2).
  A bare `YYYY-MM-DD` is a bucket key, not an instant; converting would shift the day and misstate the bucket.
  Headers and values unchanged.
- Park-calendar dates (forecast log `targetDate`/`targetHour`, crowd-index history `date`) and minute-of-day show
  start times: park-local, not instants.
- Relative durations ("hours ago", "Nm ago", directory age, lockout TTL seconds) and ms config values.

## Spec amendment (additive only)

`git diff --numstat`: design.md +64/-0, requirements.md +13/-0, tasks.md +26/-1 (the one removed line is the wave-9
JSON line that gained a trailing comma). Added Requirement 16 (16.1-16.6), design section 2a, Property 9 and
Property 10, Testing Strategy bullet, task 23 (23.1-23.4, `_Requirements:_` lines) and waves 10-12. Only
`- [ ]`/`- [x]` boxes used; 23.x ticked after verify exited 0.
Not verified: I could not run the Kiro "Spec Format diagnostics" tool from here; formatting was copied from the
existing entries by hand. Please run diagnostics on the three files.

## Behavior -> test map

| Behavior | Test file | Assertion |
|---|---|---|
| `localTime` emits exact `<time>` (ISO datetime/title, UTC fallback) | `html.test.ts` | `localTime(new Date('2026-10-19T14:03:00Z'))` `toBe` the full exact string |
| Accepts Date / ISO string / ISO with millis / epoch ms | `html.test.ts` | all four `toBe(EXPECTED)` |
| null / undefined / '' -> `-` | `html.test.ts` | three `toBe('-')` |
| Malicious/invalid input escaped, no `<time>`, no throw | `html.test.ts` | `<img onerror>` -> `<span class="mono">&lt;img ...&gt;</span>`; `'not a date'`, `new Date(NaN)`, `"><script>` cases |
| Year bound (`new Date(8.64e15)`) | `html.test.ts` | output has no `<time`, starts with escaped span |
| `renderPage` emits exactly one script, after `</main>`, before `</body>`, plus footnote | `html.test.ts` | script count 1, index ordering, footnote text, `<script>${LOCAL_TIME_SCRIPT}</script>` |
| Script cannot end its own tag; uses `time[data-local-time]` | `html.test.ts` | no `</script`; contains selector |
| Property 9 round trip + totality (>=100 runs) | `html.prop.test.ts` | `datetime`/`title` equal `toISOString()`, parsed `datetime` == `getTime()`, Date/ISO/epoch identical, no `<>"` in inner text; strings never throw and equal `<span class="mono">${escapeHtml(s)}</span>` when invalid |
| Script converts to viewer zone with abbreviation | `localTimeScript.test.ts` (node:vm + stub document) | LA `07:03:00 PDT`; LA winter midnight `00:00:00 PST` (no `24:`); Kolkata `2026-10-20 01:30:00 GMT+5:30`; UTC |
| Script leaves fallback on bad data / Intl failure; never edits attrs | `localTimeScript.test.ts` | missing/blank/invalid keep text; `intlThrows` no throw, text kept; `setCalls === 0` |
| Script queries only `time[data-local-time]`; end-to-end with rendered page | `localTimeScript.test.ts` | selectors `['time[data-local-time]']`; page-embedded script equals constant and yields `2026-10-19 10:03:00 EDT` |
| Catalog sync runs, last-synced | `routes.test.ts` | four `timeTag(...)` strings; `1.50 hours ago (last synced <time ...>)` |
| Null completed / null last-synced / no cache | `routes.test.ts` | `</time></td><td>-</td>`; `2.00 hours ago (last synced -)`; `No cache recorded` |
| Directory Built At; unbuilt | `routes.test.ts` | `timeTag` of fixed `builtAtMs`; `Not built` and no `<time` |
| Sampling Started/Completed | `routes.test.ts` | both `timeTag` of fixed instants |
| Derived-stats per leg | `routes.test.ts` | `04:00` and `04:05` tags; regexes for `-` placement per row |
| Notifications Occurred At (normalized to `.000Z`) | `routes.test.ts` | `timeTag('2026-10-01T12:00:00.000Z')` |
| User Created At, push registration Updated At | `routes.test.ts` | both tags |
| Pins Unlocked/Claimed, Locked, `-` | `routes.test.ts` | unlocked + claimed tags; `Locked</span></td><td>-</td>` |
| Buckets stay UTC (Property 10) | `routes.test.ts`, `photoRoutes.test.ts` | `<th>Date (UTC)</th>` + `<td><span class="mono">2026-10-02</span></td>` and no `<time`; `<th>Day (UTC)</th>` + `2026-10-18` bare |
| Park-calendar dates / showtimes untouched | `routes.test.ts` | model page has `14:00`, no `<time`; accuracy detail has `2026-10-02`, no `<time` |
| Old raw-UTC rendering gone | `routes.test.ts` | across 7 pages: no `<span class="mono">...T..Z</span>`, no `GMT[+-]dddd`, no `Coordinated Universal Time`; `data-local-time` present; one script |
| XSS in timestamp field | `routes.test.ts` | `&lt;script&gt;alert(1)&lt;/script&gt;` present, raw tag absent, one script |
| 401 untouched | `routes.test.ts` | no `<script`, no `data-local-time` |
| Photo queue Created | `photoRoutes.test.ts` | exact `<time ...2026-10-18T10:00:00.000Z...>`; old bare mono UTC text absent; one script; footnote |

Existing assertions were not weakened or deleted. I did not run the tests against the pre-change code; they fail
there by construction (the old code cannot emit `<time`, the script or the footnote).

## `npm run verify` (root, run once at the end, after fixing two TS errors in my new tests)

Literal tail (per workspace):
```
@dwt/api   Test Files  487 passed | 6 skipped (493)
           Tests  3498 passed | 54 skipped (3552)      (vitest --run --coverage, no threshold failure)
@dwt/mobile Test Suites: 326 passed, 326 total
            Tests:       2559 passed, 2559 total
@dwt/shared Test Files  45 passed (45)
            Tests  581 passed (581)
EXIT=0
```
Typecheck ran for api, mobile and shared with no errors. The first attempt exited 2 with 3 TS errors in my new test
files (vitest does not typecheck); fixed and re-ran. The full gate was run twice for that reason only.

## Not verified

- No browser/visual check. Starting the API needs Postgres, Redis and admin credentials from `apps/api/.env`
  (not read or used), so I did not claim it. The `node:vm` + stub-document test covers the script logic; real DOM
  and real browser `Intl` abbreviations were not exercised.
- Kiro Spec Format diagnostics not run (see above).
- `<time class="mono">` inside the photo "Created" span: `.mono` sets 0.8rem, so that cell is slightly larger than the
  old 0.75rem. Cosmetic, not checked visually.
