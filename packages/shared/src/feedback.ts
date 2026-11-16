/**
 * In-app feedback: constants, Zod schemas and DTOs shared by the API and the mobile client
 * (`.kiro/specs/in-app-feedback`).
 *
 * A signed-in user sends one text message of a given kind (bug, idea or other), optionally with the app version,
 * platform and OS version, and optionally consents to be contacted at their account email. The email is never part
 * of the request: the server copies it from the account only when `contactOk` is true.
 *
 * Validates: Requirements 2.1, 2.2, 8.2
 */
import { z } from 'zod';

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'resolved'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_PLATFORMS = ['ios', 'android', 'web'] as const;
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number];

/** Message length cap, shared by the client counter, the API schema and the DB CHECK. */
export const FEEDBACK_MESSAGE_MAX = 2000;
/** Length cap of `appVersion` and `osVersion`, shared with the DB CHECKs. */
export const FEEDBACK_DEVICE_FIELD_MAX = 32;

/** Device info is all-or-nothing: either all three values are present or the object is absent. */
export const feedbackDeviceSchema = z
  .object({
    appVersion: z.string().trim().min(1).max(FEEDBACK_DEVICE_FIELD_MAX),
    platform: z.enum(FEEDBACK_PLATFORMS),
    osVersion: z.string().trim().min(1).max(FEEDBACK_DEVICE_FIELD_MAX),
  })
  .strict();

export const feedbackSubmitInputSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS),
    message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
    contactOk: z.boolean().default(false),
    device: feedbackDeviceSchema.optional(),
  })
  .strict();

export type FeedbackDevice = z.infer<typeof feedbackDeviceSchema>;
export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitInputSchema>;

export interface FeedbackSubmitResponse {
  readonly id: string;
}
