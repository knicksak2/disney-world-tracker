// Feature: disney-world-tracker, Property 18: avatar accepted iff PNG/JPEG by magic-byte sniff and size <= 5 MB
/**
 * Property-based tests for the avatar magic-byte validator.
 *
 * Validates: Requirements 7.3, 7.7
 *
 * Property 18 (design.md → Correctness Properties → "Avatar validator
 * preserves prior on rejection"):
 *
 *   For any avatar upload, the upload is accepted if and only if the file
 *   format is PNG or JPEG (validated by magic bytes) and the size is at
 *   most 5 megabytes; on rejection the Profile's prior avatar is unchanged.
 *
 * Scope of this file: the *pure-function* half of Property 18 — namely
 * `validateAvatarBytes(bytes)` from `avatarValidation.ts`. The
 * "preserves prior avatar on rejection" half (the persistence side
 * effect) is exercised at the route-handler level in `profileRoutes.test.ts`
 * and is intentionally out of scope here so the property holds on
 * a single, total, side-effect-free function.
 *
 * Specification of `validateAvatarBytes(bytes)` derived from the
 * implementation (`avatarValidation.ts`) and the brief:
 *
 *   - returns 'image/png'  iff bytes.length in (0, MAX_AVATAR_BYTES]
 *                          AND bytes[0..4) == 89 50 4E 47
 *   - returns 'image/jpeg' iff bytes.length in (0, MAX_AVATAR_BYTES]
 *                          AND bytes[0..3) == FF D8 FF
 *                          AND bytes does NOT begin with 89 50 4E 47
 *                          (PNG signature is checked first; in practice
 *                           the two prefixes cannot overlap since their
 *                           first byte differs, but the precedence is
 *                           captured here for completeness.)
 *   - returns null otherwise (empty buffer, oversize, or signature
 *                            mismatch — including type-confusion
 *                            attempts where a forged Content-Type label
 *                            does not match the bytes).
 *
 * Note on "claimed content types": the validator under test is
 * deliberately *content-type agnostic* because the design's mitigation
 * for type-confusion uploads is to ignore the client-supplied label and
 * sniff bytes instead (design.md → Security and Privacy Notes:
 * "Avatars are content-type sniffed by magic bytes (not just by
 * `Content-Type` header)"). To exercise that property end-to-end we
 * still generate a `claimedContentType` alongside each random buffer
 * and assert that the validator's verdict depends only on the bytes —
 * never on the claimed label — covering the full type-confusion
 * matrix (legit PNG body labelled JPEG, GIF body labelled PNG, etc.).
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  MAX_AVATAR_BYTES,
  validateAvatarBytes,
} from '../avatarValidation.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Magic-byte signatures mirrored from `avatarValidation.ts`.
// Kept in sync here so the assertions can express the property text directly.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reference oracle: a from-scratch reimplementation of the spec's iff. */
function expectedMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_AVATAR_BYTES) return null;
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= JPEG_SIGNATURE.length &&
    JPEG_SIGNATURE.every((b, i) => bytes[i] === b)
  ) {
    return 'image/jpeg';
  }
  return null;
}

/**
 * A representative set of forged content-type strings the route layer
 * might receive. The validator under test must ignore them entirely;
 * we still drive them through the property to prove the bytes are the
 * sole input that matters.
 */
const claimedContentTypeArb = fc.constantFrom(
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'application/octet-stream',
  'text/plain',
  'image/png; charset=evil',
  '',
);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const byteArb = fc.integer({ min: 0, max: 255 });

/**
 * A "small" random tail/prefix kept to a few KiB so the test budget at
 * `numRuns: 100` stays bounded. The property does not care about tail
 * length once it is non-empty: the validator only inspects the leading
 * 4 bytes, so the suffix is purely fuzz to surface any accidental
 * dependency on it.
 */
const tailArb = fc.uint8Array({ minLength: 0, maxLength: 1024 });

/** A valid PNG: signature + arbitrary suffix, total size at most 5 MB. */
const validPngArb = tailArb.map((tail) => {
  const out = new Uint8Array(PNG_SIGNATURE.length + tail.length);
  out.set(PNG_SIGNATURE, 0);
  out.set(tail, PNG_SIGNATURE.length);
  return out;
});

/** A valid JPEG: signature + arbitrary suffix, total size at most 5 MB. */
const validJpegArb = tailArb.map((tail) => {
  const out = new Uint8Array(JPEG_SIGNATURE.length + tail.length);
  out.set(JPEG_SIGNATURE, 0);
  out.set(tail, JPEG_SIGNATURE.length);
  return out;
});

/**
 * Type-confusion buffers: the bytes start with a *non-PNG, non-JPEG*
 * recognisable signature (GIF, BMP, WEBP, ZIP, PDF, plain text) or with
 * pure noise. These exercise the case where a malicious client claims
 * `image/png` or `image/jpeg` while uploading something else.
 */
const decoySignatureArb = fc.constantFrom<readonly number[]>(
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
  [0x42, 0x4d], // BMP
  [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], // RIFF…WEBP
  [0x50, 0x4b, 0x03, 0x04], // ZIP / DOCX / XLSX
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x7b, 0x22], // {" — JSON
  [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml
  // The PNG signature shifted by one byte — a classic "did you check the
  // *first* bytes?" trap.
  [0x00, 0x89, 0x50, 0x4e, 0x47],
  // Two of the three JPEG bytes plus a non-FF: must NOT match.
  [0xff, 0xd8, 0x00],
  // Three of the four PNG bytes plus a non-47: must NOT match.
  [0x89, 0x50, 0x4e, 0x00],
);

const typeConfusionArb = fc
  .tuple(decoySignatureArb, tailArb)
  .map(([sig, tail]) => {
    const out = new Uint8Array(sig.length + tail.length);
    out.set(sig, 0);
    out.set(tail, sig.length);
    return out;
  });

/**
 * Pure noise buffer in `[0, MAX_AVATAR_BYTES]` length. Most random
 * draws will not match either signature, but the assertion uses the
 * `expectedMime` oracle so an accidental signature match is still a
 * pass (not a flake).
 */
const noiseArb = fc
  .array(byteArb, { minLength: 0, maxLength: 64 })
  .map((arr) => Uint8Array.from(arr));

/**
 * Oversized buffer: exactly `MAX_AVATAR_BYTES + 1` bytes, with a real
 * PNG/JPEG/garbage prefix. Constructed by allocating the buffer once
 * and seeding the prefix; the suffix is left at the default 0x00 fill
 * because the validator never reads past byte 4.
 */
const oversizedArb = fc
  .tuple(
    fc.constantFrom<readonly number[]>(
      // Real PNG signature — must STILL be rejected because of size.
      [...PNG_SIGNATURE],
      // Real JPEG signature — same.
      [...JPEG_SIGNATURE],
      // Garbage — already null on signature alone, oversize keeps it null.
      [0x00, 0x00, 0x00, 0x00],
    ),
  )
  .map(([prefix]) => {
    const out = new Uint8Array(MAX_AVATAR_BYTES + 1);
    out.set(prefix, 0);
    return out;
  });

/** Empty buffer — the lower-bound edge case of the size predicate. */
const emptyArb = fc.constant(new Uint8Array(0));

/**
 * Buffers shorter than the JPEG signature. Tests the `bytes.length <
 * signature.length` branch of `startsWith`.
 */
const shortArb = fc
  .array(byteArb, { minLength: 1, maxLength: 2 })
  .map((arr) => Uint8Array.from(arr));

/**
 * Buffer at *exactly* the size limit. Combined with a valid prefix,
 * this is the upper-bound edge case of the size predicate.
 */
const atLimitArb = fc
  .constantFrom<readonly number[]>(
    [...PNG_SIGNATURE],
    [...JPEG_SIGNATURE],
    [0x00, 0x00, 0x00, 0x00], // garbage at the limit
  )
  .map((prefix) => {
    const out = new Uint8Array(MAX_AVATAR_BYTES);
    out.set(prefix, 0);
    return out;
  });

/**
 * Combined buffer arbitrary mixing all the cases above. The frequency
 * weights bias generation towards the cases the property cares most
 * about (valid + type-confusion) while still spending some runs on
 * the size edges.
 */
const anyAvatarBufferArb = fc.oneof(
  { weight: 4, arbitrary: validPngArb },
  { weight: 4, arbitrary: validJpegArb },
  { weight: 4, arbitrary: typeConfusionArb },
  { weight: 2, arbitrary: noiseArb },
  { weight: 2, arbitrary: shortArb },
  { weight: 1, arbitrary: emptyArb },
  { weight: 1, arbitrary: atLimitArb },
  // `oversizedArb` is allocated as 5 MB + 1 bytes per draw, which is
  // expensive. Keep its weight low so the suite stays under a few
  // seconds at numRuns: 100 while still exercising the upper edge.
  { weight: 1, arbitrary: oversizedArb },
);

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('validateAvatarBytes — Property 18: PNG/JPEG by magic-byte sniff and size ≤ 5 MB', () => {
  it('returns "image/png" iff bytes start with 89 50 4E 47 and size is in (0, MAX_AVATAR_BYTES]', () => {
    fc.assert(
      fc.property(anyAvatarBufferArb, claimedContentTypeArb, (bytes, _claim) => {
        const result = validateAvatarBytes(bytes);
        const isPng =
          bytes.length > 0 &&
          bytes.length <= MAX_AVATAR_BYTES &&
          bytes.length >= PNG_SIGNATURE.length &&
          PNG_SIGNATURE.every((b, i) => bytes[i] === b);
        if (isPng) {
          return result === 'image/png';
        }
        return result !== 'image/png';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns "image/jpeg" iff bytes start with FF D8 FF (and not the PNG signature) and size is in (0, MAX_AVATAR_BYTES]', () => {
    fc.assert(
      fc.property(anyAvatarBufferArb, claimedContentTypeArb, (bytes, _claim) => {
        const result = validateAvatarBytes(bytes);
        const isPng =
          bytes.length >= PNG_SIGNATURE.length &&
          PNG_SIGNATURE.every((b, i) => bytes[i] === b);
        const isJpeg =
          !isPng &&
          bytes.length > 0 &&
          bytes.length <= MAX_AVATAR_BYTES &&
          bytes.length >= JPEG_SIGNATURE.length &&
          JPEG_SIGNATURE.every((b, i) => bytes[i] === b);
        if (isJpeg) {
          return result === 'image/jpeg';
        }
        return result !== 'image/jpeg';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null for any buffer that is empty, oversized, or whose first bytes match no supported signature', () => {
    fc.assert(
      fc.property(anyAvatarBufferArb, claimedContentTypeArb, (bytes, _claim) => {
        const result = validateAvatarBytes(bytes);
        const isPng =
          bytes.length >= PNG_SIGNATURE.length &&
          PNG_SIGNATURE.every((b, i) => bytes[i] === b);
        const isJpeg =
          bytes.length >= JPEG_SIGNATURE.length &&
          JPEG_SIGNATURE.every((b, i) => bytes[i] === b);
        const sizeOk = bytes.length > 0 && bytes.length <= MAX_AVATAR_BYTES;
        const accept = sizeOk && (isPng || isJpeg);
        if (!accept) {
          return result === null;
        }
        // Accepted ⇒ result must be non-null. (Stronger checks above.)
        return result !== null;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('verdict equals the reference oracle for every generated buffer (full iff)', () => {
    fc.assert(
      fc.property(anyAvatarBufferArb, claimedContentTypeArb, (bytes, _claim) => {
        return validateAvatarBytes(bytes) === expectedMime(bytes);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('verdict is independent of the claimed content type: forging the label cannot flip the outcome', () => {
    // Type-confusion sweep: take the same bytes and run them past a
    // family of forged content-type labels. The validator must produce
    // the same answer for every label — including the worst-case label
    // that disagrees with the bytes.
    fc.assert(
      fc.property(
        anyAvatarBufferArb,
        fc.array(claimedContentTypeArb, { minLength: 2, maxLength: 6 }),
        (bytes, claims) => {
          const baseline = validateAvatarBytes(bytes);
          // The claims array is fuzz: the validator never sees it.
          // Re-run the validator multiple times to also pin down purity
          // (no hidden state across calls).
          for (const _claim of claims) {
            if (validateAvatarBytes(bytes) !== baseline) return false;
          }
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('validateAvatarBytes — totality', () => {
  it('returns one of {"image/png", "image/jpeg", null} for every buffer', () => {
    const allowed = new Set<unknown>(['image/png', 'image/jpeg', null]);
    fc.assert(
      fc.property(anyAvatarBufferArb, (bytes) => {
        return allowed.has(validateAvatarBytes(bytes));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
