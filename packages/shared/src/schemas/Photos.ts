import { z } from 'zod';
import { uuidSchema, isoTimestampSchema } from './primitives.js';
import {
  PHOTO_TARGET_KINDS,
  PHOTO_CONTENT_TYPE,
  PHOTO_MAX_DIMENSION_PX,
  PHOTO_REPORT_REASONS,
  PHOTO_REPORT_NOTE_MAX,
  PHOTO_POST_CAPTION_MAX,
  MY_PHOTOS_MAX_LIMIT,
} from '../constants/photos.js';

export const photoUploadItemSchema = z
  .object({
    contentType: z.literal(PHOTO_CONTENT_TYPE),
    byteSize: z.number().int().positive(),
    thumbByteSize: z.number().int().positive(),
    width: z.number().int().min(1).max(PHOTO_MAX_DIMENSION_PX),
    height: z.number().int().min(1).max(PHOTO_MAX_DIMENSION_PX),
    takenAt: isoTimestampSchema.optional(),
  })
  .strict();

export const photoInitiateSchema = z
  .object({
    target: z
      .object({
        kind: z.enum(PHOTO_TARGET_KINDS),
        id: uuidSchema,
      })
      .strict(),
    items: z.array(photoUploadItemSchema).min(1).max(10),
  })
  .strict();

export const photoConfirmSchema = z
  .object({
    photoIds: z.array(uuidSchema).min(1).max(10),
  })
  .strict();

export const photoStatusQuerySchema = z
  .object({
    ids: z.string().transform((val, ctx) => {
      const parts = val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length < 1 || parts.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ids must contain 1 to 10 comma-separated UUIDs',
        });
        return z.NEVER;
      }
      for (const id of parts) {
        const parsed = uuidSchema.safeParse(id);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid UUID: ${id}`,
          });
          return z.NEVER;
        }
      }
      return parts;
    }),
  })
  .strict();

export const photoReportSchema = z
  .object({
    reason: z.enum(PHOTO_REPORT_REASONS),
    note: z.string().trim().min(1).max(PHOTO_REPORT_NOTE_MAX).optional(),
    shareId: uuidSchema.optional(),
  })
  .strict();

export const blockCreateSchema = z.union([
  z.object({ userId: uuidSchema }).strict(),
  z
    .object({
      photoId: uuidSchema,
      shareId: uuidSchema.optional(),
    })
    .strict(),
]);

export const tripPostCreateSchema = z
  .object({
    photoIds: z.array(uuidSchema).min(1).max(4),
    caption: z.string().trim().min(1).max(PHOTO_POST_CAPTION_MAX).optional(),
  })
  .strict();

export const tripAlbumQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    summary: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

/** GET /me/inbox/:shareId/trip-recap/photos (R15.25, decision D35); default limit 40 is applied by the route. */
export const tripRecapPhotosQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const myPhotosQuerySchema = z
  .object({
    targetKind: z.enum(PHOTO_TARGET_KINDS),
    scopeId: uuidSchema,
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export const foodGalleryQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const myPhotosAllQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MY_PHOTOS_MAX_LIMIT).optional(),
  })
  .strict();

export const photoUploadsRequestSchema = photoInitiateSchema;
export const photoConfirmRequestSchema = photoConfirmSchema;
export const photoReportCreateSchema = photoReportSchema;
