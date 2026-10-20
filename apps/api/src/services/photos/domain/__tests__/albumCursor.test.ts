import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeAlbumCursor, decodeAlbumCursor } from '../albumCursor.js';

describe('albumCursor', () => {
  it('round-trips arbitrary valid (sortAt, id) pairs', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z') }), fc.uuid(), (sortAt, id) => {
        const cursor = encodeAlbumCursor({ sortAt, id });
        expect(typeof cursor).toBe('string');

        const decoded = decodeAlbumCursor(cursor);
        expect(decoded).not.toBeNull();
        if (decoded) {
          expect(decoded.id).toBe(id);
          expect(decoded.sortAt.toISOString()).toBe(sortAt.toISOString());
        }
      }),
      { numRuns: 100 }
    );
  });

  it('accepts string sortAt in ISO format for encode', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const iso = '2025-05-15T14:30:00.000Z';
    const cursor = encodeAlbumCursor({ sortAt: iso, id });
    const decoded = decodeAlbumCursor(cursor);
    expect(decoded).toEqual({
      id,
      sortAt: new Date(iso),
    });
  });

  it('returns null on malformed cursor inputs', () => {
    expect(decodeAlbumCursor('')).toBeNull();
    expect(decodeAlbumCursor('not-valid-base64!@#$')).toBeNull();
    expect(decodeAlbumCursor(Buffer.from('not json', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeAlbumCursor(Buffer.from('123', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeAlbumCursor(Buffer.from('[]', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeAlbumCursor(Buffer.from('{}', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeAlbumCursor(Buffer.from(JSON.stringify({ s: 'not-a-date', i: '123e4567-e89b-12d3-a456-426614174000' }), 'utf8').toString('base64url'))).toBeNull();
    expect(decodeAlbumCursor(Buffer.from(JSON.stringify({ s: '2025-01-01T00:00:00Z', i: 'not-a-uuid' }), 'utf8').toString('base64url'))).toBeNull();
  });
});
