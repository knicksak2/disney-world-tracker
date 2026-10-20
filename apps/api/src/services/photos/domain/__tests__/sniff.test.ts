import { describe, it, expect } from 'vitest';
import { isJpeg } from '../sniff.js';

describe('isJpeg sniff', () => {
  it('returns true when first three bytes are FF D8 FF', () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe(true);
  });

  it('returns false for truncated byte arrays', () => {
    expect(isJpeg(new Uint8Array([]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });

  it('returns false for non-JPEG headers such as PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isJpeg(png)).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd9, 0xff]))).toBe(false);
    expect(isJpeg(new Uint8Array([0x00, 0x00, 0x00]))).toBe(false);
  });
});
