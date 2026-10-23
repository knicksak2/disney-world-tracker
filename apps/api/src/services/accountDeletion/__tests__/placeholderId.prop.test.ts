import { randomBytes } from 'node:crypto';

import { DELETED_USER_ID_PREFIX, isDeletedUserId, uuidSchema } from '@dwt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { generatePlaceholderId } from '../placeholderId.js';

const RUNS = { numRuns: 100 };
const V4_SHAPE = /^deadc0de-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const bytes16 = fc.uint8Array({ minLength: 16, maxLength: 16 });

describe('generatePlaceholderId', () => {
  it('rejects a byte source shorter than 16 bytes', () => {
    expect(() => generatePlaceholderId(() => new Uint8Array(15))).toThrow(RangeError);
  });

  it('formats all-zero and all-0xff bytes as valid placeholders', () => {
    expect(generatePlaceholderId(() => new Uint8Array(16))).toBe(
      'deadc0de-0000-4000-8000-000000000000',
    );
    expect(generatePlaceholderId(() => new Uint8Array(16).fill(0xff))).toBe(
      'deadc0de-ffff-4fff-bfff-ffffffffffff',
    );
  });

  // Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
  it('Property 12: every id has the prefix and v4 shape, is accepted by uuidSchema, and isDeletedUserId is true', () => {
    fc.assert(
      fc.property(bytes16, (bytes) => {
        const id = generatePlaceholderId(() => bytes);
        expect(id).toMatch(V4_SHAPE);
        expect(id.startsWith(DELETED_USER_ID_PREFIX)).toBe(true);
        expect(uuidSchema.safeParse(id).success).toBe(true);
        expect(isDeletedUserId(id)).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
  it('Property 12: the id is stable for the same bytes and injective over the bits it uses', () => {
    fc.assert(
      fc.property(bytes16, bytes16, (a, b) => {
        expect(generatePlaceholderId(() => a)).toBe(generatePlaceholderId(() => a));
        const hex = (x: Uint8Array): string => Buffer.from(x).toString('hex');
        // The id uses hex digits 0..6, the low two bits of digit 7, and digits 8..22.
        const used = (x: Uint8Array): string => {
          const h = hex(x);
          return h.slice(0, 7) + (parseInt(h[7]!, 16) & 3) + h.slice(8, 23);
        };
        const same = generatePlaceholderId(() => a) === generatePlaceholderId(() => b);
        expect(same).toBe(used(a) === used(b));
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
  it('Property 12: ids for many purged accounts are all distinct, and no random v4 UUID is read as a placeholder', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(generatePlaceholderId(() => randomBytes(16)));
    expect(ids.size).toBe(2000);

    fc.assert(
      fc.property(fc.uuid({ version: 4 }), (id) => {
        // A real v4 id starts 'deadc0de-' with probability 2^-32; that collision is accepted
        // (see the migration notes) and filtered here rather than asserted away.
        fc.pre(!id.startsWith(DELETED_USER_ID_PREFIX));
        expect(isDeletedUserId(id)).toBe(false);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
  it('Property 12: the id carries no part of the user id or email (it is random, not derived)', () => {
    fc.assert(
      fc.property(fc.uuid(), bytes16, (userId, bytes) => {
        // The generator takes only random bytes: nothing about the user can reach it.
        const id = generatePlaceholderId(() => bytes);
        expect(id.includes(userId)).toBe(false);
        expect(generatePlaceholderId.length).toBe(1);
      }),
      RUNS,
    );
  });
});
