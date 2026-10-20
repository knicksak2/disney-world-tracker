import fc from 'fast-check';
import {
  getPollInterval,
  getBatchForTick,
  filterPendingPhotoIds,
  isFinalPhotoStatus,
  MAX_IDS_PER_POLL_REQUEST,
  POLL_INTERVAL_FAST_MS,
  POLL_INTERVAL_SLOW_MS,
  POLL_FAST_THRESHOLD_MS,
} from '../pollPlan';

// Feature: photo-uploads, Property 29: Status polling costs one request per tick
describe('pollPlan (Property 29)', () => {
  it('Property 29: cadence 3s under 60s, 15s at or after 60s, at most 10 ids per tick, empty when none pending', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 0, maxLength: 35 }),
        fc.integer({ min: 0, max: 300_000 }), // elapsed ms up to 5 min
        fc.integer({ min: 0, max: 20 }), // tick index
        (ids, elapsedMs, tickIndex) => {
          // Cadence check
          const interval = getPollInterval(elapsedMs);
          if (elapsedMs < POLL_FAST_THRESHOLD_MS) {
            expect(interval).toBe(POLL_INTERVAL_FAST_MS);
          } else {
            expect(interval).toBe(POLL_INTERVAL_SLOW_MS);
          }

          // Batch check
          const batch = getBatchForTick(ids, tickIndex);

          if (ids.length === 0) {
            expect(batch).toEqual([]);
          } else {
            expect(batch.length).toBeGreaterThan(0);
            expect(batch.length).toBeLessThanOrEqual(MAX_IDS_PER_POLL_REQUEST);
            // Every element in the batch comes from the original ids
            for (const id of batch) {
              expect(ids).toContain(id);
            }
            // If <= 10 pending, the batch equals all pending ids exactly
            if (ids.length <= 10) {
              expect(batch).toEqual(ids);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  describe('unit examples', () => {
    it('uses 3s interval for first 60 seconds and 15s after', () => {
      expect(getPollInterval(0)).toBe(3000);
      expect(getPollInterval(3000)).toBe(3000);
      expect(getPollInterval(59999)).toBe(3000);
      expect(getPollInterval(60000)).toBe(15000);
      expect(getPollInterval(90000)).toBe(15000);
    });

    it('issues no request when nothing is pending', () => {
      expect(getBatchForTick([], 0)).toEqual([]);
      expect(getBatchForTick([], 1)).toEqual([]);
    });

    it('returns all 7 ids in one batch when 7 are pending', () => {
      const ids = ['1', '2', '3', '4', '5', '6', '7'];
      const batch = getBatchForTick(ids, 0);
      expect(batch).toEqual(ids);
    });

    it('chunks into groups of 10 when 25 are pending', () => {
      const ids = Array.from({ length: 25 }, (_, i) => `photo-${i}`);
      const batch0 = getBatchForTick(ids, 0);
      const batch1 = getBatchForTick(ids, 1);
      const batch2 = getBatchForTick(ids, 2);
      const batch3 = getBatchForTick(ids, 3); // wraps around to chunk 0

      expect(batch0.length).toBe(10);
      expect(batch1.length).toBe(10);
      expect(batch2.length).toBe(5);
      expect(batch3).toEqual(batch0);
    });

    it('drops ids whose status is final (approved, rejected, deleted)', () => {
      expect(isFinalPhotoStatus('approved')).toBe(true);
      expect(isFinalPhotoStatus('rejected')).toBe(true);
      expect(isFinalPhotoStatus('deleted')).toBe(true);
      expect(isFinalPhotoStatus('pending')).toBe(false);
      expect(isFinalPhotoStatus('uploading')).toBe(false);
      expect(isFinalPhotoStatus('needs_review')).toBe(false);
      expect(isFinalPhotoStatus('hidden')).toBe(false);

      const all = ['a', 'b', 'c', 'd'];
      const finalSet = new Set(['b', 'd']);
      const active = filterPendingPhotoIds(all, finalSet);
      expect(active).toEqual(['a', 'c']);
    });
  });
});
