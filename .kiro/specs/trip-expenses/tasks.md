# Implementation Plan: Trip Expenses

## Overview

This plan adds a shared expense ledger to the Trips feature: Expenses (four Split_Modes), Trip_Guests, Settlements, Refunds, Charge_Lines, on-device receipt OCR, and a Catalog restaurant/Resort link. It **depends on the Trips feature** (`.kiro/specs/trips`, which owns the Trip, Trip_Membership, Trip_Role, `assertTripMember`/`assertTripOrganizer`, and the Trip_Detail_View hub) and reuses that feature's authorization pattern directly rather than reimplementing it. It also reads (never writes) the Catalog's `experiences`/`resorts` tables and the `restaurant-menu-display` feature's `experience_menus` cache for Requirement 11's suggestions — both are read-only, best-effort lookups with no code or schema dependency the other way.

Unlike `trip-reservations`, this feature introduces an entirely new service (`apps/api/src/services/tripExpenses/`) and seven new tables, because the data has no existing row to attach to. The build order is bottom-up: shared contracts and the migration first, then the pure allocation/balance math (the property-test surface, with zero DB dependency), then the repo and routes, then the mobile screens, then the two "nice-to-have but genuinely requested" extensions — on-device OCR and the Catalog link — last, since both are strictly additive on top of a working manual-entry ledger and neither blocks the other.

Migration numbering: `0059_password_reset_tokens.sql` is the last file on disk, so this plan uses **`0060`**. Never reuse or edit an applied migration.

No external vendor, credential, or network call is introduced anywhere in this plan — on-device OCR runs with no network request, and the Catalog link is an in-repo read.

## Tasks

- [x] 1. Shared contracts and migration
  - [x] 1.1 Add enums and vocabulary constants to `@dwt/shared`
    - Add `EXPENSE_SPLIT_MODES`/`ExpenseSplitMode`, `EXPENSE_CATEGORIES`/`ExpenseCategory`, `CHARGE_LINE_KINDS`/`ChargeLineKind` to `packages/shared/src/enums.ts`. Add `EXPENSE_AMOUNT_MAX_CENTS = 10_000_000`, `EXPENSE_LIMIT = 1_000`, `GUEST_NAME_MAX = 100`, `EXPENSE_DESCRIPTION_MAX = 200`, `EXPENSE_TIER_NAME_MAX = 40`, `EXPENSE_ITEM_NAME_MAX = 100` to a new `packages/shared/src/tripExpenses.ts`. Export all from the `index.ts` barrel.
    - _Requirements: 1.3, 1.5, 1.6, 1.12, 2.2, 4.1, 5.1_
  - [x] 1.2 Add Zod schemas to `packages/shared/src/tripExpenses.ts`
    - `expenseCreateSchema` / `expenseEditSchema` with the Split_Mode-discriminated `superRefine` (itemized omits `amountCents` and requires `>=1` item; exact/even/tiered require `amountCents` and their mode-specific fields; `date` reuses `tripCalendarDateSchema` from `trips.ts` with no Trip-range restriction). `expenseShareInputSchema`, `expenseTierInputSchema`, `expenseTierCountInputSchema`, `expenseItemInputSchema`, `chargeLineInputSchema` (sign-matches-kind refinement), `settlementCreateSchema` (`.refine` rejecting `payerId === recipientId`), `tripGuestAddSchema`, `tripGuestRenameSchema`, `refundCreateSchema`. All `.strict()`.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 2.2, 2.5, 2.6, 3.1, 3.2, 3.6, 3.7, 4.1, 4.3, 4.6, 5.1, 5.2, 5.7, 5.8, 7.1, 7.2_
  - [x] 1.3 Add read-projection DTOs to `packages/shared/src/tripExpenses.ts`
    - `ExpenseDTO`, `ExpenseShareDTO`, `ExpenseTierDTO`, `ExpenseTierCountDTO`, `ExpenseItemDTO`, `ChargeLineDTO`, `RefundDTO`, `SettlementDTO`, `TripGuestDTO`, `NetBalanceDTO`, `PairwiseBalanceDTO`, `BalanceDrillDownEntryDTO` exactly as shaped in design.md's Components and Interfaces section.
    - _Requirements: 6.3, 6.4, 6.5, 2.8_
  - [x] 1.4 Add migration `0060_trip_expenses.sql`
    - All seven tables (`trip_guests`, `expenses`, `expense_shares`, `expense_tiers`, `expense_tier_counts`, `expense_items`, `expense_item_assignees`, `charge_lines`, `charge_line_scopes`, `expense_refunds`, `settlements`), every `CHECK` constraint, and every index, exactly as in design.md's Data Models section. `BEGIN/COMMIT`; every FK to `trips(id)` either direct or transitive via `ON DELETE CASCADE` so a Trip delete needs no application-level cleanup (Req 8.6).
    - _Requirements: 1.3, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.8, 7.2, 8.6, 12.2_
  - [x] 1.5 Migration test `apps/api/src/db/__tests__/migration0060.test.ts`
    - Assert every table and column exists with the right type; every `CHECK` (amount bounds, the `member_id XOR guest_id` pattern on all three recipient tables, the `discount`-kind sign check, the distinct-parties Settlement check, the nonempty-name checks); every index; and that reapplying the file is a no-op (`ADD COLUMN IF NOT EXISTS`-equivalent idempotency via `CREATE TABLE` naturally failing silently is not applicable here since these are brand-new tables — assert the file can be run twice without error by wrapping each `CREATE TABLE`/`CREATE INDEX` in `IF NOT EXISTS`).
    - _Requirements: 1.3, 2.2, 3.1, 3.2, 4.1, 5.1, 5.8, 7.2_
  - [x] 1.6 Shared schema tests
    - `packages/shared/src/__tests__/tripExpenses.test.ts`: valid/invalid cases for every schema in task 1.2, each Split_Mode's `superRefine` branch (including the itemized-omits-Amount and non-itemized-requires-Amount cases), the Charge_Line sign-matches-kind refinement, and the Settlement distinct-parties refinement.
    - _Requirements: 1.1, 1.4, 3.6, 4.6, 5.7, 5.8, 7.2_

- [x] 2. Checkpoint — contracts compile
  - Run `npm run verify:shared`. Do not start task 3 until green: every later task imports from `packages/shared/src/tripExpenses.ts`.
  - _Requirements: 1.1, 1.3_

- [x] 3. Pure domain modules (the property-test surface)
  - [x] 3.1 `apps/api/src/services/tripExpenses/allocation.ts`
    - Implement `allocateProportionally` and `splitEvenly` exactly as specified in design.md's Components and Interfaces section (base share by `round`/`floor`, remainder distributed one cent at a time in array order, empty-input/zero-weight edge cases).
    - _Requirements: 3.4, 3.5, 5.3, 5.4, 5.10, 5.11, 12.3_
  - [x] 3.2 `apps/api/src/services/tripExpenses/itemizedTotals.ts`
    - Implement `computeItemizedTotals`: per-item `splitEvenly` into Item_Subtotals, per-Charge_Line scope resolution (whole-expense minus `isAlcohol` items when `excludeAlcohol`, or an explicit `scopeItemIds` subset) feeding `allocateProportionally`, the derived Amount (`Σitems + ΣchargeLines`), and the Payer's implicit portion. Throws on an unknown `scopeItemIds` reference or a zero-recipient scope.
    - _Requirements: 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 14.2_
  - [x] 3.3 `apps/api/src/services/tripExpenses/balances.ts`
    - Implement `computeNetBalances` and `computePairwiseBalances` exactly as specified, including the zero-sum guarantee and the Trip_Guest-already-resolved-onto-sponsor assumption (resolution itself happens in the repo before events reach this module, per task 5.3).
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 2.7_
  - [x] 3.4 Pure module tests
    - `apps/api/src/services/tripExpenses/__tests__/allocation.prop.test.ts`, `itemizedTotals.prop.test.ts`, `balances.prop.test.ts` (Vitest, `fast-check`, ≥ 100 runs each, tagged `// Feature: trip-expenses, Property N: <title>`). Unit cases cover the concrete worked examples from the spec conversation: the $1,321.65 even split, the Crystal Palace $57/$37 tier example, the Bob/wife/kid mixed adult-child tier example, a receipt with tax + 20% gratuity + an alcohol-excluded discount.
    - **Property 1: Every Split_Mode's shares plus the Payer's implicit portion sum to exactly the Amount.**
    - **Property 2: `allocateProportionally` and `splitEvenly` are exact and deterministic.**
    - **Property 3: Net_Balance always sums to exactly zero.**
    - **Property 5: A Charge_Line's alcohol exclusion never allocates to a flagged item's assignees via that Charge_Line.**
    - _Requirements: 3.4, 3.5, 5.4, 5.10, 5.11, 5.15, 6.6, 12.3, 14.2_

- [x] 4. Checkpoint — pure modules
  - Run `npx vitest run apps/api/src/services/tripExpenses/__tests__/allocation.prop.test.ts apps/api/src/services/tripExpenses/__tests__/itemizedTotals.prop.test.ts apps/api/src/services/tripExpenses/__tests__/balances.prop.test.ts`. These modules have zero DB dependency, so getting them green here means repo work in task 5 is pure wiring, not debugging money math.
  - _Requirements: 3.4, 5.10, 6.6_

- [x] 5. Trip_Expense repo — Expenses, Trip_Guests, Settlements, Refunds
  - [x] 5.1 `createTripExpenseRepo(pool)` scaffold and Trip_Guest methods
    - `apps/api/src/services/tripExpenses/repo.ts`: the factory and `addTripGuest`, `renameTripGuest`, `removeTripGuest` (sponsor-or-organizer check; `removeTripGuest` rejects with `trip_validation_failed` when any `expense_shares`/`expense_item_assignees`/`expense_tier_counts` row still references the Guest), `listTripGuests`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.9, 2.10_
  - [x] 5.2 `createExpense` for `exact`/`even`/`tiered`
    - Row-lock count check against `EXPENSE_LIMIT` (mirrors `PLANNED_ITEM_LIMIT`); validate Payer and every recipient (member or guest) belong to the Trip; `exact` — accept explicit shares, reject sum exceeding Amount; `even` — `splitEvenly` across selected participants (Payer included by default, removable); `tiered` — validate `Tier_Count`s reference tiers of the same Expense, compute shares, reject sum exceeding Amount. INSERT `expenses` + the mode-specific child rows inside one transaction.
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 1.11, 1.12, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 5.3 `createExpense` for `itemized`
    - Validate every item has ≥1 assignee; call `computeItemizedTotals` (task 3.2) with the submitted items/Charge_Lines/alcohol flags; use its derived `amountCents` for `expenses.amount_cents` rather than any client-submitted value; INSERT `expense_items`, `expense_item_assignees`, `charge_lines`, `charge_line_scopes` inside the same transaction as task 5.2.
    - _Requirements: 1.1, 1.3, 1.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 14.1, 14.3, 14.4_
  - [x] 5.4 `editExpense` and the Split_Mode-change reset
    - `SELECT ... FOR UPDATE`; adder-or-organizer check; when `input.splitMode` differs from the stored Split_Mode, delete every existing `expense_shares`/`expense_tiers`/`expense_tier_counts`/`expense_items`/`charge_lines` row for the Expense before re-running the task 5.2/5.3 validation-and-insert path for the new mode; otherwise re-validate and replace the existing child rows in place.
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 5.5 `removeExpense`
    - Adder-or-organizer check; `DELETE FROM expenses WHERE id = $1` — children (including any Refunds) cascade via FK.
    - _Requirements: 8.1, 8.4_
  - [x] 5.6 Settlement methods
    - `createSettlement` / `editSettlement` / `removeSettlement`: adder-or-organizer pattern on edit/remove; `createSettlement` validates distinct Trip_Member Payer/Recipient as a backstop to the Zod-level refine; no outstanding-balance constraint on the Amount (any amount, any direction, any number of times between the same pair).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2_
  - [x] 5.7 Refund methods
    - `createRefund` / `editRefund` / `removeRefund`: `SELECT ... FOR UPDATE` the target Expense plus the sum of its existing Refunds; reject if the new total exceeds the Expense's original `amount_cents`; adder-or-organizer check scoped to the original Expense's creator/any Organizer; never mutate the Expense's own `amount_cents` or Description.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6_
  - [x] 5.8 Listing, balances, and export
    - `listExpensesAndSettlements(tripId, filters)` (Category/Payer filters, Date-ordered, Expenses+Settlements merged); `getNetBalances(tripId)` / `getPairwiseBalances(tripId)` (assemble `BalanceEvent[]` resolving every Trip_Guest share onto its sponsor, delegate to `balances.ts`); `getBalanceDrillDown(tripId, memberId)`; `exportLedgerCsv(tripId)` (Guest attributions resolved to `"Sponsor — Guest_Name"`).
    - _Requirements: 2.7, 2.8, 6.1, 6.2, 6.3, 6.4, 6.5, 7.6, 13.1, 13.3_
  - [x] 5.9 Lifecycle preservation and cascade
    - No code change expected here — this task is the explicit verification that a departed Trip_Member's rows (FK'd to `users(id)`, never to `trip_memberships`) and a deleted Trip's rows (cascading via `trips(id)`) behave per Requirements 8.5/8.6 by construction. Write the integration tests in task 5.11 that prove it; if either fails, fix the migration's FK target, not the repo.
    - _Requirements: 8.5, 8.6_
  - [x] 5.10 Catalog restaurant/Resort link reads
    - In `createExpense`/`editExpense`: when `experienceId` is submitted, verify it references a Restaurant_Experience in the Catalog (`category = 'Restaurant'`) with a plain `pool.query` against `experiences`; when `resortId` is submitted, verify it exists in `resorts`; reject either referencing a nonexistent or wrong-category entity with `trip_validation_failed`. Store the link as informational only — no behavior keys off it on read.
    - _Requirements: 11.1, 11.2, 11.5, 11.6, 11.8_
  - [x] 5.11 Repo integration tests (pg-mem)
    - One test file per concern area under `apps/api/src/services/tripExpenses/__tests__/`: Expense creation per Split_Mode reading back real computed shares; the `EXPENSE_LIMIT` row-lock cap; `editExpense`'s Split_Mode-change reset (assert no stale child rows survive a mode switch — this is the regression this repo's steering specifically flags); `removeTripGuest`'s in-use rejection against real referencing rows; Settlement/Refund creation and bound rejection; the former-Member-preserved and Trip-deleted-cascades cases from task 5.9; the restaurant/Resort link rejecting a non-restaurant/nonexistent reference.
    - _Requirements: 1.12, 2.9, 7.4, 8.3, 8.4, 8.5, 8.6, 11.5, 12.2_

- [x] 6. Checkpoint — repo complete
  - Run `npx vitest run apps/api/src/services/tripExpenses/__tests__/`. All pg-mem integration tests and the pure-module tests from task 4 must be green before wiring routes.
  - _Requirements: 1.12, 8.3, 8.6_

- [x] 7. Routes, notifications, and composition wiring
  - [x] 7.1 `apps/api/src/services/tripExpenses/events.ts`
    - `ExpenseAffectedNotice` exactly as specified in design.md.
    - _Requirements: 1.9, 1.10_
  - [x] 7.2 `apps/api/src/services/tripExpenses/routes.ts`
    - `tripExpenseRoutes(options): FastifyPluginAsync` taking `pool`, `repo: TripExpenseRepo`, `requireSession`, and the `emitExpenseAffected` dispatch port. Routes: `POST/PATCH/DELETE /trips/:id/expenses`, `POST/PATCH/DELETE /trips/:id/expenses/:expenseId/refunds`, `POST/PATCH/DELETE /trips/:id/guests`, `POST/PATCH/DELETE /trips/:id/settlements`, `GET /trips/:id/expenses` (list, with query-param filters), `GET /trips/:id/balances`, `GET /trips/:id/balances/:memberId/drilldown`, `GET /trips/:id/expenses/export`. Every route: `requireSession` → `assertTripMember`/`assertTripOrganizer` as appropriate → repo call → response. After a committed `createExpense`/`editExpense` that affects other Members, call `emitExpenseAffected` (fire-and-forget, not awaited).
    - _Requirements: 1.7, 1.9, 1.10, 2.4, 2.10, 7.5, 8.1, 10.1, 10.2, 10.4, 12.6, 13.1, 13.3, 13.4_
  - [x] 7.3 Wire `composeServices.ts`
    - `const tripExpenseRepo = createTripExpenseRepo(pool);` (no injected deps needed). Add the `emitExpenseAffected` dispatch closure, mirroring `emitTripInviteCreated` exactly (fire-and-forget `.catch` logging). Register `tripExpenseRoutes({ pool, repo: tripExpenseRepo, requireSession, emitExpenseAffected })`.
    - _Requirements: 1.9, 1.10_
  - [x] 7.4 Add `trip_validation_failed`/`trip_forbidden` usage audit
    - No new error codes are needed — confirm every rejection path in tasks 5 and 7 uses one of the two existing codes already in `packages/shared/src/errors.ts`; this task is a review pass, not new code.
    - _Requirements: all Req 1–14 rejection paths_
  - [x] 7.5 Route integration tests
    - `server.inject` against a `Proxy`-based fake `TripExpenseRepo` (mirroring `routes.reservations.test.ts`): the membership gate on every route; the adder-or-organizer gate on edit/remove for Expense, Settlement, Refund, Guest; a happy-path create per Split_Mode returning the expected DTO; a validation-failure path per Split_Mode; the export route; and an assertion that `emitExpenseAffected` fires with the correct `affectedMemberIds` on both creation and an amount-changing edit, and does not fire on an edit that changes nothing about who owes what.
    - **Property 10: Expense and Settlement authorization matches the adder-or-organizer rule.**
    - _Requirements: 1.9, 1.10, 8.1, 10.1, 10.2, 10.4, 12.5, 12.6_
  - [x] 7.6 Notification/feed exclusion test
    - Assert `GET /trips/:id/feed` and `GET /trips/:id/summary` payloads contain no Expense, Settlement, Refund, or balance data, per Requirement 10.3.
    - _Requirements: 10.3_

- [x] 8. Checkpoint — backend complete
  - Run `npm run verify:api`. Confirm the `src/services/planning/**` coverage threshold is unaffected (this plan adds no planning code).
  - _Requirements: 1.9, 8.3, 10.2_

- [x] 9. Mobile hub wiring and navigation
  - [x] 9.1 Register routes
    - Add `TripExpenses: { tripId: string }` and `TripBalances: { tripId: string }` to `TripsStackParamList` and the `<Stack.Screen>` registrations in `apps/mobile/src/navigation/TripsStack.tsx`.
    - _Requirements: 10.1_
  - [x] 9.2 Add the hub section
    - Add `'TripExpenses'` to `HubSection['route']` and an `expenses` entry to `HUB_SECTIONS` in `TripDetailScreen.tsx`, with `testID="trip-detail-section-expenses"`. Deliberately update `tripStructureRegression.test.tsx`'s snapshot in the same change.
    - _Requirements: 10.1_

- [x] 10. Mobile ledger screen and manual Expense entry
  - [x] 10.1 TanStack Query keys and API client functions
    - `tripExpenseKeys.list(tripId)`, `.balances(tripId)`, `.drilldown(tripId, memberId)`; client functions for every route from task 7.2.
    - _Requirements: 10.1_
  - [x] 10.2 `TripExpensesScreen.tsx` — ledger list & integrated balances
    - `ScreenContainer` + `GradientHeader` + Segmented tab toggle between 'Expenses' and 'Who Owes What'. On Expenses tab: Balance Overview Hero Card (user's net position, direct debts, Log Payment action); Category and Payer filter chips; Expense and Settlement cards with personal share indicator (lent / owe / not involved) and expandable split breakdown. On Who Owes What tab: Simplified pairwise debts with one-tap Settle action, per-member net balances with drilldown navigation.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 7.6, 10.5, 13.1, 13.2_
  - [x] 10.3 Add-Expense modal — `exact` and `even` modes
    - Payer picker (defaults to the current member), Description, Date (via interactive `DatePickerField` calendar control), Category, Split_Mode selector. `exact`: per-person amount fields. `even`: participant checkboxes (Payer included by default, removable per Req 3.3), live preview of each computed share.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.13, 3.1, 3.2, 3.3, 3.6_
  - [x] 10.4 Add-Expense modal — `tiered` mode
    - Tier builder (name + per-unit price, quantity & subtotal summary per tier). Per-participant Tier_Count entry with stepper controls (`-` / `+`) and live participant subtotal preview. Real-time auto-calculation of Total Amount from tiers × counts, auto-populating Amount with optional extra fees adjustment. Loading/seeding of `tierCounts` on edit so existing tiered counts and totals are preserved.
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_
  - [x] 10.5 Add-Expense modal — `itemized` mode (manual entry)
    - Item rows (name + price), per-item Assignee multi-select with the "everyone on this expense" one-tap control (Req 5.5), Charge_Line rows (kind, amount-or-percentage-for-gratuity per Req 5.9, scope selector, "exclude alcohol items" toggle for `discount` per Req 14.2), per-item `isAlcohol` toggle (Req 14.1), live-computed derived Amount and per-person totals.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13, 5.14, 14.1, 14.2, 14.4_
  - [x] 10.6 Edit-Expense modal and Split_Mode-change UX
    - Reuses the task 10.3–10.5 mode-specific forms seeded from the existing Expense; switching Split_Mode in the edit form clears the previously-entered mode's fields and requires the new mode's fields to be filled before saving (mirrors Req 8.3's server-side reset).
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 10.7 Remove-Expense and Refund UI
    - Remove action gated to the Expense's creator or an Organizer (hidden otherwise). A "Record a Refund" action on an Expense's detail view, showing the running Refund total and the resulting effective Amount (Req 12.4's "Hotel deposit: $300, Refunded: $50, Net: $250" presentation).
    - _Requirements: 8.1, 12.1, 12.4, 12.5_
  - [x] 10.8 Component tests
    - `TripExpensesScreen.test.tsx` with `@testing-library/react-native`, mocking only the network layer: render real ledger data; drive **every** interactive flow — add an Expense in each of the four Split_Modes (asserting the exact POST body per mode), edit (asserting PATCH body, including a Split_Mode change), remove, filter by Category and by Payer, record a Refund (asserting the POST body and the on-screen "Net: $X" update) — asserting both the network call and the resulting on-screen change for each.
    - _Requirements: 1.1, 3.1, 3.3, 4.1, 5.1, 5.5, 5.9, 8.1, 8.3, 12.1, 12.4, 13.1_

- [x] 11. Mobile Trip_Guest management
  - [x] 11.1 Trip_Guest roster UI
    - A guest-management surface (reached from the Add-Expense modal's participant pickers and from a dedicated "Manage Guests" entry on `TripExpensesScreen`): add a Guest with a name and sponsor selector (defaulting to the adding member), rename/reassign sponsor, remove (disabled/explained when the Guest is still referenced by an Expense).
    - _Requirements: 2.1, 2.2, 2.3, 2.9, 2.10, 2.11, 2.12_
  - [x] 11.2 Guest display in balances and shares
    - Every place a recipient is shown (share rows, balance drill-down) renders a Guest as "Sponsor's name — Guest_Name" per Req 2.8.
    - _Requirements: 2.8_
  - [x] 11.3 Component tests
    - `TripGuestManagement.test.tsx` (or folded into `TripExpensesScreen.test.tsx`): add with sponsor mapping, rename/reassign, remove flows, and the removal-blocked-while-in-use case with the explanatory message.
    - _Requirements: 2.1, 2.2, 2.9, 2.10, 2.11, 2.12_

- [x] 12. Mobile Balances screen and Settlements
  - [x] 12.1 `TripBalancesScreen.tsx` — Net_Balance view
    - `Card`-per-member list of `NetBalanceDTO`, signed amount with clear "owed to them" / "they owe" framing, `0` shown explicitly for no-activity members. Toggle to the pairwise view (`PairwiseBalanceDTO[]`).
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 12.2 Balance drill-down
    - Tapping a member opens their `BalanceDrillDownEntryDTO[]` list — every contributing Expense/Settlement with Description/counterparty, Date, and signed amount.
    - _Requirements: 6.4_
  - [x] 12.3 Record-Settlement flow
    - From a nonzero pairwise balance, an action pre-fills a Settlement form (Payer, Recipient, the simplified pairwise amount), adjustable before submitting; also reachable as a standalone "Record a Settlement" action for an unprompted/partial repayment.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_
  - [x] 12.4 Component tests
    - `TripBalancesScreen.test.tsx`: render real balance data; toggle to pairwise view; open a drill-down and assert its contents; record a Settlement from a pre-filled pairwise balance (asserting the POST body matches the pre-fill) and record one with an adjusted/partial amount; assert the resulting on-screen balance updates after each.
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 7.1, 7.3, 7.7_

- [x] 13. Checkpoint — manual-entry ledger complete
  - Run `npm run verify:mobile`, then `npm run verify:api` if any backend file changed since task 8. At this point the feature is fully usable end-to-end via manual entry; tasks 14–17 are additive enhancements (OCR, Catalog link, filtering/export/nudge) that do not change anything built so far.
  - _Requirements: 1.1, 5.1, 6.1, 7.1_

- [x] 14. On-device receipt OCR
  - [x] 14.1 Choose and install the OCR library
    - Add a maintained Expo/React Native wrapper around Apple Vision (iOS) / Google ML Kit (Android) text recognition (e.g. `expo-ocr-kit` or an equivalent) as an exact-pinned dependency in `apps/mobile/package.json`. Confirm it makes no network call at runtime (Req 9.7) before adopting it.
    - _Requirements: 9.1, 9.7_
  - [x] 14.2 `apps/mobile/src/screens/trips/receiptScan.ts` — pure parser
    - `parseReceiptText(rawText): { items, chargeLines, subtotalCents }` distinguishing item lines from subtotal/tax/gratuity/fee/discount lines by text pattern; `flagAlcoholCandidate(name): boolean` against a maintained term list; `matchMenuItemName(recognizedName, menuItemNames): string | null` for the Requirement 11.9/9.9 cross-check. No I/O, no React import.
    - _Requirements: 9.2, 9.6, 9.8, 9.9_
  - [x] 14.3 `apps/mobile/src/screens/trips/receiptScan.native.ts` — OCR call site
    - Capture/pick a photo via `expo-image-picker` (already a dependency), call the task 14.1 library, return raw recognized text to `parseReceiptText`. No photo is ever written to disk persistently or sent to any server (Req 9.1).
    - _Requirements: 9.1, 9.7_
  - [x] 14.4 Receipt-scan review screen/modal
    - Presents every draft Expense_Item and Charge_Line from `parseReceiptText` for confirm/edit/merge/split/delete and Assignee assignment before anything is submitted (Req 9.3); shows the detected subtotal as context only (Req 9.6); a pre-checked but editable `isAlcohol` suggestion per item (Req 9.8); falls back to empty manual itemized entry with no error when zero items are detected (Req 9.5); a "scan another photo" control appending a new photo's parsed results to the existing draft list rather than replacing it (Req 9.10), with per-photo subtotal/total detection (Req 9.11) and the ability to discard one photo's contribution before confirming (Req 9.12).
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.10, 9.11, 9.12_
  - [x] 14.5 Wire into the itemized Add-Expense modal
    - A "Scan Receipt" entry point from task 10.5's itemized form; confirming the review screen populates the same item/Charge_Line fields the manual form uses — the Trip_Service receives an identical request shape regardless of origin (Req 9.4).
    - _Requirements: 9.3, 9.4_
  - [x] 14.6 Tests
    - `apps/mobile/src/screens/trips/__tests__/receiptScan.test.ts` / `.prop.test.ts`: unit cases against a corpus of representative fixture text (a Disney table-service receipt with tax+gratuity, a quick-service receipt with a discount line, a multi-item gift-shop receipt); the lossless-partition and multi-photo-append properties, tagged `// Feature: trip-expenses, Property N: <title>`, ≥ 100 runs.
    - **Property 8: Receipt parsing partitions recognized text losslessly between items, charge lines, and ignored totals.**
    - **Property 9: Multi-photo Receipt_Scan append is order-independent for the final reviewed set.**
    - A component test for the review screen/modal (mocking the OCR call site, never the parser): asserts the draft list renders, editing/merging/deleting a draft item updates what gets submitted, the zero-items fallback message appears and allows manual entry, and scanning two photos then discarding one leaves exactly the kept photo's items.
    - _Requirements: 9.2, 9.3, 9.5, 9.6, 9.10, 9.11, 9.12_
  - [x] 14.7 Checkpoint
    - `npm run verify:mobile`.
    - _Requirements: 9.4, 9.7_

- [x] 15. Catalog restaurant/Resort link
  - [x] 15.1 Restaurant/Resort picker in the Add-Expense form
    - When Category is `dining`, offer `ExperiencePicker` with `defaultTab = 'dining'`, `showTabs={false}` (mirrors the `trip-reservations` precedent exactly); when Category is `hotel`, offer a Resort picker (reuse whatever existing Catalog Resort-browsing component is found during implementation, per design.md's note that this is a task-level choice). Linking pre-fills Description with the venue's name if empty (Req 11.3), remaining editable.
    - _Requirements: 11.1, 11.2, 11.3_
  - [x] 15.2 Tier-price suggestion from a linked restaurant's menu
    - For a `tiered` Expense linked to a restaurant with a cached menu (via the existing `restaurant-menu-display` Menu_Cache read, read-only), run a per-person-pricing-line matcher (e.g. "$X per adult" / "$X per child" pattern) and suggest pre-filled Expense_Tiers; member accepts/edits/discards before submission; nothing is persisted without explicit confirmation (Req 11.4, 11.5). Falls back to empty manual Tier entry with no error when no match is found (Req 11.6).
    - _Requirements: 11.4, 11.5, 11.6_
  - [x] 15.3 Menu item name cross-check during receipt review
    - In the task 14.4 review screen, when the itemized Expense is linked to a restaurant, call `matchMenuItemName` (task 14.2) per draft item and surface a suggested name correction without overwriting a member's own edit.
    - _Requirements: 9.9_
  - [x] 15.4 Tests
    - `TripExpensesScreen.test.tsx` additions: linking a restaurant pre-fills Description; the tier-suggestion flow populates and is editable before save; linking a Resort for a `hotel` Expense; no Catalog picker offered for `tickets`/`shopping`/`transportation`/`other` categories (Req 11.8).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 11.8_
  - [x] 15.5 Checkpoint
    - `npm run verify:mobile`.
    - _Requirements: 11.5_

- [x] 16. Filtering, export, and post-trip settle-up nudge
  - [x] 16.1 Export action
    - "Export" action on `TripExpensesScreen` calling the task 7.2 export route and opening the device share sheet with the resulting CSV (Req 13.3, 13.4).
    - _Requirements: 13.3, 13.4_
  - [x] 16.2 Post-trip settle-up banner
    - A `Card` banner on `TripExpensesScreen`, shown exactly when the Trip's `TripStatus` (from the existing `trips` feature) is `past` and at least one Trip_Member has a nonzero Net_Balance; links to `TripBalancesScreen`; hidden once every balance is zero.
    - _Requirements: 13.2_
  - [x] 16.3 Tests
    - `TripExpensesScreen.test.tsx` additions: the export action triggers the request and the share sheet; the settle-up banner appears for a past Trip with nonzero balances and is absent both for an active Trip and for a past Trip with all-zero balances.
    - _Requirements: 13.2, 13.3_

- [x] 17. Final checkpoint and verification gate
  - Re-read the full diff adversarially for stubs, unrealistic fixtures, and uncovered branches (especially: every Split_Mode's happy and rejection paths, the alcohol-exclusion branch, the Split_Mode-change reset, the multi-photo append/discard paths, and the Trip_Guest rollup). Produce the behavior→test map covering every row in this plan's tasks. Then run the full `npm run verify` **once** and confirm exit code `0` with per-workspace test counts for `apps/api`, `apps/mobile`, and `packages/shared`.
  - _Requirements: all_
  - **Independently re-verified** (not from the implementer's self-report, which contained fabricated details): migration 0060, shared schemas/DTOs, pure allocation/itemizedTotals/balances modules, repo.ts, routes.ts, composeServices.ts wiring, mobile screens/modals for all 4 Split_Modes, Trip_Guest management, Balances/Settlement flows, on-device OCR parser + native call site + property tests, Catalog restaurant/Resort link, export/settle-up banner were all read directly from source and confirmed to match design.md and requirements.md. `npm run verify` was re-run independently: exit code 0, `apps/api` 411 test files passed, `apps/mobile` 251 test suites / 1728 tests passed, `packages/shared` 37 test files / 468 tests passed.

- [x] 18. Pairwise Transaction Breakdown and Layout Polish
  - [x] 18.1 Backend support for pairwise drilldown filter
    - In `apps/api/src/services/tripExpenses/repo.ts` and `routes.ts`, support optional `counterpartyId` query parameter on `getBalanceDrillDown` (`GET /trips/:id/balances/:memberId/drilldown?counterpartyId=...`). When provided, filter balance events to only those where `counterpartyId === counterpartyParam`.
    - _Requirements: 6.4, 6.7_
  - [x] 18.2 Mobile API client and query keys
    - In `apps/mobile/src/screens/trips/tripExpenseApi.ts`, support `counterpartyId` in `tripExpenseKeys.drilldown` and `fetchBalanceDrillDown(tripId, memberId, counterpartyId)`.
    - _Requirements: 6.7_
  - [x] 18.3 UI implementation: Pairwise breakdown modal and visual polish
    - In `apps/mobile/src/screens/trips/TripExpensesScreen.tsx` (and `TripBalancesScreen.tsx`), provide a dedicated Pairwise Breakdown Modal showing the mutual member avatars and names, the exact pairwise balance, quick Log Payment action, and the list of mutual expenses and settlements. Make pairwise cards and hero debt items interactive with clear visual hints/taps. Polish pairwise cards so long names do not get clipped.
    - _Requirements: 6.7_
  - [x] 18.4 Tests
    - Add repo integration test in `repo.settlementsAndRefunds.integration.test.ts` for counterparty drilldown filtering, and component tests in `TripExpensesScreen.test.tsx` verifying tapping a pairwise card or hero debt row opens the mutual breakdown with expected mutual transactions.
    - **Property 13: Pairwise transaction breakdown preserves mutual balance consistency.**
    - _Requirements: 6.7_
  - [x] 18.5 Checkpoint and verification gate
    - Run `npm run verify` to confirm exit code 0 across all workspaces.
    - _Requirements: 6.7_

- [x] 19. Settlement Visual Distinction and Pairwise Debt Math Consistency
  - [x] 19.1 Contract and backend balance event attribution
    - Extend `BalanceDrillDownEntryDTO` and `BalanceEvent` with optional `payerId` and `recipientId`. Attach both during `buildBalanceEvents`.
    - _Requirements: 6.7_
  - [x] 19.2 Pairwise contribution signed convention
    - Update `getBalanceDrillDown` when filtered by `counterpartyId` so settlements paid reduce debt (`-`) and expense shares increase debt (`+`), ensuring the sum of drilldown entries matches the pairwise debt balance (`aOwesBCents`).
    - _Requirements: 6.7_
  - [x] 19.3 Mobile settlement card presentation and payment badges
    - In `TripExpensesScreen.tsx` and `TripBalancesScreen.tsx`, render settlements in the pairwise drilldown as dedicated payment cards with soft green styling, a payment badge (`[ Payment Received ]`), payer/recipient attribution, and emerald "Paid down" amount caption. Distinguish shared expense rows with "Added to debt" and attribution.
    - _Requirements: 6.7_
  - [x] 19.4 Tests
    - Update `repo.settlementsAndRefunds.integration.test.ts` to assert `mutualSum === 3000` matching `aliceBobPair.aOwesBCents` and assert `payerId`/`recipientId`. Update `TripExpensesScreen.test.tsx` and `TripBalancesScreen.test.tsx` to assert settlement card rendering and payment badge.
    - **Property 13: Pairwise transaction breakdown preserves mutual balance consistency.**
    - _Requirements: 6.7_
  - [x] 19.5 Verification gate
    - Run `npm run verify` across all workspaces to confirm clean exit code 0.
    - _Requirements: 6.7_

- [x] 20. Mobile UI Redesign: Streamlined Ledger, Scannable Expense Cards, and Polished Balances
  - [x] 20.1 Redesign Hero Balance Card on Expenses tab into a compact financial status capsule with single prominent Log Payment action
    - Streamline the top balance card from a heavy multi-button container into a sleek status capsule showing the user's net position, primary Log Payment action, and compact debt ticker link.
    - _Requirements: 10.5_
  - [x] 20.2 Redesign Expense Cards into scannable modern rows with category squircle, clear typography, and color-coded personal share badge/caption
    - Replace the 4-box vertical card stack with a modern scannable row (category squircle, title, date/payer, total amount, and color-coded personal share indicator) that cleanly expands to show participant breakdown, venue link, refund status, and actions.
    - _Requirements: 7.6, 10.5_
  - [x] 20.3 Redesign toolbar and filters: sleek primary Add Expense action, streamlined secondary Guests/Export buttons, and unified compact filter bar
    - Streamline the action buttons and horizontal filter strips to reduce vertical height and visual clutter.
    - _Requirements: 10.5, 13.1_
  - [x] 20.4 Redesign "Who Owes What" tab: modern transfer cards for simplified repayments and refined member net balances
    - Upgrade the direct repayments into clean, modern transfer cards with debtor/creditor flow, prominent amounts, and quick settle button; refine member net balance rows.
    - _Requirements: 6.5, 6.7, 7.6, 10.5_
  - [x] 20.5 Update component tests to verify redesigned elements while preserving all behavioral coverage
    - Run `apps/mobile` component tests, ensuring all interactive flows, testIDs, and assertions pass cleanly.
    - _Requirements: 10.5, 13.1_
  - [x] 20.6 Verification gate
    - Run `npm run verify` across all workspaces to confirm clean exit code 0.
    - _Requirements: all_

## Notes

- **New service, not an extension of `trips/repo.ts`.** `apps/api/src/services/tripExpenses/` is a sibling to `apps/api/src/services/trips/`, reusing only `assertTripMember`/`assertTripOrganizer` from `trips/authz.ts` by import. Do not add Expense/Settlement/Guest methods to `trips/repo.ts` itself.
- **No new error codes.** `trip_validation_failed` and `trip_forbidden` already exist in `packages/shared/src/errors.ts` and cover every rejection path in this plan. Do not add `trip_expense_*` or `trip_guest_*` codes.
- **The Payer's own share is never a stored row, in the DB or in any DTO.** Every Split_Mode computes it as `Amount − Σ(stored shares)`. If you find yourself inserting an `expense_shares` row for the Payer, stop — re-read design.md Key Decision 3.
- **`itemized` Expenses have no client-submitted `amountCents`.** The schema (task 1.2) must omit it as a required field for that mode, and the repo (task 5.3) always computes it from items + Charge_Lines. A route or screen that asks the user to type a total for an itemized Expense is a defect against Requirement 1.1/5.14, not an acceptable simplification.
- **On-device OCR makes zero network requests, ever.** If implementing task 14 pulls in a cloud vision SDK or API key, stop — re-read Requirement 9.7 and design.md's External Interfaces section. The receipt photo itself is never persisted or transmitted.
- **The Catalog link (task 15) is informational only.** Nothing about balance computation, Split_Mode validation, or allocation reads `experienceId`/`resortId` — removing the link or the linked Catalog entity being deactivated must never alter a stored share (Req 11.7). If a balance computation path ends up branching on whether an Expense is linked, that is a defect.
- **Verification tiers.** Use the single-file inner loop (`npx vitest run <path>` / `npx jest <file>`) while iterating; the scoped `verify:shared`/`verify:api`/`verify:mobile` at the checkpoints in tasks 2, 4, 6, 8, and 13; the full `npm run verify` exactly once at task 17.
- **Mobile tests are Jest; `apps/api`/`packages/shared` tests are Vitest.** Do not cross the two.
- **Open questions deliberately left out of scope** — do not implement without a spec amendment: real payment processing or money movement of any kind; multi-currency/FX; persisting the receipt photo; cloud-vision OCR; a curated prix-fixe price dataset independent of the synced menu text; per-Expense currency override.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.6"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3"] },
    { "id": 6, "tasks": ["3.4"] },
    { "id": 7, "tasks": ["4"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3", "5.10"] },
    { "id": 11, "tasks": ["5.4", "5.6", "5.7"] },
    { "id": 12, "tasks": ["5.5", "5.8", "5.9"] },
    { "id": 13, "tasks": ["5.11"] },
    { "id": 14, "tasks": ["6"] },
    { "id": 15, "tasks": ["7.1"] },
    { "id": 16, "tasks": ["7.2"] },
    { "id": 17, "tasks": ["7.3"] },
    { "id": 18, "tasks": ["7.4", "7.5", "7.6"] },
    { "id": 19, "tasks": ["8"] },
    { "id": 20, "tasks": ["9.1", "9.2"] },
    { "id": 21, "tasks": ["10.1"] },
    { "id": 22, "tasks": ["10.2"] },
    { "id": 23, "tasks": ["10.3", "10.4", "10.5"] },
    { "id": 24, "tasks": ["10.6", "10.7"] },
    { "id": 25, "tasks": ["10.8"] },
    { "id": 26, "tasks": ["11.1"] },
    { "id": 27, "tasks": ["11.2"] },
    { "id": 28, "tasks": ["11.3"] },
    { "id": 29, "tasks": ["12.1"] },
    { "id": 30, "tasks": ["12.2", "12.3"] },
    { "id": 31, "tasks": ["12.4"] },
    { "id": 32, "tasks": ["13"] },
    { "id": 33, "tasks": ["14.1"] },
    { "id": 34, "tasks": ["14.2"] },
    { "id": 35, "tasks": ["14.3", "14.4"] },
    { "id": 36, "tasks": ["14.5"] },
    { "id": 37, "tasks": ["14.6"] },
    { "id": 38, "tasks": ["14.7"] },
    { "id": 39, "tasks": ["15.1"] },
    { "id": 40, "tasks": ["15.2", "15.3"] },
    { "id": 41, "tasks": ["15.4"] },
    { "id": 42, "tasks": ["15.5"] },
    { "id": 43, "tasks": ["16.1", "16.2"] },
    { "id": 44, "tasks": ["16.3"] },
    { "id": 45, "tasks": ["17"] },
    { "id": 46, "tasks": ["18.1", "18.2"] },
    { "id": 47, "tasks": ["18.3"] },
    { "id": 48, "tasks": ["18.4"] },
    { "id": 49, "tasks": ["18.5"] },
    { "id": 50, "tasks": ["19.1", "19.2"] },
    { "id": 51, "tasks": ["19.3"] },
    { "id": 52, "tasks": ["19.4"] },
    { "id": 53, "tasks": ["19.5"] },
    { "id": 54, "tasks": ["20.1", "20.2", "20.3", "20.4"] },
    { "id": 55, "tasks": ["20.5"] },
    { "id": 56, "tasks": ["20.6"] }
  ]
}
```

- Tasks 1.1–1.6 are the contract layer; nothing in `apps/api` or `apps/mobile` can import `tripExpenses` shared types until task 1 lands.
- Task 3 (pure allocation/balance math) has zero DB dependency and could in principle start alongside task 1, but is sequenced after it here because `itemizedTotals.ts`'s types (`ItemizedLineItem`, `ChargeLineInput`) are easiest to keep aligned with the shared DTOs if the shared contracts land first; a team working in parallel may safely start task 3 immediately using design.md's signatures without waiting.
- Task 5 (repo) depends on both task 2 (contracts) and task 4 (pure modules, which it wraps rather than reimplements).
- Task 9 (mobile hub wiring) and task 10.1 (query keys/client functions) only need the backend's wire shapes (task 2), not a running backend, so mobile work can begin as soon as contracts land and proceed against a mocked network layer in parallel with tasks 5–8; however, this plan sequences task 9 after task 8 for a cold-start executor since the component tests in task 10.8 onward assert against the real request/response shapes task 7 produces.
- Tasks 14 (OCR) and 15 (Catalog link) are both strictly additive on top of task 13's complete manual-entry ledger and have no dependency on each other; they may be built in either order or in parallel, which is why both are sequenced after task 13 rather than interleaved earlier.
