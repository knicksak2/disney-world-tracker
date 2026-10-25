import type { MyPhotoDTO } from '@dwt/shared';
import {
  flattenMyPhotoPages,
  effectiveStatus,
  effectiveRejectMessage,
  pollableMyPhotoIds,
  settledByPoll,
  tileImageUri,
  tileAccessibilityLabel,
  formatMyPhotoSubtitle,
  toViewerItem,
} from '../myPhotos.pure';

function makeMockPhoto(overrides: Partial<MyPhotoDTO> = {}): MyPhotoDTO {
  return {
    id: 'photo-1',
    targetKind: 'food_log',
    targetId: 'log-1',
    scopeId: 'dish-1',
    status: 'approved',
    rejectReason: null,
    rejectMessage: null,
    thumbUrl: 'https://example.com/thumb.jpg',
    url: 'https://example.com/full.jpg',
    width: 800,
    height: 600,
    feedItemId: null,
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

describe('myPhotos.pure unit tests', () => {
  describe('flattenMyPhotoPages', () => {
    it('concatenates pages and removes duplicate IDs keeping the first occurrence', () => {
      const p1 = makeMockPhoto({ id: '1' });
      const p2 = makeMockPhoto({ id: '2' });
      const p3 = makeMockPhoto({ id: '3' });
      const p2Duplicate = makeMockPhoto({ id: '2', status: 'hidden' });

      const pages = [
        { items: [p1, p2], nextCursor: 'c1' },
        { items: [p2Duplicate, p3], nextCursor: null },
      ];

      const flattened = flattenMyPhotoPages(pages);
      expect(flattened).toHaveLength(3);
      expect(flattened.map((p) => p.id)).toEqual(['1', '2', '3']);
      expect(flattened[1]!.status).toBe('approved'); // First kept
    });

    it('returns empty array for empty pages and does not mutate input', () => {
      const pages = [{ items: [], nextCursor: null }];
      expect(flattenMyPhotoPages(pages)).toEqual([]);
      expect(flattenMyPhotoPages([])).toEqual([]);
    });
  });

  describe('effectiveStatus & effectiveRejectMessage', () => {
    it('returns polled status when list item is pending', () => {
      const item = makeMockPhoto({ id: 'p1', status: 'pending' });
      const polled = { p1: { status: 'approved' as const } };
      expect(effectiveStatus(item, polled)).toBe('approved');
    });

    it('returns list status when list item is not pending (stale polled value guard)', () => {
      const item = makeMockPhoto({ id: 'p1', status: 'hidden' });
      const polled = { p1: { status: 'approved' as const } };
      // Polled approved must NOT override list hidden
      expect(effectiveStatus(item, polled)).toBe('hidden');
    });

    it('returns polled rejectMessage when list item is pending', () => {
      const item = makeMockPhoto({ id: 'p1', status: 'pending', rejectMessage: null });
      const polled = { p1: { rejectMessage: 'Polled reject reason' } };
      expect(effectiveRejectMessage(item, polled)).toBe('Polled reject reason');
    });

    it('returns list rejectMessage when list item is not pending', () => {
      const item = makeMockPhoto({ id: 'p1', status: 'rejected', rejectMessage: 'List reason' });
      const polled = { p1: { rejectMessage: 'Polled reason' } };
      expect(effectiveRejectMessage(item, polled)).toBe('List reason');
    });
  });

  describe('pollableMyPhotoIds', () => {
    it('returns pending photo ids that are not in settled', () => {
      const items = [
        makeMockPhoto({ id: '1', status: 'pending' }),
        makeMockPhoto({ id: '2', status: 'uploading' }),
        makeMockPhoto({ id: '3', status: 'approved' }),
        makeMockPhoto({ id: '4', status: 'pending' }),
      ];
      const settled = new Set(['1']);

      const pollable = pollableMyPhotoIds(items, settled);
      expect(pollable).toEqual(['4']);
    });
  });

  describe('settledByPoll', () => {
    it('returns photo IDs whose polled status is needs_review or hidden', () => {
      const polled = {
        '1': { status: 'approved' as const },
        '2': { status: 'needs_review' as const },
        '3': { status: 'hidden' as const },
        '4': { status: 'rejected' as const },
        '5': undefined,
      };

      const settled = settledByPoll(polled);
      expect(settled.sort()).toEqual(['2', '3']);
    });
  });

  describe('tileImageUri', () => {
    it('returns null for uploading and rejected photos or null thumbUrl', () => {
      expect(tileImageUri(makeMockPhoto({ status: 'uploading', thumbUrl: 'https://thumb' }))).toBeNull();
      expect(tileImageUri(makeMockPhoto({ status: 'rejected', thumbUrl: 'https://thumb' }))).toBeNull();
      expect(tileImageUri(makeMockPhoto({ status: 'approved', thumbUrl: null }))).toBeNull();
    });

    it('returns thumbUrl for approved, pending, needs_review, hidden when thumbUrl exists', () => {
      expect(tileImageUri(makeMockPhoto({ status: 'approved', thumbUrl: 'https://thumb.jpg' }))).toBe(
        'https://thumb.jpg'
      );
      expect(tileImageUri(makeMockPhoto({ status: 'pending', thumbUrl: 'https://thumb.jpg' }))).toBe(
        'https://thumb.jpg'
      );
      expect(tileImageUri(makeMockPhoto({ status: 'needs_review', thumbUrl: 'https://thumb.jpg' }))).toBe(
        'https://thumb.jpg'
      );
      expect(tileImageUri(makeMockPhoto({ status: 'hidden', thumbUrl: 'https://thumb.jpg' }))).toBe(
        'https://thumb.jpg'
      );
    });
  });

  describe('tileAccessibilityLabel', () => {
    it('returns exact kind-based accessibility label', () => {
      expect(tileAccessibilityLabel(makeMockPhoto({ targetKind: 'food_log' }))).toBe(
        'Food photo, opens viewer'
      );
      expect(tileAccessibilityLabel(makeMockPhoto({ targetKind: 'trip' }))).toBe(
        'Trip photo, opens viewer'
      );
    });

    it('returns fallback label for any unknown target kind', () => {
      const unknownItem = makeMockPhoto({ targetKind: 'experience' as any });
      expect(tileAccessibilityLabel(unknownItem)).toBe('Photo, opens viewer');
    });
  });

  describe('formatMyPhotoSubtitle', () => {
    it('formats kind and date in America/New_York time zone', () => {
      // 2026-10-23T18:00:00Z is 2:00 PM EDT on Oct 23, 2026
      expect(formatMyPhotoSubtitle('food_log', '2026-10-23T18:00:00.000Z')).toBe(
        'Food photo • Oct 23, 2026'
      );
      expect(formatMyPhotoSubtitle('trip', '2026-07-04T12:00:00.000Z')).toBe(
        'Trip photo • Jul 4, 2026'
      );
      expect(formatMyPhotoSubtitle('other_kind', '2026-10-23T18:00:00.000Z')).toBe(
        'Photo • Oct 23, 2026'
      );
    });

    it('falls back to kind label if createdAt is omitted or invalid', () => {
      expect(formatMyPhotoSubtitle('food_log')).toBe('Food photo');
      expect(formatMyPhotoSubtitle('trip', 'invalid-date')).toBe('Trip photo');
      expect(formatMyPhotoSubtitle('unknown', undefined)).toBe('Photo');
    });
  });

  describe('toViewerItem', () => {
    it('returns url and thumbUrl as null for uploading and rejected items even if thumbUrl is present in DTO', () => {
      const uploadingItem = makeMockPhoto({
        status: 'uploading',
        url: null,
        thumbUrl: 'https://example.com/u_thumb.jpg',
      });
      const viewerItem1 = toViewerItem(uploadingItem);
      expect(viewerItem1.url).toBeNull();
      expect(viewerItem1.thumbUrl).toBeNull();
      expect(viewerItem1.mine).toBe(true);
      expect(viewerItem1.uploader?.displayName).toBe('You');

      const rejectedItem = makeMockPhoto({
        status: 'rejected',
        url: null,
        thumbUrl: null,
      });
      const viewerItem2 = toViewerItem(rejectedItem);
      expect(viewerItem2.url).toBeNull();
      expect(viewerItem2.thumbUrl).toBeNull();
    });

    it('passes url and thumbUrl through for approved item', () => {
      const approvedItem = makeMockPhoto({
        status: 'approved',
        url: 'https://example.com/full.jpg',
        thumbUrl: 'https://example.com/thumb.jpg',
        targetKind: 'trip',
        createdAt: '2026-10-23T18:00:00.000Z',
      });
      const viewerItem = toViewerItem(approvedItem);
      expect(viewerItem.url).toBe('https://example.com/full.jpg');
      expect(viewerItem.thumbUrl).toBe('https://example.com/thumb.jpg');
      expect(viewerItem.mine).toBe(true);
      expect(viewerItem.uploader?.displayName).toBe('You');
      expect(viewerItem.subtitle).toBe('Trip photo • Oct 23, 2026');
    });
  });
});
