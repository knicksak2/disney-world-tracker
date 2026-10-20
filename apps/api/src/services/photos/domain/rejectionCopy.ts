import { PHOTO_REJECT_MESSAGES, type PhotoRejectReason } from '@dwt/shared';

export function rejectionMessage(reason: PhotoRejectReason): string {
  return PHOTO_REJECT_MESSAGES[reason];
}
