import type { MyPhotoDTO, PhotoPageDTO, PhotoStatus } from '@dwt/shared';
import type { PhotoViewerItem } from './PhotoViewer';

/**
 * Concatenate pages in order, dropping repeated ids keeping the first occurrence.
 * Never mutates input arrays or items.
 */
export function flattenMyPhotoPages(
  pages: ReadonlyArray<PhotoPageDTO<MyPhotoDTO>>
): MyPhotoDTO[] {
  const result: MyPhotoDTO[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
  }
  return result;
}

/**
 * Precedence rule: the polled status wins only while the list item's status is 'pending';
 * otherwise the list status wins.
 */
export function effectiveStatus(
  item: MyPhotoDTO,
  polled: Record<string, { status: PhotoStatus } | undefined>
): PhotoStatus {
  if (item.status === 'pending') {
    return polled[item.id]?.status ?? item.status;
  }
  return item.status;
}

/**
 * Precedence rule: the polled reject message wins only while the list item's status is 'pending';
 * otherwise the list rejectMessage wins.
 */
export function effectiveRejectMessage(
  item: MyPhotoDTO,
  polled: Record<string, { rejectMessage?: string | null } | undefined>
): string | null {
  if (item.status === 'pending') {
    return polled[item.id]?.rejectMessage ?? item.rejectMessage;
  }
  return item.rejectMessage;
}

/**
 * Returns photo IDs whose list status is 'pending' and are not in settled.
 */
export function pollableMyPhotoIds(
  items: readonly MyPhotoDTO[],
  settled: ReadonlySet<string>
): string[] {
  return items
    .filter((item) => item.status === 'pending' && !settled.has(item.id))
    .map((item) => item.id);
}

/**
 * Returns photo IDs whose polled status is 'needs_review' or 'hidden'.
 */
export function settledByPoll(
  polled: Record<string, { status: PhotoStatus } | undefined>
): string[] {
  const settledIds: string[] = [];
  for (const [id, val] of Object.entries(polled)) {
    if (val && (val.status === 'needs_review' || val.status === 'hidden')) {
      settledIds.push(id);
    }
  }
  return settledIds;
}

/**
 * Returns the URI to render in the grid tile:
 * null for uploading, rejected, or when thumbUrl is null.
 * Otherwise thumbUrl.
 */
export function tileImageUri(item: MyPhotoDTO): string | null {
  if (item.status === 'uploading' || item.status === 'rejected' || !item.thumbUrl) {
    return null;
  }
  return item.thumbUrl;
}

/**
 * Accessibility label for a cell:
 * "Food photo, opens viewer" for food_log
 * "Trip photo, opens viewer" for trip
 * "Photo, opens viewer" for any other target kind (fallback, never empty string)
 */
export function tileAccessibilityLabel(item: MyPhotoDTO): string {
  if (item.targetKind === 'food_log') {
    return 'Food photo, opens viewer';
  }
  if (item.targetKind === 'trip') {
    return 'Trip photo, opens viewer';
  }
  return 'Photo, opens viewer';
}

/**
 * Formats a clean category and timestamp subtitle for the photo viewer header:
 * - "Food photo • Oct 23, 2026" for food_log
 * - "Trip photo • Oct 23, 2026" for trip
 * - "Photo • Oct 23, 2026" for any other target kind
 * Falls back to kind label alone if createdAt is missing or invalid.
 */
export function formatMyPhotoSubtitle(targetKind: string, createdAt?: string): string {
  const kindLabel =
    targetKind === 'food_log'
      ? 'Food photo'
      : targetKind === 'trip'
      ? 'Trip photo'
      : 'Photo';

  if (!createdAt) {
    return kindLabel;
  }

  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) {
      return kindLabel;
    }
    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      }).format(d);
    } catch {
      formatted = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return `${kindLabel} • ${formatted}`;
  } catch {
    return kindLabel;
  }
}

/**
 * Converts MyPhotoDTO to PhotoViewerItem.
 * - mine: true
 * - uploader: { displayName: 'You', avatarPreset: null }
 * - url and thumbUrl are both null when tileImageUri(item) is null (uploading and rejected)
 *   so the viewer shows "Photo unavailable" instead of a broken image
 * - otherwise item's own url and thumbUrl
 * - subtitle: kind and date (e.g. "Food photo • Oct 23, 2026")
 */
export function toViewerItem(item: MyPhotoDTO): PhotoViewerItem {
  const hasImage = tileImageUri(item) !== null;
  return {
    id: item.id,
    url: hasImage ? item.url : null,
    thumbUrl: hasImage ? item.thumbUrl : null,
    width: item.width,
    height: item.height,
    uploader: {
      displayName: 'You',
      avatarPreset: null,
    },
    mine: true,
    subtitle: formatMyPhotoSubtitle(item.targetKind, item.createdAt),
  };
}

