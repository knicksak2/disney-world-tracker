import fc from 'fast-check';
import { buildInitiatePayload, buildPutPlans, type UploadTarget } from '../uploadPlan';
import { pickTakenAt } from '../photoPicker.pure';
import type { PreparedImages } from '../imagePrep.pure';

// Feature: photo-uploads, Property 33: Declared sizes equal sent sizes
describe('uploadPlan & pickTakenAt (Property 33)', () => {
  it('Property 33: declared sizes equal blob sizes exactly, PUT bodies equal blob instances, only Content-Type set, no Content-Length', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (fullSize, thumbSize, width, height) => {
          // Create fake Blobs with specified sizes
          const fullBlob = new Blob([new Uint8Array(fullSize)], { type: 'image/jpeg' });
          const thumbBlob = new Blob([new Uint8Array(thumbSize)], { type: 'image/jpeg' });

          const prepared: PreparedImages = {
            full: {
              uri: 'file:///data/full.jpg',
              width,
              height,
              blob: fullBlob,
            },
            thumb: {
              uri: 'file:///data/thumb.jpg',
              width: Math.min(width, 320),
              height: Math.min(height, 320),
              blob: thumbBlob,
            },
          };

          const target: UploadTarget = {
            kind: 'food_log',
            id: '11111111-1111-4111-8111-111111111111',
          };

          const payload = buildInitiatePayload(prepared, target);

          // Declared sizes must equal blob sizes exactly
          const item = payload.items[0];
          expect(item).toBeDefined();
          if (!item) return;
          expect(item.byteSize).toBe(fullSize);
          expect(item.thumbByteSize).toBe(thumbSize);
          expect(item.width).toBe(width);
          expect(item.height).toBe(height);
          expect(item.contentType).toBe('image/jpeg');

          // Build PUT plans
          const slot = {
            putUrl: 'https://storage.example/u/photo-1/full.jpg?sig=xyz',
            thumbPutUrl: 'https://storage.example/u/photo-1/thumb.jpg?sig=xyz',
          };
          const [fullPlan, thumbPlan] = buildPutPlans(prepared, slot);

          // Same Blob objects as bodies (reference equality)
          expect(fullPlan.body).toBe(fullBlob);
          expect(thumbPlan.body).toBe(thumbBlob);

          // Only Content-Type: image/jpeg
          expect(fullPlan.headers).toEqual({ 'Content-Type': 'image/jpeg' });
          expect(thumbPlan.headers).toEqual({ 'Content-Type': 'image/jpeg' });

          // No Content-Length or Authorization headers
          expect((fullPlan.headers as Record<string, string>)['Content-Length']).toBeUndefined();
          expect((fullPlan.headers as Record<string, string>)['content-length']).toBeUndefined();
          expect((fullPlan.headers as Record<string, string>)['Authorization']).toBeUndefined();
          expect((fullPlan.headers as Record<string, string>)['authorization']).toBeUndefined();

          expect((thumbPlan.headers as Record<string, string>)['Content-Length']).toBeUndefined();
          expect((thumbPlan.headers as Record<string, string>)['content-length']).toBeUndefined();
          expect((thumbPlan.headers as Record<string, string>)['Authorization']).toBeUndefined();
          expect((thumbPlan.headers as Record<string, string>)['authorization']).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  describe('pickTakenAt', () => {
    it('reads EXIF DateTimeOriginal and normalises to ISO timestamp (zoneless local time)', () => {
      const asset = {
        exif: {
          DateTimeOriginal: '2024:08:15 14:30:45',
          GPSLatitude: 28.3772,
          GPSLongitude: -81.5707,
          Make: 'Apple',
          Model: 'iPhone 15',
        },
      };

      const takenAt = pickTakenAt(asset, 'library');
      expect(takenAt).toBeDefined();

      // Verify date components match local time parsing
      const parsed = new Date(takenAt!);
      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(7); // August (0-indexed)
      expect(parsed.getDate()).toBe(15);
      expect(parsed.getHours()).toBe(14);
      expect(parsed.getMinutes()).toBe(30);
      expect(parsed.getSeconds()).toBe(45);
    });

    it('handles EXIF DateTimeOriginal with timezone offset', () => {
      const asset = {
        exif: {
          DateTimeOriginal: '2024:08:15 14:30:45-04:00',
        },
      };

      const takenAt = pickTakenAt(asset, 'library');
      expect(takenAt).toBe('2024-08-15T18:30:45.000Z');
    });

    it('handles EXIF with separate OffsetTimeOriginal field', () => {
      const asset = {
        exif: {
          DateTimeOriginal: '2024:08:15 14:30:45',
          OffsetTimeOriginal: '-04:00',
        },
      };

      const takenAt = pickTakenAt(asset, 'library');
      expect(takenAt).toBe('2024-08-15T18:30:45.000Z');
    });

    it('returns current time for camera capture', () => {
      const fixedNow = new Date('2024-09-01T12:00:00.000Z');
      const asset = {
        exif: {
          GPSLatitude: 28.3772,
        },
      };

      const takenAt = pickTakenAt(asset, 'camera', fixedNow);
      expect(takenAt).toBe('2024-09-01T12:00:00.000Z');
    });

    it('returns undefined when EXIF is missing or DateTimeOriginal is missing', () => {
      expect(pickTakenAt(null, 'library')).toBeUndefined();
      expect(pickTakenAt({}, 'library')).toBeUndefined();
      expect(pickTakenAt({ exif: null }, 'library')).toBeUndefined();
      expect(pickTakenAt({ exif: {} }, 'library')).toBeUndefined();
    });

    it('returns undefined for malformed DateTimeOriginal string', () => {
      expect(pickTakenAt({ exif: { DateTimeOriginal: 'not-a-date' } }, 'library')).toBeUndefined();
      expect(pickTakenAt({ exif: { DateTimeOriginal: '2024:99:99 99:99:99' } }, 'library')).toBeUndefined();
      expect(pickTakenAt({ exif: { DateTimeOriginal: '' } }, 'library')).toBeUndefined();
    });

    it('discards all GPS and other metadata from initiate payload', () => {
      const asset = {
        exif: {
          DateTimeOriginal: '2024:08:15 14:30:45-04:00',
          GPSLatitude: 28.3772,
          GPSLongitude: -81.5707,
          GPSAltitude: 25,
          UserComment: 'Secret note',
        },
      };

      const takenAt = pickTakenAt(asset, 'library');

      const blob = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
      const prepared: PreparedImages = {
        full: { uri: 'file:///full.jpg', width: 800, height: 600, blob },
        thumb: { uri: 'file:///thumb.jpg', width: 320, height: 240, blob },
      };

      const target: UploadTarget = {
        kind: 'food_log',
        id: '22222222-2222-4222-8222-222222222222',
      };

      const payload = buildInitiatePayload(prepared, target, takenAt);

      // Verify no GPS or other EXIF fields survived in payload
      const item = payload.items[0];
      expect(item).toBeDefined();
      expect(item).toEqual({
        contentType: 'image/jpeg',
        byteSize: 100,
        thumbByteSize: 100,
        width: 800,
        height: 600,
        takenAt: '2024-08-15T18:30:45.000Z',
      });
      const keys = Object.keys(item ?? {});
      expect(keys.includes('GPSLatitude')).toBe(false);
      expect(keys.includes('GPSLongitude')).toBe(false);
      expect(keys.includes('exif')).toBe(false);
    });
  });
});
