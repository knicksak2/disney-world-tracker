# Trip Budget spec report

Spec-only change. No application code, migrations, tests, package files or env files were touched.

## Files created

| File | Summary |
| --- | --- |
| `.kiro/specs/trip-budget/requirements.md` | 22 EARS requirements (Budget lines, ticket price client and cache, menu item pricing, Lightning Lane, authorization, deletion, mobile/accessibility). |
| `.kiro/specs/trip-budget/design.md` | Architecture, components, data models, 49 Correctness Properties (each with a `**Validates:**` line), error handling, testing strategy, Configuration & Constants, External Interfaces. |
| `.kiro/specs/trip-budget/tasks.md` | Implementation plan with Notes and Task Dependency Graph; all checkboxes are `- [ ]`. |
| `.agents/tasks/trip-budget/investigation.md` | Research notes. |
| `.agents/tasks/trip-budget/ticket-price-source.md` | Ticket price source analysis. |
| `.agents/tasks/trip-budget/design-review.json` | Final review verdict (round 6). `reviewDoc` now points at `reviews/design-review.md`. |
| `.agents/tasks/trip-budget/reviews/design-review.md`, `.round2.md`, `.round4.md`, `.round5.md` | Review working files, moved out of the spec folder. |
| `.agents/tasks/trip-budget/SPEC-REPORT.md` | This report. |

References to the moved review files were updated in `trip-budget/design.md` (Notes, 3 places), `trip-budget/tasks.md` (Notes, 2 places) and `design-review.json`.

## Sibling specs amended (additive)

Each got new requirement text, a design section (6 lines each, except trip-expenses at 54) and a task note.

| Spec | New requirement |
| --- | --- |
| `account-deletion` | Requirement 21: Budget data of a deleted account |
| `admin-panel` | Requirement 18: Ticket price diagnostics |
| `crowd-calendar` | Requirement 19: Lightning Lane price persistence |
| `disney-source-resilience` | Requirement 16: Documented exception for the ticket price client |
| `legal-disclaimers-and-terms` | Requirement 7: Third-party price data credits and limits |
| `restaurant-menu-display` | Requirement 8: Structured menu prices and lazy refill |
| `trip-expenses` | Requirement 16: Menu Item Picker; plus appended criteria 2.9 (item 13) and 10.1 (item 6) |
| `trips` | Requirement 25: Trip Budget actions and hub section |

## Migrations reserved: 0065 to 0068

Re-verified: the highest existing migration is `0064_account_deletion.sql`, and `apps/api/migrations` has no file matching `0065` to `0069`. All four numbers are free.

## Final review verdict

`design-review.json`: verdict APPROVED, round 6, 0 HIGH, 0 MEDIUM, 2 NIT. Round 5 findings H1, M1 to M5 and L1 to L14 (except L12) were verified fixed. L12 was declined with a reason (the Expense tax and gratuity controls are specified and flagged for an owner veto).

Open findings (both NIT, text only, not applied):
- N1: an Error Handling row cites Requirement 13.6 for "a missing set is stale". The rule lives in `decideRefresh` (Requirement 12).
- N2: R14.12 rule (3) wording. For a null set the `lastError` clause is vacuous. Suggested wording: "set exists, has asOf == null, and set.lastError != null". The design's pure function already behaves this way.

## Open questions for the user

1. Keep or veto the Expense tax and gratuity controls (`trip-expenses` R16.6, Property 42, task 19.1)? They go beyond what you asked for.
2. Apply the two NIT wording fixes (N1, N2)? They are harmless either way.
3. Confirm the launch gate (R21.8): the owner quote and the post-deploy `TICKET_PRICES` diagnostic must pass before the feature flag is turned on in production.

## Implementation handoff (Antigravity)

- Read `AGENTS.md` and every `.md` in `.kiro/steering/` first. Then read all three trip-budget spec files, and the amended sibling sections.
- Follow `tasks.md` in Task Dependency Graph order. Stop at each checkpoint task and surface results.
- Migrations are 0065 to 0068. Add them in that order and never edit an applied migration.
- Post-deploy gate: after the first deploy, run the admin `TICKET_PRICES` diagnostic (admin-panel R18). Do not enable Budget ticket pricing until it reports a healthy fetch. Diagnose never reads the kill switch.
- Kill switches default to `false` in production. Enable them only after the diagnostic gate passes.
- Run `npm run verify` once at the end of the whole change, and include the behavior to test map in the completion report.
- WARNING: the working tree has 9 uncommitted mobile files that predate this work: `BookingSettingsModal.tsx`, `ExpenseFormModal.tsx`, `PackingItemFormModal.tsx`, `ReceiptReviewModal.tsx`, `RefundModal.tsx`, `ResortPickerModal.tsx`, `SettlementModal.tsx`, `TripGuestManagementModal.tsx` and `__tests__/TripExpensesScreen.test.tsx`, all under `apps/mobile/src/screens/trips/`. Do not overwrite, revert or commit them blindly. Confirm with the owner before touching `ExpenseFormModal.tsx` (task 19.x overlaps it).

## Diagnostics and git results

Kiro Spec Format diagnostics: the `get_diagnostics` tool is not available in this session, so I could not run it. I did not claim it passed. Please run it on the 3 trip-budget files and the 8 amended sibling specs in the editor. I did these manual structural checks instead:
- Malformed checkboxes in trip-budget (anything other than `- [ ]` or `- [x]`): 0.
- trip-budget `design.md` has Architecture, Components and Interfaces, Data Models, Correctness Properties, Error Handling, Testing Strategy, Configuration & Constants and External Interfaces.
- `design.md` has 49 `### Property` headings and 49 `**Validates:**` lines.
- `tasks.md` has `# Implementation Plan: Trip Budget`, `## Tasks`, `## Notes` and `## Task Dependency Graph`.
- Not checked manually: sibling-spec format beyond the additive diff, and whether the validator accepts every heading.

Git status: changed paths are `.kiro/specs/**` markdown (8 sibling specs x 3 files, plus untracked `.kiro/specs/trip-budget/`), untracked `.agents/tasks/trip-budget/`, and the 9 pre-existing mobile files. Nothing else (no `apps/api`, migrations, packages or env files).

Numstat of the 24 amended sibling spec files: 0 deletions in every `design.md` and `requirements.md`. Each `tasks.md` has exactly 1 deletion (8 files; trips has 13 additions, restaurant-menu-display 10, the rest 7). The deleted line is a Task Dependency Graph JSON entry that gained a trailing comma, so the new entry could be appended: ids 29, 12, 32, 10, 7, 9, 56, 23 across the files. This is formatting only. The mobile files' diffs (13/2 and so on) are pre-existing and are not from this work.

Git emits CRLF to LF warnings for `disney-source-resilience/*` and `trips/design.md`. This is line-ending noise only.
