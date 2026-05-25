/**
 * Unit tests for the Redis-backed lockout service (task 6.4).
 *
 * Validates the contract of `createLockoutService` against a small
 * in-memory fake that implements just enough of the `LockoutRedis`
 * interface to drive the sliding-window logic. The full universally-
 * quantified property (Property 15) is covered separately by the property
 * test in task 6.9.
 *
 * What we check here:
 *   1. Below the 5-failure threshold the account is not locked.
 *   2. The 5th failure within 15 minutes triggers the lock.
 *   3. Failures older than 15 minutes drop out of the sliding window.
 *   4. `clearOnSuccess` resets both the counter and the lock.
 *   5. Once the lock TTL (simulated by manual expiration) has elapsed,
 *      `isLocked` returns false again.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  createLockoutService,
  LOCKOUT_THRESHOLD,
  LOCKOUT_TTL_SECONDS,
  LOCKOUT_WINDOW_MS,
  type LockoutRedis,
} from '../lockout.js';

// ---------------------------------------------------------------------------
// In-memory fake Redis
// ---------------------------------------------------------------------------
//
// The fake supports the exact subset the lockout service uses: sorted-set
// add/range-remove/cardinality, a generic SET with EX, EXISTS, EXPIRE, and
// DEL. TTLs are tracked as absolute expiration times measured against an
// injectable clock, so tests can fast-forward time deterministically.

interface SortedSetEntry {
  readonly score: number;
  readonly member: string;
}

class FakeRedis implements LockoutRedis {
  private now: () => number;
  private strings = new Map<string, string>();
  private zsets = new Map<string, SortedSetEntry[]>();
  private expirations = new Map<string, number>();

  constructor(now: () => number) {
    this.now = now;
  }

  /** Drop any expired keys lazily on read. */
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
    const exists = this.strings.has(key) || (this.zsets.get(key)?.length ?? 0) > 0;
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
    // Parse `EX <seconds>` if present.
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
      const had =
        this.strings.delete(key) || this.zsets.delete(key);
      this.expirations.delete(key);
      if (had) removed += 1;
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lockout service — Requirement 6.7', () => {
  let nowMs: number;
  let fake: FakeRedis;

  beforeEach(() => {
    nowMs = 1_700_000_000_000; // arbitrary epoch ms
    fake = new FakeRedis(() => nowMs);
  });

  it('does not lock the account before the 5-failure threshold', async () => {
    const service = createLockoutService(fake, () => nowMs);
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i += 1) {
      const triggered = await service.recordFailure('user-1');
      expect(triggered).toBe(false);
      nowMs += 1000; // 1s between failures, all well within 15 min
    }
    expect(await service.isLocked('user-1')).toBe(false);
  });

  it('locks the account on the 5th failure within 15 minutes', async () => {
    const service = createLockoutService(fake, () => nowMs);
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i += 1) {
      const triggered = await service.recordFailure('user-1');
      expect(triggered).toBe(false);
      nowMs += 60_000; // 1 minute apart
    }
    const triggered = await service.recordFailure('user-1');
    expect(triggered).toBe(true);
    expect(await service.isLocked('user-1')).toBe(true);
  });

  it('does not lock when failures span more than 15 minutes', async () => {
    const service = createLockoutService(fake, () => nowMs);
    // 5 failures spaced 4 minutes apart -> total span 16 minutes, so the
    // earliest one slides out of the window before the 5th lands.
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      const triggered = await service.recordFailure('user-1');
      expect(triggered).toBe(false);
      nowMs += 4 * 60_000;
    }
    expect(await service.isLocked('user-1')).toBe(false);
  });

  it('clearOnSuccess resets both the counter and the lock', async () => {
    const service = createLockoutService(fake, () => nowMs);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await service.recordFailure('user-1');
      nowMs += 1000;
    }
    expect(await service.isLocked('user-1')).toBe(true);

    await service.clearOnSuccess('user-1');
    expect(await service.isLocked('user-1')).toBe(false);

    // After clearing, the counter starts from 0 — a single failure must not
    // immediately re-lock the account.
    const triggered = await service.recordFailure('user-1');
    expect(triggered).toBe(false);
    expect(await service.isLocked('user-1')).toBe(false);
  });

  it('lock expires after the 15-minute TTL', async () => {
    const service = createLockoutService(fake, () => nowMs);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await service.recordFailure('user-1');
      nowMs += 1000;
    }
    expect(await service.isLocked('user-1')).toBe(true);

    // Advance just past the lock TTL; the fake's lazy GC drops the key on
    // read and EXISTS returns 0.
    nowMs += LOCKOUT_TTL_SECONDS * 1000 + 1;
    expect(await service.isLocked('user-1')).toBe(false);
  });

  it('uses an explicit timestamp when supplied', async () => {
    const service = createLockoutService(fake, () => nowMs);
    const baseline = nowMs;
    // 5 failures all stamped at the same instant.
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await service.recordFailure('user-1', baseline + i);
    }
    // Clock far in the future, but the lock was established by explicit
    // timestamps; the lock TTL was set off the recordFailure clock so we
    // verify within-window behavior using `isLocked` directly.
    expect(await service.isLocked('user-1')).toBe(true);
  });

  // The spec calls out a sliding window; we make the boundary explicit:
  // an attempt one millisecond shy of `LOCKOUT_WINDOW_MS` old must still
  // count toward the total (the window is the trailing 15 minutes). This
  // pins the boundary semantics so a future refactor cannot quietly drop
  // attempts that happen near the edge.
  it('keeps attempts within the 15-minute window in the count', async () => {
    const service = createLockoutService(fake, () => nowMs);
    const t0 = nowMs;
    await service.recordFailure('user-1', t0);
    // Advance to one millisecond before the window edge.
    nowMs = t0 + LOCKOUT_WINDOW_MS - 1;
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i += 1) {
      await service.recordFailure('user-1');
    }
    expect(await service.isLocked('user-1')).toBe(true);
  });
});
