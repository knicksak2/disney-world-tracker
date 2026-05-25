/**
 * Unit tests for avatar magic-byte sniffing and size validation.
 *
 * These cover the pure-function portion of R7.3 / R7.7. The route-level
 * integration with `@fastify/multipart` is exercised in `profileRoutes.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_AVATAR_BYTES,
  sniffAvatar,
  validateAvatarBytes,
} from '../avatarValidation.js';

describe('sniffAvatar', () => {
  it('returns image/png for the canonical PNG signature', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff);
    expect(sniffAvatar(png)).toBe('image/png');
  });

  it('returns image/jpeg for the canonical JPEG signature (JFIF)', () => {
    const jfif = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
    expect(sniffAvatar(jfif)).toBe('image/jpeg');
  });

  it('returns image/jpeg for an Exif JPEG (FF D8 FF E1)', () => {
    const exif = Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78);
    expect(sniffAvatar(exif)).toBe('image/jpeg');
  });

  it('returns null for a GIF signature', () => {
    const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    expect(sniffAvatar(gif)).toBeNull();
  });

  it('returns null for a BMP signature', () => {
    const bmp = Uint8Array.of(0x42, 0x4d, 0x76, 0x00);
    expect(sniffAvatar(bmp)).toBeNull();
  });

  it('returns null for a WebP signature (RIFF...WEBP)', () => {
    const webp = Uint8Array.of(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    );
    expect(sniffAvatar(webp)).toBeNull();
  });

  it('returns null for buffers shorter than the JPEG signature', () => {
    expect(sniffAvatar(Uint8Array.of(0xff, 0xd8))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(sniffAvatar(new Uint8Array())).toBeNull();
  });

  it('rejects PNG-like bytes shorter than the 4-byte signature', () => {
    expect(sniffAvatar(Uint8Array.of(0x89, 0x50, 0x4e))).toBeNull();
  });

  it('rejects a JPEG-prefixed payload that has only the first 2 bytes', () => {
    // Type-confusion attempt: 2 bytes of JPEG SOI followed by JSON-like
    // text. Must not be misclassified.
    expect(sniffAvatar(Uint8Array.of(0xff, 0xd8, 0x7b))).toBeNull();
  });

  it('rejects a PNG signature at any offset other than 0', () => {
    const offsetPng = Uint8Array.of(0x00, 0x89, 0x50, 0x4e, 0x47);
    expect(sniffAvatar(offsetPng)).toBeNull();
  });
});

describe('validateAvatarBytes', () => {
  it('returns the sniffed mime when both size and signature are valid', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(validateAvatarBytes(png)).toBe('image/png');
  });

  it('returns null for an empty body even with a "valid" zero-length read', () => {
    expect(validateAvatarBytes(new Uint8Array())).toBeNull();
  });

  it('returns null when the body exceeds MAX_AVATAR_BYTES', () => {
    // Build a buffer 1 byte over the limit. The first 4 bytes are a real
    // PNG signature; the size check must still reject it.
    const oversize = new Uint8Array(MAX_AVATAR_BYTES + 1);
    oversize[0] = 0x89;
    oversize[1] = 0x50;
    oversize[2] = 0x4e;
    oversize[3] = 0x47;
    expect(validateAvatarBytes(oversize)).toBeNull();
  });

  it('accepts a body exactly at the size limit when the signature matches', () => {
    const atLimit = new Uint8Array(MAX_AVATAR_BYTES);
    atLimit[0] = 0xff;
    atLimit[1] = 0xd8;
    atLimit[2] = 0xff;
    expect(validateAvatarBytes(atLimit)).toBe('image/jpeg');
  });

  it('returns null when size is acceptable but signature does not match', () => {
    const garbage = Uint8Array.of(0x00, 0x01, 0x02, 0x03, 0x04, 0x05);
    expect(validateAvatarBytes(garbage)).toBeNull();
  });
});
