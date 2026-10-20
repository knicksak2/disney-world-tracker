export type PhotoSource = 'library' | 'camera';

export interface PickerAssetInput {
  readonly exif?: Record<string, unknown> | null;
}

/**
 * Extracts and normalises takenAt timestamp from a picked photo asset or camera capture.
 *
 * Rules:
 * - In-app camera capture: returns current time (now).
 * - Library asset with EXIF DateTimeOriginal: parsed as zoneless local time, converted with
 *   offset if present (from string or OffsetTimeOriginal/OffsetTime), otherwise treated as device time zone.
 * - Missing EXIF or malformed string: returns undefined.
 * - Discards all other EXIF metadata (including GPS, device info, etc.).
 */
export function pickTakenAt(
  asset: PickerAssetInput | null | undefined,
  source: PhotoSource,
  now: Date = new Date()
): string | undefined {
  if (source === 'camera') {
    return now.toISOString();
  }

  if (!asset || !asset.exif) {
    return undefined;
  }

  const raw = asset.exif.DateTimeOriginal;
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }

  const match = raw.trim().match(
    /^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:([+-]\d{2}:?\d{2}|Z))?$/
  );

  if (!match) {
    return undefined;
  }

  const yStr = match[1];
  const mStr = match[2];
  const dStr = match[3];
  const hStr = match[4];
  const minStr = match[5];
  const sStr = match[6];
  const inlineOffset = match[7];

  if (!yStr || !mStr || !dStr || !hStr || !minStr || !sStr) {
    return undefined;
  }

  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const hours = parseInt(hStr, 10);
  const minutes = parseInt(minStr, 10);
  const seconds = parseInt(sStr, 10);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return undefined;
  }

  let offset = inlineOffset;
  if (!offset && typeof asset.exif.OffsetTimeOriginal === 'string') {
    offset = asset.exif.OffsetTimeOriginal.trim();
  } else if (!offset && typeof asset.exif.OffsetTime === 'string') {
    offset = asset.exif.OffsetTime.trim();
  }

  if (offset) {
    let normOffset = offset;
    if (/^[+-]\d{4}$/.test(offset)) {
      normOffset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
    }
    const isoString = `${yStr}-${mStr}-${dStr}T${hStr}:${minStr}:${sStr}${normOffset}`;
    const parsed = new Date(isoString);
    if (isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed.toISOString();
  }

  const localDate = new Date(year, month - 1, day, hours, minutes, seconds);
  if (isNaN(localDate.getTime())) {
    return undefined;
  }
  return localDate.toISOString();
}
