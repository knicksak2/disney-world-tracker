# Design Document

## Overview

Trip Expenses is a new, self-contained sibling service to `trips` — a new service folder (`apps/api/src/services/tripExpenses/`), seven new tables, and a new section of the existing Trip_Detail_View hub. Unlike `trip-reservations` (which overlaid a facet onto an existing row), this feature's data has no existing table to extend: an Expense, its Shares, and a Settlement are genuinely new entities with their own lifecycle, so a new service is the better fit than growing `trips/repo.ts` further. The new service reuses `trips`' authorization primitives (`assertTripMember`, `assertTripOrganizer` from `services/trips/authz.ts`) directly rather than duplicating them, and is deleted via the same cascade that deletes a Trip (R3.7) — no new deletion code is required at all, because every new table's foreign key to `trips(id)` carries `ON DELETE CASCADE`.

### Key design decisions

1. **A new sibling service, not an extension of `trips/repo.ts`.** `trips/repo.ts` is already large (~4800 lines) and governs a different cluster of concerns (membership, invites, planned items, log entries, feed). Expenses introduce seven new tables and a materially different domain (money, proportional allocation, derived balances) that benefits from its own pure-domain module separated from I/O, per this repo's service-shape convention. The new service still answers to the same Trip membership gate, so nothing about Trip authorization is duplicated or forked.

2. **Net_Balance and the proportional-allocation math are pure, derived, and never stored.** `balances.ts` and `itemizedAllocation.ts` are pure functions over Expense/Share/Settlement rows with no I/O, so the zero-cent-remainder rules (Req 3.4, 5.10, 5.14) and the zero-sum invariant (Req 6.6) are property-testable directly, independent of Postgres. This mirrors `trips/summary.ts` and `trips/permissions.ts`'s existing pure-module pattern.

3. **The Payer's own share is never a stored row.** Every Split_Mode computes the Payer's implicit portion as `Amount − Σ(stored shares)` rather than writing a self-referential Expense_Share. This was already specified in Requirements 3–5; the design keeps it that way end-to-end (DB, repo, DTO) rather than materializing a convenience row, because a materialized Payer-share would double-count in Requirement 6.6's zero-sum property unless specifically excluded, which is a bug waiting to happen. Leaving it implicit means the invariant holds by construction.

4. **`itemized` Split_Mode's Amount is derived, not submitted (Req 1.1, 5.14).** This is the one place this design departs from a uniform "Expense has an Amount field" shape: for `itemized`, the repo computes `Amount = Σ(Expense_Item.price) + Σ(Charge_Line.amount)` inside the same transaction that persists the items and charge lines, and that is what gets stored in `expenses.amount_cents`. This keeps the receipt itself as the single source of truth rather than asking the member to separately type a total that could drift from what they itemized.

5. **A Trip_Guest is a label, not an account.** `trip_guests` has no relationship to `users` at all — it is purely `(id, trip_id, sponsor_member_id, name)`. Every balance computation resolves a Guest's shares onto its sponsor before any aggregation happens (Req 2.7), so `balances.ts` never has to reason about "a balance held by a non-login entity" — by the time balances are computed, there are only Trip_Member balances.

6. **Charge_Line proportional allocation and Refund proportional allocation share one allocation primitive.** Both "spread this tax/gratuity/discount across people proportional to their item subtotals" (Req 5.10–5.11) and "spread this refund back across people proportional to their original share" (Req 12.3) are the same mathematical operation: distribute a signed integer-cent amount across a set of (recipient, weight) pairs so the parts sum exactly to the whole, assigning leftover cents deterministically. One pure function, `allocateProportionally`, backs both, so there is exactly one rounding rule to test and reason about rather than two that could silently diverge.

7. **On-device OCR and its parsing are entirely client-side; the server never knows a scan happened.** Per Requirement 9.4 and 9.7, there is no field, column, or endpoint distinguishing a Receipt_Scan-originated Expense_Item from a typed one. The API's `itemized` Expense endpoint accepts exactly the same `items`/`chargeLines` shape regardless of origin. This keeps the backend simple and means the OCR parser (`receiptParser.ts`) and the menu-based tier/name-suggestion matcher are both mobile-only pure modules with no server counterpart.

8. **Alcohol exclusion is manual, per-item, per-discount — never inferred from Category or any other signal (Req 14.3).** `isAlcohol` is a plain boolean on `expense_items`, defaulting false, settable by the member regardless of entry method. The repo has no alcohol-detection logic of its own; a maintained term list lives client-side only, as a suggestion.

## Architecture

### Placement

| Concern | Location |
| --- | --- |
| Tables, constraints, indexes | `apps/api/migrations/0060_trip_expenses.sql` |
| Enums, Zod schemas, DTOs | `packages/shared/src/tripExpenses.ts` (new sibling file to `trips.ts`), vocab constants in `packages/shared/src/enums.ts` |
| Pure allocation/balance math | `apps/api/src/services/tripExpenses/allocation.ts`, `apps/api/src/services/tripExpenses/balances.ts` |
| DB access, transactions | `apps/api/src/services/tripExpenses/repo.ts` |
| Fastify routes | `apps/api/src/services/tripExpenses/routes.ts` |
| Wiring | `apps/api/src/composeServices.ts` (new `createTripExpenseRepo(pool)` + `tripExpenseRoutes({...})` registration; reuses `trips`' `assertTripMember`/`assertTripOrganizer`, no new injected ports) |
| Notifications | `apps/api/src/services/tripExpenses/events.ts` (notice types) + two new `composeServices.ts` dispatch closures mirroring `emitTripInviteCreated` |
| Expenses/Balances screens | `apps/mobile/src/screens/trips/TripExpensesScreen.tsx`, `TripBalancesScreen.tsx` |
| On-device OCR + parsing | `apps/mobile/src/screens/trips/receiptScan.ts` (pure parser), `apps/mobile/src/screens/trips/receiptScan.native.ts` (OCR library call site) |
| Hub entry + route registration | `apps/mobile/src/screens/trips/TripDetailScreen.tsx`, `apps/mobile/src/navigation/TripsStack.tsx` |

`tripExpenseRoutes` takes `pool`, `repo: TripExpenseRepo`, and the same `requireSession` pre-handler every other Trip route uses — no cross-feature port is required because the restaurant/Resort link (Requirement 11) only needs a read against the existing `experiences`/`resorts` tables, done with a plain `pool.query` inside `tripExpenses/repo.ts` rather than a dependency on `catalog`'s repo (consistent with how `trips/repo.ts` already does its own lightweight catalog existence checks for Planned_Items rather than importing the Catalog_Service).

### Service shape

Following the existing `services/<name>/` convention: `tripExpenses/` has `allocation.ts` and `balances.ts` (pure, no I/O — the property-test surface), `repo.ts` (DB access via `createTripExpenseRepo(pool): TripExpenseRepo`, a factory returning a plain object of methods, matching `createTripRepo`'s shape), `routes.ts` (a Fastify plugin factory `tripExpenseRoutes(options): FastifyPluginAsync`), and `events.ts` (notice types for notification dispatch, matching `trips/events.ts`).

### Expenses and Balances screen architecture

Two mobile screens reached from the new hub tile:

- `TripExpensesScreen` (the Expense_Ledger_Screen) — lists Expenses and Settlements interleaved by Date (Req 7.6), with Category/Payer filter controls (Req 13.1) and the post-trip settle-up banner (Req 13.2). Backed by one query, `tripExpenseKeys.list(tripId)` → `readonly (ExpenseDTO | SettlementDTO)[]`.
- `TripBalancesScreen` (the Balances_View) — renders `NetBalanceDTO[]` (one per Trip_Member) from `tripExpenseKeys.balances(tripId)`, with the per-member drill-down (Req 6.4) and the pairwise simplified view toggle (Req 6.5), and the "record a settlement" action pre-filled from a pairwise balance (Req 7.7).

Both screens' data is a GET off the same new service; a mutation (`POST`/`PATCH`/`DELETE` on an Expense or Settlement) invalidates both query keys together, since every mutation can change both the ledger list and every Net_Balance.

## Components and Interfaces

### Pure domain modules (the PBT surface)

#### `apps/api/src/services/tripExpenses/allocation.ts`

```ts
/** One (recipientId, weight) pair to receive a proportional slice of a signed integer-cent amount. */
export interface AllocationTarget {
  readonly recipientId: string;
  readonly weight: number; // non-negative; e.g. an Item_Subtotal or an original Expense_Share amount
}

/**
 * Distribute `totalCents` (may be negative, e.g. a discount or Refund) across
 * `targets` in proportion to each target's weight, in integer cents, such
 * that the returned amounts sum to exactly `totalCents`. Each target's base
 * share is `round(totalCents * weight / sum(weights))`; the remainder
 * (`totalCents - sum(base shares)`) is distributed one cent at a time, in
 * `targets` array order, to make the total exact. Returns an empty array
 * when `targets` is empty or `sum(weights)` is zero (the caller is expected
 * to route the full `totalCents` to the Payer's implicit portion in that
 * case). This single primitive backs both Charge_Line allocation (Req 5.10,
 * 5.11) and Refund distribution (Req 12.3) so there is one rounding rule.
 *
 * Validates: Requirements 5.9, 5.10, 5.11, 12.3.
 */
export function allocateProportionally(
  totalCents: number,
  targets: readonly AllocationTarget[],
): readonly { recipientId: string; amountCents: number }[];

/**
 * Split `priceCents` evenly in integer cents across `assigneeIds`, assigning
 * the base `floor(priceCents / assigneeIds.length)` to everyone and the
 * remainder one cent at a time in array order (Req 3.4, 5.4). Degenerates to
 * `[{ assigneeId: assigneeIds[0], amountCents: priceCents }]` for a
 * single-assignee input (Req 5.3).
 *
 * Validates: Requirements 3.4, 3.5, 5.3, 5.4.
 */
export function splitEvenly(
  priceCents: number,
  assigneeIds: readonly string[],
): readonly { assigneeId: string; amountCents: number }[];
```

#### `apps/api/src/services/tripExpenses/itemizedTotals.ts`

```ts
/** One Expense_Item as persisted/submitted, pre-Charge_Line. */
export interface ItemizedLineItem {
  readonly id: string;
  readonly priceCents: number;
  readonly assigneeIds: readonly string[]; // Trip_Member or Trip_Guest ids, already resolved past sponsorship
  readonly isAlcohol: boolean;
}

/** One Charge_Line as submitted. */
export interface ChargeLineInput {
  readonly kind: 'tax' | 'gratuity' | 'fee' | 'discount';
  readonly amountCents: number; // negative for discount, positive otherwise
  readonly scopeItemIds?: readonly string[]; // undefined = whole-expense scope
  readonly excludeAlcohol?: boolean; // only meaningful for a whole-expense discount
}

/**
 * Compute every recipient's final itemized Expense_Share amount and the
 * Expense's derived total Amount, from Expense_Items and Charge_Lines alone
 * (Req 5.6, 5.9–5.15). Pipeline:
 *   1. `splitEvenly` each item's price across its assignees → each
 *      recipient's Item_Subtotal (sum across every item naming them).
 *   2. For each Charge_Line, resolve its scope (whole-expense minus
 *      `isAlcohol` items when `excludeAlcohol`, or the explicit
 *      `scopeItemIds`), build `AllocationTarget[]` from that scope's
 *      recipients weighted by their Item_Subtotal within the scope, and run
 *      `allocateProportionally`.
 *   3. Sum each recipient's Item_Subtotal plus every applicable Charge_Line
 *      contribution → their final Expense_Share amount.
 *   4. The Payer's own implicit portion and the derived Amount are the
 *      remainder: `Amount = Σ(item.priceCents) + Σ(chargeLine.amountCents)`,
 *      `payerPortion = Amount - Σ(final Expense_Share amounts)`, which this
 *      function asserts is always exactly correct by construction (never a
 *      user-facing check — Req 5.15).
 * Throws on a `scopeItemIds` referencing an unknown item id, or a Charge_Line
 * whose scope resolves to zero recipients (Req 5.11).
 *
 * Validates: Requirements 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15.
 */
export function computeItemizedTotals(
  items: readonly ItemizedLineItem[],
  chargeLines: readonly ChargeLineInput[],
): {
  readonly amountCents: number; // derived Expense.amountCents
  readonly shares: readonly { recipientId: string; amountCents: number }[];
  readonly payerImplicitCents: number;
};
```

#### `apps/api/src/services/tripExpenses/balances.ts`

```ts
/** One ledger contribution to a Trip_Member's running balance. */
export interface BalanceEvent {
  readonly kind: 'expense_payer' | 'expense_share' | 'settlement_paid' | 'settlement_received';
  readonly memberId: string; // already resolved past Trip_Guest sponsorship (Req 2.7)
  readonly amountCents: number; // always positive; sign is implied by `kind`
  readonly counterpartyId: string | null; // the other party, for the pairwise view / drill-down
  readonly sourceId: string; // Expense or Settlement id, for the drill-down (Req 6.4)
  readonly description: string;
  readonly date: string; // YYYY-MM-DD
  readonly payerId?: string;
  readonly recipientId?: string;
}

/**
 * Reduce a Trip's full event stream into each Trip_Member's Net_Balance
 * (Req 6.1, 6.2) — `expense_payer` and `settlement_paid` are positive
 * contributions, `expense_share` and `settlement_received` are negative. Every
 * Trip_Member who appears in at least one event is present in the result,
 * reporting exactly `0` for a Member with perfectly offsetting activity or
 * (by the caller including every Trip_Member id, not just those with
 * activity) a Member with none at all (Req 6.3).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.6.
 */
export function computeNetBalances(
  events: readonly BalanceEvent[],
  allMemberIds: readonly string[],
): ReadonlyMap<string, number>; // memberId -> net balance in cents; always sums to exactly 0

/**
 * Derive the simplified pairwise amount for every pair of Trip_Members with a
 * nonzero mutual balance (Req 6.5): for each pair, net every `expense_share`
 * contribution where one is the counterparty of the other's `expense_payer`
 * event (and vice versa) plus every Settlement between them, into one signed
 * amount describing what A owes B (or B owes A) if they settled directly.
 * Omits a pair whose net is exactly zero.
 *
 * Validates: Requirement 6.5.
 */
export function computePairwiseBalances(
  events: readonly BalanceEvent[],
): readonly { memberIdA: string; memberIdB: string; aOwesB: number }[]; // aOwesB negative means B owes A
```

### Shared contracts (`@dwt/shared`)

```ts
// enums.ts — additions
export const EXPENSE_SPLIT_MODES = ['exact', 'even', 'tiered', 'itemized'] as const;
export type ExpenseSplitMode = (typeof EXPENSE_SPLIT_MODES)[number];

export const EXPENSE_CATEGORIES = ['hotel', 'tickets', 'dining', 'shopping', 'transportation', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CHARGE_LINE_KINDS = ['tax', 'gratuity', 'fee', 'discount'] as const;
export type ChargeLineKind = (typeof CHARGE_LINE_KINDS)[number];

// tripExpenses.ts — new sibling file to trips.ts
export const EXPENSE_AMOUNT_MAX_CENTS = 10_000_000; // $100,000.00 (Req 1.3)
export const EXPENSE_LIMIT = 1_000; // per-Trip cap (Req 1.12)
export const GUEST_NAME_MAX = 100; // (Req 2.2)
export const EXPENSE_DESCRIPTION_MAX = 200; // (Req 1.5)
export const EXPENSE_TIER_NAME_MAX = 40; // (Req 4.1)
export const EXPENSE_ITEM_NAME_MAX = 100; // (Req 5.1)

export const expenseCreateSchema = z.object({
  payerId: uuidSchema,
  description: z.string().trim().min(1).max(EXPENSE_DESCRIPTION_MAX),
  date: tripCalendarDateSchema, // reused from trips.ts; no Trip-range restriction (Req 1.11)
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  splitMode: z.enum(EXPENSE_SPLIT_MODES),
  experienceId: uuidSchema.optional(), // Req 11.1, only meaningful with category 'dining'
  resortId: uuidSchema.optional(),     // Req 11.2, only meaningful with category 'hotel'
  // exactly one of the following, enforced by a discriminated superRefine on splitMode:
  amountCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS).optional(), // required for exact/even/tiered; absent/ignored for itemized
  shares: z.array(expenseShareInputSchema).optional(),       // exact
  participantIds: z.array(uuidSchema).optional(),            // even
  tiers: z.array(expenseTierInputSchema).optional(),         // tiered
  tierCounts: z.array(expenseTierCountInputSchema).optional(),// tiered
  items: z.array(expenseItemInputSchema).optional(),         // itemized
  chargeLines: z.array(chargeLineInputSchema).optional(),    // itemized
}).strict();
// .superRefine enforces: splitMode-specific required fields present, others absent;
// itemized requires >=1 item (Req 5.7) and omits amountCents (Req 1.1, 1.4);
// exact/even/tiered require amountCents (Req 1.1, 1.4).

export const expenseEditSchema = expenseCreateSchema; // same shape; a Split_Mode change
  // triggers the full-reset rule (Req 8.3) in the repo, not in the schema.

export const settlementCreateSchema = z.object({
  payerId: uuidSchema,
  recipientId: uuidSchema,
  amountCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS),
  date: tripCalendarDateSchema,
}).strict().refine((v) => v.payerId !== v.recipientId, { message: 'trip_validation_failed' });

export const tripGuestAddSchema = z.object({
  name: z.string().trim().min(1).max(GUEST_NAME_MAX),
  sponsorMemberId: uuidSchema.optional(),
}).strict();

export const tripGuestRenameSchema = z.object({
  name: z.string().trim().min(1).max(GUEST_NAME_MAX),
  sponsorMemberId: uuidSchema.optional(),
}).strict();

export const refundCreateSchema = z.object({
  amountCents: z.number().int().positive(),
  date: tripCalendarDateSchema,
}).strict();

// DTOs (types only, matching the trips.ts convention of plain interfaces for reads)
export interface ExpenseDTO {
  readonly id: string;
  readonly tripId: string;
  readonly payerId: string;
  readonly createdByUserId: string;
  readonly amountCents: number; // derived for itemized, stored for others
  readonly description: string;
  readonly date: string;
  readonly category: ExpenseCategory | null;
  readonly splitMode: ExpenseSplitMode;
  readonly experienceId: string | null;
  readonly resortId: string | null;
  readonly shares: readonly ExpenseShareDTO[];
  readonly tiers: readonly ExpenseTierDTO[]; // only populated for tiered
  readonly tierCounts?: readonly ExpenseTierCountDTO[]; // populated for tiered
  readonly items: readonly ExpenseItemDTO[]; // only populated for itemized
  readonly chargeLines: readonly ChargeLineDTO[]; // only populated for itemized
  readonly refunds: readonly RefundDTO[];
  readonly createdAt: string;
}
export interface ExpenseShareDTO {
  readonly memberId: string | null; // null when attributed to a Trip_Guest
  readonly guestId: string | null;  // null when attributed to a Trip_Member directly
  readonly amountCents: number;
}
// ExpenseTierDTO, ExpenseItemDTO, ChargeLineDTO, RefundDTO, SettlementDTO, TripGuestDTO: analogous plain shapes.

export interface NetBalanceDTO {
  readonly memberId: string;
  readonly netCents: number; // positive = owed to them, negative = they owe
}
export interface PairwiseBalanceDTO {
  readonly memberIdA: string;
  readonly memberIdB: string;
  readonly aOwesBCents: number; // negative means B owes A
}
export interface BalanceDrillDownEntryDTO {
  readonly kind: 'expense' | 'settlement';
  readonly sourceId: string;
  readonly description: string;
  readonly date: string;
  readonly contributionCents: number; // signed: from Member's net balance perspective; or pairwise debt perspective when counterpartyId is filtered
  readonly payerId?: string;
  readonly recipientId?: string;
}
```

### Trip_Expense repo (`services/tripExpenses/repo.ts`)

Factory `createTripExpenseRepo(pool: DbPool): TripExpenseRepo`, same shape as `createTripRepo` but with no injected deps (no cross-feature port is needed — see Architecture). Representative methods:

- `createExpense(tripId, submittedByUserId, input)` — `BEGIN`; `SELECT COUNT(*) FROM expenses WHERE trip_id = $1 FOR UPDATE` against a row lock on the Trip (mirrors the existing `PLANNED_ITEM_LIMIT` race-safe pattern) to enforce the 1,000 cap (Req 1.12); validate `payerId` is a Trip_Member (Req 1.2) and any `shares`/`items`/`tierCounts` recipient is a Trip_Member or Trip_Guest of the *same* Trip (Req 2.5); for `itemized`, call `computeItemizedTotals` and use its derived `amountCents`/`shares`/`payerImplicitCents` for the INSERTs (Req 5.14) instead of a submitted amount; for `exact`/`even`/`tiered`, validate per Requirements 3/4 and compute shares via `splitEvenly`/tier arithmetic; INSERT `expenses` row, then the Split_Mode-specific child rows (`expense_shares`, `expense_tiers`+`expense_tier_counts`, or `expense_items`+`charge_lines`); `COMMIT`; return the assembled `ExpenseDTO`. Rolls back and throws `trip_validation_failed` for every Requirement-1/3/4/5 violation before any INSERT.
- `editExpense(tripId, expenseId, callerId, callerRole, input)` — `SELECT ... FOR UPDATE` the existing Expense and its Split_Mode; adder-or-organizer check (`callerRole !== 'organizer' && expense.created_by !== callerId` → `ROLLBACK; throw trip_forbidden`, Req 8.1); if `input.splitMode` differs from the stored one, `DELETE FROM expense_shares/expense_tiers/expense_tier_counts/expense_items/charge_lines WHERE expense_id = $1` (all four, unconditionally — cheap and simple) before re-running the same validation/INSERT path as `createExpense` for the new mode (Req 8.3); otherwise, re-validate and replace the existing child rows in place. Returns the updated `ExpenseDTO`.
- `removeExpense(tripId, expenseId, callerId, callerRole)` — adder-or-organizer check; `DELETE FROM expenses WHERE id = $1` — children cascade via FK (Req 8.4).
- `addTripGuest` / `renameTripGuest` / `removeTripGuest` — `addTripGuest` creates a guest with the specified or caller's `sponsorMemberId` after validating membership (Req 2.1); `renameTripGuest` permits updating name and optionally reassigning `sponsorMemberId` after validating new sponsor membership (Req 2.11); `removeTripGuest` first checks `NOT EXISTS` across `expense_shares`, `expense_item_assignees`, `expense_tier_counts` referencing the guest before deleting (Req 2.9); sponsor-or-organizer check (Req 2.10, 2.11).
- `createSettlement` / `editSettlement` / `removeSettlement` — same adder-or-organizer pattern; `createSettlement` validates `payerId !== recipientId` and both are Trip_Members (Req 7.2) as a defense-in-depth backstop to the Zod-level check.
- `createRefund` / `editRefund` / `removeRefund` — `SELECT` the target Expense and the sum of its existing Refunds `FOR UPDATE`; reject if the new total would exceed the Expense's original Amount (Req 12.2); on success, call `allocateProportionally` against the Expense's existing shares (weighted by their own amount) to get the Refund's per-recipient negative contribution, used only when assembling `NetBalanceDTO` output — the original `expense_shares` rows are never rewritten, only the Refund row is inserted (keeping Req 12.4's "original Amount stays visible" property true by construction).
- `listExpensesAndSettlements(tripId)` — one `UNION`-free pair of queries (Expenses with their children via `json_agg` subqueries, Settlements plain), merged and sorted by `date` in application code; supports the Category/Payer filters as `WHERE` clauses (Req 13.1).
- `getNetBalances(tripId)` / `getPairwiseBalances(tripId)` — load every Expense/Share/Guest-sponsorship/Settlement row for the Trip into `BalanceEvent[]` (resolving Guest shares onto their sponsor per Req 2.7) and delegate to `computeNetBalances`/`computePairwiseBalances`; read-only, no transaction needed.
- `exportLedgerCsv(tripId)` — reuses `listExpensesAndSettlements`, resolves Guest attributions to `"Sponsor — Guest_Name"` strings (Req 13.3), and formats as CSV in-process; no persistence.

### Notification events (`services/tripExpenses/events.ts`)

```ts
/** Emitted after an Expense is created or edited such that one or more Trip_Members' owed amount changed (Req 1.9, 1.10). */
export interface ExpenseAffectedNotice {
  readonly expenseId: string;
  readonly tripId: string;
  readonly actorUserId: string; // who created/edited the Expense
  readonly affectedMemberIds: readonly string[]; // excludes the actor
}
```

`composeServices.ts` adds one dispatch closure, `emitExpenseAffected`, mirroring `emitTripInviteCreated` exactly (fire-and-forget, `.catch` logs and swallows). `tripExpenseRoutes` is constructed with this port and calls it after a `createExpense`/`editExpense` transaction commits, computing `affectedMemberIds` as the symmetric difference needed by Requirement 1.10 (new shares, changed amounts) vs. the full share list for Requirement 1.9 (creation).

### Mobile

- `TripsStack.tsx` — add `TripExpenses: { tripId: string }` and `TripBalances: { tripId: string }` to `TripsStackParamList`; register both screens.
- `TripDetailScreen.tsx` — add `'TripExpenses'` to `HubSection['route']` and a `{ key: 'expenses', route: 'TripExpenses', title: 'Expenses', icon: 'cash-outline' }` entry to `HUB_SECTIONS`; the `tripStructureRegression.test.tsx` snapshot is updated deliberately as part of this task.
- `TripExpensesScreen.tsx` — `GradientHeader` + compact Financial Status Capsule (user net position + primary Log Payment action) + scannable ledger list (category squircle, clear typography, and color-coded personal share badge/caption, with collapsible breakdown for participant shares, refunds, and actions) + unified toolbar and compact filter chips (Req 10.5, 13.1) + post-trip settle-up banner (Req 13.2) + Add/Edit Expense and Guest management modals + Who Owes What tab with modern transfer cards for simplified repayments and refined net balance rows (Req 6.5, 6.7, 7.6) + export action (Req 13.3).
- `TripBalancesScreen.tsx` — `Card`-per-member Net_Balance list with a toggle (Req 6.5) to the pairwise view; tapping a member opens the drill-down (Req 6.4); tapping a nonzero pairwise balance opens the pre-filled Settlement modal (Req 7.7).
- `receiptScan.ts` (pure) — `parseReceiptText(rawText: string): { items: DraftItem[]; chargeLines: DraftChargeLine[]; subtotalCents: number | null }`, the OCR-output-to-draft-list parser (Req 9.2, 9.6), plus `flagAlcoholCandidate(name: string): boolean` (Req 9.8) and `matchMenuItemName(recognizedName: string, menuItemNames: readonly string[]): string | null` (Req 9.9, Req 11's tier/name suggestions reuse the same fuzzy-match helper).
- `receiptScan.native.ts` — the thin call site into the on-device OCR library (e.g. `expo-ocr-kit`/ML Kit/Vision wrapper) that produces the raw recognized text handed to `parseReceiptText`; this is the one piece that cannot be unit-tested without a device/simulator, so it is kept to the smallest possible surface (capture/pick a photo, call the library, return text) with every actual decision pushed into the pure `receiptScan.ts`.
- `ExperiencePicker.tsx` — reused unchanged for the Requirement 11 restaurant link (`defaultTab = 'dining'`, `showTabs={false}`, same pattern as `trip-reservations`); a parallel lightweight Resort picker (no existing component — Resorts aren't browsed via `ExperiencePicker`'s category tabs) is a small new `ResortPicker.tsx` or a `category`-less list sourced from the existing Resort list endpoint, whichever the implementer finds already exists in the Catalog screens — this is a task-level decision, not a design-level one, since no cross-cutting contract depends on which.

## Data Models

### Migration `0060_trip_expenses.sql`

```sql
BEGIN;

-- Trip_Guest: a non-account companion, sponsored by a Trip_Member (R2).
CREATE TABLE trip_guests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sponsor_member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_guests_name_nonempty CHECK (length(trim(name)) > 0)
);
CREATE INDEX trip_guests_trip_idx ON trip_guests (trip_id);

-- Expense: one real-world payment (R1).
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents    BIGINT NOT NULL,
  description     VARCHAR(200) NOT NULL,
  expense_date    DATE NOT NULL,
  category        VARCHAR(20),
  split_mode      VARCHAR(20) NOT NULL,
  experience_id   UUID REFERENCES experiences(id),
  resort_id       UUID REFERENCES resorts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_expenses_amount CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  CONSTRAINT chk_expenses_description_nonempty CHECK (length(trim(description)) > 0),
  CONSTRAINT chk_expenses_category CHECK (category IS NULL OR category IN
    ('hotel', 'tickets', 'dining', 'shopping', 'transportation', 'other')),
  CONSTRAINT chk_expenses_split_mode CHECK (split_mode IN ('exact', 'even', 'tiered', 'itemized'))
);
CREATE INDEX expenses_trip_idx ON expenses (trip_id, expense_date);
CREATE INDEX expenses_trip_payer_idx ON expenses (trip_id, payer_id);

-- Expense_Share: amount one Trip_Member/Trip_Guest owes the Payer (R2, R3, R4, R5).
-- Exactly one of member_id / guest_id is set (R2.5's "name either").
CREATE TABLE expense_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id     UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  CONSTRAINT chk_expense_shares_amount CHECK (amount_cents > 0),
  CONSTRAINT chk_expense_shares_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT uq_expense_shares_recipient UNIQUE (expense_id, member_id, guest_id)
);
CREATE INDEX expense_shares_expense_idx ON expense_shares (expense_id);

-- Expense_Tier: a named per-unit price scoped to one tiered Expense (R4).
CREATE TABLE expense_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tier_name     VARCHAR(40) NOT NULL,
  price_cents   BIGINT NOT NULL,
  CONSTRAINT chk_expense_tiers_price CHECK (price_cents > 0),
  CONSTRAINT chk_expense_tiers_name_nonempty CHECK (length(trim(tier_name)) > 0)
);
CREATE INDEX expense_tiers_expense_idx ON expense_tiers (expense_id);

-- Expense_Tier_Count: how many units of a tier one recipient covers (R4.2).
CREATE TABLE expense_tier_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id     UUID NOT NULL REFERENCES expense_tiers(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id    UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  unit_count  INTEGER NOT NULL,
  CONSTRAINT chk_expense_tier_counts_count CHECK (unit_count >= 1),
  CONSTRAINT chk_expense_tier_counts_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  )
);
CREATE INDEX expense_tier_counts_tier_idx ON expense_tier_counts (tier_id);

-- Expense_Item: one itemized receipt line (R5).
CREATE TABLE expense_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  item_name     VARCHAR(100) NOT NULL,
  price_cents   BIGINT NOT NULL,
  is_alcohol    BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_expense_items_price CHECK (price_cents > 0),
  CONSTRAINT chk_expense_items_name_nonempty CHECK (length(trim(item_name)) > 0)
);
CREATE INDEX expense_items_expense_idx ON expense_items (expense_id);

-- Expense_Item_Assignee: the Assignee_Set of one Expense_Item (R5.2).
CREATE TABLE expense_item_assignees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id    UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  CONSTRAINT chk_expense_item_assignees_one_recipient CHECK (
    (member_id IS NOT NULL AND guest_id IS NULL) OR
    (member_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT uq_expense_item_assignees UNIQUE (item_id, member_id, guest_id)
);
CREATE INDEX expense_item_assignees_item_idx ON expense_item_assignees (item_id);

-- Charge_Line: a tax/gratuity/fee/discount adjustment on an itemized Expense (R5.8-5.12, R14).
CREATE TABLE charge_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id      UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  kind            VARCHAR(20) NOT NULL,
  amount_cents    BIGINT NOT NULL,
  exclude_alcohol BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_charge_lines_kind CHECK (kind IN ('tax', 'gratuity', 'fee', 'discount')),
  CONSTRAINT chk_charge_lines_sign CHECK (
    (kind = 'discount' AND amount_cents < 0) OR
    (kind != 'discount' AND amount_cents > 0)
  )
);
CREATE INDEX charge_lines_expense_idx ON charge_lines (expense_id);

-- Charge_Line_Scope: explicit Expense_Item subset a Charge_Line is scoped to (R5.11). Absent rows = whole-expense scope.
CREATE TABLE charge_line_scopes (
  charge_line_id UUID NOT NULL REFERENCES charge_lines(id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  PRIMARY KEY (charge_line_id, item_id)
);

-- Refund: a reduction in what a Payer actually ended up owed (R12).
CREATE TABLE expense_refunds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  refund_date  DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_expense_refunds_amount CHECK (amount_cents > 0)
);
CREATE INDEX expense_refunds_expense_idx ON expense_refunds (expense_id);

-- Settlement: a recorded real-world repayment between two Trip_Members (R7).
CREATE TABLE settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents  BIGINT NOT NULL,
  settled_date  DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlements_amount CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  CONSTRAINT chk_settlements_distinct_parties CHECK (payer_id != recipient_id)
);
CREATE INDEX settlements_trip_idx ON settlements (trip_id, settled_date);

COMMIT;
```

Every table's path back to `trips(id)` is via `ON DELETE CASCADE` either directly (`trip_guests`, `expenses`, `settlements`) or transitively through `expenses`/`trip_guests`/`expense_items`/`expense_tiers`/`charge_lines` (every child table), so `DELETE FROM trips WHERE id = $1` alone satisfies Requirement 8.6 with no application-level cleanup. `member_id`/`sponsor_member_id`/`payer_id`/`created_by` reference `users(id)` directly (not `trip_memberships`) — mirroring how `trips`' own tables reference the user, not the membership row — so a former Trip_Member's historical rows survive their membership being removed (Req 8.5), since the FK target (`users`) is never deleted when someone merely leaves a Trip.

### Storage notes

- All money is `BIGINT` cents, never `NUMERIC`/`FLOAT`, matching the existing `ll_multipass_price_cents` convention elsewhere in this codebase.
- `expenses.amount_cents` is written by the repo for every Split_Mode, including `itemized` (where it's the computed sum rather than a client-submitted value) — there is no separate "derived" column or flag; the field always holds the authoritative total regardless of how it was arrived at.
- `expense_shares`/`expense_tier_counts`/`expense_item_assignees` all use the same `member_id XOR guest_id` pattern via a `CHECK`, so a single recipient-resolution helper (`resolveRecipientIds(row)`) in the repo handles all three without duplicated branching logic.
- `charge_line_scopes` has no `CHECK` enforcing non-empty scope per row (Postgres can't express "at least one row exists for this parent" declaratively); the zero-scope rejection (Req 5.11) is enforced in the repo at write time, same as the existing `chk_planned_items_reservation_anchored` pattern of "constraint is the backstop, not the primary path."

## Correctness Properties

### Property 1: Every Split_Mode's shares plus the Payer's implicit portion sum to exactly the Amount

For any accepted Expense of any Split_Mode, the sum of its stored `expense_shares.amount_cents` plus the Payer's implicit portion (`amount_cents − Σ(shares)`) equals `amount_cents` exactly, in integer cents, with no fractional remainder ever discarded or double-counted — regardless of how many recipients are involved or how the remainder cent(s) fall.

**Validates: Requirements 3.4, 3.5, 4.5, 5.13, 5.15**

### Property 2: `allocateProportionally` and `splitEvenly` are exact and deterministic

For any non-negative integer `totalCents`/`priceCents` and any non-empty set of targets/assignees with at least one positive weight, the returned per-recipient amounts sum to exactly the input total; every individual amount's absolute difference from its ideal continuous share is less than one cent; and calling the function twice with identical input yields identical output (determinism, so the UI never flickers between renders of the same data).

**Validates: Requirements 3.4, 5.4, 5.10, 5.11, 12.3**

### Property 3: Net_Balance always sums to exactly zero

For any Trip's full set of Expenses, Expense_Shares (with Trip_Guest shares resolved onto their sponsor), and Settlements, the sum of every Trip_Member's computed `Net_Balance` is exactly `0`, for any sequence of adds, edits, and removals, including after a Refund is applied.

**Validates: Requirements 6.6**

### Property 4: A Trip_Guest's shares always resolve onto its sponsor

For any Trip_Guest with one or more Expense_Shares/Expense_Item assignments/Tier_Counts, the Guest's attributed amounts contribute to its Sponsoring_Member's `Net_Balance` as if attributed to the Sponsoring_Member directly, and never appear as an independent balance entity in `computeNetBalances`'s output — the output map's keys are always exactly the Trip's Trip_Member ids, never a Guest id.

**Validates: Requirements 2.7, 2.8**

### Property 5: A Charge_Line's alcohol exclusion never allocates to a flagged item's assignees via that Charge_Line

For any `discount` Charge_Line with `excludeAlcohol = true`, the set of recipients receiving a nonzero allocation from that Charge_Line is always a subset of the assignees of Expense_Items *not* flagged `isAlcohol` on that Expense — an assignee whose only Expense_Item involvement is alcohol-flagged items receives exactly `0` from that Charge_Line, regardless of their Item_Subtotal from other non-alcohol items.

**Validates: Requirements 14.2**

### Property 6: Editing an Expense's Split_Mode fully resets its prior data

For any Expense whose Split_Mode is changed via edit, after the edit commits, the Expense has no `expense_shares`/`expense_tiers`/`expense_tier_counts`/`expense_items`/`charge_lines` rows attributable to its *previous* Split_Mode — only rows consistent with the new Split_Mode's shape exist — and the Expense's recomputed shares/Amount derive solely from the edit's new input, never from any value carried over from the prior mode.

**Validates: Requirements 8.3**

### Property 7: A Refund never exceeds its Expense's original Amount and preserves visibility

For any sequence of Refunds against one Expense, the running sum of Refund amounts never exceeds the Expense's original `amount_cents` (a Refund that would make it exceed is rejected and the Expense is unchanged), and the Expense's own stored `amount_cents` and Description are never altered by a Refund — a Refund is always a separate, additional row, never a mutation of the Expense it targets.

**Validates: Requirements 12.2, 12.4**

### Property 8: Receipt parsing partitions recognized text losslessly between items, charge lines, and ignored totals

For any OCR'd raw text, `parseReceiptText` classifies every candidate line into exactly one of: a draft Expense_Item, a draft Charge_Line, a recognized subtotal (surfaced but not persisted), or unrecognized/ignored — no line is double-classified, and running the function twice on identical input yields an identical result (determinism, required for the review screen in Requirement 9.3 to be stable while the member edits other fields).

**Validates: Requirements 9.2, 9.5, 9.6**

### Property 9: Multi-photo Receipt_Scan append is order-independent for the final reviewed set

For any sequence of per-photo parse results fed into the combined draft list (Req 9.10), the final combined set of draft Expense_Items/Charge_Lines before member review is the same regardless of the order photos were scanned in (each photo's contribution is independently classified per Property 8 and simply concatenated), and removing one photo's contribution (Req 9.12) yields exactly the combined set of the remaining photos' contributions, as if that photo had never been scanned.

**Validates: Requirements 9.10, 9.11, 9.12**

### Property 10: Expense and Settlement authorization matches the adder-or-organizer rule

For any Expense, Settlement, or Refund, an edit or removal attempt succeeds if and only if the caller is the record's creator or holds the `organizer` Trip_Role on the Trip; every other caller is rejected with `trip_forbidden` and the record is left byte-identical.

**Validates: Requirements 8.1, 12.5**

### Property 11: Trip_Guest sponsor assignment and reassignment validates membership

For any Trip_Guest created or renamed/reassigned with an explicit `sponsorMemberId`, the operation succeeds if and only if `sponsorMemberId` is an active Trip_Member of that Trip; if `sponsorMemberId` does not belong to the Trip, the operation is rejected with `trip_validation_failed`.

### Property 12: Tiered Expense auto-calculation and breakdown consistency

For any tiered Expense with defined tiers and participant tier counts, the derived total amount computed equals the sum of `unit_count × tier.price_cents` across all participants, and the per-participant subtotals sum to this derived total amount.

**Validates: Requirement 4.7**

### Property 13: Pairwise transaction breakdown preserves mutual balance consistency

For any two Trip_Members A and B, the pairwise transaction breakdown listing for (A, B) contains exactly those events where {A, B} are the member and counterparty. Settlements paid reduce debt (`-`) while mutual expense shares increase debt (`+`), such that the sum of signed contributions from A's perspective equals B's net pairwise debt to A (`aOwesBCents`). Furthermore, settlements are visually distinguished from expense shares with dedicated payment card styling and attribution.

**Validates: Requirement 6.7**

## Error Handling

| Condition | Code | Behavior |
| --- | --- | --- |
| `payerId` not a Trip_Member; Expense_Share/Item/TierCount recipient not a Trip_Member or Trip_Guest of the same Trip | `trip_validation_failed` | Rejected inside the transaction after a `SELECT` check; nothing persisted. |
| Non-member named as Trip_Guest sponsor on add or rename (Req 2.1, 2.11) | `trip_validation_failed` | Rejected after membership check against `trip_memberships`; nothing persisted. |
| Amount zero/negative/non-integer/over $100,000 cap | `trip_validation_failed` | Rejected at the Zod edge; `chk_expenses_amount` is the backstop. |
| Missing required field for the Expense's Split_Mode (Req 1.4) | `trip_validation_failed` | Rejected by `expenseCreateSchema`'s discriminated `superRefine`. |
| `exact` shares sum exceeds Amount; `tiered` computed shares exceed Amount | `trip_validation_failed` | Rejected in the repo before any INSERT, inside the transaction. |
| `even` with fewer than one other participant | `trip_validation_failed` | Rejected by the schema/repo per Req 3.6. |
| Duplicate recipient on one Expense (same member/guest named twice) | `trip_validation_failed` | Rejected by the repo pre-INSERT check; `uq_expense_shares_recipient` etc. are the backstop. |
| `itemized` Expense with zero items, or an item with zero assignees | `trip_validation_failed` | Rejected in `computeItemizedTotals`'s caller before any INSERT. |
| Charge_Line sign/kind mismatch, or scoped to zero items | `trip_validation_failed` | Rejected in `computeItemizedTotals`; `chk_charge_lines_sign` is the backstop for sign. |
| Trip_Guest removal while still referenced by any share/assignment/tier-count | `trip_validation_failed` | Rejected by an `EXISTS` check in `removeTripGuest`, inside the transaction. |
| Non-sponsor, non-organizer renames/removes a Trip_Guest | `trip_forbidden` | Existing adder-or-organizer-style check, applied to the sponsor. |
| Settlement with `payerId === recipientId`, a Trip_Guest named, or either not a Trip_Member | `trip_validation_failed` | Rejected at the Zod edge (`.refine`) and the repo; `chk_settlements_distinct_parties` is the backstop. |
| Refund would exceed the Expense's original Amount combined with prior Refunds | `trip_validation_failed` | Rejected in `createRefund`/`editRefund` after a `SELECT ... FOR UPDATE` sum check. |
| Non-creator, non-organizer edits/removes an Expense, Settlement, or Refund | `trip_forbidden` | Adder-or-organizer rule, mirroring `trips`' Planned_Item rule. |
| Non-member reads or writes any Expense/Settlement/Guest/balance data | `trip_forbidden` | `assertTripMember`, reused directly from `services/trips/authz.ts`; identical for an unknown Trip id. |
| Trip already holds 1,000 Expenses | `trip_validation_failed` | Race-safe row-lock count check, mirroring `PLANNED_ITEM_LIMIT`. |
| `experienceId` not a Restaurant_Experience, or `resortId`/`experienceId` not found in Catalog | `trip_validation_failed` | Rejected by a plain existence/category check against `experiences`/`resorts`. |
| On-device OCR produces zero usable text/items | none (client-side) | Falls back to manual itemized entry; no request is made (Req 9.5). |

## Testing Strategy

- **Pure modules** — `apps/api/src/services/tripExpenses/__tests__/allocation.prop.test.ts`, `itemizedTotals.prop.test.ts`, `balances.prop.test.ts` (Vitest, ≥ 100 runs, tagged `// Feature: trip-expenses, Property N: <title>`): generate arbitrary weight sets/item-assignee graphs/event streams via `fast-check` and assert the exactness, determinism, zero-sum, and alcohol-exclusion properties above. Unit cases cover the concrete worked examples from this conversation (e.g. $1,321.65 split two ways, the $57/$37 Crystal Palace tier example, the Bob/wife/kid tiered ticket example).
- **Shared schema** — `packages/shared/src/__tests__/tripExpenses.test.ts` (Vitest): valid/invalid cases for every new schema, the Split_Mode-specific `superRefine` branches, and the `payerId !== recipientId` Settlement refinement.
- **Repo** — pg-mem integration tests in `apps/api/src/services/tripExpenses/__tests__/`: create an Expense of each Split_Mode and read back the real computed shares; assert the 1,000-item cap via row-lock count; assert `editExpense`'s Split_Mode-change reset deletes prior child rows (the real regression this repo's steering flags — a mocked repo would not catch stale tier rows surviving a mode switch); assert `removeTripGuest`'s in-use rejection against real referencing rows; assert the cascade delete of a Trip removes every new table's rows (`cascadeDelete.integration.test.ts`-style, extended).
- **Migration** — `apps/api/src/db/__tests__/migration0060.test.ts`: asserts every table, `CHECK` constraint (including the `member_id XOR guest_id` pattern across all three recipient tables and the `discount`-sign check), and index exists, and that reapplying the file is a no-op.
- **Routes** — `server.inject` tests against a `Proxy`-based fake `TripExpenseRepo` (mirroring `routes.reservations.test.ts`): the membership gate, the adder-or-organizer gate on edit/remove, a happy-path create per Split_Mode returning the expected DTO shape, and a validation-failure path per Split_Mode. A dedicated test asserts the notification dispatch port is invoked with the correct `affectedMemberIds` for both creation and an amount-changing edit.
- **Mobile pure module** — `apps/mobile/src/screens/trips/__tests__/receiptScan.test.ts` / `.prop.test.ts`: unit cases against a corpus of representative receipt text fixtures (a Disney table-service receipt with tax+gratuity, a quick-service receipt with a discount line, a prix-fixe menu string), plus the lossless-partition and multi-photo-append properties.
- **Mobile component** — `TripExpensesScreen.test.tsx`, `TripBalancesScreen.test.tsx` (`@testing-library/react-native`, mocking only the network layer): render real ledger/balance data, and drive every interactive flow this feature adds — adding an Expense per Split_Mode (asserting the POST body), filtering by Category/Payer, the settle-up banner's presence/absence, recording a Settlement from a pairwise balance (asserting the pre-filled amount and the POST body), scanning a receipt (mocking the OCR call site, asserting the draft review screen populates and that confirming submits the reviewed — not the raw OCR — items), and the CSV export action.

## Configuration & Constants

No new environment variables, secrets, base URLs, or cadences: the feature adds no external integration (on-device OCR makes no network call; the Catalog link is an in-repo read) and no scheduled background work.

| Constant | Value | Where | Meaning |
| --- | --- | --- | --- |
| `EXPENSE_SPLIT_MODES` | `['exact','even','tiered','itemized']` | `packages/shared/src/enums.ts` | Closed Split_Mode vocabulary; also the `chk_expenses_split_mode` text. |
| `EXPENSE_CATEGORIES` | `['hotel','tickets','dining','shopping','transportation','other']` | `packages/shared/src/enums.ts` | Closed Category vocabulary; also `chk_expenses_category`. |
| `CHARGE_LINE_KINDS` | `['tax','gratuity','fee','discount']` | `packages/shared/src/enums.ts` | Closed Charge_Line kind vocabulary; also `chk_charge_lines_kind`. |
| `EXPENSE_AMOUNT_MAX_CENTS` | `10_000_000` ($100,000.00) | `packages/shared/src/tripExpenses.ts` | Sanity cap on any single Amount (Req 1.3). |
| `EXPENSE_LIMIT` | `1_000` | `packages/shared/src/tripExpenses.ts` | Per-Trip Expense count cap (Req 1.12). |
| `GUEST_NAME_MAX` | `100` | `packages/shared/src/tripExpenses.ts` | Max Trip_Guest name length (Req 2.2). |
| `EXPENSE_DESCRIPTION_MAX` | `200` | `packages/shared/src/tripExpenses.ts` | Max Description length (Req 1.5). |
| `EXPENSE_TIER_NAME_MAX` | `40` | `packages/shared/src/tripExpenses.ts` | Max Tier_Name length (Req 4.1). |
| `EXPENSE_ITEM_NAME_MAX` | `100` | `packages/shared/src/tripExpenses.ts` | Max Expense_Item name length (Req 5.1). |
| Alcohol term list | maintained array of common beverage terms + known Disney bar/lounge drink names | `apps/mobile/src/screens/trips/receiptScan.ts` | Client-side suggestion list for `flagAlcoholCandidate` (Req 9.8); never authoritative. |
| Gratuity percentage presets | `[0.18, 0.20, 0.22]` + custom | `apps/mobile/src/screens/trips/TripExpensesScreen.tsx` | UI presets for the gratuity-as-percentage entry mode (Req 5.9); not a server-side constant since only the resulting cents amount is ever transmitted. |

### External Interfaces

None beyond what already exists in this repo. The restaurant/Resort link (Requirement 11) reads only the already-synced `experiences`/`resorts` tables and the already-cached `experience_menus` table (owned by the `restaurant-menu-display` feature) — no new external call. On-device receipt OCR (Requirement 9) explicitly makes zero network requests; the OCR library runs entirely on-device via the platform's built-in text recognition (Vision on iOS, ML Kit on Android), wrapped by a maintained React Native/Expo module chosen at implementation time (e.g. `expo-ocr-kit` or an equivalent Vision/ML Kit wrapper) — the specific package is a task-level implementation choice, not a design-level external dependency, since it introduces no credential, no account, and no server-side integration point.
