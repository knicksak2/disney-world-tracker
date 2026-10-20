/**
 * Tests for shared Photo constants, schemas, error codes, and HTTP mappings.
 *
 * Validates: Requirements 1.1, 1.2, 3.4, 4.3, 4.10, 10.3, 11.2, 16.1, 17.1, 27.2
 */

import { describe, expect, it } from 'vitest';
import {
  PHOTO_CONTENT_TYPE,
  PHOTO_TARGET_KINDS,
  PHOTO_MAX_ITEMS_PER_INITIATE,
  PHOTO_MAX_DIMENSION_PX,
  PHOTO_FULL_LONG_EDGE_PX,
  PHOTO_FULL_JPEG_QUALITY,
  PHOTO_THUMB_LONG_EDGE_PX,
  PHOTO_THUMB_JPEG_QUALITY,
  PHOTO_REPORT_REASONS,
  PHOTO_REPORT_NOTE_MAX,
  PHOTO_POST_CAPTION_MAX,
  PHOTO_STATUS_POLL_CADENCE_INITIAL_MS,
  PHOTO_STATUS_POLL_CADENCE_FALLBACK_MS,
  PHOTO_STATUS_POLL_INITIAL_WINDOW_MS,
  PHOTO_GALLERY_STALE_TIME_MS,
  PHOTO_DEFAULT_EXPERIENCE_STRIP_MAX,
  PHOTO_DEFAULT_RECAP_HIGHLIGHT_MAX,
  PHOTO_RECAP_HIGHLIGHT_MIN,
  PHOTO_RECAP_HIGHLIGHT_MAX_LIMIT,
  PHOTO_EXPERIENCE_STRIP_MIN,
  PHOTO_EXPERIENCE_STRIP_MAX_LIMIT,
  photoUploadItemSchema,
  photoInitiateSchema,
  photoUploadsRequestSchema,
  photoConfirmSchema,
  photoConfirmRequestSchema,
  photoStatusQuerySchema,
  photoReportSchema,
  photoReportCreateSchema,
  blockCreateSchema,
  tripPostCreateSchema,
  tripAlbumQuerySchema,
  tripRecapPhotosQuerySchema,
  myPhotosQuerySchema,
  foodGalleryQuerySchema,
  errorCodeToHttpStatus,
} from '../index.js';

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const UUID_3 = '00000000-0000-4000-8000-000000000003';

describe('Shared Photos: Constants & Error Mappings', () => {
  it('defines expected constants matching design specifications', () => {
    expect(PHOTO_CONTENT_TYPE).toBe('image/jpeg');
    expect(PHOTO_TARGET_KINDS).toEqual(['food_log', 'trip']);
    expect(PHOTO_MAX_ITEMS_PER_INITIATE).toBe(10);
    expect(PHOTO_MAX_DIMENSION_PX).toBe(4096);
    expect(PHOTO_FULL_LONG_EDGE_PX).toBe(1280);
    expect(PHOTO_FULL_JPEG_QUALITY).toBe(0.75);
    expect(PHOTO_THUMB_LONG_EDGE_PX).toBe(320);
    expect(PHOTO_THUMB_JPEG_QUALITY).toBe(0.7);
    expect(PHOTO_REPORT_REASONS).toEqual([
      'inappropriate',
      'shows_person',
      'not_food',
      'spam',
      'other',
    ]);
    expect(PHOTO_REPORT_NOTE_MAX).toBe(300);
    expect(PHOTO_POST_CAPTION_MAX).toBe(500);
    expect(PHOTO_STATUS_POLL_CADENCE_INITIAL_MS).toBe(3000);
    expect(PHOTO_STATUS_POLL_CADENCE_FALLBACK_MS).toBe(15000);
    expect(PHOTO_STATUS_POLL_INITIAL_WINDOW_MS).toBe(60000);
    expect(PHOTO_GALLERY_STALE_TIME_MS).toBe(30 * 60 * 1000);
    expect(PHOTO_DEFAULT_EXPERIENCE_STRIP_MAX).toBe(8);
    expect(PHOTO_DEFAULT_RECAP_HIGHLIGHT_MAX).toBe(6);
    expect(PHOTO_RECAP_HIGHLIGHT_MIN).toBe(1);
    expect(PHOTO_RECAP_HIGHLIGHT_MAX_LIMIT).toBe(24);
    expect(PHOTO_EXPERIENCE_STRIP_MIN).toBe(1);
    expect(PHOTO_EXPERIENCE_STRIP_MAX_LIMIT).toBe(24);
  });

  it('maps all photo error codes to expected HTTP status codes', () => {
    expect(errorCodeToHttpStatus.photo_not_found).toBe(404);
    expect(errorCodeToHttpStatus.photo_upload_invalid).toBe(400);
    expect(errorCodeToHttpStatus.photo_quota_exceeded).toBe(429);
    expect(errorCodeToHttpStatus.photo_target_full).toBe(409);
    expect(errorCodeToHttpStatus.photo_uploads_disabled).toBe(503);
    expect(errorCodeToHttpStatus.photo_uploads_banned).toBe(403);
  });
});

describe('Shared Photos: Schemas', () => {
  describe('photoUploadsRequestSchema / photoInitiateSchema', () => {
    const validItem = {
      contentType: 'image/jpeg',
      byteSize: 200000,
      thumbByteSize: 15000,
      width: 1280,
      height: 960,
      takenAt: '2026-10-18T12:00:00.000Z',
    };

    it('accepts valid food_log initiate payload with 1 item', () => {
      const parsed = photoUploadsRequestSchema.safeParse({
        target: { kind: 'food_log', id: UUID_1 },
        items: [validItem],
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts valid trip initiate payload with multiple items up to 10', () => {
      const items = Array.from({ length: 10 }, () => ({ ...validItem }));
      const parsed = photoInitiateSchema.safeParse({
        target: { kind: 'trip', id: UUID_2 },
        items,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects empty items array (< 1)', () => {
      const parsed = photoUploadsRequestSchema.safeParse({
        target: { kind: 'food_log', id: UUID_1 },
        items: [],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects more than 10 items (> 10)', () => {
      const items = Array.from({ length: 11 }, () => ({ ...validItem }));
      const parsed = photoUploadsRequestSchema.safeParse({
        target: { kind: 'food_log', id: UUID_1 },
        items,
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects invalid target kind', () => {
      const parsed = photoUploadsRequestSchema.safeParse({
        target: { kind: 'user', id: UUID_1 },
        items: [validItem],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-jpeg content type', () => {
      const parsed = photoUploadsRequestSchema.safeParse({
        target: { kind: 'food_log', id: UUID_1 },
        items: [{ ...validItem, contentType: 'image/png' }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-positive sizes or dimensions exceeding maximum', () => {
      expect(
        photoUploadItemSchema.safeParse({ ...validItem, byteSize: 0 }).success,
      ).toBe(false);
      expect(
        photoUploadItemSchema.safeParse({ ...validItem, width: 4097 }).success,
      ).toBe(false);
      expect(
        photoUploadItemSchema.safeParse({ ...validItem, height: 0 }).success,
      ).toBe(false);
    });
  });

  describe('photoConfirmRequestSchema / photoConfirmSchema', () => {
    it('accepts 1 to 10 UUIDs', () => {
      expect(
        photoConfirmRequestSchema.safeParse({ photoIds: [UUID_1] }).success,
      ).toBe(true);
      const ten = Array.from({ length: 10 }, () => UUID_1);
      expect(photoConfirmSchema.safeParse({ photoIds: ten }).success).toBe(true);
    });

    it('rejects empty photoIds or > 10 photoIds', () => {
      expect(photoConfirmRequestSchema.safeParse({ photoIds: [] }).success).toBe(
        false,
      );
      const eleven = Array.from({ length: 11 }, () => UUID_1);
      expect(
        photoConfirmRequestSchema.safeParse({ photoIds: eleven }).success,
      ).toBe(false);
    });

    it('rejects non-UUID photoId', () => {
      expect(
        photoConfirmRequestSchema.safeParse({ photoIds: ['not-a-uuid'] }).success,
      ).toBe(false);
    });
  });

  describe('photoStatusQuerySchema', () => {
    it('parses and transforms a single UUID string', () => {
      const res = photoStatusQuerySchema.safeParse({ ids: UUID_1 });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.ids).toEqual([UUID_1]);
      }
    });

    it('parses and transforms comma-separated UUIDs with whitespace', () => {
      const res = photoStatusQuerySchema.safeParse({
        ids: ` ${UUID_1} ,  ${UUID_2} , ${UUID_3} `,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.ids).toEqual([UUID_1, UUID_2, UUID_3]);
      }
    });

    it('rejects empty ids string', () => {
      expect(photoStatusQuerySchema.safeParse({ ids: '' }).success).toBe(false);
      expect(photoStatusQuerySchema.safeParse({ ids: '   ' }).success).toBe(false);
    });

    it('rejects more than 10 UUIDs', () => {
      const ids = Array.from({ length: 11 }, () => UUID_1).join(',');
      expect(photoStatusQuerySchema.safeParse({ ids }).success).toBe(false);
    });

    it('rejects invalid UUID in the list', () => {
      expect(
        photoStatusQuerySchema.safeParse({ ids: `${UUID_1},invalid-uuid` }).success,
      ).toBe(false);
    });
  });

  describe('photoReportCreateSchema / photoReportSchema', () => {
    it('accepts valid reasons with optional note and shareId', () => {
      for (const reason of PHOTO_REPORT_REASONS) {
        expect(
          photoReportCreateSchema.safeParse({ reason }).success,
        ).toBe(true);
      }
      expect(
        photoReportSchema.safeParse({
          reason: 'inappropriate',
          note: 'Contains offensive content',
          shareId: UUID_2,
        }).success,
      ).toBe(true);
    });

    it('rejects invalid reason', () => {
      expect(
        photoReportCreateSchema.safeParse({ reason: 'not_a_reason' }).success,
      ).toBe(false);
    });

    it('rejects note longer than PHOTO_REPORT_NOTE_MAX (300)', () => {
      expect(
        photoReportCreateSchema.safeParse({
          reason: 'spam',
          note: 'a'.repeat(301),
        }).success,
      ).toBe(false);
    });
  });

  describe('blockCreateSchema', () => {
    it('accepts { userId }', () => {
      const res = blockCreateSchema.safeParse({ userId: UUID_1 });
      expect(res.success).toBe(true);
    });

    it('accepts { photoId } and optional shareId', () => {
      expect(blockCreateSchema.safeParse({ photoId: UUID_1 }).success).toBe(true);
      expect(
        blockCreateSchema.safeParse({ photoId: UUID_1, shareId: UUID_2 }).success,
      ).toBe(true);
    });

    it('rejects empty object or object with both userId and photoId', () => {
      expect(blockCreateSchema.safeParse({}).success).toBe(false);
      expect(
        blockCreateSchema.safeParse({ userId: UUID_1, photoId: UUID_2 }).success,
      ).toBe(false);
    });

    it('rejects unrecognized properties due to strict mode', () => {
      expect(
        blockCreateSchema.safeParse({ userId: UUID_1, extra: 'bad' }).success,
      ).toBe(false);
    });
  });

  describe('tripPostCreateSchema', () => {
    it('accepts 1 to 4 photoIds with optional caption up to 500 chars', () => {
      expect(
        tripPostCreateSchema.safeParse({ photoIds: [UUID_1] }).success,
      ).toBe(true);
      expect(
        tripPostCreateSchema.safeParse({
          photoIds: [UUID_1, UUID_2, UUID_3, UUID_1],
          caption: 'Great trip day!',
        }).success,
      ).toBe(true);
    });

    it('rejects 0 or > 4 photoIds', () => {
      expect(tripPostCreateSchema.safeParse({ photoIds: [] }).success).toBe(false);
      expect(
        tripPostCreateSchema.safeParse({
          photoIds: [UUID_1, UUID_2, UUID_3, UUID_1, UUID_2],
        }).success,
      ).toBe(false);
    });

    it('rejects caption longer than PHOTO_POST_CAPTION_MAX (500)', () => {
      expect(
        tripPostCreateSchema.safeParse({
          photoIds: [UUID_1],
          caption: 'x'.repeat(501),
        }).success,
      ).toBe(false);
    });
  });

  describe('tripAlbumQuerySchema & myPhotosQuerySchema', () => {
    it('accepts valid album query params with optional summary boolean transform', () => {
      const res1 = tripAlbumQuerySchema.safeParse({ summary: 'true' });
      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.data.summary).toBe(true);
      }
      const res2 = tripAlbumQuerySchema.safeParse({ summary: 'false' });
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.data.summary).toBe(false);
      }
    });

    it('validates myPhotosQuerySchema requires targetKind and scopeId', () => {
      expect(
        myPhotosQuerySchema.safeParse({
          targetKind: 'food_log',
          scopeId: UUID_1,
        }).success,
      ).toBe(true);
      expect(
        myPhotosQuerySchema.safeParse({
          scopeId: UUID_1,
        }).success,
      ).toBe(false);
    });
  });

  describe('foodGalleryQuerySchema (Task 1.5)', () => {
    it('accepts empty object (all optional)', () => {
      expect(foodGalleryQuerySchema.safeParse({}).success).toBe(true);
    });

    it('accepts valid cursor and limit in 1..100', () => {
      const res = foodGalleryQuerySchema.safeParse({
        cursor: 'eyJuZXh0IjoyfQ==',
        limit: '50',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.limit).toBe(50);
        expect(res.data.cursor).toBe('eyJuZXh0IjoyfQ==');
      }
    });

    it('rejects limit < 1 or limit > 100', () => {
      expect(foodGalleryQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(foodGalleryQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('rejects unknown query keys', () => {
      expect(
        foodGalleryQuerySchema.safeParse({ limit: 10, unknown: 'param' }).success,
      ).toBe(false);
    });
  });

  describe('tripRecapPhotosQuerySchema (D35, R15.25)', () => {
    it('accepts an empty object, a cursor, and limits 1, 40 (string) and 100', () => {
      expect(tripRecapPhotosQuerySchema.safeParse({}).success).toBe(true);
      expect(tripRecapPhotosQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(true);
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
      const res = tripRecapPhotosQuerySchema.safeParse({ limit: '40' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.limit).toBe(40);
      }
    });

    it('rejects limit 0, 101, 1.5 and a non-number', () => {
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
    });

    it('rejects an empty cursor and a cursor longer than 200 characters', () => {
      expect(tripRecapPhotosQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ cursor: 'a'.repeat(200) }).success).toBe(true);
      expect(tripRecapPhotosQuerySchema.safeParse({ cursor: 'a'.repeat(201) }).success).toBe(false);
    });

    it('rejects unknown keys (foo, summary, shareId)', () => {
      expect(tripRecapPhotosQuerySchema.safeParse({ foo: '1' }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ summary: 'true' }).success).toBe(false);
      expect(tripRecapPhotosQuerySchema.safeParse({ shareId: UUID_1 }).success).toBe(false);
    });
  });
});
