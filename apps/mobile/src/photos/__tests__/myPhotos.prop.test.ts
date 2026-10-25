import fc from 'fast-check';
import type { MyPhotoDTO, PhotoPageDTO, PhotoStatus, PhotoTargetKind } from '@dwt/shared';
import {
  flattenMyPhotoPages,
  effectiveStatus,
  effectiveRejectMessage,
  pollableMyPhotoIds,
  settledByPoll,
  tileImageUri,
  tileAccessibilityLabel,
  toViewerItem,
} from '../myPhotos.pure';

const STATUSES: readonly PhotoStatus[] = [
  'uploading',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'hidden',
  'deleted',
];

const TARGET_KINDS: readonly PhotoTargetKind[] = ['food_log', 'trip'];

const photoArb = fc.record({
  id: fc.uuid(),
  targetKind: fc.constantFrom<PhotoTargetKind>(...TARGET_KINDS),
  targetId: fc.uuid(),
  scopeId: fc.uuid(),
  status: fc.constantFrom<PhotoStatus>(...STATUSES),
  rejectReason: fc.constantFrom<'harm' | null>('harm', null),
  rejectMessage: fc.constantFrom<string | null>('Rejected message', null),
  thumbUrl: fc.constantFrom<string | null>('https://thumb.jpg', null),
  url: fc.constantFrom<string | null>('https://full.jpg', null),
  width: fc.integer({ min: 100, max: 4000 }),
  height: fc.integer({ min: 100, max: 4000 }),
  feedItemId: fc.constantFrom<string | null>(null, 'feed-1'),
  createdAt: fc.constant('2026-05-01T10:00:00Z'),
});

describe('Property 50: The My Photos client model', () => {
  // Feature: photo-uploads, Property 50: The My Photos client model is order-preserving, duplicate-free, and polls only pending photos
  it('Property 50: The My Photos client model is order-preserving, duplicate-free, and polls only pending photos', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            items: fc.array(photoArb, { maxLength: 10 }),
            nextCursor: fc.constantFrom<string | null>('cursor', null),
          }),
          { maxLength: 5 }
        ),
        fc.dictionary(
          fc.uuid(),
          fc.record({
            status: fc.constantFrom<PhotoStatus>(...STATUSES),
            rejectMessage: fc.constantFrom<string | null>('Polled message', null),
          })
        ),
        fc.array(fc.uuid(), { maxLength: 5 }),
        (pages: ReadonlyArray<PhotoPageDTO<MyPhotoDTO>>, polledMap, settledArr) => {
          const settledSet = new Set(settledArr);

          // 1. flattenMyPhotoPages
          const pagesCopy = JSON.parse(JSON.stringify(pages));
          const flattened = flattenMyPhotoPages(pages);
          expect(pages).toEqual(pagesCopy); // never mutates input

          const allInputItems = pages.flatMap((p) => p.items);
          const expectedDistinctIds = new Set(allInputItems.map((i) => i.id));
          expect(flattened.length).toBe(expectedDistinctIds.size);

          // Order-preserving and first occurrence kept
          const seenIds = new Set<string>();
          let flatIndex = 0;
          for (const item of allInputItems) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              expect(flattened[flatIndex]!.id).toBe(item.id);
              flatIndex++;
            }
          }

          // 2. pollableMyPhotoIds
          const pollableIds = pollableMyPhotoIds(flattened, settledSet);
          for (const id of pollableIds) {
            const item = flattened.find((p) => p.id === id)!;
            expect(item.status).toBe('pending');
            expect(settledSet.has(id)).toBe(false);
          }
          for (const item of flattened) {
            if (item.status === 'pending' && !settledSet.has(item.id)) {
              expect(pollableIds).toContain(item.id);
            } else {
              expect(pollableIds).not.toContain(item.id);
            }
          }

          // 3. settledByPoll
          const settledIds = settledByPoll(polledMap);
          for (const id of settledIds) {
            const val = polledMap[id];
            expect(val?.status === 'needs_review' || val?.status === 'hidden').toBe(true);
          }
          for (const [id, val] of Object.entries(polledMap)) {
            if (val && (val.status === 'needs_review' || val.status === 'hidden')) {
              expect(settledIds).toContain(id);
            }
          }

          // 4. effectiveStatus & effectiveRejectMessage
          for (const item of flattened) {
            const effStatus = effectiveStatus(item, polledMap);
            const effReject = effectiveRejectMessage(item, polledMap);

            if (item.status === 'pending') {
              const polled = polledMap[item.id];
              expect(effStatus).toBe(polled?.status ?? item.status);
              expect(effReject).toBe(polled?.rejectMessage ?? item.rejectMessage);
            } else {
              expect(effStatus).toBe(item.status);
              expect(effReject).toBe(item.rejectMessage);
            }

            // 5. tileImageUri
            const uri = tileImageUri(item);
            if (item.status === 'uploading' || item.status === 'rejected' || !item.thumbUrl) {
              expect(uri).toBeNull();
            } else {
              expect(uri).toBe(item.thumbUrl);
            }

            // 6. tileAccessibilityLabel
            const label = tileAccessibilityLabel(item);
            expect(label.length).toBeGreaterThan(0);
            if (item.targetKind === 'food_log') {
              expect(label).toBe('Food photo, opens viewer');
            } else if (item.targetKind === 'trip') {
              expect(label).toBe('Trip photo, opens viewer');
            }

            // Unknown target kind fallback
            const unknownTargetItem = { ...item, targetKind: 'other_kind' as any };
            expect(tileAccessibilityLabel(unknownTargetItem)).toBe('Photo, opens viewer');

            // 7. toViewerItem
            const viewerItem = toViewerItem(item);
            expect(viewerItem.mine).toBe(true);
            expect(viewerItem.uploader?.displayName).toBe('You');
            if (uri === null) {
              expect(viewerItem.url).toBeNull();
              expect(viewerItem.thumbUrl).toBeNull();
            } else {
              expect(viewerItem.url).toBe(item.url);
              expect(viewerItem.thumbUrl).toBe(item.thumbUrl);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
