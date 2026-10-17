/**
 * Property 21 & Property 22: Push Payload and Booking Reminder Handler Tests
 *
 * Validates: Requirements 9.5, 9.7, 9.10, 15.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createNotificationService,
  type NotificationPreferenceReader,
  type PushTokenTargeter,
  type TripBookingReminderEvent,
} from '../service.js';
import type {
  ExpoPushClient,
  ExpoPushDelivery,
  ExpoPushDeliveryStatus,
  ExpoPushMessage,
} from '../expoPushClient.js';
import { composeBookingReminder } from '../bookingReminderCompose.js';

describe('Notification Service — Trip Booking Reminder Handler (Properties 21 & 22)', () => {
  // Feature: trip-booking-timeline, Property 21: The push payload carries only the Trip identifier
  it('Property 21: push message data is strictly { bookingTripId } with no additional keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tripId: fc.uuid(),
          tripName: fc.string({ minLength: 1, maxLength: 50 }),
          lead: fc.constantFrom('eve', 'open', 'week') as fc.Arbitrary<'eve' | 'open' | 'week'>,
          firstCovered: fc.constant('2026-10-01'),
          lastCovered: fc.constant('2026-10-05'),
          dropAt: fc.constant('2026-08-02T10:00:00.000Z'),
          dispatchedAt: fc.constant('2026-08-02T10:05:00.000Z'),
        }),
        async (gen) => {
          const event: TripBookingReminderEvent = {
            tripId: gen.tripId,
            tripName: gen.tripName,
            lead: gen.lead,
            windows: [
              {
                kind: 'dining',
                dropAt: gen.dropAt,
                firstCovered: gen.firstCovered,
                lastCovered: gen.lastCovered,
              },
            ],
            dispatchedAt: gen.dispatchedAt,
            recipientIds: ['recipient-1'],
          };

          const capturedMessages: ExpoPushMessage[] = [];
          const fakeClient: ExpoPushClient = {
            async send(messages) {
              capturedMessages.push(...messages);
              return messages.map((m) => ({ token: m.to, status: 'ok' as const }));
            },
          };

          const service = createNotificationService({
            preferences: {
              async getPreference() {
                return { pushNotificationsEnabled: true };
              },
            },
            pushTokens: {
              async listActiveTokensForUser() {
                return ['ExponentPushToken[token1]'];
              },
              async invalidateByToken() {
                return true;
              },
            },
            expoClient: fakeClient,
            resolveSenderDisplayName: async () => 'Sender',
            resolveExperienceName: async () => 'Experience',
            now: () => Date.now(),
            delay: async () => {},
          });

          await service.handleTripBookingReminder(event);

          expect(capturedMessages.length).toBe(1);
          const msg = capturedMessages[0]!;
          const expectedContent = composeBookingReminder(event);

          expect(msg.title).toBe(expectedContent.title);
          expect(msg.body).toBe(expectedContent.body);

          // Assert data carries ONLY bookingTripId
          expect(msg.data).toEqual({ bookingTripId: gen.tripId });
          expect(Object.keys(msg.data)).toEqual(['bookingTripId']);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: trip-booking-timeline, Property 22: The reminder handler gates correctly, never rejects, and logs every delivery
  it('Property 22: gates correctly, never rejects, isolates recipient failures, and reports delivery kind', async () => {
    type RecipientOutcome = 'enabled' | 'disabled' | 'pref_error';
    type TokenOutcome = 'ok' | 'device_unregistered' | 'error' | 'throw';

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            pref: fc.constantFrom<RecipientOutcome>('enabled', 'disabled', 'pref_error'),
            hasToken: fc.boolean(),
            tokenOutcome: fc.constantFrom<TokenOutcome>('ok', 'device_unregistered', 'error', 'throw'),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (recipients) => {
          const reportedDeliveries: {
            userId: string;
            status: ExpoPushDeliveryStatus;
            kind: string;
          }[] = [];

          const prefReader: NotificationPreferenceReader = {
            async getPreference(userId: string) {
              const r = recipients.find((x) => x.userId === userId);
              if (r?.pref === 'pref_error') {
                throw new Error('Database error reading preferences');
              }
              return { pushNotificationsEnabled: r?.pref === 'enabled' };
            },
          };

          const tokenTargeter: PushTokenTargeter = {
            async listActiveTokensForUser(userId: string) {
              const r = recipients.find((x) => x.userId === userId);
              return r?.hasToken ? [`token-${userId}`] : [];
            },
            async invalidateByToken() {
              return true;
            },
          };

          const fakeExpo: ExpoPushClient = {
            async send(messages) {
              const results: ExpoPushDelivery[] = [];
              for (const m of messages) {
                const r = recipients.find((x) => `token-${x.userId}` === m.to);
                if (r?.tokenOutcome === 'throw') {
                  throw new Error('Expo connection timeout');
                }
                results.push({
                  token: m.to,
                  status: (r?.tokenOutcome as ExpoPushDeliveryStatus) ?? 'ok',
                });
              }
              return results;
            },
          };

          const service = createNotificationService({
            preferences: prefReader,
            pushTokens: tokenTargeter,
            expoClient: fakeExpo,
            resolveSenderDisplayName: async () => 'Sender',
            resolveExperienceName: async () => 'Experience',
            now: () => Date.now(),
            delay: async () => {},
            maxRetries: 0, // avoid test timeout on simulated errors
            onDelivery: async (userId, status, kind) => {
              reportedDeliveries.push({ userId, status, kind });
            },
          });

          const event: TripBookingReminderEvent = {
            tripId: 'test-trip-id',
            tripName: 'Trip Test',
            lead: 'eve',
            windows: [
              {
                kind: 'dining',
                dropAt: '2026-10-01T10:00:00.000Z',
                firstCovered: '2026-12-01',
                lastCovered: '2026-12-05',
              },
            ],
            dispatchedAt: '2026-09-30T10:00:00.000Z',
            recipientIds: recipients.map((r) => r.userId),
          };

          // Must resolve, never reject
          await expect(service.handleTripBookingReminder(event)).resolves.not.toThrow();

          // Every reported delivery has notificationKind: 'trip_booking_reminder'
          for (const d of reportedDeliveries) {
            expect(d.kind).toBe('trip_booking_reminder');
          }

          // Recipients with disabled preferences or pref_error never have deliveries reported
          for (const r of recipients) {
            if (r.pref !== 'enabled' || !r.hasToken) {
              expect(reportedDeliveries.some((d) => d.userId === r.userId)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
