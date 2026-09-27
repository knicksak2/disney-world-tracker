// Feature: experience-detail-redesign, Task 13.1 — pure trip-context-date resolution
//
// Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
//
// Pure and framework-free module (no React, no Linking, no navigation, no wdwClock)
// to resolve the calendar date the "Trip" Wait_Context_Selector segment should request.

export interface ResolveTripContextDateInput {
  /**
   * The planned item's scheduled date for this Experience on the relevant
   * trip, if one exists (`planned_items.planned_date`), else null.
   */
  readonly plannedDate: string | null;
  /**
   * The viewer's active or nearest-upcoming trip's date range, else null
   * when the viewer has no trip at all.
   */
  readonly activeTripRange: {
    readonly startDate: string;
    readonly endDate: string;
  } | null;
  /**
   * Today's date in the WDW park calendar (`America/New_York`), as
   * produced by `wdwClock`.
   */
  readonly todayWdw: string;
}

/**
 * Resolve the calendar date the "Trip" Wait_Context_Selector segment should
 * request, per Requirement 16's precedence order. Returns null when no date
 * is resolvable (R16.4), in which case the screen omits the "Trip" segment.
 * Pure and framework-free; performs no I/O, no Linking, no navigation.
 *
 * Precedence:
 * 1. Non-null `plannedDate` first (R16.1)
 * 2. Else `todayWdw` when `activeTripRange` is non-null and `todayWdw` falls
 *    within `[startDate, endDate]` inclusive (R16.2)
 * 3. Else `activeTripRange.startDate` when `activeTripRange` is non-null (R16.3)
 * 4. Else `null` (R16.4)
 */
export function resolveTripContextDate(
  input: ResolveTripContextDateInput,
): string | null {
  if (input.plannedDate !== null && input.plannedDate !== undefined && input.plannedDate !== '') {
    return input.plannedDate;
  }

  if (input.activeTripRange !== null && input.activeTripRange !== undefined) {
    const { startDate, endDate } = input.activeTripRange;
    if (input.todayWdw >= startDate && input.todayWdw <= endDate) {
      return input.todayWdw;
    }
    return startDate;
  }

  return null;
}
