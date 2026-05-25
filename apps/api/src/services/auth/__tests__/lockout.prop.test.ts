// Feature: disney-world-tracker, Property 15: lockout fires iff 5+ failures in trailing 15-minute window and 15 min not elapsed
/**
 * Property-based test for the Redis-backed lockout service (task 6.9).
 *
 * Validates: Requirements 6.7
 *
 * Design Property 15 says, in essence:
 *
 *   For any User account and any sequence of `(timestamp, success)` login
 *   attempts, at any time `t` the account is locked iff there were 5 or
 *   more failed attempts in the trailing 15-minute window ending at the
 *   most recent qualifying failure AND fewer than 15 minutes have elapsed
 *   since that failure (and no successful login since).
 *
 * The strategy below generates a sorted timeline of three event kinds —
 * `failure`, `clear`, `query` — drives them through `createLockoutService`
 * backed by an injectable in-memory fake Redis, and at every `query`
 * event compares the live `isLocked()` answer against an independent
 * simulation-based oracle.
 *
 * The oracle is written from the property statement directly, mirroring
 * the storage rules from the design's "Password handling" section: a
 * sliding-window counter that drops entries strictly older than
 * `t - 15 min` on each failure and a lock marker stamped on every failure
 * whose post-prune count reaches the threshold (which refreshes its TTL).
 * It does NOT re-implement the service's Redis layout — only its
 * observable contract — so the test catches drift between the two.
 *
 * The fake Redis is structurally identical to the one used by the unit
 * tests in `lockout.test.ts`; the lockout module's `LockoutRedis`
 * interface is small enough that duplicating it here keeps the property
 * test self-contained.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  createLockoutService,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  type LockoutRedis,
} from '../lockout.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// In-memory fake Redis (LockoutRedis)
// ---------------------------------------------------------------------------
//
// Implements only the subset the lockout service uses. TTLs are tracked as
// absolute expiration times against an injectable clock so the property test
// can step through arbitrary (timestamp, kind) sequences deterministically.

interface SortedSetEntry {
  readonly score: number;
  readonly member: string;
}

class FakeRedis implements LockoutRedis {
  private readonly now: () => number;
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, SortedSetEntry[]>();
  private readonly expirations = new Map<string, number>();

  constructor(now: () => number) {
    this.now = now;
  }

  /** Lazily drop expired keys on read; mirrors Redis's lazy-expire model. */
  private gc(key: string): void {
    const exp = this.expirations.get(key);
    if (exp !== undefined && exp <= this.now()) {
      this.strings.delete(key);
      this.zsets.delete(key);
      this.expirations.delete(key);
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.gc(key);
    const entries = this.zsets.get(key) ?? [];
    const existingIdx = entries.findIndex((e) => e.member === member);
    if (existingIdx >= 0) {
      entries[existingIdx] = { score, member };
      this.zsets.set(key, entries);
      return 0;
    }
    entries.push({ score, member });
    this.zsets.set(key, entries);
    return 1;
  }

  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    this.gc(key);
    const entries = this.zsets.get(key);
    if (!entries) return 0;
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);
    const before = entries.length;
    const next = entries.filter(
      (e) => e.score < minScore || e.score > maxScore,
    );
    this.zsets.set(key, next);
    return before - next.length;
  }

  async zcard(key: string): Promise<number> {
    this.gc(key);
    return this.zsets.get(key)?.length ?? 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.gc(key);
    const exists =
      this.strings.has(key) || (this.zsets.get(key)?.length ?? 0) > 0;
    if (!exists) return 0;
    this.expirations.set(key, this.now() + seconds * 1000);
    return 1;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.strings.set(key, value);
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (typeof flag === 'string' && flag.toUpperCase() === 'EX') {
        const seconds = Number(args[i + 1]);
        this.expirations.set(key, this.now() + seconds * 1000);
        i += 1;
      }
    }
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    this.gc(key);
    return this.strings.has(key) || (this.zsets.get(key)?.length ?? 0) > 0
      ? 1
      : 0;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      const had = this.strings.delete(key) || this.zsets.delete(key);
      this.expirations.delete(key);
      if (had) removed += 1;
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Event timeline arbitrary
// ---------------------------------------------------------------------------

type EventKind = 'failure' | 'clear' | 'query';
type Event = { readonly kind: EventKind; readonly t: number };

/** Arbitrary epoch baseline; the concrete value does not matter. */
const BASELINE_MS = 1_700_000_000_000;

/**
 * Inter-event delta in milliseconds. The mixture biases toward small gaps
 * so lockouts actually fire on a meaningful fraction of generated runs,
 * while still occasionally sampling gaps long enough for a lock to expire
 * on its own and for counter entries to fall out of the trailing window.
 */
const deltaMsArb = fc.oneof(
  // Tight bursts (sub-second) — drive the count-in-window predicate.
  fc.integer({ min: 0, max: 1_000 }),
  // Within-window gaps up to 5 minutes.
  fc.integer({ min: 0, max: 5 * 60_000 }),
  // Cross-window gaps up to 20 minutes.
  fc.integer({ min: 0, max: 20 * 60_000 }),
);

/**
 * A timeline of up to 30 events with non-decreasing timestamps. Event
 * kinds are uniform over `{failure, clear, query}` so interleavings of all
 * three are exercised.
 */
const timelineArb: fc.Arbitrary<readonly Event[]> = fc
  .array(
    fc.record({
      delta: deltaMsArb,
      kind: fc.constantFrom<EventKind>('failure', 'clear', 'query'),
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((draws) => {
    let t = BASELINE_MS;
    return draws.map((d) => {
      t += d.delta;
      return { kind: d.kind, t } as Event;
    });
  });

// ---------------------------------------------------------------------------
// Reference simulation oracle
// ---------------------------------------------------------------------------
//
// The oracle keeps a small model that mirrors the property statement:
//
//   - `counter`: timestamps of failures still in the sliding 15-minute
//                window. On every failure, drop entries older than
//                `t - LOCKOUT_WINDOW_MS`, then append `t`. On a clear,
//                empty the counter.
//   - `lockSetAt`: timestamp at which the lock was last stamped. Updated
//                  on each failure whose post-prune count is at least
//                  the threshold (this matches `SET ... EX` overwriting
//                  the marker and refreshing the 15-minute TTL). Cleared
//                  on a clear.
//
// At any query time `q`, the lock is alive iff `lockSetAt !== null` and
// `q - lockSetAt < LOCKOUT_WINDOW_MS`. The lock can therefore expire
// naturally between events without any explicit transition; the
// comparison handles it.

interface ModelState {
  counter: number[];
  lockSetAt: number | null;
}

function step(state: ModelState, event: Event): void {
  switch (event.kind) {
    case 'failure': {
      // Drop entries strictly older than t - 15 minutes.
      const cutoff = event.t - LOCKOUT_WINDOW_MS;
      state.counter = state.counter.filter((f) => f >= cutoff);
      state.counter.push(event.t);
      if (state.counter.length >= LOCKOUT_THRESHOLD) {
        // Refreshes the marker's TTL to start at this failure.
        state.lockSetAt = event.t;
      }
      break;
    }
    case 'clear':
      state.counter = [];
      state.lockSetAt = null;
      break;
    case 'query':
      // No state change; the assertion happens against `expectedIsLocked`.
      break;
  }
}

function expectedIsLocked(state: ModelState, queryT: number): boolean {
  if (state.lockSetAt === null) return false;
  return queryT - state.lockSetAt < LOCKOUT_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('lockout service — Property 15: trailing-window lockout invariant', () => {
  it('isLocked agrees with the trailing-15-minute / threshold / TTL oracle over arbitrary event timelines', async () => {
    await fc.assert(
      fc.asyncProperty(timelineArb, async (events) => {
        let nowMs = BASELINE_MS;
        const fake = new FakeRedis(() => nowMs);
        const service = createLockoutService(fake, () => nowMs);
        const userId = 'user-prop-15';
        const model: ModelState = { counter: [], lockSetAt: null };

        for (const event of events) {
          // Advance the injected clock to the event's timestamp before the
          // operation; identical clock semantics in service and oracle.
          nowMs = event.t;
          step(model, event);
          switch (event.kind) {
            case 'failure':
              await service.recordFailure(userId);
              break;
            case 'clear':
              await service.clearOnSuccess(userId);
              break;
            case 'query': {
              const actual = await service.isLocked(userId);
              const expected = expectedIsLocked(model, event.t);
              if (actual !== expected) return false;
              break;
            }
          }
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

});
