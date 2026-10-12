/**
 * Notification event for trip expenses.
 *
 * Validates: Requirements 1.9, 1.10
 */

/** Emitted after an Expense is created or edited such that one or more Trip_Members' owed amount changed (Req 1.9, 1.10). */
export interface ExpenseAffectedNotice {
  readonly expenseId: string;
  readonly tripId: string;
  readonly actorUserId: string; // who created/edited the Expense
  readonly affectedMemberIds: readonly string[]; // excludes the actor
}
