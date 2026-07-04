/**
 * Notification_Service public surface (task 15.1).
 *
 * Re-exports the service factory, the `ShareDelivered` event, the structural
 * dependency ports, and the Expo Push client so `composeServices.ts` (task
 * 16.1) can wire the whole thing from a single import:
 *
 * ```ts
 * import {
 *   createNotificationService,
 *   createExpoPushClient,
 *   createSenderDisplayNameResolver,
 *   createExperienceNameResolver,
 * } from './services/notifications/index.js';
 * ```
 *
 * The service is invoked with a {@link ShareDeliveredEvent} on a background
 * `(event) => Promise<void>` dispatch after `createShareAtomic` commits,
 * mirroring the existing `emitRatingChanged` seam so `POST /me/shares` returns
 * `201` regardless of push outcome (R7.7).
 */

export {
  createNotificationService,
  truncateLabel,
  MAX_LABEL_LENGTH,
  PROGRESS_LABEL,
  FRIEND_REQUEST_LABEL,
} from './service.js';
export type {
  NotificationService,
  NotificationServiceDeps,
  NotificationPreferenceReader,
  PushTokenTargeter,
  NotificationLogger,
  ShareDeliveredEvent,
  FriendRequestReceivedEvent,
} from './service.js';

export { createExpoPushClient } from './expoPushClient.js';
export type {
  ExpoPushClient,
  ExpoPushClientOptions,
  ExpoPushMessage,
  ExpoPushDelivery,
  ExpoPushDeliveryStatus,
} from './expoPushClient.js';

export {
  createSenderDisplayNameResolver,
  createExperienceNameResolver,
} from './directory.js';
