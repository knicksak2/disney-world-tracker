import { createHash, createHmac } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LOG_ID_DOMAIN, accountLogId } from '../logId.js';

const RUNS = { numRuns: 100 };
const secretArb = fc.string({ minLength: 32, maxLength: 64 });

describe('accountLogId', () => {
  it('uses the documented domain prefix', () => {
    expect(LOG_ID_DOMAIN).toBe('account-deletion-log-v1:');
  });

  it('matches a fixed vector computed with node:crypto', () => {
    const secret = 'test-session-secret-must-be-at-least-32-chars';
    const userId = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    const expected = createHmac('sha256', secret)
      .update('account-deletion-log-v1:' + userId)
      .digest('hex')
      .slice(0, 12);
    expect(accountLogId(userId, secret)).toBe(expected);
  });

  // Feature: account-deletion, Property 22: Logs identify an account only by a keyed hash
  it('Property 22: is exactly the first 12 lowercase hex chars of HMAC-SHA256 (node:crypto oracle)', () => {
    fc.assert(
      fc.property(fc.uuid(), secretArb, (userId, secret) => {
        const id = accountLogId(userId, secret);
        expect(id).toMatch(/^[0-9a-f]{12}$/);
        const oracle = createHmac('sha256', secret)
          .update(`account-deletion-log-v1:${userId}`)
          .digest('hex')
          .slice(0, 12);
        expect(id).toBe(oracle);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 22: Logs identify an account only by a keyed hash
  it('Property 22: is stable for one secret and user', () => {
    fc.assert(
      fc.property(fc.uuid(), secretArb, (userId, secret) => {
        expect(accountLogId(userId, secret)).toBe(accountLogId(userId, secret));
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 22: Logs identify an account only by a keyed hash
  it('Property 22: differs by user and by key', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), secretArb, secretArb, (u1, u2, s1, s2) => {
        fc.pre(u1 !== u2);
        fc.pre(s1 !== s2);
        // 48 bits: a collision in 100 runs has probability ~1e-10; treated as impossible.
        expect(accountLogId(u1, s1)).not.toBe(accountLogId(u2, s1));
        expect(accountLogId(u1, s1)).not.toBe(accountLogId(u1, s2));
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 22: Logs identify an account only by a keyed hash
  it('Property 22: is not a prefix of the user id nor of an unkeyed SHA-256 of it', () => {
    fc.assert(
      fc.property(fc.uuid(), secretArb, (userId, secret) => {
        const id = accountLogId(userId, secret);
        const unkeyed = createHash('sha256').update(userId).digest('hex');
        const unkeyedDomain = createHash('sha256')
          .update('account-deletion-log-v1:' + userId)
          .digest('hex');
        expect(userId.replace(/-/g, '').startsWith(id)).toBe(false);
        expect(unkeyed.startsWith(id)).toBe(false);
        expect(unkeyedDomain.startsWith(id)).toBe(false);
      }),
      RUNS,
    );
  });
});
