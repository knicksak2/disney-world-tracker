/**
 * Re-authentication grant helpers: pure apart from the random byte source
 * (account-deletion R2.2, R2.3). Only the hash of a grant is ever stored.
 */

import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url-encoded (the opaque token) and its SHA-256 hex digest (what is stored). */
export function generateGrant(): { grant: string; hash: string } {
  const grant = randomBytes(32).toString('base64url');
  return { grant, hash: hashGrant(grant) };
}

/** SHA-256 hex digest of a grant. */
export function hashGrant(grant: string): string {
  return createHash('sha256').update(grant).digest('hex');
}

/** True iff the grant has not been used and `now` is strictly before its expiry. */
export function isGrantUsable(
  row: { usedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  return row.usedAt === null && now.getTime() < row.expiresAt.getTime();
}
