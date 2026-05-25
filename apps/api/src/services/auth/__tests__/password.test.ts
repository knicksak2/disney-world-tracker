/**
 * Unit tests for the Argon2id password hashing wrapper.
 *
 * Validates: Requirements 6.11 (passwords stored only as one-way hashes,
 * never plaintext).
 *
 * These are example-based correctness tests, not the property test for
 * Property 16 (which lives in `noPlaintext.prop.test.ts` and is task 6.10).
 * They cover:
 *
 *   - `hash` produces a self-describing Argon2id-encoded string with the
 *     parameters mandated by design.md (m=64 MiB, t=3, p=1).
 *   - `hash` produces a fresh salt every call: hashing the same plaintext
 *     twice yields two distinct encoded strings.
 *   - `verify` returns `true` for the matching plaintext and `false` for a
 *     non-match.
 *   - `verify` swallows malformed encoded strings and returns `false` rather
 *     than throwing — a uniform `invalid_credentials`-shaped outcome.
 *   - The plaintext is never substring-present in the encoded hash.
 */

import { describe, expect, it } from 'vitest';

import { hash, verify } from '../password.js';

describe('password.hash / password.verify', () => {
  it('produces an Argon2id PHC string with m=65536, t=3, p=1', async () => {
    const encoded = await hash('correct horse battery staple');
    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).toContain('m=65536');
    expect(encoded).toContain('t=3');
    expect(encoded).toContain('p=1');
  });

  it('returns a different encoded string on each call (random salt per record)', async () => {
    const first = await hash('p4ssw0rd!');
    const second = await hash('p4ssw0rd!');
    expect(first).not.toBe(second);
  });

  it('verify returns true for the matching plaintext', async () => {
    const encoded = await hash('s3cret-pa$$');
    await expect(verify(encoded, 's3cret-pa$$')).resolves.toBe(true);
  });

  it('verify returns false for a non-matching plaintext', async () => {
    const encoded = await hash('s3cret-pa$$');
    await expect(verify(encoded, 'wrong-password')).resolves.toBe(false);
  });

  it('verify returns false for a malformed encoded string instead of throwing', async () => {
    await expect(verify('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });

  it('encoded hash never contains the plaintext as a substring', async () => {
    const plaintext = 'some-recognizable-plaintext-zxQ89';
    const encoded = await hash(plaintext);
    expect(encoded.includes(plaintext)).toBe(false);
  });
});
