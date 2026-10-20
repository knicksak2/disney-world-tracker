import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hasExifSegment } from '../exifScan.js';

describe('exifScan properties', () => {
  // Feature: photo-uploads, Property 28: Exif scan
  it('Property 28: hasExifSegment returns true iff an APP1 segment starts with Exif\\0\\0 within limit, and never throws', () => {
    // Generator for a JPEG segment
    const segmentArb = fc.record({
      marker: fc.constantFrom(0xe0, 0xe1, 0xe2, 0xc0, 0xc4, 0xdb),
      isExifApp1: fc.boolean(),
      payload: fc.uint8Array({ minLength: 0, maxLength: 50 }),
    }).map(({ marker, isExifApp1, payload }) => {
      if (marker === 0xe1 && isExifApp1) {
        // Build APP1 with Exif\0\0 header
        const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
        const fullPayload = new Uint8Array(exifHeader.length + payload.length);
        fullPayload.set(exifHeader, 0);
        fullPayload.set(payload, exifHeader.length);

        const length = fullPayload.length + 2; // length includes the 2 length bytes
        const seg = new Uint8Array(4 + fullPayload.length);
        seg[0] = 0xff;
        seg[1] = 0xe1;
        seg[2] = (length >> 8) & 0xff;
        seg[3] = length & 0xff;
        seg.set(fullPayload, 4);
        return { bytes: seg, hasExif: true };
      } else {
        // Non-exif segment (if 0xe1, ensure it does NOT start with Exif\0\0)
        const safePayload = new Uint8Array(payload.length);
        safePayload.set(payload);
        if (marker === 0xe1 && safePayload.length >= 6) {
          safePayload[0] = 0x00; // corrupt header
        }
        const length = safePayload.length + 2;
        const seg = new Uint8Array(4 + safePayload.length);
        seg[0] = 0xff;
        seg[1] = marker;
        seg[2] = (length >> 8) & 0xff;
        seg[3] = length & 0xff;
        seg.set(safePayload, 4);
        return { bytes: seg, hasExif: false };
      }
    });

    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: 8 }), (segments) => {
        // Prefix with SOI (FF D8)
        const totalLen = 2 + segments.reduce((sum, s) => sum + s.bytes.length, 0);
        const jpeg = new Uint8Array(totalLen);
        jpeg[0] = 0xff;
        jpeg[1] = 0xd8;

        let offset = 2;
        let expectedExif = false;
        for (const s of segments) {
          if (s.hasExif && !expectedExif) {
            expectedExif = true;
          }
          jpeg.set(s.bytes, offset);
          offset += s.bytes.length;
        }

        const actual = hasExifSegment(jpeg, 65536);
        expect(actual).toBe(expectedExif);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 28 (robustness): never throws on arbitrary random or truncated byte arrays', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 500 }), fc.integer({ min: 0, max: 1000 }), (bytes, maxScan) => {
        expect(() => hasExifSegment(bytes, maxScan)).not.toThrow();
      }),
      { numRuns: 100 }
    );
  });
});
