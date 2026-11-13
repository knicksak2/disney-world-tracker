/**
 * The pure half of "Send to Trip Budget" (Requirement 26.4 to 26.9, 26.14; design.md "Budget export"; Properties 41
 * and 42 pure halves).
 *
 * From one evaluated Combination with per-Person amounts, builds the Budget_Lines the export owns (Export_Keys under
 * `dining_plan:`), decides for each whether it is created or edited in place, and lists the earlier exported lines to
 * delete. It never reads or touches a line without the prefix. The service executes the plan through the Budget repo.
 */

import {
  BUDGET_ALLOCATIONS_PER_LINE_MAX,
  BUDGET_DESCRIPTION_MAX,
  DINING_EXPORT_KEY_PREFIX,
  diningExportKey,
  type BudgetAllocationInput,
  type BudgetLineInput,
  type DiningBudgetExportResultDTO,
  type DiningExportGroup,
  type DiningPerPersonAmounts,
} from '@dwt/shared';

/** A Plan_Stay of the Combination being exported. Without a plan (`hasPlan` false) it gets no plan line. */
export interface ExportStay {
  readonly key: string;
  readonly label: string;
  readonly checkIn: string;
  readonly hasPlan: boolean;
  /** A `have_plan` stay: its description ends "(already booked)". */
  readonly held: boolean;
  /** The plan's `display_name` for this stay. */
  readonly displayName: string;
}

/** A Person_Key's Budget allocation target; only `active` accounts are in the map (Requirement 26.8). */
export type ExportPartyRef = { readonly memberId: string } | { readonly guestId: string };

/** An earlier exported Budget_Line, as the dining module's own query returns it. */
export interface ExistingExportLine {
  readonly id: string;
  readonly key: string;
  readonly linkedExpenseId: string | null;
}

export interface BudgetExportInput {
  readonly include: readonly DiningExportGroup[];
  /** From the same engine run that produced the displayed result (`includePerPerson`). */
  readonly perPerson: readonly DiningPerPersonAmounts[];
  /** In date order. */
  readonly stays: readonly ExportStay[];
  readonly party: ReadonlyMap<string, ExportPartyRef>;
  /** The Trip's effective Budget dining tax rate. */
  readonly budgetTaxBps: number;
  /** The calculator's tax rate for this result. */
  readonly calculatorTaxBps: number;
  /** The Budget's tax rate for category `other`, where the tips line goes. */
  readonly otherCategoryTaxBps: number;
  readonly planPricesIncludeTax: boolean;
  readonly existing: readonly ExistingExportLine[];
}

export interface BudgetExportLine {
  readonly key: string;
  /** The id of the earlier line with this key, edited in place; null when the line is created. */
  readonly existingId: string | null;
  readonly input: BudgetLineInput;
  readonly subtotalCents: number;
}

export interface BudgetExportPlan {
  readonly creates: readonly BudgetExportLine[];
  readonly edits: readonly BudgetExportLine[];
  /** Earlier exported lines this export no longer produces; the service deletes them last (Requirement 26.10). */
  readonly deletes: readonly ExistingExportLine[];
  readonly warnings: DiningBudgetExportResultDTO['warnings'];
}

/**
 * A tax-inclusive amount as the Budget's pre-tax figure at rate `bps`: `round(cents x 10000 / (10000 + bps))`, half
 * up, in integers (Requirement 26.6). 10650 at 650 bps is 10000.
 */
export function toPreTax(cents: number, bps: number): number {
  const denominator = 10_000 + bps;
  return Math.floor((cents * 20_000 + denominator) / (2 * denominator));
}

function clip(text: string): string {
  return text.length <= BUDGET_DESCRIPTION_MAX ? text : `${text.slice(0, BUDGET_DESCRIPTION_MAX - 1)}…`;
}

export function buildBudgetExport(input: BudgetExportInput): BudgetExportPlan {
  const existingByKey = new Map(input.existing.filter((l) => l.key.startsWith(DINING_EXPORT_KEY_PREFIX)).map((l) => [l.key, l]));
  const built: { key: string; input: Omit<BudgetLineInput, 'linkedExpenseId' | 'suggestionKey'>; subtotalCents: number }[] = [];

  const allocate = (amountOf: (p: DiningPerPersonAmounts) => number): BudgetAllocationInput[] => {
    const allocations: BudgetAllocationInput[] = [];
    for (const p of input.perPerson) {
      const ref = input.party.get(p.key);
      const amountCents = amountOf(p);
      if (ref === undefined || amountCents <= 0) continue;
      allocations.push('memberId' in ref ? { memberId: ref.memberId, amountCents } : { guestId: ref.guestId, amountCents });
    }
    return allocations.slice(0, BUDGET_ALLOCATIONS_PER_LINE_MAX);
  };
  const push = (key: string, line: Omit<BudgetLineInput, 'linkedExpenseId' | 'suggestionKey' | 'allocations'>, allocations: BudgetAllocationInput[]): void => {
    if (allocations.length === 0) return;
    built.push({ key, input: { ...line, allocations }, subtotalCents: allocations.reduce((a, x) => a + (x.amountCents ?? 0), 0) });
  };

  if (input.include.includes('plan')) {
    for (const stay of input.stays) {
      if (!stay.hasPlan) continue;
      const allocations = allocate((p) => {
        const share = p.planCostByStay[stay.key] ?? 0;
        return input.planPricesIncludeTax ? toPreTax(share, input.budgetTaxBps) : share;
      });
      push(
        diningExportKey('plan', stay.key),
        {
          category: 'dining',
          description: clip(`${stay.displayName} (${stay.label})${stay.held ? ' (already booked)' : ''}`),
          plannedDate: stay.checkIn,
          priceSource: 'user_entered',
          applyTip: false,
        },
        allocations,
      );
    }
  }
  if (input.include.includes('out_of_pocket')) {
    push(
      diningExportKey('out_of_pocket'),
      { category: 'dining', description: 'Dining out of pocket (estimate)', plannedDate: null, priceSource: 'user_entered', applyTip: false },
      allocate((p) => p.oopFoodCents + p.oopSnackMugCents),
    );
  }
  let tipsLine = false;
  if (input.include.includes('tips')) {
    const before = built.length;
    push(
      diningExportKey('tips'),
      { category: 'other', description: 'Dining tips (estimate)', plannedDate: null, priceSource: 'user_entered', applyTip: false },
      allocate((p) => p.tipCents),
    );
    tipsLine = built.length > before;
  }

  const creates: BudgetExportLine[] = [];
  const edits: BudgetExportLine[] = [];
  for (const b of built) {
    const existing = existingByKey.get(b.key) ?? null;
    const line: BudgetExportLine = {
      key: b.key,
      existingId: existing?.id ?? null,
      input: { ...b.input, suggestionKey: b.key, linkedExpenseId: existing?.linkedExpenseId ?? null },
      subtotalCents: b.subtotalCents,
    };
    (existing === null ? creates : edits).push(line);
  }
  const produced = new Set(built.map((b) => b.key));
  const deletes = [...existingByKey.values()].filter((l) => !produced.has(l.key));

  const warnings: { code: 'tax_rate_mismatch' | 'other_category_taxed'; calculatorTaxBps?: number; budgetTaxBps?: number }[] = [];
  if (input.calculatorTaxBps !== input.budgetTaxBps) {
    warnings.push({ code: 'tax_rate_mismatch', calculatorTaxBps: input.calculatorTaxBps, budgetTaxBps: input.budgetTaxBps });
  }
  if (tipsLine && input.otherCategoryTaxBps > 0) warnings.push({ code: 'other_category_taxed', budgetTaxBps: input.otherCategoryTaxBps });

  return { creates, edits, deletes, warnings };
}
