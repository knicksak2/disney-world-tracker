/**
 * Notification_Service (task 15.1).
 *
 * Invoked with a {@link ShareDeliveredEvent} after `createShareAtomic` commits
 * (design "Notification_Service"). It is the best-effort push side of the Share
 * send flow: for each recipient it decides whether to notify, composes a
 * privacy-preserving notification, and sends it through the Expo Push API with
 * bounded retry and token invalidation. It NEVER throws — every failure is
 * caught and logged — so the background dispatch that runs it (task 16.1)
 * cannot fail or block `POST /me/shares` (R7.7).
 *
 * Per-recipient algorithm:
 *
 *   1. Read the recipient's `Share_Notification_Preference` (default enabled,
 *      R9.7). Skip a recipient who has disabled Share notifications (R9.4). A
 *      recipient with the preference enabled — including the never-set default
 *      — proceeds (R9.5, R9.7).
 *   2. Read the recipient's `active` `Push_Registration` tokens (R8.6). If there
 *      are none, complete delivery for that recipient with no notification
 *      (R7.5).
 *   3. Compose one notification whose title is the sending User's display name
 *      and whose body is a single content label of ≤100 chars — the Experience
 *      name truncated to 100 for an `Experience_Share` (R7.3), or a
 *      "shared progress" indication for a `Progress_Share` (R7.4). The
 *      notification discloses NOTHING else: no rating, no note, no completion
 *      percentages (R7.2).
 *   4. Send to each active token via the Expo Push API, retrying transient
 *      failures at most `maxRetries` times within the `retryWindowMs` window
 *      (R7.1, R7.7). On a "device not registered" outcome, mark that
 *      `Push_Registration` invalidated and never send to it again (R7.6).
 *
 * Composition wiring (the real repos, catalog/profile lookups, and Expo client)
 * lives in `composeServices.ts` (task 16.1); this module depends only on narrow
 * structural ports so tests inject fakes.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.6, 9.4, 9.5, 9.7.
 */

import type {
  ExpoPushClient,
  ExpoPushData,
  ExpoPushMessage,
} from './expoPushClient.js';

// ---------------------------------------------------------------------------
// ShareDelivered event
// ---------------------------------------------------------------------------

/**
 * Event handed to the Notification_Service after a Share is durably delivered.
 *
 * Carries exactly what the service needs to target and compose without
 * re-reading the `shares` row: the recipients to notify, the sender to name,
 * and — for an `experience` Share — the referenced `experienceId` whose name
 * becomes the content label (R7.3). A `progress` Share needs no extra field;
 * its label is fixed (R7.4).
 */
export type ShareDeliveredEvent =
  | {
      readonly shareId: string;
      readonly senderId: string;
      readonly recipientIds: readonly string[];
      readonly payloadKind: 'experience';
      readonly experienceId: string;
    }
  | {
      readonly shareId: string;
      readonly senderId: string;
      readonly recipientIds: readonly string[];
      readonly payloadKind: 'progress';
    };

// ---------------------------------------------------------------------------
// FriendRequestReceived event
// ---------------------------------------------------------------------------

/**
 * Event handed to the Notification_Service after a Friend_Request is durably
 * created (`sendRequest` commits). Carries exactly what the service needs to
 * target and compose without re-reading the `friend_requests` row: the
 * recipient to notify, the sender to name, and the request id for tap
 * deep-linking.
 *
 * Like a Share notification, a friend-request notification is gated by the
 * User's push notification preference (the master toggle): a recipient who has
 * disabled push receives no friend-request notification (R9.4).
 */
export interface FriendRequestReceivedEvent {
  /** The pending Friend_Request's id, used for notification-tap deep-linking. */
  readonly requestId: string;
  /** The User who sent the request; named in the notification title. */
  readonly senderId: string;
  /** The User who received the request; the notification target. */
  readonly recipientId: string;
}

// ---------------------------------------------------------------------------
// TripInviteCreated event (Trips R6.6, R6.7)
// ---------------------------------------------------------------------------

/**
 * Event handed to the Notification_Service after a `pending` Trip_Invite is
 * durably created (`sendInvite` commits). Structurally identical to the
 * Trip_Service's `TripInviteCreatedNotice`, so the composition root can hand it
 * straight through. Carries exactly what the service needs to target and
 * compose without re-reading the `trip_invites` row: the invited User to
 * notify, the inviting Organizer to name, and the invite id for tap
 * deep-linking (Trips R6.6, R6.7).
 *
 * Like every push notification, it is gated by the recipient's master push
 * preference: an invited User who has disabled push receives no notification.
 */
export interface TripInviteCreatedEvent {
  /** The created Trip_Invite's id, used for notification-tap deep-linking. */
  readonly inviteId: string;
  /** The Trip the invite is for. */
  readonly tripId: string;
  /** The Organizer who sent the invite; named in the notification title. */
  readonly inviterId: string;
  /** The invited User; the notification target. */
  readonly inviteeId: string;
}

// ---------------------------------------------------------------------------
// RodeWithTagCreated event (Trips R10.8)
// ---------------------------------------------------------------------------

/**
 * Event handed to the Notification_Service after a `pending` Rode_With_Tag is
 * durably created (`logCompletion` commits). Structurally identical to the
 * Trip_Service's `RodeWithTagCreatedNotice`, so the composition root can hand
 * it straight through. Carries exactly what the service needs to target and
 * compose without re-reading the `rode_with_tags` row: the tagged Member to
 * notify, the Member who logged the Completion to name, and the tag + log-entry
 * ids for tap deep-linking to the confirm/decline view (Trips R10.8).
 *
 * Like every push notification, it is gated by the recipient's master push
 * preference: a tagged Member who has disabled push receives no notification.
 */
export interface RodeWithTagCreatedEvent {
  /** The created Rode_With_Tag's id, used for notification-tap deep-linking. */
  readonly tagId: string;
  /** The Trip_Log_Entry the tag belongs to, for the confirm view. */
  readonly tripLogEntryId: string;
  /** The Member who logged the Completion; named in the notification title. */
  readonly taggingMemberId: string;
  /** The tagged Member; the notification target. */
  readonly taggedMemberId: string;
}

// ---------------------------------------------------------------------------
// Structural dependency ports
// ---------------------------------------------------------------------------

/** Reads a User's push notification preference (default enabled, R9.7). */
export interface NotificationPreferenceReader {
  getPreference(
    userId: string,
  ): Promise<{ readonly pushNotificationsEnabled: boolean }>;
}

/**
 * Targets and invalidates push tokens. Satisfied structurally by the
 * `Push_Registration_Service` repo (task 12.1): `listActiveTokensForUser`
 * (R8.6) and `invalidateByToken` (R7.6).
 */
export interface PushTokenTargeter {
  listActiveTokensForUser(userId: string): Promise<readonly string[]>;
  invalidateByToken(expoPushToken: string): Promise<boolean>;
}

/** Minimal logging surface (satisfied structurally by a pino logger). */
export interface NotificationLogger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Dependencies for {@link createNotificationService}. */
export interface NotificationServiceDeps {
  /** Preference gate (R9.4, R9.5, R9.7). */
  readonly preferences: NotificationPreferenceReader;
  /** Active-token targeting (R8.6) and token invalidation (R7.6). */
  readonly pushTokens: PushTokenTargeter;
  /** Expo Push API port (R7.1). */
  readonly expoClient: ExpoPushClient;
  /**
   * Resolve a sending User's display name for the notification title (R7.2).
   * Returns `null` when the name cannot be resolved, in which case a neutral
   * fallback title is used.
   */
  readonly resolveSenderDisplayName: (
    senderId: string,
  ) => Promise<string | null>;
  /**
   * Resolve a referenced Experience's name for the content label (R7.3).
   * Returns `null` when it cannot be resolved, in which case a neutral
   * experience label is used.
   */
  readonly resolveExperienceName: (
    experienceId: string,
  ) => Promise<string | null>;

  /** Optional structured logger; failures are swallowed if omitted. */
  readonly logger?: NotificationLogger;
  /** Monotonic clock (ms) for the retry window; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Async delay between retries; defaults to a real `setTimeout` sleep. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Max retries per token after the initial attempt (R7.7). Default 3. */
  readonly maxRetries?: number;
  /** Total retry window in ms (R7.1, R7.7). Default 30_000. */
  readonly retryWindowMs?: number;
  /** Backoff between attempts in ms. Default 500. */
  readonly retryBackoffMs?: number;
}

/** Public surface of the Notification_Service. */
export interface NotificationService {
  /**
   * Handle a {@link ShareDeliveredEvent}. Resolves once every recipient has
   * been processed. Never rejects: all errors are caught and logged so the
   * caller (a background dispatch) is fully decoupled from push outcome
   * (R7.7).
   */
  handleShareDelivered(event: ShareDeliveredEvent): Promise<void>;

  /**
   * Handle a {@link FriendRequestReceivedEvent}: notify the recipient that
   * `senderId` sent them a friend request. Resolves once the recipient has
   * been processed. Never rejects: all errors are caught and logged so the
   * caller (a background dispatch) is fully decoupled from push outcome, and
   * `POST /me/friend-requests` returns `201` regardless of push result.
   */
  handleFriendRequestReceived(
    event: FriendRequestReceivedEvent,
  ): Promise<void>;

  /**
   * Handle a {@link TripInviteCreatedEvent}: notify the invited User that
   * `inviterId` invited them to a Trip. Resolves once the recipient has been
   * processed. Never rejects: all errors are caught and logged so the caller (a
   * background dispatch) is fully decoupled from push outcome, and the invite
   * request succeeds regardless of push result (Trips R6.6, R6.7).
   */
  handleTripInviteCreated(event: TripInviteCreatedEvent): Promise<void>;

  /**
   * Handle a {@link RodeWithTagCreatedEvent}: notify the tagged Member that
   * `taggingMemberId` tagged them on a logged Completion. Resolves once the
   * recipient has been processed. Never rejects: all errors are caught and
   * logged so the caller (a background dispatch) is fully decoupled from push
   * outcome, and the log request succeeds regardless of push result
   * (Trips R10.8).
   */
  handleRodeWithTagCreated(event: RodeWithTagCreatedEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum content-label length (R7.2, R7.3). */
export const MAX_LABEL_LENGTH = 100;
/** Fixed label for a `Progress_Share` (R7.4). */
export const PROGRESS_LABEL = 'Shared their progress';
/** Fixed body for a Friend_Request notification. */
export const FRIEND_REQUEST_LABEL = 'Sent you a friend request';
/** Fixed body for a Trip_Invite notification (Trips R6.6, R6.7). */
export const TRIP_INVITE_LABEL = 'Invited you to a trip';
/** Fixed body for a Rode_With_Tag notification (Trips R10.8). */
export const RODE_WITH_TAG_LABEL = 'Tagged you on a ride';
/** Neutral fallbacks when a lookup returns null (still discloses nothing extra). */
const FALLBACK_SENDER_NAME = 'A friend';
const FALLBACK_EXPERIENCE_LABEL = 'Shared an experience';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_WINDOW_MS = 30_000;
const DEFAULT_RETRY_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link NotificationService} from its structural dependencies.
 */
export function createNotificationService(
  deps: NotificationServiceDeps,
): NotificationService {
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? defaultDelay;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryWindowMs = deps.retryWindowMs ?? DEFAULT_RETRY_WINDOW_MS;
  const retryBackoffMs = deps.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

  const timing = { now, delay, maxRetries, retryWindowMs, retryBackoffMs };

  return {
    async handleShareDelivered(event: ShareDeliveredEvent): Promise<void> {
      let body: string;
      let title: string;
      try {
        title = await composeTitle(event, deps);
        body = await composeBody(event, deps);
      } catch (err) {
        // A lookup failure must not abort the whole delivery. Log and bail —
        // the request has already returned 201 regardless (R7.7).
        deps.logger?.error(
          { err, shareId: event.shareId },
          'notification composition failed',
        );
        return;
      }

      // Process recipients independently so one recipient's failure cannot
      // starve the others.
      await Promise.all(
        event.recipientIds.map((recipientId) =>
          notifyRecipient(recipientId, { title, body }, {
            deps,
            ...timing,
            data: { shareId: event.shareId },
            logContext: { shareId: event.shareId },
          }).catch((err) => {
            // Defensive: notifyRecipient already swallows its own errors, but
            // guarantee handleShareDelivered never rejects (R7.7).
            deps.logger?.error(
              { err, recipientId, shareId: event.shareId },
              'notification delivery failed for recipient',
            );
          }),
        ),
      );
    },

    async handleFriendRequestReceived(
      event: FriendRequestReceivedEvent,
    ): Promise<void> {
      // Title = the sending User's display name; body = a fixed label. Gated
      // by the recipient's push notification preference (the master toggle)
      // via notifyRecipient, exactly like a Share notification (R9.4).
      let title: string;
      try {
        const name = await deps.resolveSenderDisplayName(event.senderId);
        const trimmed = name?.trim();
        title =
          trimmed && trimmed.length > 0 ? trimmed : FALLBACK_SENDER_NAME;
      } catch (err) {
        deps.logger?.error(
          { err, requestId: event.requestId },
          'friend-request notification composition failed',
        );
        return;
      }

      await notifyRecipient(
        event.recipientId,
        { title, body: FRIEND_REQUEST_LABEL },
        {
          deps,
          ...timing,
          data: { friendRequestId: event.requestId },
          logContext: { requestId: event.requestId },
        },
      ).catch((err) => {
        // Defensive: notifyRecipient already swallows its own errors, but
        // guarantee handleFriendRequestReceived never rejects.
        deps.logger?.error(
          { err, recipientId: event.recipientId, requestId: event.requestId },
          'friend-request notification delivery failed for recipient',
        );
      });
    },

    async handleTripInviteCreated(
      event: TripInviteCreatedEvent,
    ): Promise<void> {
      // Title = the inviting Organizer's display name; body = a fixed label.
      // Gated by the recipient's master push preference via notifyRecipient,
      // exactly like a friend-request notification (Trips R6.6, R6.7).
      let title: string;
      try {
        const name = await deps.resolveSenderDisplayName(event.inviterId);
        const trimmed = name?.trim();
        title =
          trimmed && trimmed.length > 0 ? trimmed : FALLBACK_SENDER_NAME;
      } catch (err) {
        deps.logger?.error(
          { err, inviteId: event.inviteId },
          'trip-invite notification composition failed',
        );
        return;
      }

      await notifyRecipient(
        event.inviteeId,
        { title, body: TRIP_INVITE_LABEL },
        {
          deps,
          ...timing,
          data: { tripInviteId: event.inviteId },
          logContext: { inviteId: event.inviteId, tripId: event.tripId },
        },
      ).catch((err) => {
        // Defensive: notifyRecipient already swallows its own errors, but
        // guarantee handleTripInviteCreated never rejects.
        deps.logger?.error(
          { err, recipientId: event.inviteeId, inviteId: event.inviteId },
          'trip-invite notification delivery failed for recipient',
        );
      });
    },

    async handleRodeWithTagCreated(
      event: RodeWithTagCreatedEvent,
    ): Promise<void> {
      // Title = the tagging Member's display name; body = a fixed label. Gated
      // by the recipient's master push preference via notifyRecipient, exactly
      // like a friend-request notification (Trips R10.8).
      let title: string;
      try {
        const name = await deps.resolveSenderDisplayName(event.taggingMemberId);
        const trimmed = name?.trim();
        title =
          trimmed && trimmed.length > 0 ? trimmed : FALLBACK_SENDER_NAME;
      } catch (err) {
        deps.logger?.error(
          { err, tagId: event.tagId },
          'rode-with notification composition failed',
        );
        return;
      }

      await notifyRecipient(
        event.taggedMemberId,
        { title, body: RODE_WITH_TAG_LABEL },
        {
          deps,
          ...timing,
          data: {
            rodeWithTagId: event.tagId,
            tripLogEntryId: event.tripLogEntryId,
          },
          logContext: {
            tagId: event.tagId,
            tripLogEntryId: event.tripLogEntryId,
          },
        },
      ).catch((err) => {
        // Defensive: notifyRecipient already swallows its own errors, but
        // guarantee handleRodeWithTagCreated never rejects.
        deps.logger?.error(
          { err, recipientId: event.taggedMemberId, tagId: event.tagId },
          'rode-with notification delivery failed for recipient',
        );
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Composition (R7.2, R7.3, R7.4)
// ---------------------------------------------------------------------------

/** Title = the sending User's display name (R7.2). */
async function composeTitle(
  event: ShareDeliveredEvent,
  deps: NotificationServiceDeps,
): Promise<string> {
  const name = await deps.resolveSenderDisplayName(event.senderId);
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : FALLBACK_SENDER_NAME;
}

/**
 * Body = a single content label ≤100 chars. For an `Experience_Share` the
 * Experience name truncated to 100 (R7.3); for a `Progress_Share` the fixed
 * "shared progress" indication (R7.4). No rating/note/percentage is ever
 * consulted (R7.2).
 */
async function composeBody(
  event: ShareDeliveredEvent,
  deps: NotificationServiceDeps,
): Promise<string> {
  if (event.payloadKind === 'progress') {
    return PROGRESS_LABEL;
  }
  const name = await deps.resolveExperienceName(event.experienceId);
  const trimmed = name?.trim();
  const label =
    trimmed && trimmed.length > 0 ? trimmed : FALLBACK_EXPERIENCE_LABEL;
  return truncateLabel(label);
}

/** Truncate a label to at most {@link MAX_LABEL_LENGTH} characters (R7.3). */
export function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_LENGTH
    ? label.slice(0, MAX_LABEL_LENGTH)
    : label;
}

// ---------------------------------------------------------------------------
// Per-recipient delivery (R7.1, R7.5, R7.6, R7.7, R8.6, R9.4, R9.5, R9.7)
// ---------------------------------------------------------------------------

interface DeliveryContext {
  readonly deps: NotificationServiceDeps;
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
  readonly maxRetries: number;
  readonly retryWindowMs: number;
  readonly retryBackoffMs: number;
  /** Routing-only payload attached to every message in this delivery. */
  readonly data: ExpoPushData;
  /** Extra fields merged into every log line for this delivery (e.g. shareId). */
  readonly logContext: Record<string, unknown>;
}

/**
 * Gated recipient path: apply the User's push notification preference gate
 * (R9.4, R9.5, R9.7) and then deliver. Used by both the Share path and the
 * friend-request path, since the preference is a master toggle governing all
 * push notifications.
 */
async function notifyRecipient(
  recipientId: string,
  content: { readonly title: string; readonly body: string },
  ctx: DeliveryContext,
): Promise<void> {
  const { deps } = ctx;

  // Preference gate (R9.4, R9.5, R9.7). A read failure defaults to skipping
  // this recipient rather than risking an unwanted notification.
  let enabled: boolean;
  try {
    const pref = await deps.preferences.getPreference(recipientId);
    enabled = pref.pushNotificationsEnabled;
  } catch (err) {
    deps.logger?.warn(
      { err, recipientId, ...ctx.logContext },
      'preference read failed; skipping recipient',
    );
    return;
  }
  if (!enabled) {
    // R9.4: recipient has opted out; complete delivery with no notification.
    return;
  }

  await deliverToRecipient(recipientId, content, ctx);
}

/**
 * Target a recipient's active tokens and send with bounded retry. Shared by
 * the Share path (after its preference gate) and the friend-request path.
 */
async function deliverToRecipient(
  recipientId: string,
  content: { readonly title: string; readonly body: string },
  ctx: DeliveryContext,
): Promise<void> {
  const { deps } = ctx;

  // Active-token targeting (R8.6). No active token ⇒ no notification (R7.5).
  let tokens: readonly string[];
  try {
    tokens = await deps.pushTokens.listActiveTokensForUser(recipientId);
  } catch (err) {
    deps.logger?.warn(
      { err, recipientId, ...ctx.logContext },
      'active-token read failed; skipping recipient',
    );
    return;
  }
  if (tokens.length === 0) {
    // R7.5: no active Push_Registration ⇒ complete delivery with no push.
    return;
  }

  // Send with bounded retry + invalidation (R7.1, R7.6, R7.7).
  await sendWithRetry(tokens, content, ctx);
}

/**
 * Send `content` to every token, retrying transient failures within the
 * bounded window and invalidating tokens the provider reports as unregistered.
 *
 * Delivery bookkeeping is per token: a token is removed from the pending set
 * once it is delivered (`ok`) or invalidated (`device_unregistered`, terminal).
 * Only tokens that transiently failed — or that a thrown `send` left
 * unresolved — remain pending for the next attempt. The loop stops when the
 * pending set empties, the retry budget is exhausted, or the 30-second window
 * elapses (R7.7).
 */
async function sendWithRetry(
  tokens: readonly string[],
  content: { readonly title: string; readonly body: string },
  ctx: DeliveryContext,
): Promise<void> {
  const { deps } = ctx;
  const startedAt = ctx.now();
  let pending = [...tokens];

  // attempt 0 is the initial send; attempts 1..maxRetries are the retries.
  for (let attempt = 0; attempt <= ctx.maxRetries; attempt += 1) {
    if (pending.length === 0) return;

    if (attempt > 0) {
      // Respect the 30s window: do not start a retry that begins past it.
      if (ctx.now() - startedAt >= ctx.retryWindowMs) {
        deps.logger?.warn(
          { ...ctx.logContext, pending: pending.length },
          'notification retry window elapsed; abandoning pending tokens',
        );
        return;
      }
      await ctx.delay(backoffFor(attempt, ctx.retryBackoffMs));
      if (ctx.now() - startedAt >= ctx.retryWindowMs) {
        return;
      }
    }

    const messages: ExpoPushMessage[] = pending.map((token) => ({
      to: token,
      title: content.title,
      body: content.body,
      // Routing-only payload so a notification tap can deep-link to the
      // triggering Share or Friend_Request (R10.2). Carries only an id — no
      // rating/note/percentage (R7.2).
      data: ctx.data,
    }));

    let deliveries;
    try {
      deliveries = await deps.expoClient.send(messages);
    } catch (err) {
      // Provider unreachable: every pending token transiently failed (R7.7).
      // Keep the whole pending set and retry on the next iteration.
      deps.logger?.warn(
        { err, ...ctx.logContext, pending: pending.length },
        'expo push send threw; will retry pending tokens',
      );
      continue;
    }

    const byToken = new Map(deliveries.map((d) => [d.token, d] as const));
    const stillPending: string[] = [];
    for (const token of pending) {
      const delivery = byToken.get(token);
      if (!delivery) {
        // No result for this token ⇒ treat as transient and retry (R7.7).
        stillPending.push(token);
        continue;
      }
      if (delivery.status === 'ok') {
        continue; // delivered
      }
      if (delivery.status === 'device_unregistered') {
        // R7.6: token no longer valid ⇒ invalidate and stop sending to it.
        try {
          await deps.pushTokens.invalidateByToken(token);
        } catch (err) {
          deps.logger?.warn(
            { err, ...ctx.logContext },
            'failed to invalidate unregistered token',
          );
        }
        continue; // terminal — never retried
      }
      // transient error ⇒ retry
      stillPending.push(token);
    }
    pending = stillPending;
  }

  if (pending.length > 0) {
    deps.logger?.warn(
      { ...ctx.logContext, pending: pending.length },
      'notification retries exhausted; some tokens undelivered',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linear backoff capped so retries stay comfortably inside the window. */
function backoffFor(attempt: number, baseMs: number): number {
  return baseMs * attempt;
}

/** Real timer-based delay; replaced by tests via `deps.delay`. */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
