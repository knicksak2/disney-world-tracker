const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'

export function hasExifSegment(bytes: Uint8Array, maxScanBytes = 65536): boolean {
  if (bytes.length < 4) {
    return false;
  }
  // Must start with SOI: FF D8
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false;
  }

  const limit = Math.min(bytes.length, maxScanBytes);
  let offset = 2;

  while (offset < limit) {
    // Each marker starts with 0xFF, possibly multiple 0xFF bytes for padding
    if (bytes[offset] !== 0xff) {
      return false;
    }
    while (offset < limit && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= limit) {
      return false;
    }

    const marker = bytes[offset++];
    if (marker === undefined) {
      return false;
    }

    // Standalone markers with no length:
    // 0xD8 (SOI), 0xD9 (EOI), 0xD0..0xD7 (RST0..RST7), 0x00 (escaped FF)
    if (marker === 0xd9) {
      return false;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) {
      continue;
    }

    // All other markers have a 2-byte length (which includes the 2 length bytes themselves)
    if (offset + 1 >= limit) {
      return false;
    }
    const b0 = bytes[offset];
    const b1 = bytes[offset + 1];
    if (b0 === undefined || b1 === undefined) {
      return false;
    }
    const length = (b0 << 8) | b1;
    if (length < 2) {
      return false;
    }

    // Check if this is APP1 (0xE1) and contains Exif\0\0
    if (marker === 0xe1) {
      // Payload starts after the 2 length bytes: offset + 2
      if (length >= 8 && offset + 2 + 6 <= limit) {
        let isExif = true;
        for (let i = 0; i < 6; i++) {
          if (bytes[offset + 2 + i] !== EXIF_HEADER[i]) {
            isExif = false;
            break;
          }
        }
        if (isExif) {
          return true;
        }
      }
    }

    // If SOS (Start of Scan: 0xDA), compressed image data follows
    if (marker === 0xda) {
      return false;
    }

    offset += length;
  }

  return false;
}
