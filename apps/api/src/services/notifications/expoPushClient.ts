/**
 * Expo Push API client — structural port + production implementation (task 15.1).
 *
 * The `Notification_Service` sends every Share push notification through the
 * Expo Push API. To keep the service unit-testable without a live network the
 * dependency is expressed as a narrow structural port, {@link ExpoPushClient},
 * whose single `send` method takes a batch of composed messages and returns one
 * {@link ExpoPushDelivery} result per message (keyed by the destination token).
 * Tests inject a fake implementing this port; production wires
 * {@link createExpoPushClient}, which talks to `https://exp.host`.
 *
 * The port deliberately collapses Expo's two-step ticket/receipt protocol into
 * a single per-token outcome so the service's retry and invalidation logic
 * (R7.6, R7.7) depends only on three states:
 *
 *   - `ok`                — the message was accepted for delivery;
 *   - `device_unregistered` — the token is no longer valid and the
 *     corresponding `Push_Registration` must be invalidated (R7.6). This is a
 *     terminal outcome: the service never retries it;
 *   - `error`             — a transient/unknown failure. The service retries
 *     these within its bounded window (R7.7).
 *
 * A thrown error from `send` (the provider is unreachable) is treated by the
 * service as "every message in the batch transiently failed" and retried the
 * same way (R7.7).
 */

// ---------------------------------------------------------------------------
// Message + delivery result shapes
// ---------------------------------------------------------------------------

/**
 * Routing-only data payload carried on a Share push notification. It exists so
 * a notification tap can deep-link to the referenced Share (R10.2/R10.4): the
 * mobile handler reads `notification.request.content.data.shareId`. It carries
 * ONLY the Share id — never the sender's rating, note, or any completion
 * percentage — so the "discloses only sender name and a bounded label"
 * guarantee (R7.2) is preserved.
 */
export interface ExpoPushData {
  /** The delivered Share's id, used for notification-tap deep-linking. */
  readonly shareId: string;
}

/**
 * A single composed push notification. The Notification_Service sets `title`
 * to the sending User's display name and `body` to the bounded content label;
 * `data` carries only the Share id for tap deep-linking and never any
 * rating/note/percentage (R7.2).
 */
export interface ExpoPushMessage {
  /** Destination Expo push token. */
  readonly to: string;
  /** Notification title — the sender's display name (R7.2). */
  readonly title: string;
  /** Notification body — the bounded content label ≤100 chars (R7.2). */
  readonly body: string;
  /** Routing-only data payload for tap deep-linking (R10.2). */
  readonly data: ExpoPushData;
}

/** Normalized per-token outcome of one send attempt. */
export type ExpoPushDeliveryStatus = 'ok' | 'device_unregistered' | 'error';

/**
 * Per-message send result, keyed by the destination token so the service can
 * reconcile a batch response back to the tokens it targeted regardless of
 * ordering.
 */
export interface ExpoPushDelivery {
  readonly token: string;
  readonly status: ExpoPushDeliveryStatus;
  /** Optional provider-supplied detail for logging on the `error` path. */
  readonly message?: string;
}

/**
 * Structural port the Notification_Service depends on. A single `send` accepts
 * a batch of messages and resolves with one {@link ExpoPushDelivery} per
 * message. Implementations SHOULD return a result for every input token; the
 * service treats a token with no corresponding result as a transient `error`.
 */
export interface ExpoPushClient {
  send(
    messages: readonly ExpoPushMessage[],
  ): Promise<readonly ExpoPushDelivery[]>;
}

// ---------------------------------------------------------------------------
// Production implementation
// ---------------------------------------------------------------------------

/** Default Expo Push API send endpoint. */
const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';

/** The error code Expo reports for a token that is no longer registered. */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/** Minimal `fetch` surface this client needs (Node 18+ global `fetch`). */
type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Options for {@link createExpoPushClient}. */
export interface ExpoPushClientOptions {
  /** Override the send endpoint (tests / self-hosted Expo). */
  readonly url?: string;
  /** Injected `fetch` (defaults to the global). */
  readonly fetch?: FetchLike;
}

/** Shape of a single ticket in the Expo send response `data` array. */
interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Build a production {@link ExpoPushClient} backed by the Expo Push API.
 *
 * The client POSTs the batch to `EXPO_PUSH_SEND_URL` and maps each returned
 * ticket to an {@link ExpoPushDelivery}: an `error` ticket whose
 * `details.error` is `DeviceNotRegistered` becomes `device_unregistered`
 * (terminal, drives R7.6); any other `error` ticket becomes `error`
 * (retryable, R7.7); an `ok` ticket becomes `ok`. If the HTTP call itself
 * fails or the body is not the expected shape, the error propagates so the
 * service's retry path treats the whole batch as a transient failure (R7.7).
 *
 * Tickets are matched to tokens positionally, mirroring Expo's contract that
 * the response `data` array is index-aligned with the request messages.
 */
export function createExpoPushClient(
  options: ExpoPushClientOptions = {},
): ExpoPushClient {
  const url = options.url ?? EXPO_PUSH_SEND_URL;
  const doFetch: FetchLike =
    options.fetch ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async send(messages) {
      if (messages.length === 0) return [];

      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          messages.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            // Routing-only payload; surfaces to the mobile tap handler as
            // `notification.request.content.data.shareId` (R10.2).
            data: m.data,
          })),
        ),
      });

      if (!response.ok) {
        // Provider returned a non-2xx. Surface as a throw so the service's
        // retry loop treats every message in the batch as transiently failed.
        throw new Error(`Expo push send failed with status ${response.status}`);
      }

      const body = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(body.data) ? body.data : [];

      return messages.map((message, index): ExpoPushDelivery => {
        const ticket = tickets[index];
        if (!ticket || ticket.status === 'ok') {
          return { token: message.to, status: 'ok' };
        }
        const status: ExpoPushDeliveryStatus =
          ticket.details?.error === DEVICE_NOT_REGISTERED
            ? 'device_unregistered'
            : 'error';
        // Only include `message` when the provider supplied one so the result
        // satisfies the optional-property contract under exactOptionalPropertyTypes.
        return ticket.message !== undefined
          ? { token: message.to, status, message: ticket.message }
          : { token: message.to, status };
      });
    },
  };
}
