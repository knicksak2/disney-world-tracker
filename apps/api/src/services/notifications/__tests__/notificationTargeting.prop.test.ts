// Feature: social-sharing-loop, Property 15: Delivery targets are exactly the active tokens of preference-enabled recipients
/**
 * Property-based test for Notification_Service delivery targeting (task 15.3).
 *
 * Validates: Requirements 8.6, 9.4, 9.5, 9.7
 *
 * Property 15 (design.md → Correctness Properties → "Delivery targets are
 * exactly the active tokens of preference-enabled recipients"):
 *
 *   For any set of recipients — each with a Share_Notification_Preference that
 *   is enabled, disabled, or never-set (default enabled, R9.7), and each with
 *   some set of active Push_Tokens — the notifications the service dispatches
 *   target exactly the union of the active tokens of the recipients whose
 *   preference permits Share notifications, and no others.
 *
 * This pins down all four cited requirements at once:
 *   - R9.4  a disabled recipient is skipped: none of its tokens are targeted.
 *   - R9.5  an enabled recipient with ≥1 active token is targeted on every one.
 *   - R9.7  a never-set preference is treated as enabled (the reader returns the
 *           `true` default), so such a recipient is targeted like an enabled one.
 *   - R8.6  only `active` tokens are delivered to: the service targets exactly
 *           what `listActiveTokensForUser` returns (the repo excludes
 *           invalidated registrations), and an enabled recipient with zero
 *           active tokens receives nothing.
 *
 * Test strategy: drive the real `createNotificationService` over a generated
 * roster of recipients, capturing every `ExpoPushMessage` handed to a fake
 * `ExpoPushClient`. Recipient ids and tokens are assigned deterministically by
 * index so they are globally unique, making the observed target set directly
 * comparable to the expected union computed independently from the roster.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { createNotificationService } from '../service.js';
import type {
  ShareDeliveredEvent,
  PushTokenTargeter,
  NotificationPreferenceReader,
} from '../service.js';
import type { ExpoPushClient, ExpoPushMessage } from '../expoPushClient.js';

const NUM_RUNS = 100;

/** Preference state of a recipient; `unset` exercises the R9.7 default. */
type PrefState = 'enabled' | 'disabled' | 'unset';

/**
 * Per-recipient spec: a preference state and how many active tokens the
 * targeter reports for it. Concrete ids/tokens are assigned by index in the
 * property body so they are unique across the roster.
 */
const recipientSpecArb = fc.record({
  pref: fc.constantFrom<PrefState>('enabled', 'disabled', 'unset'),
  tokenCount: fc.nat({ max: 4 }),
});

/** A roster of 1–6 recipients. */
const rosterArb = fc.array(recipientSpecArb, { minLength: 1, maxLength: 6 });

interface Recipient {
  readonly userId: string;
  readonly pref: PrefState;
  readonly tokens: readonly string[];
}

/** Assign deterministic, globally-unique ids and tokens to each spec. */
function materialize(
  specs: readonly { pref: PrefState; tokenCount: number }[],
): Recipient[] {
  return specs.map((spec, i) => ({
    userId: `user-${i}`,
    pref: spec.pref,
    tokens: Array.from({ length: spec.tokenCount }, (_, j) => `tok-${i}-${j}`),
  }));
}

describe('Notification_Service — Property 15: delivery targets are exactly the active tokens of preference-enabled recipients', () => {
  it(
    'targets the union of active tokens of enabled/default recipients, skipping disabled recipients and never inventing tokens',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          rosterArb,
          async (shareId, senderId, specs) => {
            const recipients = materialize(specs);
            const byUser = new Map(recipients.map((r) => [r.userId, r]));

            // Capture every dispatched message.
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

            // Preference reader: `unset` returns the enabled-by-default value
            // (R9.7); `disabled` returns false (R9.4); `enabled` returns true.
            const preferences: NotificationPreferenceReader = {
              async getPreference(userId) {
                const r = byUser.get(userId);
                return {
                  pushNotificationsEnabled: r ? r.pref !== 'disabled' : true,
                };
              },
            };

            // Targeter reports only the recipient's active tokens (the repo
            // excludes invalidated registrations, R8.6).
            const pushTokens: PushTokenTargeter = {
              async listActiveTokensForUser(userId) {
                return byUser.get(userId)?.tokens ?? [];
              },
              async invalidateByToken() {
                return true;
              },
            };

            const service = createNotificationService({
              preferences,
              pushTokens,
              expoClient,
              resolveSenderDisplayName: async () => 'Sender',
              resolveExperienceName: async () => 'Space Mountain',
            });

            const event: ShareDeliveredEvent = {
              shareId,
              senderId,
              recipientIds: recipients.map((r) => r.userId),
              payloadKind: 'progress',
            };

            await service.handleShareDelivered(event);

            // Expected target set: the union of active tokens over recipients
            // whose preference permits notifications (enabled or unset).
            const expected = new Set<string>();
            for (const r of recipients) {
              if (r.pref !== 'disabled') {
                for (const t of r.tokens) expected.add(t);
              }
            }

            const targeted = captured.map((m) => m.to);

            // Exactly the expected tokens, each targeted exactly once.
            expect(targeted.slice().sort()).toEqual([...expected].sort());

            // No token belonging to a disabled recipient is ever targeted (R9.4).
            const forbidden = new Set<string>();
            for (const r of recipients) {
              if (r.pref === 'disabled') {
                for (const t of r.tokens) forbidden.add(t);
              }
            }
            for (const t of targeted) {
              expect(forbidden.has(t)).toBe(false);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
