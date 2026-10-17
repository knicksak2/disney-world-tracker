import { createHash, timingSafeEqual } from 'node:crypto';

export type PassDecision = 'start' | 'skip_in_flight' | 'skip_debounce';

/**
 * Evaluates whether a new reminder pass should start.
 * Measured start-to-start: stamped when a pass starts, never when it ends.
 */
export function decidePassStart(s: {
  inFlight: boolean;
  lastStartMs: number | null;
  nowMs: number;
  minIntervalMs: number;
}): PassDecision {
  if (s.inFlight) return 'skip_in_flight';
  if (s.lastStartMs !== null && s.nowMs - s.lastStartMs < s.minIntervalMs) return 'skip_debounce';
  return 'start';
}

/**
 * Constant-time comparison between provided header value and expected secret.
 * Non-string or empty inputs evaluate to false.
 */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) {
    return false;
  }
  const h1 = createHash('sha256').update(provided).digest();
  const h2 = createHash('sha256').update(expected).digest();
  return timingSafeEqual(h1, h2);
}
