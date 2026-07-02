/**
 * Backoff_Policy pure decision core for the `Disney_Transport` (design.md →
 * "1b. Backoff_Policy" and Requirement 3).
 *
 * This module contains only pure functions — no I/O, no clock, no globals, no
 * timers — so the transport's retry pacing is deterministic and property-test
 * friendly (see Property 3, task 2.4). All time-dependent inputs (`now`, the
 * per-attempt `jitter`, and the parsed `Retry-After`) are injected by the
 * caller.
 *
 * Semantics:
 *
 *   - **Exponential growth (R3.2):** the pre-jitter base delay for a 1-based
 *     retry `attempt` is `baseDelayMs * factor^(attempt - 1)`, capped at
 *     `maxDelayMs` before any jitter is applied. See {@link computeBaseDelay}.
 *
 *   - **Jitter (R3.2):** "equal jitter" is applied to the capped base so
 *     successive delays are randomized while retaining a floor of half the
 *     base. Given an injected `jitter` in `[0, 1)`, the jittered delay is
 *     `(base / 2) * (1 + jitter)`, which lies in the documented band
 *     `[base / 2, base)`. See {@link JITTER_FLOOR_RATIO} and
 *     {@link computeBackoffDelay}.
 *
 *   - **Retry-After floor (R3.4):** when the server sends a `Retry-After`
 *     header, the actual wait is `max(jitteredDelay, retryAfterMs)` — the
 *     header acts as a lower bound, never shortening the wait. See
 *     {@link parseRetryAfter}.
 *
 *   - **Cumulative-delay cap (R3.3, R3.6):** {@link computeBackoffSchedule}
 *     builds the full sequence of per-attempt delays for a request, stopping
 *     once the configured `maxRetries` count is reached or once adding the next
 *     delay would push the accumulated delay past `maxTotalDelayMs`. The
 *     returned schedule therefore always sums to at most `maxTotalDelayMs`, and
 *     its length is at most `maxRetries`.
 *
 * `Retry-After` is parsed from both of its documented forms — delta-seconds
 * (e.g. `Retry-After: 120`) and an HTTP-date (e.g.
 * `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`) — relative to an injected
 * `now`, so the caller need not touch the wall clock.
 *
 * Validates: Requirements 3.2, 3.4, 3.6
 */

import type { BackoffConfig } from '@dwt/shared';

/**
 * The lower edge of the equal-jitter band as a fraction of the capped base
 * delay. The jittered delay is drawn from `[base * JITTER_FLOOR_RATIO, base)`;
 * with equal jitter the floor is exactly half the base.
 */
export const JITTER_FLOOR_RATIO = 0.5;

/**
 * Per-attempt input to {@link computeBackoffDelay}.
 *
 * `attempt` is 1-based: the first retry is `attempt === 1`. `jitter` is a
 * randomness sample in `[0, 1)` injected by the caller. `retryAfterMs`, when
 * present, is the already-parsed `Retry-After` duration (see
 * {@link parseRetryAfter}) applied as a floor on the computed delay.
 */
export interface BackoffAttemptInput {
  /** 1-based retry index; the first retry is `1`. */
  readonly attempt: number;
  /** Parsed `Retry-After` duration in milliseconds, applied as a floor (R3.4). */
  readonly retryAfterMs?: number;
  /** Injected jitter sample in `[0, 1)` (R3.2). */
  readonly jitter: number;
}

/**
 * Per-attempt input to {@link computeBackoffSchedule}. Identical to
 * {@link BackoffAttemptInput} but without `attempt`, which the schedule derives
 * from each element's position.
 */
export interface BackoffScheduleInput {
  /** Parsed `Retry-After` duration in milliseconds for this attempt, if any. */
  readonly retryAfterMs?: number;
  /** Injected jitter sample in `[0, 1)` for this attempt. */
  readonly jitter: number;
}

/**
 * The pre-jitter, capped exponential base delay for a 1-based retry `attempt`
 * (R3.2): `min(baseDelayMs * factor^(attempt - 1), maxDelayMs)`.
 *
 * `attempt` is clamped to at least `1` so the exponent is never negative. The
 * `maxDelayMs` cap also absorbs the `factor^(attempt - 1)` term overflowing to
 * `Infinity` for very large attempts.
 */
export function computeBaseDelay(cfg: BackoffConfig, attempt: number): number {
  const exponent = Math.max(0, Math.trunc(attempt) - 1);
  const raw = cfg.baseDelayMs * Math.pow(cfg.factor, exponent);
  return Math.min(raw, cfg.maxDelayMs);
}

/**
 * The delay to wait before a single retry `attempt`, honoring `Retry-After` as
 * a floor (R3.2, R3.4).
 *
 * The capped exponential base (see {@link computeBaseDelay}) is jittered with
 * equal jitter into the band `[base * JITTER_FLOOR_RATIO, base)`, then floored
 * by `retryAfterMs` when present. The result is never negative.
 */
export function computeBackoffDelay(
  cfg: BackoffConfig,
  input: BackoffAttemptInput,
): number {
  const base = computeBaseDelay(cfg, input.attempt);
  // Equal jitter: floor of half the base plus a random half. With jitter in
  // [0, 1) the result lies in [base/2, base).
  const jitterSample = clampUnit(input.jitter);
  const jittered =
    base * JITTER_FLOOR_RATIO + base * JITTER_FLOOR_RATIO * jitterSample;
  const floor = input.retryAfterMs !== undefined ? Math.max(0, input.retryAfterMs) : 0;
  return Math.max(jittered, floor);
}

/**
 * Build the full bounded delay schedule for a request (R3.3, R3.6).
 *
 * `attempts` supplies the per-attempt jitter and any parsed `Retry-After` for
 * each prospective retry, in order. The schedule:
 *
 *   - considers at most `cfg.maxRetries` attempts (R3.3); and
 *   - stops before adding any delay that would push the cumulative delay past
 *     `cfg.maxTotalDelayMs` (R3.6).
 *
 * The returned array therefore has length `<= maxRetries` and sums to
 * `<= maxTotalDelayMs`.
 */
export function computeBackoffSchedule(
  cfg: BackoffConfig,
  attempts: readonly BackoffScheduleInput[],
): number[] {
  const delays: number[] = [];
  let cumulative = 0;
  const limit = Math.min(attempts.length, Math.max(0, Math.trunc(cfg.maxRetries)));
  for (let i = 0; i < limit; i += 1) {
    const attempt = attempts[i];
    const input: BackoffAttemptInput =
      attempt?.retryAfterMs !== undefined
        ? { attempt: i + 1, jitter: attempt.jitter, retryAfterMs: attempt.retryAfterMs }
        : { attempt: i + 1, jitter: attempt?.jitter ?? 0 };
    const delay = computeBackoffDelay(cfg, input);
    if (cumulative + delay > cfg.maxTotalDelayMs) {
      break;
    }
    delays.push(delay);
    cumulative += delay;
  }
  return delays;
}

/**
 * Parse a `Retry-After` header value into a non-negative delay in milliseconds
 * relative to `now` (R3.4), handling both documented forms:
 *
 *   - **delta-seconds** — a non-negative integer count of seconds
 *     (e.g. `"120"`), returned as `seconds * 1000`.
 *   - **HTTP-date** — an absolute date (e.g.
 *     `"Wed, 21 Oct 2015 07:28:00 GMT"`), returned as `max(0, date - now)`.
 *
 * Returns `undefined` when the value is absent, blank, or unparseable, so the
 * caller falls back to the computed backoff delay with no floor.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now: number,
): number | undefined {
  if (headerValue === null || headerValue === undefined) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (trimmed === '') {
    return undefined;
  }
  // delta-seconds form: a bare non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  // HTTP-date form.
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.max(0, parsed - now);
}

/** Clamp an injected jitter sample into `[0, 1)`, guarding against bad inputs. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    // Keep strictly below 1 so the jittered delay stays strictly below `base`,
    // preserving the documented half-open band.
    return 1 - Number.EPSILON;
  }
  return value;
}
