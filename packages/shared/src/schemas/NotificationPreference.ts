
/**
 * Zod schemas for the push notification preference.
 *
 * `notificationPreferenceSchema` mirrors `NotificationPreferenceDTO`, the
 * response body for `GET /me/notification-preferences` (R9.3, R9.7).
 * `notificationPreferenceInputSchema` validates the `PUT` request body used to
 * toggle the preference.
 *
 * Validates: Requirements 9.3, 9.7
 */

import { z } from 'zod';

export const notificationPreferenceSchema = z
  .object({
    pushNotificationsEnabled: z.boolean(),
  })
  .strict();

export const notificationPreferenceInputSchema = z
  .object({
    pushNotificationsEnabled: z.boolean(),
  })
  .strict();

export type NotificationPreferenceInput = z.infer<
  typeof notificationPreferenceInputSchema
>;
