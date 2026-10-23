import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateGrant, hashGrant, isGrantUsable } from '../reauthGrant.js';

describe('generateGrant', () => {
  it('returns a base64url token of 32 random bytes and the sha256 hex of it', () => {
    const { grant, hash } = generateGrant();
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 base64url chars
    expect(Buffer.from(grant, 'base64url')).toHaveLength(32);
    expect(hash).toBe(createHash('sha256').update(grant).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not store or derive the hash from anything but the grant', () => {
    const { grant, hash } = generateGrant();
    expect(hashGrant(grant)).toBe(hash);
    expect(hash).not.toContain(grant);
  });

  it('produces a different grant every time', () => {
    const grants = new Set(Array.from({ length: 200 }, () => generateGrant().grant));
    expect(grants.size).toBe(200);
  });
});

describe('hashGrant', () => {
  it('is the sha256 hex digest, stable, and sensitive to a one-character change', () => {
    expect(hashGrant('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashGrant('abc')).toBe(hashGrant('abc'));
    expect(hashGrant('abc')).not.toBe(hashGrant('abd'));
  });
});

describe('isGrantUsable', () => {
  const expiresAt = new Date('2026-01-01T00:05:00.000Z');

  it('is usable while unused and strictly before expiry', () => {
    expect(isGrantUsable({ usedAt: null, expiresAt }, new Date('2026-01-01T00:04:59.999Z'))).toBe(true);
  });

  it('is not usable at or after expiry', () => {
    expect(isGrantUsable({ usedAt: null, expiresAt }, expiresAt)).toBe(false);
    expect(isGrantUsable({ usedAt: null, expiresAt }, new Date('2026-01-01T01:00:00.000Z'))).toBe(false);
  });

  it('is not usable once used, even before expiry', () => {
    expect(
      isGrantUsable({ usedAt: new Date('2026-01-01T00:01:00.000Z'), expiresAt }, new Date('2026-01-01T00:02:00.000Z')),
    ).toBe(false);
  });
});
