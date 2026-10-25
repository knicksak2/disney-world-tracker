import { describe, it, expect } from 'vitest';
import {
  MY_PHOTOS_DEFAULT_LIMIT,
  MY_PHOTOS_MAX_LIMIT,
  myPhotosAllQuerySchema,
} from '../index.js';

describe('My Photos query schema and constants (Requirement 29.4, 29.8)', () => {
  it('defines the expected limit constants', () => {
    expect(MY_PHOTOS_DEFAULT_LIMIT).toBe(40);
    expect(MY_PHOTOS_MAX_LIMIT).toBe(100);
  });

  describe('valid query inputs', () => {
    it('accepts an empty query object', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.cursor).toBeUndefined();
        expect(parsed.data.limit).toBeUndefined();
      }
    });

    it('accepts limit as strings "1" and "100" and coerces to integer', () => {
      const p1 = myPhotosAllQuerySchema.safeParse({ limit: '1' });
      expect(p1.success).toBe(true);
      if (p1.success) {
        expect(p1.data.limit).toBe(1);
      }

      const p100 = myPhotosAllQuerySchema.safeParse({ limit: '100' });
      expect(p100.success).toBe(true);
      if (p100.success) {
        expect(p100.data.limit).toBe(100);
      }
    });

    it('accepts a valid cursor string', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ cursor: 'some-valid-cursor-string' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.cursor).toBe('some-valid-cursor-string');
      }
    });

    it('accepts both cursor and limit together', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({
        cursor: 'abc',
        limit: '50',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.cursor).toBe('abc');
        expect(parsed.data.limit).toBe(50);
      }
    });
  });

  describe('invalid query inputs', () => {
    it('rejects limit "0"', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ limit: '0' });
      expect(parsed.success).toBe(false);
    });

    it('rejects limit "101"', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ limit: '101' });
      expect(parsed.success).toBe(false);
    });

    it('rejects limit "1.5"', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ limit: '1.5' });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-numeric limit "abc"', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ limit: 'abc' });
      expect(parsed.success).toBe(false);
    });

    it('rejects empty cursor', () => {
      const parsed = myPhotosAllQuerySchema.safeParse({ cursor: '' });
      expect(parsed.success).toBe(false);
    });

    it('rejects cursor exceeding 200 characters', () => {
      const longCursor = 'a'.repeat(201);
      const parsed = myPhotosAllQuerySchema.safeParse({ cursor: longCursor });
      expect(parsed.success).toBe(false);
    });

    it('rejects disallowed extra keys because the schema is strict', () => {
      const extraKeys = [
        { userId: '123e4567-e89b-12d3-a456-426614174000' },
        { ownerId: '123e4567-e89b-12d3-a456-426614174000' },
        { targetKind: 'food_log' },
        { scopeId: '123e4567-e89b-12d3-a456-426614174000' },
      ];

      for (const extra of extraKeys) {
        const parsed = myPhotosAllQuerySchema.safeParse(extra);
        expect(parsed.success, `Should reject ${Object.keys(extra)[0]}`).toBe(false);
      }
    });
  });
});

