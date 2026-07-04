// Feature: social-sharing-loop, Property 13: Notification composition discloses only sender name and a bounded label
/**
 * Property-based test for Notification_Service composition (task 15.2).
 *
 * Validates: Requirements 7.2, 7.3
 *
 * Property 13 (design.md → Correctness Properties → "Notification composition
 * discloses only sender name and a bounded label"):
 *
 *   For any delivered Share, the composed push notification contains the
 *   sender's display name and a content label of at most 100 characters,
 *   contains none of the sender's Rating, the sender's Note, or any completion
 *   percentage, and — for an Experience_Share — the label equals the
 *   Experience name truncated to at most 100 characters.
 *
 * Test strategy: drive the real `createNotificationService` for a single
 * preference-enabled recipient with a single active token, capturing every
 * message handed to a fake `ExpoPushClient`. Because the composed message is a
 * pure function of the resolved sender display name and (for an experience
 * share) the resolved Experience name — and `ExpoPushMessage` carries only
 * `to`/`title`/`body` — the exact-equality assertions below prove the
 * "discloses ONLY" clause: any leaked Rating, Note, or percentage would have to
 * appear as extra text in `title`/`body` or as an extra message field, and both
 * are pinned down exactly.
 *
 *   - `title`  === the sender's display name (trimmed), or the neutral fallback
 *                  when the resolver yields null/blank (R7.2).
 *   - `body`   === for a progress share, the fixed "shared progress" label
 *                  (R7.4-adjacent, exercised here for the bound); for an
 *                  experience share, the Experience name trimmed then truncated
 *                  to ≤100 chars (R7.3), or the neutral fallback when null/blank.
 *   - `body.length` ≤ 100 for every share (R7.2).
 *   - the message has exactly the keys `to`/`title`/`body` — no data payload
 *     smuggling rating/note/percentages (R7.2).
 *
 * Names are drawn from `fast-check`'s default (printable-ASCII) string space,
 * including lengths well over 100 to exercise truncation, plus null to exercise
 * the neutral fallbacks.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  createNotificationService,
  truncateLabel,
  MAX_LABEL_LENGTH,
  PROGRESS_LABEL,
} from '../service.js';
import type {
  ShareDeliveredEvent,
  PushTokenTargeter,
  NotificationPreferenceReader,
} from '../service.js';
import type { ExpoPushClient, ExpoPushMessage } from '../expoPushClient.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

/**
 * Local mirrors of the service's (unexported) neutral fallbacks, used to
 * compute the expected composition independently. Kept in sync with
 * `service.ts` by intent: a drift would surface as a counter-example.
 */
const FALLBACK_SENDER_NAME = 'A friend';
const FALLBACK_EXPERIENCE_LABEL = 'Shared an experience';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Printable-ASCII strings up to 250 chars so both truncation (>100) and the
 * pass-through case (≤100) are exercised heavily.
 */
const nameArb: fc.Arbitrary<string> = fc.string({ maxLength: 250 });

/** A resolvable name, or `null` to exercise the neutral fallback path. */
const maybeNameArb: fc.Arbitrary<string | null> = fc.option(nameArb, {
  nil: null,
});

/** Discriminated Share payload: an experience (with a resolvable name) or progress. */
const payloadArb = fc.oneof(
  fc.record({
    kind: fc.constant('experience' as const),
    experienceId: fc.uuid(),
    experienceName: maybeNameArb,
  }),
  fc.record({ kind: fc.constant('progress' as const) }),
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Notification_Service — Property 13: composition discloses only sender name and a bounded label', () => {
  it(
    'composes title = sender display name and body = a single label ≤100 chars (Experience name truncated for an experience share), with no extra disclosure',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          maybeNameArb,
          payloadArb,
          async (shareId, senderId, recipientId, senderName, payload) => {
            // Capture every message the service dispatches to the provider.
            const captured: ExpoPushMessage[] = [];
            const expoClient: ExpoPushClient = {
              async send(messages) {
                for (const m of messages) captured.push(m);
                return messages.map((m) => ({
                  token: m.to,
                  status: 'ok' as const,
                }));
              },
            };

            // Preference-enabled recipient with exactly one active token, so
            // composition happens once and is observable in `captured[0]`.
            const preferences: NotificationPreferenceReader = {
              async getPreference() {
                return { shareNotificationsEnabled: true };
              },
            };
            const token = `ExponentPushToken[${recipientId}]`;
            const pushTokens: PushTokenTargeter = {
              async listActiveTokensForUser() {
                return [token];
              },
              async invalidateByToken() {
                return true;
              },
            };

            const service = createNotificationService({
              preferences,
              pushTokens,
              expoClient,
              resolveSenderDisplayName: async () => senderName,
              resolveExperienceName: async () =>
                payload.kind === 'experience' ? payload.experienceName : null,
            });

            const event: ShareDeliveredEvent =
              payload.kind === 'experience'
                ? {
                    shareId,
                    senderId,
                    recipientIds: [recipientId],
                    payloadKind: 'experience',
                    experienceId: payload.experienceId,
                  }
                : {
                    shareId,
                    senderId,
                    recipientIds: [recipientId],
                    payloadKind: 'progress',
                  };

            await service.handleShareDelivered(event);

            // ---- Expected composition, derived independently -------------
            const trimmedName = senderName?.trim();
            const expectedTitle =
              trimmedName && trimmedName.length > 0
                ? trimmedName
                : FALLBACK_SENDER_NAME;

            let expectedBody: string;
            if (payload.kind === 'progress') {
              expectedBody = PROGRESS_LABEL;
            } else {
              const trimmedExp = payload.experienceName?.trim();
              const label =
                trimmedExp && trimmedExp.length > 0
                  ? trimmedExp
                  : FALLBACK_EXPERIENCE_LABEL;
              expectedBody = truncateLabel(label);
            }

            // ---- Assertions ---------------------------------------------
            // Exactly one composed message for the single active token.
            expect(captured).toHaveLength(1);
            const msg = captured[0]!;

            // title = sender display name (R7.2).
            expect(msg.title).toBe(expectedTitle);

            // body = the single content label (R7.2, R7.3, R7.4).
            expect(msg.body).toBe(expectedBody);

            // The label is bounded to ≤100 characters for every share (R7.2).
            expect(msg.body.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);

            // For an experience share the label is exactly the Experience name
            // (trimmed) truncated to ≤100 chars when a name resolves (R7.3).
            if (payload.kind === 'experience') {
              const trimmedExp = payload.experienceName?.trim();
              if (trimmedExp && trimmedExp.length > 0) {
                expect(msg.body).toBe(truncateLabel(trimmedExp));
              }
            }

            // "Discloses ONLY": the message carries no field beyond
            // to/title/body/data (R7.2). The `data` payload is routing-only —
            // exactly `{ shareId }` — so no rating/note/percentage can ride
            // along, while still enabling notification-tap deep-linking (R10.2).
            expect(Object.keys(msg).sort()).toEqual([
              'body',
              'data',
              'title',
              'to',
            ]);
            expect(msg.data).toEqual({ shareId });
            expect(Object.keys(msg.data).sort()).toEqual(['shareId']);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
