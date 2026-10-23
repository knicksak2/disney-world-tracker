/**
 * Constant-time cron secret comparison for the purge endpoint (account-deletion design,
 * "Cron-auth mechanism"). Deliberately a local copy rather than an import from another
 * service's folder: this service depends on no concrete module of another service.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True iff `provided` is a non-empty string equal to a non-empty `expected`. Both sides are
 * hashed with SHA-256 first so `timingSafeEqual` always compares equal-length buffers and the
 * comparison time does not depend on where the strings differ.
 */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) {
    return false;
  }
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
