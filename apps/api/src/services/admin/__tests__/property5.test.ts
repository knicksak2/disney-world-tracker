/**
 * Property 5 Test: Rate-limiter and directory snapshot reads never mutate observed state.
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 */

import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import fc from 'fast-check';
import { getRateLimiterSnapshot } from '../../catalog/disney/rateLimiter.js';
import { createThemeParksDirectory } from '../../live/themeParksDirectory.js';

describe('Property 5: Rate-limiter and directory snapshot reads never mutate observed state', () => {
  // Feature: admin-panel, Property 5: Rate-limiter and directory snapshot reads never mutate observed state
  it('Property 5: calling getRateLimiterSnapshot N times leaves Redis keys byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // N snapshot read calls
        fc.integer({ min: 1, max: 50 }),  // initial syncGateway rate entries
        fc.integer({ min: 0, max: 20 }),  // initial syncGateway concurrency
        async (numReads, rateCount, concurrency) => {
          const redis = new RedisMock();

          const now = Date.now();
          // Seed rate sorted set and concurrency string
          for (let i = 0; i < rateCount; i++) {
            await redis.zadd('disney:ratelimit:sync_gateway:rate', now - i * 10, `req-${i}`);
            await redis.zadd('disney:ratelimit:web:rate', now - i * 10, `webreq-${i}`);
          }
          await redis.set('disney:ratelimit:sync_gateway:concurrency', String(concurrency));
          await redis.set('disney:ratelimit:web:concurrency', String(concurrency + 1));

          const budget = {
            maxRequestsPerSecond: 10,
            maxConcurrency: 5,
          };

          // Capture state before reads
          const sgRateBefore = await redis.zrange('disney:ratelimit:sync_gateway:rate', 0, -1, 'WITHSCORES');
          const sgConcBefore = await redis.get('disney:ratelimit:sync_gateway:concurrency');
          const webRateBefore = await redis.zrange('disney:ratelimit:web:rate', 0, -1, 'WITHSCORES');
          const webConcBefore = await redis.get('disney:ratelimit:web:concurrency');

          // Execute N read-only snapshot calls
          for (let i = 0; i < numReads; i++) {
            const snap = await getRateLimiterSnapshot(redis as never, budget);
            expect(snap.syncGateway.maxRps).toBe(budget.maxRequestsPerSecond);
            expect(snap.syncGateway.maxConcurrency).toBe(budget.maxConcurrency);
          }

          // State after reads must be byte-identical
          const sgRateAfter = await redis.zrange('disney:ratelimit:sync_gateway:rate', 0, -1, 'WITHSCORES');
          const sgConcAfter = await redis.get('disney:ratelimit:sync_gateway:concurrency');
          const webRateAfter = await redis.zrange('disney:ratelimit:web:rate', 0, -1, 'WITHSCORES');
          const webConcAfter = await redis.get('disney:ratelimit:web:concurrency');

          expect(sgRateAfter).toEqual(sgRateBefore);
          expect(sgConcAfter).toBe(sgConcBefore);
          expect(webRateAfter).toEqual(webRateBefore);
          expect(webConcAfter).toBe(webConcBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 5: ThemeParksDirectory.getSnapshot() never triggers build or mutates state', async () => {
    let liveClientCalled = false;
    const fakeLiveClient = {
      async getDestinations() {
        liveClientCalled = true;
        return [];
      },
    };

    const dir = createThemeParksDirectory({
      client: fakeLiveClient as never,
      ttlMs: 43200000,
    });

    // Initial unbuilt state
    const snap1 = dir.getSnapshot();
    expect(snap1.builtAtMs).toBeNull();
    expect(snap1.entryCount).toBe(0);
    expect(snap1.ttlMs).toBe(43200000);
    expect(liveClientCalled).toBe(false);

    // Multiple calls still report unchanged unbuilt state without contacting client
    for (let i = 0; i < 50; i++) {
      const snap = dir.getSnapshot();
      expect(snap.builtAtMs).toBeNull();
      expect(snap.entryCount).toBe(0);
    }
    expect(liveClientCalled).toBe(false);
  });
});
