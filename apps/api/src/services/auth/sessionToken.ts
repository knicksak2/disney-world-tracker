/**
 * Auth_Service: opaque session token generator and hash function.
 *
 * The Auth_Service uses opaque, server-side-revocable session tokens (see
 * design.md → "Session strategy"). The plaintext token is returned to the
 * client exactly once at login/register time and is never persisted in the
 * database; instead, the SHA-256 hash of the raw token bytes is stored in
 * `sessions.token_hash`. On every authenticated request, the middleware
 * re-hashes the bearer token with `hashToken` and looks up the row by hash.
 *
 * Properties of this module:
 *
 *   - `generateToken()` produces a fresh 256-bit token plus its hash.
 *   - The token surface is `base64url`-encoded so it is safe in HTTP
 *     headers, URLs, and logs (when redaction fails, no escaping is
 *     required).
 *   - `hashToken(token)` is deterministic: the same token always yields the
 *     same hex hash, which is what makes server-side lookup possible
 *     without ever storing the plaintext.
 *   - The hash is computed over the *raw 32 random bytes*, not over the
 *     base64url string. This makes the hash insensitive to encoding
 *     choices: callers who present the token in any equivalent encoding
 *     (today there is only one) still resolve to the same row.
 *
 * Validates: Requirements 6.11
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Number of random bytes drawn for each session token. 32 bytes = 256 bits,
 * matching the design's "Opaque random session tokens (256 bits)" decision.
 */
const TOKEN_BYTE_LENGTH = 32;

/**
 * SHA-256 produces 32 bytes / 256 bits of digest, encoded as 64 hex
 * characters. Held as a constant for clarity at the single call site.
 */
const HASH_HEX_LENGTH = 64;

/**
 * Newly-issued session token, returned by `generateToken`.
 *
 * The caller is expected to:
 *   1. Persist `tokenHash` into `sessions.token_hash`.
 *   2. Return `token` to the client (typically as a `Bearer` token).
 *   3. Discard the in-memory `token` immediately after use.
 */
export interface GeneratedSessionToken {
  /** URL-safe base64 encoding of the 256 random bits; given to the client. */
  token: string;
  /** Lower-case hex SHA-256 of the *raw* token bytes; persisted server-side. */
  tokenHash: string;
}

/**
 * Generate a fresh session token and its persisted hash.
 *
 * Returns both halves so the Auth_Service can never accidentally persist the
 * plaintext or return the hash to the client: the call site picks the
 * correct field for each destination.
 */
export function generateToken(): GeneratedSessionToken {
  const rawBytes = randomBytes(TOKEN_BYTE_LENGTH);
  const token = rawBytes.toString('base64url');
  const tokenHash = sha256Hex(rawBytes);
  return { token, tokenHash };
}

/**
 * Re-derive the persisted hash for a token presented by a client.
 *
 * Used by the session middleware to look up `sessions.token_hash`. Decodes
 * the base64url surface back to its raw bytes before hashing so the digest
 * matches what `generateToken` originally stored.
 *
 * If the supplied string is not valid base64url (i.e. contains characters
 * outside the alphabet or has an invalid length after padding inference),
 * the resulting digest cannot match any persisted token, and the caller
 * will treat the lookup as a miss — i.e. an unauthorized request. The
 * function therefore does not throw on malformed input; it only needs to
 * produce a deterministic 64-hex-character string for any input string.
 *
 * @param token - The bearer token presented by the client.
 * @returns Lower-case hex SHA-256 of the decoded token bytes.
 */
export function hashToken(token: string): string {
  const rawBytes = Buffer.from(token, 'base64url');
  return sha256Hex(rawBytes);
}

/**
 * Internal helper: SHA-256 of the supplied bytes, lower-case hex.
 *
 * Held in one place so the digest format used by `generateToken` and
 * `hashToken` cannot drift apart.
 */
function sha256Hex(bytes: Buffer): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  // Defensive sanity check: SHA-256 always emits 64 hex characters. Falling
  // through this would indicate a hostile shim of `node:crypto`, in which
  // case failing loudly is correct.
  if (digest.length !== HASH_HEX_LENGTH) {
    throw new Error('sessionToken: unexpected SHA-256 digest length');
  }
  return digest;
}
