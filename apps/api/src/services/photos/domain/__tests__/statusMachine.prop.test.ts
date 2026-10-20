import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  canTransition,
  applyOutcome,
  operatorApprovePatch,
  servingCleanupAfterZeroRows,
  type ModerationOutcome,
  type StatusMachineRow,
} from '../statusMachine.js';
import { PHOTO_STATUSES, type PhotoTargetKind } from '@dwt/shared';

describe('statusMachine properties', () => {
  // Feature: photo-uploads, Property 7: Status machine permits only legal transitions
  it('Property 7: Status machine permits only legal transitions and enforces verdict invariants on approved', () => {
    // Expected legal transitions per Requirement 8.8
    const legalTransitions = new Set([
      'uploading->pending',
      'uploading->deleted',
      'pending->approved',
      'pending->rejected',
      'pending->needs_review',
      'pending->deleted',
      'needs_review->approved',
      'needs_review->rejected',
      'needs_review->deleted',
      'approved->hidden',
      'approved->deleted',
      'hidden->approved',
      'hidden->deleted',
      'rejected->deleted',
    ]);

    for (const from of PHOTO_STATUSES) {
      for (const to of PHOTO_STATUSES) {
        const edge = `${from}->${to}`;
        const allowed = canTransition(from, to);
        expect(allowed).toBe(legalTransitions.has(edge));
      }
    }

    // deleted is strictly terminal
    for (const to of PHOTO_STATUSES) {
      expect(canTransition('deleted', to)).toBe(false);
    }

    // operatorApprovePatch on food_log and trip
    const now = new Date('2025-06-01T12:00:00Z');
    const foodOpPatch = operatorApprovePatch({ targetKind: 'food_log' }, now);
    expect(foodOpPatch.status).toBe('approved');
    expect(foodOpPatch.harmVerdict).toBe('pass');
    expect(foodOpPatch.visionVerdict).toBe('pass');
    expect(foodOpPatch.approvedByOperator).toBe(true);
    expect(foodOpPatch.servedAt).toEqual(now);
    expect(foodOpPatch.moderatedAt).toEqual(now);

    const tripOpPatch = operatorApprovePatch({ targetKind: 'trip' }, now);
    expect(tripOpPatch.status).toBe('approved');
    expect(tripOpPatch.harmVerdict).toBe('pass');
    expect(tripOpPatch.visionVerdict).toBeNull();
    expect(tripOpPatch.approvedByOperator).toBe(true);

    // Any outcome leading to approved has pass verdicts
    const successRow: StatusMachineRow = {
      status: 'pending',
      attempts: 1,
      targetKind: 'food_log',
    };
    const approvedPatch = applyOutcome(successRow, { kind: 'publish_success' }, now, { maxAttempts: 6 });
    expect(approvedPatch.status).toBe('approved');
    if (approvedPatch.status === 'approved') {
      expect(approvedPatch.harmVerdict).toBe('pass');
      expect(approvedPatch.visionVerdict).toBe('pass');
    }
  });

  // Feature: photo-uploads, Property 8: Provider errors never decide a photo
  it('Property 8: Retryable outcomes keep photo pending with backoff and leaseUntil null until attempts >= max, then immediate needs_review without verdict', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('food_log', 'trip') as fc.Arbitrary<PhotoTargetKind>,
        fc.constantFrom('harm_bad_request', 'timeout', 'network_error', 'harm_http_500'),
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z') }),
        (targetKind, code, now) => {
          const cfg = { maxAttempts: 6 };
          let attempts = 0;

          // Attempts 1 to 5: must stay pending with backoff and leaseUntil === null
          while (attempts < 5) {
            attempts++;
            const row: StatusMachineRow = {
              status: 'pending',
              attempts,
              targetKind,
            };
            const outcome: ModerationOutcome = { kind: 'retryable', code };
            const patch = applyOutcome(row, outcome, now, cfg);

            expect(patch.status).toBe('pending');
            if (patch.status === 'pending') {
              expect(patch.leaseUntil).toBeNull();
              expect(patch.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
              expect(patch.lastErrorCode).toBe(code);
              // Never writes a verdict!
              expect(patch.harmVerdict).toBeUndefined();
              expect(patch.visionVerdict).toBeUndefined();
            }
          }

          // 6th attempt (attempts = 6 >= maxAttempts 6): must escalate to needs_review immediately
          attempts++;
          const finalRow: StatusMachineRow = {
            status: 'pending',
            attempts,
            targetKind,
          };
          const outcome: ModerationOutcome = { kind: 'retryable', code };
          const finalPatch = applyOutcome(finalRow, outcome, now, cfg);

          expect(finalPatch.status).toBe('needs_review');
          if (finalPatch.status === 'needs_review') {
            expect(finalPatch.lastErrorCode).toBe(code);
            expect(finalPatch.leaseUntil).toBeNull();
            // In the same step: no future nextAttemptAt wait scheduled
            expect('nextAttemptAt' in finalPatch).toBe(false);
            // Never writes a verdict!
            expect(finalPatch.harmVerdict).toBeUndefined();
            expect(finalPatch.visionVerdict).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exhaustive servingCleanupAfterZeroRows over all 7 statuses', () => {
    expect(servingCleanupAfterZeroRows('approved')).toBe('keep');
    expect(servingCleanupAfterZeroRows('hidden')).toBe('keep');
    expect(servingCleanupAfterZeroRows('uploading')).toBe('delete_serving_keys');
    expect(servingCleanupAfterZeroRows('pending')).toBe('delete_serving_keys');
    expect(servingCleanupAfterZeroRows('needs_review')).toBe('delete_serving_keys');
    expect(servingCleanupAfterZeroRows('rejected')).toBe('delete_serving_keys');
    expect(servingCleanupAfterZeroRows('deleted')).toBe('delete_serving_keys');
  });
});
