import type { MickeyStatus } from '@dwt/shared';

const ALLOWED_TRANSITIONS: ReadonlyMap<MickeyStatus, ReadonlySet<MickeyStatus>> = new Map([
  ['pending', new Set<MickeyStatus>(['approved', 'rejected'])],
  ['approved', new Set<MickeyStatus>(['retired', 'hidden'])],
  ['retired', new Set<MickeyStatus>(['approved'])],
  ['hidden', new Set<MickeyStatus>(['approved', 'retired'])],
  ['rejected', new Set<MickeyStatus>()],
]);

/**
 * Validates allowed status transitions per Requirement 1.3 and Property 11.
 *
 * Allowed:
 * pending -> approved, pending -> rejected
 * approved -> retired, retired -> approved
 * approved -> hidden, hidden -> approved, hidden -> retired
 */
export function canTransition(from: MickeyStatus, to: MickeyStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}
