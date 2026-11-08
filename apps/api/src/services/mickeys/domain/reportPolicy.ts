/**
 * Evaluates whether a hidden mickey should auto-hide based on counted reports (Requirement 7.4).
 *
 * Rules:
 * - Only approved Community entries (!official) can auto-hide.
 * - Auto-hide triggers when countedReporters >= threshold.
 * - Official entries NEVER auto-hide at any reporter count.
 * - Entries with status !== 'approved' never auto-hide.
 */
export function shouldAutoHide(
  i: { status: string; official: boolean; countedReporters: number },
  threshold: number,
): boolean {
  return i.status === 'approved' && !i.official && i.countedReporters >= threshold;
}
