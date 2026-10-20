import { type PhotoStatus, type PhotoTargetKind, type TripPostSlotState, type PhotoUploaderDTO } from '@dwt/shared';
import { photoKeys } from './objectKeys.js';

export interface CanViewPhotoFacts {
  viewerId: string;
  ownerId: string | null;
  status: PhotoStatus;
  kind: PhotoTargetKind;
  viewerIsMember?: boolean;
  blocked: boolean;
  context: 'gallery' | 'album' | 'summaryShare';
  shareActive?: boolean;
}

export function canViewPhoto(facts: CanViewPhotoFacts): boolean {
  if (facts.status === 'deleted') {
    return false;
  }
  // The owner sees every non-deleted photo
  if (facts.ownerId !== null && facts.viewerId === facts.ownerId) {
    return true;
  }
  // Others see only approved photos
  if (facts.status !== 'approved') {
    return false;
  }
  // Block in either direction hides the photo
  if (facts.blocked) {
    return false;
  }
  // Food photos are visible to all signed-in users unless blocked
  if (facts.kind === 'food_log') {
    return true;
  }
  // Trip photos require membership (or active summary share in summaryShare context)
  if (facts.kind === 'trip') {
    if (facts.context === 'summaryShare') {
      return facts.shareActive === true;
    }
    return facts.viewerIsMember === true;
  }
  return false;
}

export function tripPostSlotState(params: {
  status: PhotoStatus | null;
  mine: boolean;
  blocked: boolean;
}): TripPostSlotState {
  const { status, mine, blocked } = params;

  if (status === 'deleted' || status === null) {
    return 'removed';
  }
  if (blocked && !mine) {
    return 'unavailable';
  }
  if (status === 'approved') {
    return 'ready';
  }
  if (mine && (status === 'uploading' || status === 'pending' || status === 'needs_review' || status === 'rejected' || status === 'hidden')) {
    return 'checking';
  }
  if (!mine && (status === 'pending' || status === 'needs_review')) {
    return 'checking';
  }
  if (!mine && status === 'rejected') {
    return 'removed';
  }
  if (!mine && (status === 'hidden' || status === 'uploading')) {
    return 'unavailable';
  }
  return 'unavailable';
}

export function postVisibleToNonAuthor(slots: readonly { state: TripPostSlotState }[]): boolean {
  return slots.some((s) => s.state === 'ready' || s.state === 'checking');
}

export interface ReadKeysResult {
  uploadFull?: string;
  uploadThumb?: string;
  full?: string;
  thumb?: string;
}

export function readKeysFor(
  target: { status: PhotoStatus; viewer: 'owner' | 'other' | 'admin' },
  photoId: string
): ReadKeysResult {
  const keys = photoKeys(photoId);
  const { status, viewer } = target;

  if (status === 'approved' || status === 'hidden') {
    return { full: keys.full, thumb: keys.thumb };
  }
  if (status === 'uploading' || status === 'pending') {
    if (viewer === 'owner') {
      return { uploadThumb: keys.uploadThumb };
    }
    return {};
  }
  if (status === 'needs_review') {
    if (viewer === 'owner') {
      return { uploadThumb: keys.uploadThumb };
    }
    if (viewer === 'admin') {
      return { uploadThumb: keys.uploadThumb, uploadFull: keys.uploadFull };
    }
    return {};
  }
  // 'rejected' or 'deleted'
  return {};
}

export function bylineFor(params: {
  viewerId: string;
  ownerId: string | null;
  friendIds: ReadonlySet<string> | readonly string[];
  profile?: { displayName: string; avatarPreset: string | null } | null;
}): PhotoUploaderDTO | null {
  const { viewerId, ownerId, friendIds, profile } = params;
  if (!ownerId || !profile) {
    return null;
  }
  const isMine = viewerId === ownerId;
  const isFriend = Array.isArray(friendIds) ? friendIds.includes(ownerId) : (friendIds as ReadonlySet<string>).has(ownerId);

  if (isMine || isFriend) {
    return {
      userId: ownerId,
      displayName: profile.displayName,
      avatarPreset: profile.avatarPreset,
    };
  }
  return null;
}
