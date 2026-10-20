# Implementation Plan: Admin panel timestamps in viewer-local time

Task: show every admin-panel timestamp in the viewer's browser time zone instead of UTC.
Branch: the currently checked-out branch (no worktree). Do NOT touch `.worktrees/`.
Repo rules already read: root `AGENTS.md`, `.agents/AGENTS.md`, all of `.kiro/steering/*`
(tech-conventions, execution-discipline, pin-collection*). Pin gate is NOT relevant (no catalogue
file changes). Gate for this change is `npm run verify` (once, at the end).

## Findings (verified by reading the code)

1. Rendering model: admin pages are server-rendered strings. Every page goes through
   `renderPage(title, bodyHtml, currentPath?)` in `apps/api/src/services/admin/html.ts`
   (`routes.ts` via `renderAdminSection`, `photoRoutes.ts` directly). `renderPage` ends with
   `</main></div></body></html>` and has NO `<script>` today. One edit there covers every page,
   including error, unlock, revoke and photo confirmation pages.
2. No CSP, no nonce mechanism. Grepped `apps/api/src` for `helmet|contentSecurityPolicy|
   Content-Security-Policy|nonce`: nothing. The only admin response headers are
   `X-Robots-Tag` (routes.ts `onSend`) and `Cache-Control: private, no-store` (photoRoutes
   `setSecurityHeaders`). An inline script is therefore allowed. If a CSP is ever added, this
   script must get a nonce; record that in design.md (task 23.2).
3. Helpers to reuse (all in `html.ts`): `escapeHtml(unknown)`, `table`, `flagged`, `.mono` class.
   `table` does not escape cell output, so each `cell` must return already-safe HTML.
4. Runtime types differ from declared types. Values reach the HTML as one of:
   - `Date` objects from pg (`catalog_sync_runs`, `sampling_runs`, `derived_stat_runs`,
     `catalogRepo.getCacheAge().lastSuccessfulSyncAt`, `photos.created_at` wrapped in `new Date`).
     Today `String(Date)` is rendered for sync/sampling/derived runs. That prints e.g.
     `Thu Oct 01 2026 00:00:00 GMT+0000 (Coordinated Universal Time)` in the SERVER's zone, so
     those columns are not even a consistent UTC today. `localTime()` fixes this too.
   - ISO strings already produced by SQL `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
     (`occurredAt`, user `createdAt`, push registration `updatedAt`) and by
     `pins/repo.ts toIsoTimestamp` (`awardedAt`, `claimedAt`).
   - epoch milliseconds (`DirectorySnapshot.builtAtMs`).
5. No jsdom in `apps/api` (only a transitive root `node_modules/jsdom` via the mobile app's
   `jest-environment-jsdom`). Do NOT rely on an undeclared hoisted package and do NOT add a
   dependency. The script test uses `node:vm` plus a tiny stub document (see task 23.3).

## Design decisions (each with reasoning)

D1. Server stays authoritative and emits the exact instant; the browser only re-formats text.
    New helper `localTime(value)` in `html.ts` returns
    `<time class="mono" data-local-time datetime="2026-10-19T14:03:00.000Z" title="2026-10-19T14:03:00.000Z">2026-10-19 14:03:00 UTC</time>`.
    - `datetime` and `title` come from `new Date(value).toISOString()` (never the raw input), so
      they are safe by construction. They are still passed through `escapeHtml` for uniformity.
    - Visible text is the no-JS fallback `YYYY-MM-DD HH:MM:SS UTC` (`iso.slice(0, 19).replace('T', ' ') + ' UTC'`).
    - Hover (`title`) shows the full ISO UTC instant, which preserves operator ability to
      copy a UTC value into logs/SQL.
    Why not format fully server-side: the server cannot know the viewer's zone (Render runs UTC).
    Why not a client-only approach: it would break with JS disabled and lose the exact instant.

D2. Signature and edge cases:
    `export function localTime(value: Date | string | number | null | undefined): string`
    - `null`, `undefined`, `''` -> `'-'`.
    - Unparseable (NaN) or year outside 0..9999 -> `<span class="mono">${escapeHtml(String(value))}</span>`
      (show the raw junk to the operator, no `<time>`, no throw). The year bound keeps the
      `slice(0, 19)` fallback well-formed.
    - Valid -> the `<time>` element above. The helper owns the `mono` class, so call sites drop
      their own `<span class="mono">` wrapper.

D3. One inline script, exported as a constant `LOCAL_TIME_SCRIPT` from `html.ts` and emitted once
    in `renderPage` just before `</body>` (after `</div>` that closes `.admin-container`). It
    contains NO interpolated data, so it is not an injection surface. ES5 style, defensive:

    ```js
    (function () {
      var nodes = document.querySelectorAll('time[data-local-time]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var iso = el.getAttribute('datetime');
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime())) continue;
        try {
          var fmt = new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23', timeZoneName: 'short'
          });
          var parts = fmt.formatToParts(d), p = {};
          for (var j = 0; j < parts.length; j++) p[parts[j].type] = parts[j].value;
          el.textContent = p.year + '-' + p.month + '-' + p.day + ' ' +
            p.hour + ':' + p.minute + ':' + p.second + ' ' + p.timeZoneName;
        } catch (e) { /* keep the UTC fallback text */ }
      }
    })();
    ```
    Format decisions: ISO-like `YYYY-MM-DD HH:MM:SS TZ` so it matches the old column look and
    sorts visually; `en-US` + `formatToParts` so numeric field order is fixed regardless of the
    viewer locale while the zone abbreviation (`PDT`, `EDT`, `GMT+5:30`) still comes from the
    viewer's zone; `hourCycle: 'h23'` avoids `24:00` at midnight. The script never touches
    `datetime` or `title`. A bad/blank `datetime` or an `Intl` failure leaves the UTC fallback.

D4. CALENDAR-DATE BUCKETS STAY UTC. Only true instants are converted. A bare `YYYY-MM-DD` is an
    aggregation key, not an instant; converting it would shift the day and misstate the bucket.
    - `Date (UTC)` in `/admin/growth`: computed in `repo.ts getDailyGrowth` (`dateKeys` via
      `Date.UTC`, SQL `to_char(created_at, 'YYYY-MM-DD')` in the DB zone). Requirement 13.2
      says "trailing 7 calendar days (UTC)". Keep header and values as-is.
    - `Day (UTC)` in `/admin/photos` usage table: SQL day bucket from `photo_usage_daily`
      (requirement 15.2). Keep header and values as-is.
    - Re-bucketing by local day is NOT trivially correct (it would need the client zone in the
      SQL and a different retention/aggregation contract), so it is explicitly out of scope.
    - Park-calendar dates and clock times are also not instants and stay untouched (see "Not
      converted" below).

D5. Add one short footnote line in `renderPage` (inside `.admin-container`, after `</main>`):
    `<p class="text-muted text-xs admin-footnote">Timestamps are shown in your browser's time zone. Hover for the UTC instant.</p>`.
    It tells the operator why zone abbreviations vary and where the UTC value lives. It is
    new UI, so it is covered by the new requirement (16.6) and a test assertion.

D6. Relative durations ("5 min", "hours ago", `Nm ago`, Remaining TTL) are zone-independent;
    leave them alone.

## Exhaustive inventory of timestamp spots

Line numbers are from the current tree and may drift by a few lines; locate by the quoted code.

### A. `apps/api/src/services/admin/routes.ts` - CONVERT (true instants)

| # | Page / route | Spot | Current code | New |
|---|---|---|---|---|
| 1 | `/admin/catalog` | "last synced" inside `cacheAgeDisplay` (~L385) | `new Date(cacheInfo.lastSuccessfulSyncAt).toISOString()` in a template string | `localTime(cacheInfo.lastSuccessfulSyncAt)` (returns `-` when null). `cacheAgeDisplay` becomes HTML, so check how it is interpolated further down (if it is wrapped in `escapeHtml`, split into an escaped text part and the `localTime` part; do not double-escape the `<time>` element, and do not leave it unescaped if it contains anything else). Read the usage site (after ~L453) before editing. |
| 2 | `/admin/catalog` sync runs table, "Started At" (~L462-464) | `<span class="mono">${escapeHtml(String(r.started_at))}</span>` | `localTime(r.started_at)` |
| 3 | `/admin/catalog` sync runs table, "Completed At" (~L466-468) | `r.completed_at ? <span class="mono">String(...)</span> : '-'` | `localTime(r.completed_at)` (null -> `-`) |
| 4 | `/admin/disney-transport` directory snapshot "Built At" (~L573, L579) | `new Date(dir.builtAtMs).toISOString()` or `'Not built'`, then `<span class="mono">${escapeHtml(builtAt)}</span>` | `const builtAtHtml = dir.builtAtMs ? localTime(dir.builtAtMs) : 'Not built'` and interpolate `builtAtHtml` unescaped (both branches are safe). Keep `ageMinutes` as is. |
| 5 | `/admin/intelligence/sampling` runs table "Started At" (~L1207) | `escapeHtml(String(r.started_at))` | `localTime(r.started_at)` |
| 6 | same table "Completed At" (~L1208) | `escapeHtml(String(r.completed_at))` | `localTime(r.completed_at)` |
| 7 | `/admin/intelligence/derived-stats` "Last Success" (~L1272) | `r.last_success_at ? <span class="mono">String(...)</span> : '-'` | `localTime(r.last_success_at)` |
| 8 | same table "Last Error At" (~L1276) | same pattern on `last_error_at` | `localTime(r.last_error_at)` |
| 9 | `/admin/notifications` deliveries table "Occurred At" (~L1472) | `<span class="mono">${escapeHtml(r.occurredAt)}</span>` | `localTime(r.occurredAt)` |
| 10 | `/admin/users?email=` account card "Created At" (~L1527 metric card) | `<span class="mono">${escapeHtml(user.createdAt)}</span>` | `localTime(user.createdAt)` (keep the surrounding `metric-val` div and its `font-size: 1rem`) |
| 11 | `/admin/users?email=` push registrations table "Updated At" (~L1545) | `escapeHtml(r.updatedAt)` in mono span | `localTime(r.updatedAt)` |
| 12 | `/admin/users/:userId/pins` "Unlocked At" (~L1672) | `p.awardedAt ? mono(escapeHtml(...)) : '<span class="text-muted">Locked</span>'` | `p.awardedAt ? localTime(p.awardedAt) : '<span class="text-muted">Locked</span>'` |
| 13 | same table "Claimed At" (~L1676) | `p.claimedAt ? mono(...) : '-'` | `localTime(p.claimedAt)` |

### B. `apps/api/src/services/admin/photoRoutes.ts` - CONVERT

| # | Page | Spot | Current code | New |
|---|---|---|---|---|
| 14 | `/admin/photos` queue table "Created" (~L149-150) | `<span class="mono" style="font-size: 0.75rem;">${escapeHtml(r.createdAt.toISOString().replace('T',' ').slice(0,19))}</span>` | `<span style="font-size: 0.75rem;">${localTime(r.createdAt)}</span>` (import `localTime` from `./html.js`). `createdAt` is a `Date` (repo wraps with `new Date`). |

### C. KEEP AS UTC / NOT AN INSTANT (do not convert; add a test that they are unchanged)

| Spot | Where | Why |
|---|---|---|
| "Date (UTC)" header + `r.date` | routes.ts ~L1742 growth daily table | UTC-day aggregation bucket (req 13.2). Keep label. |
| "Day (UTC)" header + `r.day` | photoRoutes.ts ~L194-195 usage table | UTC-day rollup bucket (req 15.2). Keep label. |
| "Date" `r.targetDate`, "Hour" `r.targetHour` | routes.ts ~L997-999 forecast log | Park-calendar (America/New_York) forecast target, not an instant. |
| "Date" `r.date` | routes.ts ~L1101 per-park crowd index history | Park-calendar day key. |
| "Start Time" (`startMinutes`) / "Day of Week" | routes.ts ~L1136-1145 showtimes | Minute-of-day in park-local time, not an instant. Converting to the viewer zone would be wrong. |
| "Remaining TTL" (`lockedUntilMs`) | routes.ts lockouts table | Rendered as seconds remaining. |
| "Directory Age", "hours ago", "Healthy: last success Nm ago" | routes.ts | Relative durations. |
| Config rows `...Ms` | routes.ts `/admin/config` | Durations in ms. |

### D. Verification sweep (implementer must do before reporting done)

After edits run these greps over `apps/api/src/services/admin/*.ts` (non-test) and confirm no
raw-instant rendering is left. Each must return only the Section C items (or nothing):
- `String\(r\.[a-z_]+_at\)`, `String\(r\.started_at\)`, `String\(r\.completed_at\)`
- `\.toISOString\(\)` (only allowed inside `html.ts localTime`)
- `escapeHtml\((r|p|user)\.(occurredAt|createdAt|updatedAt|awardedAt|claimedAt)\)`
- `header: '[^']*(At|Created|Updated|Success|Built)'`
If any additional instant turns up, convert it and add it to the behavior->test map.

## Implementation tasks (ordered; one coherent change, no decomposition into FEATs)

The work is small, tightly coupled (helper -> call sites -> tests -> spec), and edits only
`html.ts`, two route files, tests and three spec files, so it is NOT split into separate FEAT
workflows. The existing implement-and-review loop runs this plan top to bottom.

- [ ] 1. Add `localTime` and `LOCAL_TIME_SCRIPT` to `html.ts`, and emit the script plus footnote in `renderPage`.
      Implement D1-D3 and D5 exactly as written above. `localTime` uses `escapeHtml` on every
      interpolated value; the script constant has no interpolation and no `</script` substring.
      Insert `<script>${LOCAL_TIME_SCRIPT}</script>` immediately before `</body>`.
      No new CSS is needed; the `<time>` element reuses the existing `.mono` class.
      Files: `apps/api/src/services/admin/html.ts`
      Verify (inner loop): `npx vitest run src/services/admin/__tests__/html.test.ts` from `apps/api`
      (existing tests still pass) and `npm run typecheck` from `apps/api`.

- [ ] 2. Convert call sites (inventory sections A and B, items 1-14).
      Replace each spot with `localTime(...)`; remove the now-redundant inline `<span class="mono">`
      wrappers and `String(...)`/`toISOString()` calls; import `localTime` in `routes.ts` and
      `photoRoutes.ts` from `./html.js`. Item 1 and 4 need care because the value is embedded in
      surrounding text or a metric card (read the interpolation site first). Leave section C untouched.
      Files: `apps/api/src/services/admin/routes.ts`, `apps/api/src/services/admin/photoRoutes.ts`
      Verify (inner loop): `npx vitest run src/services/admin` from `apps/api`, plus the section D greps.

- [ ] 3. Tests (all in `apps/api/src/services/admin/__tests__/`; see "Tests to add" below).
      Files: `html.test.ts` (extend), `html.prop.test.ts` (new), `localTimeScript.test.ts` (new),
      `routes.test.ts` (extend), `photoRoutes.test.ts` (extend).
      Verify: `npx vitest run src/services/admin` from `apps/api`; every new assertion must fail
      against the pre-change code (the "old rendering is gone" assertions guarantee that).

- [ ] 4. Spec amendment (additive only; same change as the code). See "Spec amendment" below.
      Files: `.kiro/specs/admin-panel/requirements.md`, `design.md`, `tasks.md`
      Verify: run the Kiro spec-format diagnostics on all three files and confirm clean; confirm
      `git diff` on those files shows only additions (no deleted or renumbered lines).

- [ ] 5. Final gate, once, after everything above: `npm run verify` from the repo root.
      Paste the literal tail (per-workspace `Test Files`/`Tests` lines, typecheck result) and the
      exit code. Then do the adversarial `git diff` self-review, write the behavior->test map,
      and delete any scratch files (leave no stray scripts in the tree). Mark task 23 in the
      admin-panel `tasks.md` `- [x]` only if verify exited 0.

## Tests to add

### 3a. `html.test.ts` (extend; pure unit tests of `localTime` and `renderPage`)
- `localTime(new Date('2026-10-19T14:03:00Z'))` equals exactly
  `<time class="mono" data-local-time datetime="2026-10-19T14:03:00.000Z" title="2026-10-19T14:03:00.000Z">2026-10-19 14:03:00 UTC</time>`.
- Same output for the ISO string `'2026-10-19T14:03:00Z'`, for the string with `.000Z`, and for
  epoch ms `Date.parse('2026-10-19T14:03:00Z')`.
- `null`, `undefined`, `''` -> `'-'`.
- `localTime('<img src=x onerror=alert(1)>')` -> `<span class="mono">&lt;img src=x onerror=alert(1)&gt;</span>`
  (no `<time>`, no raw `<`).
- `localTime('not a date')`, `localTime(new Date(NaN))` -> escaped span, no throw.
- Year bound: `localTime(new Date(8.64e15))` renders the escaped-span branch, not `<time>`.
- `renderPage('T', '<p>x</p>')` contains exactly one `<script>` (count occurrences), it equals
  `<script>${LOCAL_TIME_SCRIPT}</script>`, it appears after `</main>` and before `</body>`, and the
  footnote text "Timestamps are shown in your browser's time zone" is present.
- `LOCAL_TIME_SCRIPT` does not contain `</script` (cannot terminate the tag early).

### 3b. `html.prop.test.ts` (new; fast-check, `{ numRuns: 100 }` minimum)
Tag each with `// Feature: admin-panel, Property 9: <text>`.
- P9-a (round trip, over `fc.date({ min: new Date('0001-01-01'), max: new Date('9999-12-31T23:59:59.999Z'), noInvalidDate: true })`):
  `localTime(d)` has `datetime="${d.toISOString()}"` and `title="${d.toISOString()}"`, the
  fallback text equals `d.toISOString().slice(0,19).replace('T',' ') + ' UTC'`, parsing the
  `datetime` back gives `d.getTime()`, and `localTime(d)`, `localTime(d.toISOString())`,
  `localTime(d.getTime())` are identical.
- P9-b (safety/totality, over `fc.string()` and `fc.fullUnicodeString()` as `value`): never
  throws; if `Number.isNaN(new Date(s).getTime())` the result equals
  `<span class="mono">${escapeHtml(s)}</span>` (or `'-'` for the empty string); otherwise the
  `datetime` attribute equals `new Date(s).toISOString()`; in every case, after removing the
  fixed template pieces, the output contains no unescaped `<`, `>` or `"` from the input.

### 3c. `localTimeScript.test.ts` (new; behavior test of the inline script, no new deps)
Run `LOCAL_TIME_SCRIPT` with `node:vm` against a stub document. Reason: jsdom is not a declared
`apps/api` dependency and "do not add dependencies" applies; the script only touches
`document.querySelectorAll`, `getAttribute`, `textContent`, `Intl.DateTimeFormat`, so a ~15-line
stub (array of `{ attrs, textContent, getAttribute(n) }`) exercises it faithfully. Pin the zone
deterministically by passing a sandbox `Intl` whose `DateTimeFormat` wraps the real one and forces
`timeZone` (and does not change `hourCycle`/`timeZoneName`). Cases:
- `America/Los_Angeles`: `2026-10-19T14:03:00.000Z` -> `2026-10-19 07:03:00 PDT`.
- `America/Los_Angeles` winter + midnight: `2026-01-15T08:00:00.000Z` -> `2026-01-15 00:00:00 PST`
  (guards the `h23` / no `24:00` behavior).
- `Asia/Kolkata`: `2026-10-19T20:00:00.000Z` -> matches `/^2026-10-20 01:30:00 GMT\+5:30$/`
  (date rolls forward; proves it converts the instant, not the string).
- `UTC` zone -> `2026-10-19 14:03:00 UTC`.
- Invalid or missing `datetime` attribute: text left as the UTC fallback.
- `Intl.DateTimeFormat` throwing: text left as the UTC fallback, no exception escapes.
- `datetime` and `title` attributes are never modified (stub records `setAttribute` calls: zero).
- An element without `data-local-time` is not in the stub's query result, and the script uses the
  selector `time[data-local-time]` (assert the selector string passed to the stub).
- End-to-end glue: render `localTime(iso)` through `table`/`renderPage`, extract the `<time>`
  element's `datetime` with a regex, feed it to the stub, assert the rewritten text.

### 3d. `routes.test.ts` (extend; `server.inject`, auth header as in the existing tests)
Reuse the existing fixtures (sync runs `2026-10-01T00:00:00Z`/`00:05:00Z` and
`2026-09-30T00:00:00Z`/`00:01:00Z`, `lastSuccessfulSyncAt` `2026-10-01T12:00:00Z`, derived-stat
runs `04:00Z`/`04:05Z`, push `occurredAt` `2026-10-01T12:00:00Z`, user `createdAt`
`2026-01-01T00:00:00Z`, push registration `updatedAt` `2026-01-02T00:00:00Z`, pin `awardedAt`
`2026-10-01T00:00:00Z`). For fixtures built from `Date.now()` (sampling runs at ~L127,
directory `builtAtMs` at ~L265) hoist a fixed constant so the exact ISO can be asserted.
Add a small test helper `timeTag(iso)` that returns the exact `<time ...>` string for an instant.
- `/admin/catalog`: body contains `timeTag('2026-10-01T00:00:00.000Z')` and
  `timeTag('2026-10-01T00:05:00.000Z')` (sync-1 started/completed), `timeTag('2026-09-30T00:00:00.000Z')`,
  and the "last synced" tag `timeTag('2026-10-01T12:00:00.000Z')` next to `1.50 hours ago`;
  add a fixture run with `completed_at: null` and assert the Completed cell is `-`.
- `/admin/disney-transport`: "Built At" contains `timeTag(new Date(fixedBuiltAtMs).toISOString())`;
  with `builtAtMs: null` it still shows `Not built` and no `<time`.
- `/admin/intelligence/sampling`: Started At and Completed At tags for the fixed fixture instants.
- `/admin/intelligence/derived-stats`: weather row has the `04:00` tag in Last Success and `-` in
  Last Error At; cascades row has `-` in Last Success and the `04:05` tag in Last Error At.
- `/admin/notifications`: Occurred At tag `timeTag('2026-10-01T12:00:00.000Z')` (input had no
  millis; proves normalization).
- `/admin/users?email=found@example.com`: Created At tag (`2026-01-01T00:00:00.000Z`) and push
  registration Updated At tag (`2026-01-02T00:00:00.000Z`).
- `/admin/users/:id/pins`: unlocked pin row has the Unlocked At tag; the locked pin row still
  shows `Locked`; Claimed At shows `-` for `claimedAt: null` and a tag when set (add one fixture
  with a non-null `claimedAt`).
- `/admin/growth`: header `Date (UTC)` still present and `2026-10-02` still rendered as
  `<span class="mono">2026-10-02</span>` with NO `<time` wrapping it (bucket not converted).
- Old rendering gone (run over every page above): body does NOT match
  `/<span class="mono">\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/span>/` (raw ISO as mono span) and does NOT
  match `/GMT[+-]\d{4}/` or `/Coordinated Universal Time/` (the old `String(Date)` output).
- Every admin page above contains exactly one `<script>` and the footnote; the 401 response from
  `basicAuth` is untouched (still `text/plain`, no script) - extend one existing 401 assertion.
- XSS: a fixture whose timestamp field is a malicious string (e.g. push `occurredAt:
  '<script>alert(1)</script>'`) renders escaped (`&lt;script&gt;`) and the page still has exactly
  one real `<script>`.

### 3e. `photoRoutes.test.ts` (extend)
Existing seed helper uses `createdAt = new Date('2026-10-18T10:00:00Z')` and usage row
`2026-10-18`.
- `GET /admin/photos`: Created cell contains `timeTag('2026-10-18T10:00:00.000Z')`; body does not
  contain the old `2026-10-18 10:00:00</span>` bare mono text (i.e. no
  `/<span class="mono"[^>]*>2026-10-18 10:00:00<\/span>/`).
- Usage table: header `Day (UTC)` still present; `<span class="mono">2026-10-18</span>` present
  and not inside a `<time`.
- Page has exactly one `<script>` (the shell's); the existing XSS assertion (display name
  `<script>alert("pwned")</script>` escaped, raw tag absent) still passes unchanged.
- Existing 403 same-origin and photos-disabled tests remain green.

## Spec amendment (required, additive only; do not delete or renumber anything)

Follow the existing formatting in each file; only `- [ ]` / `- [x]` checkboxes.

### requirements.md
Append after Requirement 15 (the current last requirement) a new `### Requirement 16: Viewer-Local
Timestamps` with a `**User Story:**` and `#### Acceptance Criteria` in EARS form:
1. WHEN the Admin_Panel renders an instant, THE Admin_Panel SHALL emit a `<time>` element whose
   `datetime` and `title` attributes are the exact ISO-8601 UTC instant and whose visible fallback
   text is `YYYY-MM-DD HH:MM:SS UTC`.
2. WHEN a page loads in a browser with JavaScript enabled, THE Admin_Panel SHALL rewrite the
   visible text of every such element to the instant in the viewer's browser time zone as
   `YYYY-MM-DD HH:MM:SS <zone abbreviation>` using a single inline script from the shared page
   shell, leaving `datetime` and `title` unchanged.
3. IF an instant is null, undefined or empty, THEN THE Admin_Panel SHALL render `-`; IF it is not a
   valid date, THEN THE Admin_Panel SHALL render the HTML-escaped raw value and no `<time>`.
4. THE Admin_Panel SHALL NOT convert calendar-date aggregation buckets (`Date (UTC)` in Growth,
   `Day (UTC)` in photo usage), park-calendar dates, or minute-of-day show times; they retain their
   existing semantics and UTC labels (cross-referencing Requirements 13.2 and 15.2).
5. THE Admin_Panel SHALL HTML-escape every interpolated value, and the inline script SHALL contain
   no interpolated data.
6. THE Admin_Panel SHALL display, in the shared page shell, a note that timestamps are shown in the
   viewer's browser time zone and that hovering reveals the UTC instant.
Keep requirement 13.2's "(UTC)" text exactly as is.

### design.md
- Components and Interfaces: add an additive subsection directly after "### 2. `html`" (e.g.
  "### 2a. `localTime` and `LOCAL_TIME_SCRIPT` (Requirement 16)") with the signature, the emitted
  markup, the null/invalid rules, the script, the "no CSP/nonce exists today; add a nonce if one is
  introduced" note, and the list of converted vs. intentionally-UTC spots. Do not edit the existing
  code block in section 2.
- Correctness Properties: add `### Property 9: Instants render as exact UTC `<time>` elements and are safe and total`
  after Property 8 (before `## Error Handling`), in the existing italic *For any* style, with a
  `**Validates: Requirements 16.1, 16.2, 16.3, 16.5**` line. Statement: for any valid date input in
  any accepted form, `localTime` emits `datetime`/`title` equal to `toISOString()` and fallback text
  equal to the UTC rendering, and the client script maps that instant to the viewer's zone without
  altering `datetime`; for any other input it never throws and never emits unescaped markup.
  Add a short second paragraph or a `### Property 10` ONLY if you want bucket preservation as its
  own property (recommended: `### Property 10: Calendar-date buckets are never converted`,
  `**Validates: Requirements 16.4**`, asserting Growth/photo-usage bucket cells render the bare
  date string unchanged).
- Testing Strategy: add bullets (before the "No mobile tests" bullet) for `html.test.ts`,
  `html.prop.test.ts` (Property 9/10, 100 runs, tagged), `localTimeScript.test.ts` (vm + stub
  document, no jsdom) and the route-level `server.inject` assertions in `routes.test.ts` and
  `photoRoutes.test.ts`.
- Configuration & Constants: one line noting the display format constant
  (`YYYY-MM-DD HH:MM:SS <zone>`) and that there are no new env vars.

### tasks.md
- Add after task 22 (before `## Notes`):
  `- [ ] 23. Viewer-local timestamps (Requirement 16)` with sub-tasks (each with a
  `_Requirements:_` line; no `*` markers, tests are required here):
  - `- [ ] 23.1 Add localTime, LOCAL_TIME_SCRIPT and footnote to html.ts` - `_Requirements: 16.1, 16.2, 16.3, 16.5, 16.6_`
  - `- [ ] 23.2 Convert every instant call site in routes.ts and photoRoutes.ts; leave buckets UTC` - `_Requirements: 16.1, 16.4_`
  - `- [ ] 23.3 Write unit, property (Property 9/10), script-behavior and route tests` - `_Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_`
  - `- [ ] 23.4 Run npm run verify and confirm the behavior->test map` - `_Requirements: all_`
- Task Dependency Graph: append waves (do not alter existing ones), e.g.
  `{ "id": 10, "tasks": ["23.1"] },` `{ "id": 11, "tasks": ["23.2", "23.3"] },` `{ "id": 12, "tasks": ["23.4"] }`
  (mind the JSON commas after wave 9), and add a sentence after the JSON explaining waves 10-12
  depend on tasks 6 and 22 being done and are the only waves that touch `html.ts` rendering.
- Flip 23.x to `- [x]` only after `npm run verify` exits 0.

## Behavior -> test map (expected; extend with anything additional found by the section D sweep)

| Behavior | Test + assertion |
|---|---|
| `localTime` emits exact `<time>` with ISO `datetime`/`title` and UTC fallback | `html.test.ts`: exact string equality for `2026-10-19T14:03:00Z` |
| Accepts Date / ISO string / epoch ms identically | `html.test.ts` + P9-a in `html.prop.test.ts` |
| Null-safe `-` | `html.test.ts`: null/undefined/'' -> `-`; routes: `completed_at: null` cell `-` |
| Invalid input escaped, no throw | `html.test.ts` + P9-b; routes XSS fixture shows `&lt;script&gt;` |
| Inline script converts instant to viewer zone with abbreviation | `localTimeScript.test.ts`: PDT, PST midnight, Kolkata day-roll, UTC cases |
| Script leaves fallback on bad data / Intl failure; never edits `datetime`/`title` | `localTimeScript.test.ts` |
| Script emitted once per page, footnote present | `html.test.ts` renderPage count; each route test asserts one `<script>` |
| Items 1-13 render `<time>` | `routes.test.ts` per-page `timeTag(...)` assertions listed in 3d |
| Item 14 (photo Created) | `photoRoutes.test.ts` Created `timeTag('2026-10-18T10:00:00.000Z')` |
| Old raw-UTC/`String(Date)` output gone | `routes.test.ts` and `photoRoutes.test.ts` negative regexes |
| Buckets stay UTC | `routes.test.ts` Growth `Date (UTC)` + bare `2026-10-02`; `photoRoutes.test.ts` `Day (UTC)` + bare `2026-10-18` |
| Spec amendment valid | Kiro spec-format diagnostics clean on all three files |

## Risks and notes for the implementer

- Highest-risk edits are items 1 and 4 (value embedded in surrounding text/metric card): read the
  interpolation site to avoid double-escaping or leaving an unescaped dynamic string.
- `table()` cells are not auto-escaped; every new cell must return the `localTime(...)` string only.
- `Intl` `timeZoneName: 'short'` yields `GMT+5:30`-style names in `en-US` for zones without a US
  abbreviation; that is acceptable and documented in the tests.
- `hourCycle: 'h23'` is supported by all current browsers; if `formatToParts` or `Intl` is missing
  the try/catch keeps the UTC fallback.
- Do not add dependencies, do not edit applied migrations (none are involved), do not touch
  `apps/mobile`, `packages/shared`, or `.worktrees/`. No DTO or schema change, so no shared-package
  work.
- Finish with the literal `npm run verify` tail + exit code and the behavior->test map in the
  completion message, as required by root `AGENTS.md`.
