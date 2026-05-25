/**
 * Avatar validation: size limit + magic-byte content sniffing.
 *
 * The Profile avatar accepts only PNG and JPEG images at most 5 MB in size
 * (R7.3, R7.7). Validating by `Content-Type` alone is insufficient because a
 * malicious client can claim `image/png` while uploading arbitrary bytes — a
 * classic type-confusion vector. We therefore sniff the first bytes of the
 * uploaded body against well-known image signatures and reject any input
 * whose magic bytes do not match a supported format.
 *
 * Design references:
 *   - design.md "Auth_Service" → "Upload avatar | PNG/JPEG, ≤ 5 MB,
 *     content-type and magic-byte sniffed (R7.3, R7.7)"
 *   - design.md "Security and Privacy Notes" → "Avatars are content-type
 *     sniffed by magic bytes (not just by `Content-Type` header) to mitigate
 *     type-confusion uploads."
 *
 * Magic bytes (per the task brief, matching ISO/IEC 15948 and ITU-T T.81):
 *   - PNG: first 4 bytes `89 50 4E 47`
 *   - JPEG: first 3 bytes `FF D8 FF`
 *
 * This module exposes a single pure function `sniffAvatar(bytes)` that
 * returns the detected `image/png` | `image/jpeg` MIME type, or `null` for
 * any other byte pattern. Size enforcement is a separate concern handled by
 * the route plugin (Fastify multipart's `limits.fileSize`) and double-checked
 * here via `MAX_AVATAR_BYTES`.
 *
 * Validates: Requirements R7.3, R7.7 (avatar format and size constraints).
 */

/** Maximum avatar size in bytes (5 MB, base 1024 × 1024 per design "≤ 5 MB"). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * The set of image MIME types the avatar pipeline accepts. The literal union
 * is exported (not just `string`) so callers receive a discriminated value
 * suitable for storage in `profiles.avatar_mime` (which has a CHECK
 * constraint covering the same two values).
 */
export type AvatarMimeType = 'image/png' | 'image/jpeg';

/**
 * PNG signature: 89 50 4E 47 0D 0A 1A 0A. The task brief and design require
 * a 4-byte match, which is sufficient to distinguish PNG from any JPEG or
 * other image format we might accidentally accept. We match the 4 bytes
 * exactly and do not validate the trailing CRLF/IHDR sentinel because the
 * stricter check would reject some valid PNG variants without improving
 * security against type-confusion.
 */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);

/**
 * JPEG SOI + marker prefix: FF D8 FF. Every JFIF and Exif JPEG begins with
 * this 3-byte sequence; the next byte distinguishes the specific marker
 * (`E0` for JFIF, `E1` for Exif, `DB` for raw quantization, etc.). A 3-byte
 * match is therefore the canonical "is this a JPEG?" check and matches the
 * task brief.
 */
const JPEG_SIGNATURE = Uint8Array.of(0xff, 0xd8, 0xff);

/**
 * Compare the leading bytes of `bytes` to `signature`. Returns `false` if
 * `bytes` is shorter than the signature so a tiny input can never spuriously
 * match.
 */
function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Sniff the supplied bytes for a supported avatar image format.
 *
 * @returns The detected MIME type (`'image/png'` or `'image/jpeg'`), or
 *          `null` if the bytes do not match any supported signature.
 *
 * The function is pure, allocates nothing beyond the comparisons, and is
 * safe to call on arbitrarily large buffers because it only inspects the
 * first 4 bytes regardless of length. The size check lives in the route
 * handler so a 5 MB+ upload is rejected before its body is fully buffered.
 */
export function sniffAvatar(bytes: Uint8Array): AvatarMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/**
 * Combined validation: size + magic-byte sniff. Returns the detected MIME
 * type on success; throws is left to the caller (the route handler raises
 * `AppError('avatar_invalid')` so the wire response stays uniform per the
 * shared error envelope).
 *
 * @returns The detected MIME type when the input is a valid PNG or JPEG of
 *          allowable size, or `null` otherwise (oversized, undersized, or
 *          unsupported format).
 */
export function validateAvatarBytes(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_AVATAR_BYTES) return null;
  return sniffAvatar(bytes);
}
