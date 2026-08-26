# Implementation Plan: Catalog Taxonomy Cleanup

## Overview

Two independent halves, in this order.

**Half A (tasks 1–3): exclusion.** Add a pure `exclusionRuleFor` predicate to the Disney classification stage and withhold matching documents from the upstream Experience set. The existing reconciliation soft-deletes the ~326 matching rows on the next sync — there is no data migration and no `DELETE`.

**Half B (tasks 4–10): re-categorization plus the safety changes.** Add `Walkthrough`, `PlayArea`, `Game`; apply a curated 52-entry override map; move the optimizer's queue-wait gate from category to snapshot; add duration defaults; fix the live-section gating; update the client surfaces.

Half A is verifiable on its own at checkpoint task 3. Half B must not begin writing new category values before task 4.1's migration is applied.

Use the **next free sequential migration number** at implementation time (check `apps/api/migrations/` — do not assume `0032`).

The full curated Category_Override list (52 Enterprise_Ids), every exclusion pattern, and every duration default are in `design.md` → Data Models, Configuration & Constants. Use those values verbatim; do not re-derive them from facets.

## Tasks

- [x] 1. Exclusion predicate
  - [x] 1.1 Add `apps/api/src/services/catalog/disney/facilityExclusion.ts`
    - Export `ExclusionRule`, `exclusionRuleFor(doc)`, `isExcludedFacility(doc)` with the signatures in design → Components and Interfaces. Pure, total, never throws; tolerate absent `type`, `subType`, `name`. Rule evaluation order fixed to the `ExclusionRule` union order so the audit breakdown is deterministic.
    - Declare `AMENITY_SUB_TYPES`, `ANIMAL_PLACARD_SUFFIX`, `RENTAL_INVENTORY_PATTERN`, `INFORMATIONAL_PAGE_PATTERN`, `EXCLUDED_NAME_LIST`, `SERVICE_FACILITY_PATTERN` exactly as given in design → Configuration & Constants. `EXCLUDED_NAME_LIST` is exact-match, not substring.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.13_
  - [x] 1.2 Exclusion unit + property tests
    - Unit tests per rule using realistic `FacilityDocument` fixtures — real upstream strings (`'Spa / Hot Tub'`, `'African Hogs - Disney Animals'`, `'Guide for Families - EPCOT'`, `'Beachcomber Shacks Premium Plus'`), not simplified shapes. Include negative cases that must NOT match: `'Stormalong Bay'` under a non-amenity sub-type, `'Kilimanjaro Safaris'`, `'Tree of Life Awakenings'`.
    - **Property 1: Exclusion is a pure, total, deterministic function of the document.**
    - **Property 2: Every enumerated rule matches its intent and nothing broader** — both directions, per rule.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.13_

- [x] 2. Wire exclusion into the sync, with audit counts
  - [x] 2.1 Skip Excluded_Facilities in `apps/api/src/services/catalog/sync.ts`
    - Between parsing and Experience construction, skip a document when `isExcludedFacility(doc)` is true AND `categoryOverrideFor(doc.id)` is null. A curated override always outranks a rule-based drop.
    - Accumulate per-rule exclusion counts and log them at run completion through the existing sync logging path. After `applyReconciliation`, log an error-level warning when `diff.experiences.softDeletes.length` exceeds `DEACTIVATION_SAFETY_THRESHOLD` (450), and still complete the run. Measure the threshold on newly soft-deleted rows, never on the excluded-document count.
    - Note: task 2.1 references `categoryOverrideFor`, so land task 4.2 first or stub the import against the real exported signature — do not invent a different name.
    - _Requirements: 1.1, 1.10, 7.1, 7.3, 7.4_
  - [x] 2.2 Sync integration test
    - Assert a rule-matching document is withheld from the upstream Experience set; assert a document that matches a rule but has an override IS admitted; assert the per-rule counts and the threshold warning are emitted.
    - _Requirements: 1.1, 1.10, 7.1, 7.3_
  - [x] 2.3 Reconciliation preservation test (pg-mem)
    - Insert an active experience with a referencing `completions` row, run reconciliation with that upstream id absent, and read back: `active = false`, same `id`, `completions` row still present. Then re-admit the id and assert the same `id` is reactivated rather than a new row created.
    - _Requirements: 1.11, 1.12_

- [x] 3. Checkpoint — Half A
  - Run `npm run verify` once. Paste the literal tail including per-workspace `Test Files`/`Tests` lines and the exit code. Produce the behavior→test map for tasks 1–2 before reporting done.

- [x] 4. New categories: enum, migration, override map
  - [x] 4.1 Add the three members and widen the CHECK constraint
    - `packages/shared/src/enums.ts`: insert `'Walkthrough'`, `'PlayArea'`, `'Game'` into `EXPERIENCE_CATEGORIES` after `'Character_Meet'` and before `'Tour'`.
    - Add migration `00NN_experience_category_taxonomy.sql` exactly as in design → Data Models: drop and re-add `experiences_category_chk` with the widened closed set, wrapped in `BEGIN/COMMIT`. Additive only — every existing member retained. No backfill statement.
    - **This migration must be applied before any code writes a new category value**, or every affected upsert fails the CHECK and the sync run is recorded failed.
    - _Requirements: 2.1, 2.2_
  - [x] 4.2 Add `apps/api/src/services/catalog/disney/categoryOverrides.ts`
    - Export `CATEGORY_OVERRIDES` and `categoryOverrideFor(enterpriseId)` per design → Components and Interfaces. Transcribe all entries from design → Data Models verbatim, keyed on the full `{numericId};entityType={Type}` string. Hand-written constant; no runtime inference from facets or names. (Originally 52 entries; the 53rd — the Halloween-party `Event` override — is added by task 11.1b.)
    - _Requirements: 2.5, 2.6, 2.8_
  - [x] 4.3 Consult the override map in `classifyFacility`
    - Check `categoryOverrideFor` first; on a miss fall through to the existing R4.2–R4.10 mapping unchanged. Keep the current signature and the `null`-means-excluded contract.
    - Record the applied-override count and the set of override keys that matched no document; log the unmatched keys as a warning and complete the run successfully.
    - _Requirements: 2.3, 2.4, 2.7, 7.2_
  - [x] 4.4 Migration + override + classification tests
    - `migrationNNNN.test.ts` (pg-mem): the widened CHECK accepts each new member, still accepts every pre-existing member, still rejects an unknown value.
    - Override map unit test: all 52 present, keys well-formed, no duplicate key, and `18447293;entityType=Entertainment` ("Tree of Life Awakenings") absent.
    - Table-driven classification test walking each of the 52 overrides to its expected category.
    - **Property 3: A curated override always outranks a rule-based drop.**
    - **Property 4: Classification is unchanged for every non-overridden document.**
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 1.10_

- [x] 5. Optimizer: queue wait from the snapshot
  - [x] 5.1 Add `isStandbyBearing` and replace the category gate in `optimizer.ts`
    - Add the pure `isStandbyBearing(snapshot, useSingleRider)` helper per design. Replace `isRideLike` as the queue decision. Preserve, in this order: break short-circuit to zero wait; `Show`/`Parade` with showtimes on the showtime path; `Show`/`Parade` without showtimes but Standby_Bearing on the standby path (no `showtimes_unavailable`); otherwise Standby_Bearing → standby path, else zero.
    - Missing snapshot: keep the existing default wait ONLY for `Ride`/`Character_Meet`; zero for every other category.
    - Leave the rope-drop ramp, single-rider substitution, virtual-queue handling, and Lightning Lane substitution intact — they run inside the standby path, not the gate.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [x] 5.2 Duration defaults for the new categories in `resolveDefaultDuration`
    - Add an explicit branch before the `DEFAULT_RIDE_DUR` fall-through: `DEFAULT_WALKTHROUGH_DUR = 25`, `DEFAULT_PLAY_AREA_DUR = 30`, `DEFAULT_GAME_DUR = 20`. Preserve existing precedence — user override, then catalog duration, then the category default.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 5.3 Optimizer tests — properties AND explicit branch tests
    - **Property 5: The queue gate follows the snapshot, not the category** — including the category-invariance case (hold the snapshot fixed, vary the category across the whole union, assert the modeled wait does not change).
    - **Property 6: Ride behavior is preserved when prediction is unavailable.**
    - **Property 7: A wait-posting show is never modeled at zero.**
    - **Property 8: Duration never falls through to the ride default for a new category.**
    - Explicit unit tests that drive each new branch, because a property test can execute a branch without asserting it: a `Walkthrough` with a Standby_Bearing snapshot → non-zero wait; a `Walkthrough` with a non-bearing snapshot → zero; a `Show` with no showtimes but a standby wait → standby path and no `showtimes_unavailable` warning; one duration assertion per new category.
    - The coverage gate on `src/services/planning/**` (90% lines/functions/statements, 80% branches) applies. Satisfy it with tests — never lower, disable, or exclude the threshold.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 5.4 Confirm the crowd index and sampling basket are untouched
    - Add or extend a test asserting the wait-sampling basket and crowd-index membership are decided by `isStandbyBasketEntry` on the live feed, independent of Experience_Category — so moving a wait-posting attraction to `Show` does not remove it from the basket.
    - _Requirements: 3.9_

- [x] 6. Live detail section gating
  - [x] 6.1 Extend `liveSectionFor` in `apps/mobile/src/screens/catalog/gating.ts`
    - Add the `LiveShape` parameter per design. Map: `Ride`/`Character_Meet` → `wait_status`; `Show`/`Parade` → `showtimes` when showtimes present, else `wait_status` when a standby wait is present, else `showtimes`; the three new categories → `wait_status` when a standby wait is present else `none`; `Restaurant` → `dining`; every Structural_Category → `none`. Keep the `never` exhaustiveness guard.
    - Update `ExperienceDetailScreen` to pass the shape derived from the loaded `Live_Detail`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 6.2 Gating tests
    - **Property 9: At most one live section, and never an empty one** — over the full category union × both `LiveShape` booleans.
    - Unit cases for each new category in both shapes, and the `Show`-with-standby-no-showtimes fallback.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Client surfaces
  - [x] 7.1 Category visuals and labels
    - Add a `categoryVisual` entry for each new member in `apps/mobile/src/theme/theme.ts` (glyph, tint, label). Add a category placeholder image per new member. Do not distinguish by colour alone — the label carries the meaning.
    - _Requirements: 2.9, 6.6_
  - [x] 7.2 Picker tab, grouping, filters, stats, leaderboard
    - `experiencePickerFilters.ts`: `TAB_CATEGORIES.attractions` becomes `['Ride', 'Walkthrough', 'PlayArea', 'Game']`.
    - Verify `catalogGrouping.ts`, `experienceFilter.ts`, `statsView.ts`, `progressComparison.ts` all derive from `EXPERIENCE_CATEGORIES`; fix any hardcoded list found.
    - `apps/api/src/services/aggregate/leaderboard.ts`: its hand-rolled read-path category check must accept the new members.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 7.3 Consumer-surface tests
    - `ExperiencePicker` test: the attractions tab request includes the three new categories, and a `Walkthrough` result renders in that tab (drive the tab switch with `fireEvent`, assert both the request and the rendered row).
    - Catalog grouping test: a `Walkthrough` appears in its own group in canonical order; an empty category is omitted.
    - Leaderboard test: an entry with category `Walkthrough` is accepted rather than filtered out.
    - Stats coverage test: `Walkthrough` reports as its own coverage row.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Detail-screen render test
  - [x] 8.1 `ExperienceDetailScreen` test for a new category
    - Render a real `Walkthrough` experience with a `Live_Detail` carrying no standby wait; assert no live operational section and the "Walkthrough" category label. Then one carrying a standby wait; assert the wait/status section appears. Mock only the network/query layer.
    - _Requirements: 5.1, 5.2, 2.9_

- [x] 9. Amend the three shipped specs
  - [x] 9.1 Confirm the amendments are present and clean
    - `disney-facilities-catalog-source/requirements.md` Requirement 17 (narrows R4.1 by reference), `day-planning-optimization/requirements.md` R3.19 (supersedes R3.14's gate), `experience-live-details/requirements.md` R7.6–R7.7 (live-shape fallback). All are additive — no existing requirement renumbered or removed.
    - Re-run the Kiro Spec Format diagnostics on all four specs and confirm every file is clean.
    - _Requirements: 3.1, 5.3_

- [x] 10. Checkpoint — whole feature
  - Run `npm run verify` once. Paste the literal tail including per-workspace `Test Files`/`Tests` lines and the exit code. Produce the full behavior→test map. Then run a real `npm run sync:cloud` against the dev database and report the logged exclusion counts by rule, the applied-override count, and the unmatched-override list, confirming the resulting active row count is in the expected ~846 range.

- [x] 11. Deduplication of clone and same-facility rows (Requirement 8)
  - [x] 11.1 Add the `duplicate_clone` rule and `DUPLICATE_CLONE_IDS`
    - Extend the `ExclusionRule` union with `'duplicate_clone'`, evaluated **last** so a clone that also matches a content rule reports the more informative reason.
    - Transcribe all 14 Enterprise_Ids from design → Data Models verbatim. The drop is unconditional — do NOT gate it on the retained sibling being present in the run.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10_
  - [x] 11.1b Add the 53rd Category_Override: `19637044;entityType=Recreation` → `Event`
    - Mickey's Not-So-Scary Halloween Party. Its `Event` sibling `90004990` is upstream-tombstoned (`softDeleted: true`, no name/type), so the surviving `Recreation` row is re-categorized rather than dropped (R8.10). This id must NOT also appear in `DUPLICATE_CLONE_IDS`.
    - _Requirements: 2.3, 8.10, 8.11_
  - [x] 11.2 Add the `^Allergy` term to `INFORMATIONAL_PAGE_PATTERN`
    - Catches the two dietary-information `Restaurant` rows the first production run left active. Verified no active row starting with "Allergy" is a real experience.
    - _Requirements: 1.7_
  - [x] 11.3 Duplicate-clone tests
    - Unit test: all 14 ids present, well-formed, no duplicates, and no id is also another entry's retained sibling.
    - Cross-check test: no id appears in both `DUPLICATE_CLONE_IDS` and `CATEGORY_OVERRIDES` (R8.11) — this must fail loudly rather than resolve via R1.10 precedence.
    - Override test: `19637044;entityType=Recreation` maps to `Event` and is absent from `DUPLICATE_CLONE_IDS`.
    - **Property 10: A curated clone is excluded regardless of its sibling's presence.**
    - Explicit branch test: a curated clone is excluded when its retained sibling is **absent** from the document set — the unconditional behavior R8.4 requires, which a both-present test cannot distinguish.
    - Unit test for 11.2 covering both real "Allergy-Friendly …" names, plus a negative control.
    - _Requirements: 8.1, 8.4, 8.5, 1.7_
  - [x] 11.4 Add `duplicateDetector.ts` and wire it into the sync log
    - Implement `detectDuplicateGroups` per design, with normalization that folds case, NFKD, and punctuation so curly/straight apostrophes and trademark symbols group together. Suppress `KNOWN_DISTINCT_NAMESAKES`. Call it after `buildUpstreamCatalog` and log each group at warn level. Diagnostic only — it must not withhold or modify anything.
    - _Requirements: 8.7, 8.8, 8.9_
  - [x] 11.5 Detector tests
    - **Property 11: Duplicate detection reports without mutating.**
    - Unit cases: a genuine clone pair is reported; the Hilton namesake pair is not; apostrophe-style and trademark-symbol variants group together; a unique name is not reported.
    - _Requirements: 8.7, 8.8, 8.9_
  - [x] 11.6 Re-sync and confirm the identity is stable
    - Run the sync twice against the dev database and confirm the same Enterprise_Id survives for each of the 14 curated pairs on both runs, and that the detector reports no unexpected groups.
    - Confirm "Mickey's Not-So-Scary Halloween Party" is present exactly once, as category `Event`, on Enterprise_Id `19637044;entityType=Recreation`.
    - _Requirements: 8.4, 8.5, 8.7, 8.10_

- [x] 12. Checkpoint — deduplication
  - Run `npm run verify` once. Paste the literal tail including per-workspace counts and the exit code. Produce the behavior→test map for task 11.

## Notes

- **Test tasks are required, not optional.** Every new module gets unit + property tests; the migration gets a `migrationNNNN.test.ts`; every route/repo change gets a test at the layer that changed. Tag property tests `// Feature: catalog-taxonomy-cleanup, Property N: <text>`, ≥100 `fast-check` runs.
- **A property test that executes a branch does not cover it.** Task 5.3 deliberately requires explicit branch tests alongside the properties: a randomly generated snapshot can walk the new `Walkthrough`-with-wait path while asserting nothing about it. Every new branch needs a test that drives that specific condition and would fail without the change.
- **Migration before classifier.** Task 4.1 gates all of Half B. Writing `Walkthrough` before the CHECK is widened fails the upsert and records the sync run failed.
- **No hard deletes, ever.** Removal is exclusion from the upstream set; `reconcile` soft-deletes and `repo.ts` never issues a `DELETE`. This is what preserves Internal_Ids, completions, ratings, notes, and planned items, and what makes every exclusion reversible.
- **Do not re-derive the curated lists.** The 53 overrides, the 14 duplicate-clone ids, and every exclusion pattern were derived from a live audit and hand-checked; `thrillFactor`/`parkInterests` facets are ~90% accurate ("American Heritage Gallery" carries a `Slow Rides` tag) and must not be used as a runtime classifier.
- **Deduplication is about stable identity, not tidiness (task 11).** Nothing currently pins which sibling of a duplicate pair survives a run, so the Internal_Id that Completions and Ratings attach to can flip whenever upstream availability changes. That is why R8.4 makes the clone drop **unconditional**: the surviving id must be a function of the curated list alone, never of feed contents.
- **Always verify a retained sibling before curating a pair (R8.10).** Disney tombstones retired documents by setting `softDeleted: true` and stripping `name`/`type` while leaving them in the feed, and R3.4/R3.7 of `disney-facilities-catalog-source` exclude those every run. Deferring to a tombstoned sibling removes the experience indefinitely instead of resolving a duplicate. The Halloween party is exactly that case — `90004990;entityType=Event` is tombstoned — which is why it is handled by the 53rd Category_Override (task 11.1b) rather than a clone entry. Check `disney_documents` before adding any pair.
- **Splitsville is the deliberate exception.** It is the one case where the generic `Recreation` row is the better label, because it is a bowling alley; the `Show/Atmosphere` row is dropped instead. Do not "fix" this to match the others.
- **Expect stats to move.** Dropping 40 animal placards and moving 52 rows out of `Ride` shrinks the ride denominator from 180 to roughly 84, so ride-completion percentages will roughly double. That is the intended consequence, not a bug.
- **Row counts are a sanity check, not an assertion.** Tests assert rules and overrides. The ~846-active figure in task 10 is a magnitude check against upstream drift, not a value to hardcode.
- Open question for the maintainer: whether `Walkthrough` should later split out a `Gallery` member. Six gallery rows are folded into `Walkthrough` here on the grounds that a museum gallery *is* a walkthrough; revisit only if browsing them together proves confusing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "4.2"] },
    { "id": 1, "tasks": ["1.2", "4.3"] },
    { "id": 2, "tasks": ["2.1", "5.1", "5.2"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.4", "5.3", "5.4"] },
    { "id": 4, "tasks": ["3"] },
    { "id": 5, "tasks": ["6.1", "7.1", "7.2"] },
    { "id": 6, "tasks": ["6.2", "7.3", "8.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["10"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.4"] },
    { "id": 10, "tasks": ["11.3", "11.5"] },
    { "id": 11, "tasks": ["11.6"] },
    { "id": 12, "tasks": ["12"] }
  ]
}
```
