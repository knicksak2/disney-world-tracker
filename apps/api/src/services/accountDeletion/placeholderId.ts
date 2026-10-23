/**
 * Placeholder (alias / tombstone) user id generation: pure given its byte source.
 *
 * `isDeletedUserId` and the `deadc0de-` prefix live in `@dwt/shared` so the mobile app
 * recognises a placeholder from the id alone (Requirements 5.5, 11.1, 16.5).
 */

import { DELETED_USER_ID_PREFIX } from '@dwt/shared';

const VARIANT_CHARS = '89ab';

/**
 * Returns an RFC 4122 v4-shaped UUID whose first 32 bits are `DELETED_USER_ID_PREFIX`:
 * `deadc0de-` + 4 hex + `-4` + 3 hex + `-` + one of `8 9 a b` + 3 hex + `-` + 12 hex.
 * That shape is accepted by `uuidSchema` and keeps about 90 random bits.
 *
 * `rng` must return at least 16 random bytes (the service passes `() => randomBytes(16)`).
 */
export function generatePlaceholderId(rng: () => Uint8Array): string {
  const bytes = rng();
  if (bytes.length < 16) {
    throw new RangeError(`generatePlaceholderId needs 16 random bytes, got ${bytes.length}`);
  }
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i]!.toString(16).padStart(2, '0');

  const variant = VARIANT_CHARS[parseInt(hex[7]!, 16) & 3]!;
  return (
    DELETED_USER_ID_PREFIX +
    hex.slice(0, 4) +
    '-4' +
    hex.slice(4, 7) +
    '-' +
    variant +
    hex.slice(8, 11) +
    '-' +
    hex.slice(11, 23)
  );
}
