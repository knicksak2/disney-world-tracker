/**
 * The Dining Plan's write port into the Trip Budget (Requirement 26; design.md "Budget export / Port" and "Acting role
 * for keyed lines").
 *
 * `createTripBudgetWritePort` adapts the existing Budget repo (`createTripBudgetRepo(pool)`, the instance the Budget
 * routes use) and adds the one query the Budget repo does not offer: the export's earlier lines by Export_Key
 * (`loadBudget` never maps `suggestion_key`, Requirement 26.16). `tripBudget/repo.ts` is used as it is.
 *
 * Keyed lines belong to the shared Trip scenario, so a re-export by any Member who may edit the dining plan and the
 * Budget updates and deletes them, whoever created them (Requirement 26.15). The Budget repo lets only the creator or
 * an Organizer do that, so the adapter acts as `organizer` toward it, and only for a line object that its own
 * `listExportedLines` returned for that Trip: the line handles are tracked by identity, so a hand-built
 * `{ id, key }`, a line of another Trip and a line without the `dining_plan:` prefix are refused before any call.
 */

import { DINING_EXPORT_KEY_PREFIX, type BudgetCategory, type BudgetLineInput } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import type { TripRole } from '../trips/permissions.js';
import type { ExistingExportLine } from './engine/budgetExport.js';

/** The Budget's effective tax rates the export reads: `dining` for the conversion, `other` for the tips warning. */
export interface BudgetTaxRates {
  readonly dining: number;
  readonly other: number;
}

export interface TripBudgetWritePort {
  /** From the Budget settings: the stored rate, else `BUDGET_DEFAULT_TAX_BPS` (Requirement 26.6). */
  getTaxBps(tripId: string): Promise<BudgetTaxRates>;
  /** This Trip's lines whose key starts with `dining_plan:`, as handles `editLine` and `removeLine` accept. */
  listExportedLines(tripId: string): Promise<readonly ExistingExportLine[]>;
  /** Creates a line as the acting Member (`created_by`). */
  createLine(tripId: string, userId: string, input: BudgetLineInput): Promise<{ readonly id: string }>;
  /** Replaces a line `listExportedLines` returned, in place (same id). */
  editLine(tripId: string, line: ExistingExportLine, userId: string, input: BudgetLineInput): Promise<{ readonly id: string }>;
  /** Deletes a line `listExportedLines` returned. */
  removeLine(tripId: string, line: ExistingExportLine, userId: string): Promise<void>;
}

/** The part of the Budget repo the adapter calls; `TripBudgetRepo` satisfies it. */
export interface BudgetLineStore {
  getSettings(tripId: string): Promise<{ readonly taxBps: Readonly<Record<BudgetCategory, number>> }>;
  createLine(tripId: string, userId: string, input: BudgetLineInput): Promise<{ readonly id: string }>;
  editLine(tripId: string, lineId: string, userId: string, callerRole: TripRole, input: BudgetLineInput): Promise<{ readonly id: string }>;
  removeLine(tripId: string, lineId: string, userId: string, callerRole: TripRole): Promise<void>;
}

export function createTripBudgetWritePort(deps: { readonly pool: DbPool; readonly budget: BudgetLineStore }): TripBudgetWritePort {
  const { pool, budget } = deps;
  /** Each handle `listExportedLines` returned, with its Trip. */
  const issued = new WeakMap<ExistingExportLine, string>();

  function assertIssued(tripId: string, line: ExistingExportLine): void {
    if (issued.get(line) !== tripId || !line.key.startsWith(DINING_EXPORT_KEY_PREFIX)) {
      throw new Error('The Budget export may change only the dining_plan: lines it listed for this trip.');
    }
  }

  return {
    async getTaxBps(tripId) {
      const settings = await budget.getSettings(tripId);
      return { dining: settings.taxBps.dining, other: settings.taxBps.other };
    },

    async listExportedLines(tripId) {
      // `_` is a LIKE wildcard, so the pattern also matches look-alike keys; the prefix check in code makes it exact.
      const res = await pool.query<{ id: string; suggestion_key: string; linked_expense_id: string | null }>(
        `SELECT id, suggestion_key, linked_expense_id FROM trip_budget_lines WHERE trip_id = $1 AND suggestion_key LIKE 'dining_plan:%'`,
        [tripId],
      );
      return res.rows
        .filter((r) => r.suggestion_key.startsWith(DINING_EXPORT_KEY_PREFIX))
        .map((r) => {
          const line: ExistingExportLine = Object.freeze({ id: r.id, key: r.suggestion_key, linkedExpenseId: r.linked_expense_id });
          issued.set(line, tripId);
          return line;
        });
    },

    async createLine(tripId, userId, input) {
      const created = await budget.createLine(tripId, userId, input);
      return { id: created.id };
    },

    async editLine(tripId, line, userId, input) {
      assertIssued(tripId, line);
      const edited = await budget.editLine(tripId, line.id, userId, 'organizer', input);
      return { id: edited.id };
    },

    async removeLine(tripId, line, userId) {
      assertIssued(tripId, line);
      await budget.removeLine(tripId, line.id, userId, 'organizer');
    },
  };
}
