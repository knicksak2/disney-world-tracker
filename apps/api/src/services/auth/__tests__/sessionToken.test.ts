/**
 * Unit tests for the session token generator and hasher.
 *
 * Validates: Requirements 6.11 (sessions reference passwords/tokens only
 * via one-way digests; nothing reversible is persisted).
 *
 * These are example-based unit tests covering:
 *
 *   - `generateToken` returns a fresh URL-safe token and the matching
 *     SHA-256 hex digest.
 *   - The plaintext token decodes to exactly 32 random bytes (256 bits).
 *   - Two consecutive calls return distinct tokens (fresh randomness).
 *   - `hashToken` is deterministic and matches the digest produced by
 *     `generateToken` for the same token surface.
 *   - The hash is computed over the *raw bytes*, not the base64url string:
 *     a hand-computed SHA-256 of the decoded bytes equals the returned
 *     digest, while a SHA-256 of the base64url string does not.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { generateToken, hashToken } from '../sessionToken.js';

const TOKEN_BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

describe('sessionToken.generateToken', () => {
  it('returns a base64url-encoded token of the expected length and a 64-hex digest', () => {
    const { token, tokenHash } = generateToken();
    expect(token).toMatch(TOKEN_BASE64URL_RE);

    // 32 bytes encoded as base64url is 43 characters with no padding.
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    expect(tokenHash).toMatch(HEX64_RE);
  });

  it('produces fresh randomness on each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('tokenHash matches hashToken(token) for the same call', () => {
    const { token, tokenHash } = generateToken();
    expect(hashToken(token)).toBe(tokenHash);
  });
});

describe('sessionToken.hashToken', () => {
  it('is deterministic across repeated calls', () => {
    const { token } = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('hashes the raw decoded bytes, not the base64url surface', () => {
    const { token, tokenHash } = generateToken();
    const rawBytes = Buffer.from(token, 'base64url');

    const expectedDigestOverBytes = createHash('sha256').update(rawBytes).digest('hex');
    expect(tokenHash).toBe(expectedDigestOverBytes);

    const digestOverString = createHash('sha256').update(token, 'utf8').digest('hex');
    // The two digests are over different inputs and must therefore differ.
    expect(tokenHash).not.toBe(digestOverString);
  });

  it('returns a 64-hex digest for arbitrary string inputs (no throw on malformed surface)', () => {
    expect(hashToken('!!! not base64url !!!')).toMatch(HEX64_RE);
    expect(hashToken('')).toMatch(HEX64_RE);
  });
});
