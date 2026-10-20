import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  canViewPhoto,
  tripPostSlotState,
  postVisibleToNonAuthor,
  readKeysFor,
  bylineFor,
  type CanViewPhotoFacts,
} from '../accessPolicy.js';
import { checkTargetCap, reserveDailyAllowed } from '../quota.js';
import { shouldAutoHide } from '../reportPolicy.js';
import { PHOTO_STATUSES, type PhotoTargetKind, type TripPostSlotState } from '@dwt/shared';

describe('accessPolicy', () => {
  // Feature: photo-uploads, Property 10: Visibility oracle
  it('Property 10: Visibility oracle matches truth table for all combinations', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.option(fc.uuid(), { nil: null }),
        fc.constantFrom(...PHOTO_STATUSES),
        fc.constantFrom('food_log', 'trip') as fc.Arbitrary<PhotoTargetKind>,
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('gallery', 'album', 'summaryShare') as fc.Arbitrary<'gallery' | 'album' | 'summaryShare'>,
        fc.boolean(),
        (viewerId, ownerId, status, kind, viewerIsMember, blocked, context, shareActive) => {
          const facts: CanViewPhotoFacts = {
            viewerId,
            ownerId,
            status,
            kind,
            viewerIsMember,
            blocked,
            context,
            shareActive,
          };

          const actual = canViewPhoto(facts);

          // Oracle
          let expected = false;
          if (status !== 'deleted') {
            if (ownerId !== null && viewerId === ownerId) {
              expected = true;
            } else if (status === 'approved' && !blocked) {
              if (kind === 'food_log') {
                expected = true;
              } else if (kind === 'trip') {
                if (context === 'summaryShare') {
                  expected = shareActive;
                } else {
                  expected = viewerIsMember;
                }
              }
            }
          }

          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 11: Quota and caps are never exceeded
  it('Property 11: Quota and caps are never exceeded in serialized in-memory model', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            targetKind: fc.constantFrom('food_log', 'trip') as fc.Arbitrary<PhotoTargetKind>,
            targetId: fc.uuid(),
            itemCount: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (requests) => {
          const DAILY_USER_CAP = 20;
          const GLOBAL_DAILY_CAP = 2000;
          const MAX_PER_FOOD_LOG = 4;
          const MAX_PER_TRIP = 300;

          const userDailyCounts = new Map<string, number>();
          const targetCounts = new Map<string, number>();
          let globalUploads = 0;

          for (const req of requests) {
            const userCount = userDailyCounts.get(req.userId) ?? 0;
            const targetCount = targetCounts.get(req.targetId) ?? 0;
            const targetMax = req.targetKind === 'food_log' ? MAX_PER_FOOD_LOG : MAX_PER_TRIP;

            const canUserDaily = reserveDailyAllowed(userCount, req.itemCount, DAILY_USER_CAP);
            const canGlobal = reserveDailyAllowed(globalUploads, req.itemCount, GLOBAL_DAILY_CAP);
            const canTarget = checkTargetCap(targetCount, req.itemCount, targetMax);

            if (canUserDaily && canGlobal && canTarget) {
              userDailyCounts.set(req.userId, userCount + req.itemCount);
              targetCounts.set(req.targetId, targetCount + req.itemCount);
              globalUploads += req.itemCount;
            }
          }

          // Assert invariants hold
          for (const count of userDailyCounts.values()) {
            expect(count).toBeLessThanOrEqual(DAILY_USER_CAP);
          }
          expect(globalUploads).toBeLessThanOrEqual(GLOBAL_DAILY_CAP);
          for (const count of targetCounts.values()) {
            expect(count).toBeLessThanOrEqual(MAX_PER_TRIP);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 13: Report policy
  it('Property 13: Report policy auto-hides approved photos iff countedOpenReports >= threshold for kind', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PHOTO_STATUSES),
        fc.constantFrom('food_log', 'trip') as fc.Arbitrary<PhotoTargetKind>,
        fc.integer({ min: 0, max: 10 }),
        (status, kind, countedOpenReports) => {
          const thresholds = { food: 3, trip: 1 };
          const result = shouldAutoHide({ status, kind, countedOpenReports }, thresholds);

          if (status !== 'approved') {
            expect(result).toBe(false);
          } else {
            const limit = kind === 'food_log' ? 3 : 1;
            expect(result).toBe(countedOpenReports >= limit);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exhaustive truth table for tripPostSlotState over all 7 statuses x 2 mine x 2 blocked (28 combinations)', () => {
    for (const status of PHOTO_STATUSES) {
      for (const mine of [true, false]) {
        for (const blocked of [true, false]) {
          const slot = tripPostSlotState({ status, mine, blocked });

          let expected: TripPostSlotState;
          if (status === 'deleted') {
            expected = 'removed';
          } else if (blocked && !mine) {
            expected = 'unavailable';
          } else if (status === 'approved') {
            expected = 'ready';
          } else if (mine) {
            expected = 'checking';
          } else if (!mine && (status === 'pending' || status === 'needs_review')) {
            expected = 'checking';
          } else if (!mine && status === 'rejected') {
            expected = 'removed';
          } else {
            // !mine && (hidden || uploading)
            expected = 'unavailable';
          }

          expect(slot).toBe(expected);
        }
      }
    }

    // null status also produces removed
    expect(tripPostSlotState({ status: null, mine: true, blocked: false })).toBe('removed');
    expect(tripPostSlotState({ status: null, mine: false, blocked: true })).toBe('removed');
  });

  it('postVisibleToNonAuthor counts ready and checking, ignores removed and unavailable', () => {
    expect(postVisibleToNonAuthor([{ state: 'ready' }])).toBe(true);
    expect(postVisibleToNonAuthor([{ state: 'checking' }])).toBe(true);
    expect(postVisibleToNonAuthor([{ state: 'removed' }, { state: 'ready' }])).toBe(true);
    expect(postVisibleToNonAuthor([{ state: 'removed' }])).toBe(false);
    expect(postVisibleToNonAuthor([{ state: 'unavailable' }])).toBe(false);
    expect(postVisibleToNonAuthor([{ state: 'removed' }, { state: 'unavailable' }])).toBe(false);
    expect(postVisibleToNonAuthor([])).toBe(false);
  });

  it('exhaustive truth table for readKeysFor over all 7 statuses x 3 viewers (21 combinations)', () => {
    const photoId = '123e4567-e89b-12d3-a456-426614174000';
    const viewers = ['owner', 'other', 'admin'] as const;

    for (const status of PHOTO_STATUSES) {
      for (const viewer of viewers) {
        const keys = readKeysFor({ status, viewer }, photoId);

        if (status === 'approved' || status === 'hidden') {
          expect(keys).toEqual({
            full: `p/${photoId}/full.jpg`,
            thumb: `p/${photoId}/thumb.jpg`,
          });
        } else if (status === 'uploading' || status === 'pending') {
          if (viewer === 'owner') {
            expect(keys).toEqual({ uploadThumb: `u/${photoId}/thumb.jpg` });
          } else {
            expect(keys).toEqual({});
          }
        } else if (status === 'needs_review') {
          if (viewer === 'owner') {
            expect(keys).toEqual({ uploadThumb: `u/${photoId}/thumb.jpg` });
          } else if (viewer === 'admin') {
            expect(keys).toEqual({
              uploadThumb: `u/${photoId}/thumb.jpg`,
              uploadFull: `u/${photoId}/full.jpg`,
            });
          } else {
            expect(keys).toEqual({});
          }
        } else {
          // rejected or deleted
          expect(keys).toEqual({});
        }

        // An "other" viewer NEVER gets an upload key
        if (viewer === 'other') {
          expect(keys.uploadFull).toBeUndefined();
          expect(keys.uploadThumb).toBeUndefined();
        }
      }
    }
  });

  it('bylineFor returns uploader DTO for self and Friends, null for stranger', () => {
    const viewerId = '11111111-1111-1111-1111-111111111111';
    const friendId = '22222222-2222-2222-2222-222222222222';
    const strangerId = '33333333-3333-3333-3333-333333333333';
    const friendIds = new Set([friendId]);

    const selfProfile = { displayName: 'Me', avatarPreset: 'mickey' };
    const friendProfile = { displayName: 'Buddy', avatarPreset: 'goofy' };
    const strangerProfile = { displayName: 'Stranger', avatarPreset: 'donald' };

    // Viewer is uploader
    const selfByline = bylineFor({ viewerId, ownerId: viewerId, friendIds, profile: selfProfile });
    expect(selfByline).toEqual({
      userId: viewerId,
      displayName: 'Me',
      avatarPreset: 'mickey',
    });

    // Uploader is Friend
    const friendByline = bylineFor({ viewerId, ownerId: friendId, friendIds, profile: friendProfile });
    expect(friendByline).toEqual({
      userId: friendId,
      displayName: 'Buddy',
      avatarPreset: 'goofy',
    });

    // Uploader is Stranger -> null
    const strangerByline = bylineFor({ viewerId, ownerId: strangerId, friendIds, profile: strangerProfile });
    expect(strangerByline).toBeNull();

    // Missing profile or null owner -> null
    expect(bylineFor({ viewerId, ownerId: null, friendIds, profile: null })).toBeNull();
    expect(bylineFor({ viewerId, ownerId: friendId, friendIds, profile: null })).toBeNull();
  });
});
