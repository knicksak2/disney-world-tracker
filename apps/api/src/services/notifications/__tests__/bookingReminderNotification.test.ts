/**
 * Unit tests for handleTripBookingReminder (Task 8.4).
 *
 * Validates: Requirements 9.5, 9.7, 9.10, 15.4
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createNotificationService,
  type TripBookingReminderEvent,
} from '../service.js';
import type {
  ExpoPushClient,
  ExpoPushDelivery,
  ExpoPushMessage,
} from '../expoPushClient.js';

interface RecordingExpoClient extends ExpoPushClient {
  readonly allMessages: ExpoPushMessage[];
  sendCount(): number;
}

function makeExpoClient(deliveryStatus: 'ok' | 'device_unregistered' | 'error' = 'ok'): RecordingExpoClient {
  const batches: ExpoPushMessage[][] = [];
  return {
    get allMessages() {
      return batches.flat();
    },
    sendCount() {
      return batches.length;
    },
    async send(messages): Promise<readonly ExpoPushDelivery[]> {
      batches.push([...messages]);
      return messages.map((m) => ({ token: m.to, status: deliveryStatus }));
    },
  };
}

const BASE_EVENT: TripBookingReminderEvent = {
  tripId: '44444444-4444-4444-4444-444444444444',
  tripName: 'Disney Vacation',
  lead: 'eve',
  windows: [
    {
      kind: 'dining',
      dropAt: '2026-10-02T10:00:00.000Z',
      firstCovered: '2026-12-01',
      lastCovered: '2026-12-05',
    },
  ],
  dispatchedAt: '2026-10-01T20:00:00.000Z',
  recipientIds: ['user-1'],
};

describe('Notification_Service — handleTripBookingReminder unit tests', () => {
  it('delivers push notification with title, body, and payload { bookingTripId }', async () => {
    const expoClient = makeExpoClient('ok');
    const onDelivery = vi.fn();

    const service = createNotificationService({
      preferences: {
        async getPreference() {
          return { pushNotificationsEnabled: true };
        },
      },
      pushTokens: {
        async listActiveTokensForUser() {
          return ['ExponentPushToken[user1-token]'];
        },
        async invalidateByToken() {
          return true;
        },
      },
      expoClient,
      resolveSenderDisplayName: async () => 'User',
      resolveExperienceName: async () => null,
      onDelivery,
      delay: async () => {},
    });

    await service.handleTripBookingReminder(BASE_EVENT);

    expect(expoClient.allMessages.length).toBe(1);
    const msg = expoClient.allMessages[0]!;
    expect(msg.to).toBe('ExponentPushToken[user1-token]');
    expect(msg.title).toBe('Booking window opens tomorrow');
    expect(msg.data).toEqual({ bookingTripId: BASE_EVENT.tripId });

    expect(onDelivery).toHaveBeenCalledWith(
      'user-1',
      'ok',
      'trip_booking_reminder',
    );
  });

  it('skips recipient when master push notification preference is disabled', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: {
        async getPreference() {
          return { pushNotificationsEnabled: false };
        },
      },
      pushTokens: {
        async listActiveTokensForUser() {
          return ['ExponentPushToken[user1-token]'];
        },
        async invalidateByToken() {
          return true;
        },
      },
      expoClient,
      resolveSenderDisplayName: async () => null,
      resolveExperienceName: async () => null,
      delay: async () => {},
    });

    await service.handleTripBookingReminder(BASE_EVENT);
    expect(expoClient.allMessages.length).toBe(0);
  });

  it('invalidates push token on device_unregistered status', async () => {
    const expoClient = makeExpoClient('device_unregistered');
    const invalidateByToken = vi.fn().mockResolvedValue(true);

    const service = createNotificationService({
      preferences: {
        async getPreference() {
          return { pushNotificationsEnabled: true };
        },
      },
      pushTokens: {
        async listActiveTokensForUser() {
          return ['ExponentPushToken[stale-token]'];
        },
        invalidateByToken,
      },
      expoClient,
      resolveSenderDisplayName: async () => null,
      resolveExperienceName: async () => null,
      delay: async () => {},
    });

    await service.handleTripBookingReminder(BASE_EVENT);
    expect(invalidateByToken).toHaveBeenCalledWith('ExponentPushToken[stale-token]');
  });

  it('one recipient error does not prevent delivery to other recipients', async () => {
    const expoClient = makeExpoClient('ok');
    const service = createNotificationService({
      preferences: {
        async getPreference(userId: string) {
          if (userId === 'failing-user') {
            throw new Error('Database lookup failed');
          }
          return { pushNotificationsEnabled: true };
        },
      },
      pushTokens: {
        async listActiveTokensForUser(userId: string) {
          return [`ExponentPushToken[${userId}]`];
        },
        async invalidateByToken() {
          return true;
        },
      },
      expoClient,
      resolveSenderDisplayName: async () => null,
      resolveExperienceName: async () => null,
      delay: async () => {},
    });

    const multiRecipientEvent: TripBookingReminderEvent = {
      ...BASE_EVENT,
      recipientIds: ['failing-user', 'successful-user'],
    };

    await expect(service.handleTripBookingReminder(multiRecipientEvent)).resolves.not.toThrow();

    expect(expoClient.allMessages.length).toBe(1);
    expect(expoClient.allMessages[0]!.to).toBe('ExponentPushToken[successful-user]');
  });
});
