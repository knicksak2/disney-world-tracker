# Implementation Plan

## Overview

Materialize the redesigned Series 1 pin collection: the seven-tier, ~174-pin roster defined by
the track design in `design.md` and enumerated in `pin-roster-v2.html`. The plan builds the shared
catalog and Zod contracts, the `user_pins` migration, a pure evaluation engine and its Fastify
routes with synchronous award hooks, the rendered catalogue plus the new Mythic tier art, and the
mobile Pin Board UI — gated by the backend suite, the pin gate, and a final full `npm run verify`.

## Tasks

- [x] 1. Shared contracts & Series 1 pin catalog (`@dwt/shared`)
  - [x] 1.1 Define `PinTier` (seven tiers incl. `mythic`), `PinTrack`, `PinDTO`, and the criteria/`PinKind` Zod schemas in `packages/shared/src/schemas/Pin.ts`, with a valid + invalid schema test (R7, R8)
  - [x] 1.2 Author the Series 1 catalog in `packages/shared/src/pins/catalog.ts` from `pin-roster-v2.html` — each pin's id, tier, track, and criteria kind + thresholds. No hardcoded totals (R1, R8)
  - [x] 1.3 Snapshot the curated `upstream_entity_id` sets from the live catalog (coasters, the 3 mountains, 1971 classics, dark rides, Disney-owned + Deluxe resorts, transit loops, princess meets, signature/character/royal-banquet dining, 360° films, animatronics, flight sims, target shooters, interstellar, rail, wildlife, comedy) and add a test asserting every id resolves (R13)
  - [x] 1.4 Export schemas + catalog from `packages/shared/src/index.ts`; add catalog unit tests (unique ids, id-prefix agrees with tier, every criteria kind represented)

- [x] 2. Migration & pin persistence (`apps/api`)
  - [x] 2.1 Create migration `apps/api/migrations/0035_pins_and_challenges.sql` — `user_pins` (id, user_id FK, pin_id, awarded_at) with `UNIQUE (user_id, pin_id)` and the board index
  - [x] 2.2 Add `apps/api/src/db/__tests__/migration0035.test.ts` asserting the columns, unique constraint, and cascade

- [x] 3. Pure challenge evaluation engine
  - [x] 3.1 Implement pure evaluators in `apps/api/src/services/pins/evaluator.ts` for every criteria kind: count ladders (attractions, restaurants, festival, snacks, character meets, squad, critic, organizer, resort count), size-graded land completion, park mastery (attractions) & sovereign (everything), completion apexes (All Attractions, Whole Catalog), single-day feats (multi-park, ride marathons, Grand Slam, Taste of the Kingdoms, Around the World), curated named sets, and facet-derived thematic sets (R1, R9, R10, R11, R12, R14, R15, R16, R17, R18, R19)
  - [x] 3.2 Property tests `apps/api/src/services/pins/__tests__/evaluator.prop.test.ts` (`fast-check`, ≥100 runs) for Properties 1, 2, 3, 4, 8, 9, 12
  - [x] 3.3 Unit tests `apps/api/src/services/pins/__tests__/evaluator.test.ts` covering each track, all six Prism pinnacles, and the Mythic capstone against realistic activity snapshots

- [x] 4. Pin repository, routes & synchronous award hooks
  - [x] 4.1 Implement `PinRepo` in `apps/api/src/services/pins/repo.ts` (pg-mem tested): board query, progress calculation, atomic idempotent award insert (`ON CONFLICT (user_id, pin_id) DO NOTHING`) (R2.4, R3.1)
  - [x] 4.2 Implement `GET /me/pins` in `apps/api/src/services/pins/routes.ts` with tier/track/unlocked filters and the tier summary (R3)
  - [x] 4.3 Hook synchronous evaluation into `ExperienceLogRepo.addLog`, returning `newlyAwardedPinIds` in the log response (R2.1)
  - [x] 4.4 Hook evaluation into the rating/note routes (R2.2) and `confirmRodeWithTag` in the trips repo (R2.3)
  - [x] 4.5 Route integration tests `apps/api/src/services/pins/__tests__/routes.test.ts` (`server.inject`): auth gate, progress querying, and award-on-log
  - [x] 4.6 Wire `PinService` into `composeServices.ts` via constructor injection

- [x] 5. Checkpoint — backend verification gate
  - [x] 5.1 Run `npm run verify:api` and `npm run verify:shared`; paste the literal tails; both must be green before moving on

- [x] 6. Materialize the rendered catalogue & the Mythic tier (art — needs human review of renders) _(6.1–6.6 all complete; `verify/run-all.js` exits 0 with all 10 suites green against the promoted v2 `pin-catalog-mockup.html`. All 174 renders reviewed and approved by the user.)_
  - [x] 6.1 Amend `docs/pin-art-direction.md` §2 / §9 to add the 7th **Mythic** capstone tier (bespoke, non-gradient) with the recorded rationale
  - [x] 6.2 Add the `mythic` tier to the working renderer (`TIERS`, `METALS`, `RIM_BY_TIER` or bespoke treatment) in `pin-frame-sample.html`
  - [x] 6.3 Assign art/motif to every Series 1 pin; screen each die-cut through `emblemGate` at its tier rim and apply the fabrication ladder (weld / scale / plate) where it fails _(all 174 pins render to non-empty art per catalog.js; every plain die-cut screened by diecut.js — 58 pass clean, 6 grandfathered; colour die-cut pins welded in their render branch)_
  - [x] 6.4 Add any missing motif SVGs and their `CREDITS.md` rows (no row, no ship); regenerate `motifs/motif-paths.js` _(CREDITS/provenance complete and green. The `motif-paths.js` regeneration is moot for v2: the 8 new motifs the catalogue uses — teacup, magicCarpet, monorailScene, carouselHorse, fairyWandHalo, waterSplashLagoon, __balloon, bellConcierge — are provided by the inline MOTIFS block or dedicated render branches, not as library SVGs, so regenerating would not include them. **Task 7.2** (mobile `motifPaths.ts`) must account for the render-branch motifs separately.)_
  - [x] 6.5 Build the rendered catalogue from the v2 roster; promote it to `pin-catalog-mockup.html`, archive the current file as `pin-catalog-mockup-v1.html`, and repoint the hardcoded references in `verify/run-all.js`, `verify/bite.js`, `verify/trace.js`, and the steering / README / art-direction docs _(catalogue suites now share `verify/catalog-loader.js`, which executes the page's own scripts — the roster is `pins-v2-transcription.js` — rather than regexing an inline PINS array; all verify scripts already default to `pin-catalog-mockup.html`, so the rename repointed them)_
  - [x] 6.6 Run the pin gate `node .kiro/specs/pin-collection/verify/run-all.js` to exit 0 (dedup, catalog, provenance, diecut all green)

- [x] 7. Mobile PinView renderer
  - [x] 7.1 Implement `PinView.tsx` in `apps/mobile/src/components/pins/` — pins across all seven tiers (incl. Mythic), rim/metal/enamel/ladder/locked per the art contract (R4) _(**Art strategy: pre-bake.** The catalogue's renderer includes many bespoke composite branches (`renderColorDieCut` weld, `renderStarLadder`, `renderCastleFireworks`, `renderImmersiveLands`, `renderFourParksMaster`, grand-slam/compass) that a hand-written client renderer cannot reproduce, so — per the agreed Option B — every pin's final SVG is snapshotted headlessly from the reviewed catalogue into `pinArt.ts` (174 pins) and rendered on-device with react-native-svg `SvgXml`. The catalogue generators stay the single source of truth (no drift, no engine re-implementation). `PinView` applies the locked treatment (dimmed art + padlock badge) and the rarity glow (pearl 5.5s / prism 2.4s / mythic 3.2s opacity pulse, reduce-motion aware, `motion` escape hatch) at render time. The `feDropShadow` filter is stripped at bake time (unsupported in react-native-svg). The property-tested `pinRenderModel.ts` remains as the shared tier/rim/ladder contract.)_
  - [x] 7.2 Add `motifPaths.ts` generated from `.kiro/specs/pin-collection/motifs/` _(177 library motifs transcribed verbatim from `motif-paths.js`/`window.MOTIF_LIB` via a deleted one-off generator; retained as the static-motif registry. Note: with the pre-bake art strategy the board renders from `pinArt.ts`, so the generative "scene" motifs are captured in the baked SVGs rather than needing separate static paths here.)_
  - [x] 7.3 Property + component tests for Properties 5, 6, 10 and a render of each tier _(Properties 5/6/10 in `pinRenderModel.prop.test.ts` (fast-check, 200 runs); `PinView.test.tsx` renders baked art for all 7 tiers + locked padlock/dim + fallback + glow-loop gating (starts for prism, not bronze; suppressed by reduce-motion; off when `motion=false`) + onPress; `pinArtGate.test.ts` asserts every shared-catalog pin has baked art and no orphans — all green, mobile typecheck clean)_

- [x] 8. Mobile Pin Board UI & Attribution
  - [x] 8.1 Implement `PinBoardScreen.tsx` in `apps/mobile/src/screens/profile/` — seven-tier pill filters, track tabs, and the collection progress summary (R5.1–R5.3) _(fetches `GET /me/pins` once; tier pills + track tabs filter the grid client-side while the overall-percent + per-tier summary header stays whole-collection per the route contract; taps open the detail modal)_
  - [x] 8.2 Implement `PinDetailModal.tsx` (full-size art, lore, criteria progress, unlock date) (R5.4) _(184px `PinView`, name, tier/track badges, lore; unlock date when unlocked, else a progress bar with current/target/percent)_
  - [x] 8.3 Implement `PinCelebrationModal.tsx`, triggered by `newlyAwardedPinIds` (R5.5) _(resolves ids against the shared catalog, renders the awarded pins with celebratory copy; the board shows it from a `celebratePinIds` route param)_
  - [x] 8.4 Implement `AttributionScreen.tsx` matching `motifs/CREDITS.md` (R6.1) _(renders `pinCredits.ts`, the in-app attribution lines)_
  - [x] 8.5 Add build-gate test `creditsGate.test.ts` — every motif the catalog references has a `CREDITS.md` row (R6.2) _(parses the "Attribution required in-app" block from `CREDITS.md` and asserts `PIN_CREDITS` equals it exactly and in order — the in-app credits can't drift from the audit trail; complemented by `pinArtGate.test.ts` for baked-art coverage)_
  - [x] 8.6 Add navigation routes to `ProfileStack` for `PinBoardScreen` and `AttributionScreen` _(routes added + a "View your pins" entry control on the Profile screen so the board is reachable)_
  - [x] 8.7 RN interaction tests `PinBoardScreen.test.tsx` — for each interaction (tier filter, track tab, open detail, celebration) assert both the query call and the on-screen change _(7 tests: initial `GET /me/pins` + grid; tier pill → grid narrows, no refetch, header unchanged; track tab → grid narrows; tap → detail modal shows the tapped pin (unlock date for unlocked, progress bar for locked); `celebratePinIds` → celebration modal; credits control → `navigate('PinAttribution')`. 26/26 across the 5 pin suites, mobile typecheck clean)_

- [x] 9. Final end-to-end verification gate
  - [x] 9.1 Run full `npm run verify` across all workspaces AND the pin gate (`verify/run-all.js`); paste the literal tails; both must exit 0 _(full `npm run verify` exits 0 — api 303 files/2043 tests, mobile 163 suites/882 tests, shared 27 files/223 tests, typecheck clean across all workspaces; the pin gate `node verify/run-all.js` exits 0 with all 10 mockup suites passing)_

- [x] 10. Manual claim & award-wiring completeness (Requirements 20, 21 — additive)
  - [x] 10.1 Migration `apps/api/migrations/0036_pin_claiming.sql`: add nullable `user_pins.claimed_at`. Add `apps/api/src/db/__tests__/migration0036.test.ts` (pg-mem) asserting the column exists and existing `0035` behavior (UNIQUE, cascade) is untouched (R20.2) _(5/5 tests pass)_
  - [x] 10.2 Shared: add `claimedAt: string | null` to `UserPinProgressDTO` (`packages/shared/src/dto/Pin.ts`); add a new `pin_not_eligible` `ErrorCode` (409) to `packages/shared/src/errors.ts` (`ERROR_CODES` + `errorCodeToHttpStatus`), grouped with the other Pin codes. Update the schema test for the DTO's valid/invalid cases (R20.2, R20.4) _(schema test updated, 21/21 pass; `npm run build:shared` rebuilt so `apps/api`/`apps/mobile` see the new field)_
  - [x] 10.3 `evaluator.ts` / `evaluatePin`: thread `claimedAt` through so an unlocked pin's projection carries it alongside `awardedAt`, with no change to `unlocked`'s meaning or to the clamped-progress branch for locked pins (R20.1, R20.5) _(new exported `AwardState` type; `evaluatePin`/`evaluateBoard` signatures updated, all callers fixed)_
  - [x] 10.4 `PinRepo`: implement `claimPin(userId, pinId): Promise<ClaimResult>` (single `UPDATE ... WHERE claimed_at IS NULL RETURNING claimed_at`, the three-way `ClaimResult` per design.md) and `reconcileAll(): Promise<{usersProcessed, pinsAwarded}>` (runs `awardNewly` for every user). Both idempotent under re-invocation and concurrent with a synchronous award (Properties 13, 14, 15) _(implemented exactly as designed)_
  - [x] 10.5 `PinRepo` / `getBoard`: confirm (with a pg-mem test) that `tierSummary`/`totalUnlocked`/`overallPercent` are computed from `awarded_at` only — unaffected by `claimed_at` — since `evaluateBoard`'s unlocked-set logic is untouched by 10.3 (Property 14, R20.5) _(pg-mem test: claiming a pin leaves totals/tierSummary byte-identical)_
  - [x] 10.6 Routes: add `POST /me/pins/:pinId/claim` to `apps/api/src/services/pins/routes.ts` (session-gated; `not_awarded` → `pin_not_eligible` 409; `already_claimed`/`claimed` → `200 { pinId, claimedAt }`) _(implemented)_
  - [x] 10.7 Routes: add cron-secret-gated `POST` + `HEAD /internal/pins/reconcile` to the same file, mirroring `apps/api/src/services/intelligence/routes.ts`'s `/internal/sampling/run` (202 + fire-and-forget `reconcileAll`, errors logged not surfaced). Add `PIN_RECONCILE_CRON_SECRET` to `apps/api/src/config.ts` (required, `min(1)`) and `.env.example` _(implemented; also added to `.env`/`.env.dev` and, opportunistically, the pre-existing missing `SAMPLING_CRON_SECRET` doc row in `.env.example`; ran manually against the local dev DB post-implementation — confirmed 12 historical pins reconciled for a real account)_
  - [x] 10.8 Bug fix: add `awardPins?: (userId: string) => Promise<readonly string[]>` to `CompletionRoutesOptions` (`apps/api/src/services/tracking/completion/routes.ts`); call it from the `PUT /me/experiences/:id/completion` handler after `repo.mark(...)` commits, spreading `newlyAwardedPinIds` onto the response, matching the `logs`/`rating`/`note` pattern exactly (R21.1) _(implemented; existing response-shape test fixed)_
  - [x] 10.9 Bug fix: call the already-injected `awardPins` from the `POST /trips/:id/log-entries` handler in `apps/api/src/services/trips/routes.ts` after `repo.logCompletion(...)` commits, spreading `newlyAwardedPinIds` onto `{ logEntryId }` (R21.1) _(implemented; 2 existing response-shape assertions fixed)_
  - [x] 10.10 `composeServices.ts`: pass the existing `awardPins` closure into `tracking.completion` (trips already receives it; only the completion route's options object needs the new field) _(done)_
  - [x] 10.11 Property tests for Properties 13, 14, 15 in `evaluator.prop.test.ts` / a new `repo.claim.prop.test.ts` as appropriate (fast-check, ≥100 runs, tagged `Feature: pin-collection, Property N`) _(Properties 13 + 14 as pure `evaluator.prop.test.ts` cases, 150 runs each; Property 15 as a pg-mem `repo.integration.test.ts` case — reconcile run twice + after a sync award never duplicates a row)_
  - [x] 10.12 Route integration tests in `apps/api/src/services/pins/__tests__/routes.test.ts`: the three `claim` branches, the `reconcile` auth gate + 202 response, per design.md's Testing Strategy additions _(12 new tests: claim 401/409/200/idempotent-200; reconcile 401×2, 202+background-award via poll, HEAD 202/401)_
  - [x] 10.13 **Regression tests** (the actual bug fix guard) — a `server.inject` test on `PUT /me/experiences/:id/completion` and one on `POST /trips/:id/log-entries`, each seeding a completion that satisfies a real pin's criteria and asserting `newlyAwardedPinIds` is populated; both must fail against the pre-fix code and pass after (R21.1) _(added to `tracking/completion/__tests__/routes.test.ts` and `trips/__tests__/notificationDispatch.integration.test.ts`, each with a matching "never fails the write when awardPins throws" best-effort test)_
  - [x] 10.14 Mobile: add `expo-haptics` (pinned to the version matching the installed Expo SDK) to `apps/mobile/package.json` _(`expo-haptics@~56.0.3`, matching installed `expo@56.0.12`; `expo*` was already jest-transform-allowlisted, no config change needed)_
  - [x] 10.15 Mobile: `PinBoardScreen.tsx` — derive "ready to claim" (`unlocked && claimedAt === null`) per grid cell; render it with a distinct visual state from locked and from claimed (R20.7); tapping a ready-to-claim cell calls the claim mutation (`POST /me/pins/:pinId/claim`) instead of opening `PinDetailModal`, then opens `PinCelebrationModal`; tapping any other cell keeps today's `PinDetailModal` behavior _(new `PinCell` sub-component renders a glowing ring + "Tap to claim" badge for ready-to-claim tiles, distinct from the padlock (locked) and plain (claimed) renders; `isReadyToClaim()` helper; the claim mutation optimistically patches the cached board via `queryClient.setQueryData` so the badge clears without a refetch)_
  - [x] 10.16 Mobile: claim-queue chaining — when more than one pin is ready to claim (e.g. right after a reconcile), dismissing one celebration offers the next ready-to-claim pin without leaving the board (R20.6); the existing `celebratePinIds` arrival param is folded into the same queue (each id is claimed via the mutation, then celebrated, rather than shown without claiming) _(a `queue: string[]` state + a draining `useEffect` claims the head id then celebrates it, one at a time; both a grid tap and the `celebratePinIds` route param enqueue into the same queue)_
  - [x] 10.17 Mobile: a brief tile pop/sparkle on the tapped cell plus a light haptic (`expo-haptics` `notificationAsync(Success)`) on a successful claim; `PinCelebrationModal` gains a "View details" affordance that opens `PinDetailModal` for the just-claimed pin _(`PinCell` plays a scale-pop `Animated.sequence` on tap before the claim mutation resolves; `notificationAsync(Success)` fires in the mutation's `onSuccess`; `PinCelebrationModal` gained an optional `onViewDetails` prop rendering a "View details" `SecondaryButton` when celebrating exactly one pin)_
  - [x] 10.18 Mobile interaction tests in `PinBoardScreen.test.tsx`: tapping a ready-to-claim cell asserts both the `POST .../claim` call and the on-screen switch from grid to `PinCelebrationModal`; chaining through 2+ ready-to-claim pins asserts each claim call fires and each pin's celebration appears in turn; tapping a locked/claimed cell still asserts `PinDetailModal`; assert the haptic call on claim _(rewrote the mock to route `GET /me/pins` vs `POST .../claim` separately; 11 tests total — badge renders only on ready-to-claim; claim call + celebration-not-detail-modal + haptic assertion; badge clears post-claim; 2-pin chaining via `celebratePinIds` asserting both claim calls fire and each celebration shows in turn; "View details" hand-off to the detail modal; plus the pre-existing filter/detail/credits tests updated for the new `claimedAt` DTO field. 11/11 pass; mobile typecheck clean; full `src/components/pins` + `src/screens/profile` sweep 30/30 pass)_

- [x] 11. Checkpoint — final verification gate (re-run after task 10)
  - [x] 11.1 Run full `npm run verify` across all workspaces AND the pin gate (`verify/run-all.js`) once, as the single final gate for this change (migration + backend + mobile + tests together, per the execution-discipline "one unit, one final gate" rule); paste the literal tails; both must exit 0 _(`npm run verify` exits 0 — api 304 files/2068 tests (coverage 96.64%/93.97%/100%/97.01%), mobile 163 suites/886 tests, shared 27 files/225 tests, typecheck clean across all workspaces; the pin gate `node verify/run-all.js` exits 0 with all 10 mockup suites passing. One flaky fixed-sleep assertion in the new reconcile test was replaced with a poll before this final run.)_

- [x] 12. Claimable-pin discoverability: sort, filter, badge (Requirement 22 — additive)
  - [x] 12.1 `PinBoardScreen.tsx`: add `claimableFirstComparator` (ready-to-claim first, catalog order within each group) and apply it after the existing tier/track filter in the `visible` `useMemo` (R22.1, Property 16) _(implemented exactly as designed)_
  - [x] 12.2 `PinBoardScreen.tsx`: add a third filter axis `ownership: 'all' | 'unlocked' | 'locked'` as a third pill row (mirroring the tier/track `Chip` rows), combined with the existing filters via `&&` (R22.2) _(implemented; testIDs `ownership-pill-{all,unlocked,locked}`)_
  - [x] 12.3 New hook `apps/mobile/src/components/pins/useClaimablePinsBadge.ts` — reads the board under the exact same `pinBoardKey` `PinBoardScreen` uses (with `refetchInterval: POLLING_INTERVAL_MS`), derives `count` via `isReadyToClaim` and `display` via the shared `badgeDisplayFor`, returning `{ display, count }` (R22.3, R22.4) _(implemented exactly as designed)_
  - [x] 12.4 `RootNavigator.tsx` / `ProfileTabIcon`: combine notification and claimable-pin counts into a single `AttentionBadge` fed by `useAttentionBadge()` and `useClaimablePinsBadge()`, positioned at top-right with testID `profile-tab-badge` (R22.5) _(**Revised**: previously rendered two separate badges on opposite corners of the tab icon. Per user request ("these notifications should be combined on the bottom bar... messy to have the notifications and pins seperate here"), the counts are summed into a single badge on the bottom bar, while remaining split into their respective entry controls on the Profile screen itself)_
  - [x] 12.5 Export `isReadyToClaim` from `PinBoardScreen.tsx` (or hoist it to a shared pins helper module) so `useClaimablePinsBadge.ts` does not duplicate the predicate _(exported directly from `PinBoardScreen.tsx`, imported by the new hook)_
  - [x] 12.6 Tests: `PinBoardScreen.test.tsx` — claimable-first sort renders a ready-to-claim pin's cell ahead of catalog-earlier locked/claimed pins; Unlocked/Locked filter narrows the grid alone and combined with tier/track _(3 new tests added; 14/14 pass)_
  - [x] 12.7 Tests: new `useClaimablePinsBadge.test.tsx` — hidden/count/overflow derivation from a seeded board cache; same-cache-as-board-screen coherence _(4/4 pass)_
  - [x] 12.8 Tests: a `RootNavigator`/tab-icon test asserting the profile-tab badge reflects claimable pins, stays hidden at zero, shows the combined total when both notifications and pins exist, and displays overflow at 100+ _(`pinTabBadge.test.tsx`: 4 tests covering pin-only count, zero-count hidden, combined count sum, and overflow; all pass)_
  - [x] 12.9 Profile screen: add the same claimable-Pin badge to the "View your pins" entry control that the "View notifications" entry control already has, per the user's explicit follow-up request (R22.6) _(`ProfileScreen.tsx`'s "Pin collection" card wraps its `SecondaryButton` in the existing `notificationBtnWrap` style with a `notificationBadgeOverlay`-positioned `AttentionBadge` fed by `useClaimablePinsBadge()`, testID `profile-pins-badge` — an exact copy of the pattern already used for `profile-notifications-badge`, no new style or component)_
  - [x] 12.10 Tests: new `profilePinBadge.test.tsx` — the "View your pins" badge shows the exact claimable count and is hidden at zero, mirroring the existing notifications-entry badge test _(2/2 pass)_

- [x] 13. Checkpoint — final verification gate (re-run after task 12, then again after 12.4's revision + 12.9/12.10)
  - [x] 13.1 Run full `npm run verify` across all workspaces AND the pin gate (`verify/run-all.js`) once, as the single final gate for this change; paste the literal tails; both must exit 0 _(final pass, after reverting 12.4's color/icon approach and adding 12.9/12.10's Profile-screen badge: api 304 files/2068 tests (coverage 96.64%/93.97%/100%/97.01%, unchanged), mobile 166 suites/898 tests (up from 165/897 with `profilePinBadge.test.tsx`'s 2 tests, net +1 suite/+1 test after also removing `pinTabBadge.test.tsx`'s 4th test), shared 27 files/225 tests (unchanged), typecheck clean across all workspaces, exit 0; the pin gate `node verify/run-all.js` exits 0 with all 10 mockup suites passing)_

- [x] 14. Claim reveal, bulk claim, and celebration fanfare (Requirement 23 — additive)
  - [x] 14.1 `PinBoardScreen.tsx` / `PinCell`: pass `unlocked={item.unlocked && !readyToClaim}` to `PinView` instead of `unlocked={item.unlocked}`, so a ready-to-claim tile renders the locked/dimmed treatment until claimed, distinguished only by the existing "Tap to claim" badge (R23.1) _(implemented as `cellUnlocked`)_
  - [x] 14.2 `PinCell`: cross-fade the locked→unlocked art on a successful claim (a second `Animated.Value` opacity swap over ~180ms, driven by the `readyToClaim` transition) so the reveal is visible rather than an instant swap (R23.2) _(a `crossfading` state renders both the locked and unlocked `PinView` stacked, animating their opposing opacities via `Animated.timing`, for the transition's duration only; steady-state renders a single `PinView` as before)_
  - [x] 14.3 `PinCelebrationModal.tsx`: change the heading to "Pin claimed!" / "N pins claimed!" and the primary button label to "Nice!" (R23.3) _(implemented)_
  - [x] 14.4 `PinBoardScreen.tsx`: add a "Claim all (N)" `SecondaryButton` near the summary header, visible when `readyIds.length >= 2` (computed via `isReadyToClaim` over `board.data.pins`, same predicate `useClaimablePinsBadge` uses); pressing it calls `enqueueClaim` for every ready id in claimable-first catalog order (R23.4, Property 17) _(`readyIds` memoized in catalog order; `enqueueAll` feeds them into the existing queue; testID `pin-board-claim-all`)_
  - [x] 14.5 `PinBoardScreen.tsx`: track `queueTotal` (captured once when a claim batch begins, not shrinking as the queue drains) and compute `{ index, total }` for the celebration currently shown; pass it to `PinCelebrationModal` as a new optional `position` prop (R23.5) _(implemented; `queueTotal` resets to 0 once a batch fully drains so the next fresh batch starts clean)_
  - [x] 14.6 `PinCelebrationModal.tsx`: render an "`{index} of {total}`" line under the heading when `position` is provided and `total > 1`; render nothing extra when `position` is omitted or `total <= 1` (R23.5) _(testID `pin-celebration-position`)_
  - [x] 14.7 `PinBoardScreen.tsx`: add a `PACE_MS = 450` delay (`setTimeout`) between `dismissCelebration` and the next queued claim firing in the drain effect, so consecutive celebrations in a batch are visibly sequential (R23.6) _(a `pacing` boolean gates the drain effect; set on dismiss when more is queued, cleared after `PACE_MS`)_
  - [x] 14.8 `PinCelebrationModal.tsx`: add a confetti burst (≈16 `Animated.View`s animating outward from center over ~700ms, `useNativeDriver: true`, no new dependency) and a pop/scale-in (`Animated.spring` 0.6→1) on the revealed pin art; gate both behind `AccessibilityInfo.isReduceMotionEnabled()` (settle immediately, no confetti views, when true) (R23.7) _(implemented with a seeded-per-mount `ConfettiSpec[]`, no new dependency)_
  - [x] 14.9 `PinBoardScreen.tsx` claim mutation `onSuccess`: replace the single `notificationAsync(Success)` with `impactAsync(Heavy)` immediately, then `notificationAsync(Success)` after a short delay — the "thunk-ding" pattern; unaffected by reduce-motion (haptics are not motion) (R23.7) _(implemented in the claim mutation's `onSuccess`, not the modal, so it fires exactly once per claim)_
  - [x] 14.10 Tests: extend `PinBoardScreen.test.tsx` — ready-to-claim cell's `PinView` receives `unlocked={false}` pre-claim and `unlocked={true}` post-claim (R23.1, R23.2); celebration heading/button text (R23.3); `pin-board-claim-all` absent at 0/1, shown with exact count at 2+, and firing a claim call per ready id (R23.4, Property 17); position text correctness and `total` stability across a draining queue (R23.5); paced (non-synchronous) advancement via `jest.useFakeTimers` (R23.6); two-part haptic call sequence (R23.7) _(9 new tests; 23/23 pass in the file)_
  - [x] 14.11 Tests: new `PinCelebrationModal.test.tsx` — confetti views present on a normal claim, absent under mocked reduce-motion; position line absent when `total <= 1`, present and correct when `total > 1` (R23.5, R23.7) _(5/5 pass)_

- [x] 15. Checkpoint — final verification gate (re-run after task 14)
  - [x] 15.1 Run full `npm run verify` across all workspaces AND the pin gate (`verify/run-all.js`) once, as the single final gate for this change; paste the literal tails; both must exit 0 _(api 304 files/2068 tests, coverage 96.64%/93.97%/100%/97.01% (unchanged — task 14 touched no backend code); mobile 167 suites/912 tests (up from 166/898: +9 in `PinBoardScreen.test.tsx`, +5 in the new `PinCelebrationModal.test.tsx`); shared 27 files/225 tests (unchanged); typecheck clean across all workspaces, exit 0; the pin gate `node verify/run-all.js` exits 0 with all 10 mockup suites passing)_

- [x] 16. Pin Showcase — freeform display board (Requirement 24 — additive; fulfills the never-implemented "featured showcase pins" clause of Requirement 5.2)
  - [x] 16.1 Confirm the actual latest migration number in `apps/api/migrations/` (expected `0036_pin_claiming.sql` as of this writing) and create `00NN_pin_showcase.sql`: `pin_showcase_placements` (`id`, `user_id` FK `ON DELETE CASCADE`, `pin_id` TEXT, `pos_x` REAL, `pos_y` REAL, `z_index` INTEGER, `placed_at`), `UNIQUE (user_id, pin_id)`, `CHECK` on `pos_x`/`pos_y` in `[0,1]` and `pin_id` length, plus its `user_id` index. Add `apps/api/src/db/__tests__/migrationNNNN.test.ts` (pg-mem) asserting the columns/constraints/cascade (R24.3)
  - [x] 16.2 Shared: add `PinShowcasePlacementDTO`, `PinShowcaseDTO`, `PlacePinRequest` to a new `packages/shared/src/dto/PinShowcase.ts`; export from `packages/shared/src/index.ts`; add `showcase_full` and `showcase_position_overlap` to `ERROR_CODES`/`errorCodeToHttpStatus` (both 409), grouped with the other Pin codes; a schema/DTO test covering a valid and invalid case; rebuild `@dwt/shared` (R24.1, R24.5, R24.11)
  - [x] 16.3 Backend: implement `PinShowcaseRepo` (`apps/api/src/services/pins/showcaseRepo.ts`) — `getShowcase(userId): Promise<PinShowcaseDTO>` (placements + `unplaced` derived from claimed-minus-placed), `placePin(userId, pinId, pos): Promise<PlaceResult>` (upsert by `(user_id, pin_id)`, `not_eligible` if unclaimed, `full` if a NEW placement would exceed `SHOWCASE_MAX_PINS`, `overlap` if `{posX,posY}` is within `SHOWCASE_MIN_PIN_CLEARANCE` of another of the caller's placements per design.md's `overlapsAnyOtherPin`), `removePin(userId, pinId): Promise<void>` (no-op if absent) (R24.1, R24.3, R24.4, R24.5, R24.11, Properties 18, 19, 20, 22)
  - [x] 16.4 Backend: implement `showcaseRoutes.ts` — `GET /me/pin-showcase`, `GET /users/:userId/pin-showcase` (gated by `assertOwnerOrFriend`, `unplaced` omitted for a non-owner viewer), `PUT /me/pin-showcase/:pinId`, `DELETE /me/pin-showcase/:pinId`, mapping `PinShowcaseRepo`'s `not_eligible`/`full`/`overlap` to `pin_not_eligible`/`showcase_full`/`showcase_position_overlap` (R24.7, R24.8, R24.11, Property 21)
  - [x] 16.5 Backend: add `SHOWCASE_MAX_PINS = 24`, `SHOWCASE_PIN_SIZE = 72`, `SHOWCASE_MIN_PIN_CLEARANCE`, and `SHOWCASE_REFERENCE_SIZE` to `apps/api/src/config.ts` (or the pins config module alongside `PIN_RECONCILE_CRON_SECRET`); wire `PinShowcaseRepo` into `composeServices.ts` under `pins` alongside the existing `PinRepo` (R24.5, R24.11)
  - [x] 16.6 Backend tests: `showcaseRepo.integration.test.ts` (pg-mem) — place/read-back position, unclaimed-pin rejection, duplicate-place upsert (not a second row), capacity rejection leaving prior rows untouched, remove-then-re-place, a too-close placement rejected with no row change and a just-outside-clearance placement succeeding. `showcaseRoutes.test.ts` (`server.inject`) — self/Friend/non-Friend `GET`, `PUT` happy/`pin_not_eligible`/`showcase_full`/`showcase_position_overlap`, `DELETE` happy/no-op (R24.1, R24.3-24.5, R24.7-24.9, R24.11)
  - [x] 16.7 Backend property tests: `showcase.prop.test.ts` (fast-check, ≥100 runs, tagged `Feature: pin-collection, Property N`) for Properties 18, 19, 20, 22
  - [x] 16.8 Mobile: implement `PinShowcaseScreen.tsx` (`apps/mobile/src/screens/profile/`) — a cork-textured `ImageBackground` board (a bundled tileable cork-texture asset) with a wood-frame border (Requirement 24.10); measures its own board size via `onLayout`; renders each placement as a `PinView` positioned from `posX`/`posY` with a small offset drop shadow (`theme.shadow`); an unplaced-Pins tray along one edge; owner mode wires a `PanResponder` per placed/tray Pin (drag live via `Animated`, client-side `overlapsAnyOtherPin` check on release — snap back with no `PUT` if it overlaps, `PUT` otherwise, no new dependency); `readOnly` prop renders the identical cork-board layout with no gesture handlers and no tray (R24.2, R24.6, R24.10, R24.11)
  - [x] 16.9 Mobile: add `PinShowcase: { userId?: string; readOnly?: boolean } | undefined` to `ProfileStackParamList`; add "My Showcase" entry points on `ProfileScreen.tsx` and `PinBoardScreen.tsx`'s header; add a read-only Showcase section to `FriendProfileScreen.tsx`'s Overview tab passing `{ userId: friendId, readOnly: true }`; reuse the existing `profile_forbidden` → "Profile unavailable" empty-state pattern already used elsewhere in `FriendProfileScreen.tsx` for the deny case (R24.7, R24.9)
  - [x] 16.10 Mobile tests: `PinShowcaseScreen.test.tsx` — placements render at positions derived from `posX`/`posY` and a mocked layout size, and the cork-texture background renders; dragging a tray Pin onto the board fires `PUT` with the drop-point-derived `posX`/`posY`; dragging an already-placed Pin fires `PUT` for that same pin id; dragging a Pin to within `SHOWCASE_MIN_PIN_CLEARANCE` of another placed Pin fires NO `PUT` and the Pin snaps back to its pre-drag position; removing a placement fires `DELETE` and returns the Pin to the tray; `readOnly` mode attaches no drag handlers and renders no place/remove controls; the zero-placements Friend empty-state; the `profile_forbidden` deny state (R24.2-24.4, R24.6, R24.9-24.11)
  - [x] 16.11 Shared: add `PinShowcaseSharePayload` (`{ kind: 'pinShowcase', ownerId, ownerDisplayName }`) to `SharePayload`'s union in `packages/shared/src/dto/Share.ts`; add `'pinShowcase'` to `SHARE_PAYLOAD_KINDS`; add the `pinShowcase` branch to `sharePayloadSchema`'s discriminated union in `packages/shared/src/schemas/Share.ts`; a schema test covering the new variant (R24.12)
  - [x] 16.12 Backend migration: `00NN_pin_showcase_share_kind.sql` (sequential after task 16.1's migration) — `ALTER TABLE shares DROP CONSTRAINT shares_payload_kind_chk, ADD CONSTRAINT shares_payload_kind_chk CHECK (payload_kind IN ('experience','progress','pinShowcase'))` and widen `shares_experience_payload_chk` to accept `payload_kind = 'pinShowcase' AND experience_id IS NULL`; a migration test asserting all three payload kinds are now accepted and `experience`'s NOT-NULL requirement is unchanged (R24.12)
  - [x] 16.13 Backend: `sharing/routes.ts`'s `POST /me/shares` body schema gains a `pinShowcase` branch (no snapshot fields beyond `recipientIds`); the route composes `{ kind: 'pinShowcase', ownerId: senderId, ownerDisplayName }` as the payload snapshot at send time (only the identity, never placement data, satisfying R24.14 by construction) (R24.12, R24.14, Property 23)
  - [x] 16.14 Mobile: `shareBody.ts`'s `buildShareCreateBody` gains a `pinShowcase` branch; `ShareComposerParams`'s discriminated union (`RootNavigator.tsx`) gains a `{ kind: 'pinShowcase' }` variant with no snapshot fields; `PinShowcaseScreen.tsx` (owner mode) gains a "Share my Showcase" control opening `ShareComposerScreen` with that variant (R24.12)
  - [x] 16.15 Mobile: `InboxScreen.tsx`'s `handleSelect` gains a `pinShowcase` branch — verify the sender is still a Friend (reusing the existing cached-`GET /me/friends` guard the `progress` branch already uses, same "friend's profile no longer available" message on failure), then `navigation.navigate('PinShowcase', { userId: item.senderId, readOnly: true })` instead of `FriendProfile` (R24.13)
  - [x] 16.16 Tests: `shareBody.test.ts` (extended) for the `pinShowcase` branch; `InboxScreen.test.tsx` (extended) for the new tap-through branch (navigates to `PinShowcase` not `FriendProfile`, non-Friend guard unchanged); a repo-level test seeding a `pinShowcase` share, then mutating the owner's placements, then reading `GET /users/:userId/pin-showcase` as the recipient and asserting the mutated (not send-time) state (Property 23, R24.13, R24.14)

- [x] 17. Checkpoint — final verification gate (re-run after task 16)
  - [x] 17.1 Run full `npm run verify` across all workspaces AND the pin gate (`verify/run-all.js`) once, as the single final gate for this change; paste the literal tails; both must exit 0

- [x] 18. Faster claim transition and "Skip all" action in celebration queue (Requirement 23.6, 23.8 — additive)
  - [x] 18.1 `PinCelebrationModal.tsx`: add `onSkipAll?: () => void` prop; render `SecondaryButton` with `label="Skip all"` (`testID="pin-celebration-skip-all"`) when `onSkipAll` is provided, `position.total > 1`, and `position.index < position.total` (R23.8)
  - [x] 18.2 `PinBoardScreen.tsx` & `PinCelebrationModal.tsx`: reduce `PACE_MS` to 40ms and eliminate native modal fade delay with `animationType="none"` for snappier queue transitions (R23.6); implement `handleSkipAll` to close modal, clear queue, optimistically mark remaining pins claimed in cache, fire haptics, and trigger claim mutation in parallel in the background (R23.8)
  - [x] 18.3 Tests: extend `PinCelebrationModal.test.tsx` and `PinBoardScreen.test.tsx` for "Skip all" rendering, button press, batch claiming, and fast paced advancement (R23.6, R23.8)
  - [x] 18.4 Checkpoint — run verification gate

## Task Dependency Graph

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves. The
materialization/art branch (task 6) and the mobile renderer (task 7) run alongside the backend
track after the shared catalog exists.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "6.1", "6.2", "6.3", "6.4"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "6.5", "6.6"] },
    { "wave": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "7.1", "7.2", "7.3"] },
    { "wave": 5, "tasks": ["5.1"] },
    { "wave": 6, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "wave": 7, "tasks": ["9.1"] },
    { "wave": 8, "tasks": ["10.1", "10.2"] },
    { "wave": 9, "tasks": ["10.3", "10.8", "10.9", "10.10"] },
    { "wave": 10, "tasks": ["10.4", "10.5"] },
    { "wave": 11, "tasks": ["10.6", "10.7"] },
    { "wave": 12, "tasks": ["10.11", "10.12", "10.13", "10.14"] },
    { "wave": 13, "tasks": ["10.15"] },
    { "wave": 14, "tasks": ["10.16", "10.17"] },
    { "wave": 15, "tasks": ["10.18"] },
    { "wave": 16, "tasks": ["11.1"] },
    { "wave": 17, "tasks": ["12.1", "12.2", "12.5"] },
    { "wave": 18, "tasks": ["12.3"] },
    { "wave": 19, "tasks": ["12.4"] },
    { "wave": 20, "tasks": ["12.6", "12.7", "12.8"] },
    { "wave": 21, "tasks": ["12.9"] },
    { "wave": 22, "tasks": ["12.10"] },
    { "wave": 23, "tasks": ["13.1"] },
    { "wave": 24, "tasks": ["14.1", "14.3"] },
    { "wave": 25, "tasks": ["14.2", "14.4"] },
    { "wave": 26, "tasks": ["14.5"] },
    { "wave": 27, "tasks": ["14.6", "14.7"] },
    { "wave": 28, "tasks": ["14.8", "14.9"] },
    { "wave": 29, "tasks": ["14.10", "14.11"] },
    { "wave": 30, "tasks": ["15.1"] },
    { "wave": 31, "tasks": ["16.1", "16.2", "16.11"] },
    { "wave": 32, "tasks": ["16.3", "16.12"] },
    { "wave": 33, "tasks": ["16.4", "16.5", "16.13"] },
    { "wave": 34, "tasks": ["16.6", "16.7"] },
    { "wave": 35, "tasks": ["16.8"] },
    { "wave": 36, "tasks": ["16.9", "16.14"] },
    { "wave": 37, "tasks": ["16.10", "16.15"] },
    { "wave": 38, "tasks": ["16.16"] },
    { "wave": 39, "tasks": ["17.1"] }
  ]
}
```

## Notes

- **Source of truth:** the roster (which pins exist) is `pin-roster-v2.html`; the rules/tiers/tracks are the track sections in `design.md`. Task 1.2 transcribes the roster into `catalog.ts`; task 6.5 promotes the rendered catalogue to the master `pin-catalog-mockup.html` name.
- **Identifier keying:** curated sets resolve by stable `upstream_entity_id`, never by name (R13). Facet-derived sets (Water Rides, Dark, Spinners, Gentle, Shows, IP franchises) self-size from `thrillFactor` / `interests` / `category`.
- **Cross-spec dependency:** `experience-activity-logging` (already implemented) supplies `experience_logs` / `visited_on` for single-day grouping. Single-day feats are date-granularity only — no time-of-day pins.
- **Synchronous delivery:** newly awarded pins are evaluated and returned synchronously in the log/rating/rode-with responses — no background worker (free-tier hosting).
- **Idempotency:** award inserts use `ON CONFLICT (user_id, pin_id) DO NOTHING` for monotonic awards.
- **The pin gate is separate from `npm run verify`.** `verify/run-all.js` validates the rendered catalogue's geometry/contrast/provenance and is not covered by the workspace test suites; both must pass at task 9.1.
- **Mythic tier & art (task 6) need human review** — renders can't be judged in this loop; surface options rather than asserting appearance.
- **Task 10 origin.** Added after task 9 shipped: a user-reported bug (an already-earned pin
  showing locked at "6/5 · 99%") traced to two Completion-writing paths (`PUT
  /me/experiences/:id/completion`, `POST /trips/:id/log-entries`) never calling the `awardPins`
  port (Requirement 21.1), plus historical completions predating the fix having no way to
  self-heal (Requirement 21.2's reconciliation). While fixing this, the user asked for pins to be
  manually claimed rather than silently auto-unlocked, for the satisfaction of a deliberate
  "claim" moment (Requirement 20) — which also gives the reconciliation backfill a good UX outlet:
  historical pins land as a ready-to-claim queue instead of appearing to change state on their own.
  `claimed_at` is additive and purely presentational; it never affects award idempotency (Property
  1, unchanged) or the board's tier summary / overall percentage (Property 14).
- **Task 10.13 is the actual regression guard for the bug**, not 10.11/10.12 — per
  execution-discipline, a bug fix needs a test at the layer that was wrong (the route handler that
  failed to call `awardPins`), not just new-feature tests around it.
- **Task 12 origin.** Added after the reconciliation backfill (task 10) surfaced several
  ready-to-claim pins at once for a real account: the user asked to (a) sort claimable pins to the
  top of the grid, (b) filter by owned/not-owned, and (c) get a Profile-tab badge for claimable
  pins, mirroring the existing notification `AttentionBadge`. Entirely a presentation-layer change
  on top of the already-shipped `unlocked`/`claimedAt` fields — no new persisted field, no new
  endpoint, no server-side change at all.
- **Task 12.4's badge-distinguishability approach was reverted, and 12.9/12.10 were added,
  in direct response to user review.** After seeing the tab-icon badge shipped with a distinct
  amber color + `ribbon` icon (12.4's original implementation), the user said the color/icon
  distinction felt "busy" with two badges and asked to keep the plain shared look, distinguished
  only by position — reverted. In the same message the user asked for the "View your pins" entry
  on the Profile screen to get a badge too, "like how notifications gets a pin" — added as 12.9
  (implementation) and 12.10 (tests), reusing the existing `profile-notifications-badge` pattern
  verbatim rather than inventing a new visual treatment. Requirement 22.5 (revised) and 22.6 (new)
  capture both changes additively.
- **Task 14 origin.** After using the shipped claim flow, the user reported three concrete
  problems with a screenshot: (1) a ready-to-claim tile already showed full unlocked art on the
  board, so tapping it and seeing "New pin unlocked! / Add to collection" felt redundant/wrong
  since the User had already seen the art and the pin was already in their collection; (2) with
  several pins ready at once there was no way to claim them together — only one tile at a time;
  (3) the celebration itself felt flat for what should be a fun moment. Requirement 23 (additive)
  and design.md's "Claim Reveal, Bulk Claim, and Celebration Fanfare" section capture the fix:
  render ready-to-claim tiles as locked until tapped (so claiming is the actual reveal), a
  "Claim all (N)" bulk action that feeds the existing one-at-a-time queue, an "X of N" position
  indicator plus a paced delay between queued celebrations, and a confetti/pop/two-part-haptic
  celebration — all built with React Native's existing `Animated`/`Haptics`, no new dependency.
- **Task 16 origin.** The user asked whether a "show off your favorite pins" board — distinct from
  the collection grid — had been built, referencing Requirement 5.2's "featured showcase pins"
  clause. It had not: that clause shipped in name only (task 8.1's completion note describes only
  the summary header, never a showcase). Requirement 24 is the concrete design that clause always
  needed, written now with the user's explicit direction that it should feel like a real Disney
  park pin board/lanyard — a freeform `(x, y)` placement a User drags Pins onto, not a fixed grid
  or ranked list. No existing Requirement (including 5.2 itself) is changed or renumbered; 5.2 is
  fulfilled, not amended. A new persisted resource (`pin_showcase_placements`), two new endpoints,
  and one new mobile screen — none of which touch `user_pins`, the evaluator, or any existing pin
  route. Friend visibility (R24.7, R24.9) reuses the app's existing `assertOwnerOrFriend` gate
  rather than inventing new authorization, per this repo's "reuse, don't reinvent" convention.
  Drag is implemented with RN's own `PanResponder`/`Animated` (already this feature's pattern for
  motion, e.g. task 14's claim reveal/pop/confetti) rather than adding a gesture/reanimated
  dependency neither app currently has.
- **Task 16's cork-board/non-overlap/sharing amendment.** Before implementation began, the user
  added three concrete requirements to the still-unbuilt Showcase: (1) it should visually look
  like a cork board, not another list screen; (2) placed Pins must never overlap each other; (3)
  a Showcase must be shareable, and the recipient should land directly on it rather than a general
  profile page. All three folded into Requirement 24 (24.10-24.14) and design.md additively before
  any code was written, per this spec's "amend before/with code" convention. The overlap rule is
  enforced in two places by design — client-side for instant snap-back UX, server-side
  (`placePin`) as the actual authority (Property 22) — so a bypassed or stale client can never
  persist two overlapping pins. Sharing reuses the app's existing Sharing_Service/Inbox mechanism
  (a new `pinShowcase` `SharePayload` variant) rather than inventing new sharing infrastructure;
  this app has no public/unauthenticated link surface anywhere today, so "share it" was scoped to
  the existing friend-to-friend share-and-Inbox model, landing the recipient on the owner's
  Showcase the same way an existing `progress` share already deep-links straight to the Friend's
  Comparison pane rather than a general profile landing. Unlike `progress`, a `pinShowcase` share
  carries no send-time snapshot — it is a live pointer, so a recipient always sees the owner's
  current arrangement (Property 23), which the user explicitly wanted for a "personal display"
  rather than a frozen achievement record.
