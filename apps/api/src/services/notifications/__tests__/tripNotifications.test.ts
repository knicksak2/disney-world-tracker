// Feature: trips, Task 13.1: Notification_Service handlers for Trip_Invite + Rode_With_Tag
/**
 * Unit tests for the Trip notification handlers (task 13.1).
 *
 * Validates: Requirements 6.6, 6.7, 10.8
 *
 * These exercise the real `createNotificationService` wired to fake
 * preference/push-token ports and a recording fake `ExpoPushClient`. They drive
 * `handleTripInviteCreated` and `handleRodeWithTagCreated` and assert on:
 *   - title = the inviter / tagging Member's display name;
 *   - the fixed body labels;
 *   - the deep-link `data` payloads (`{ tripInviteId }` and
 *     `{ rodeWithTagId, tripLogEntryId }`);
 *   - the master push preference gate (a disabled recipient gets nothing);
 *   - never throwing, even when a dependency rejects.
 */

import { describe, it, expect } from 'vitest';

import {
  createNotificationService,
  TRIP_INVITE_LABEL,
  RODE_WITH_TAG_LABEL,
} from '../service.js';
import type {
  TripInviteCreatedEvent,
  RodeWithTagCreatedEvent,
  NotificationPreferenceReader,
  PushTokenTargeter,
} from '../service.js';
import type {
  ExpoPushClient,
  ExpoPushMessage,
  ExpoPushDelivery,
} from '../expoPushClient.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface RecordingExpoClient extends ExpoPushClient {
  readonly allMessages: ExpoPushMessage[];
  sendCount(): number;
}

function makeExpoClient(): RecordingExpoClient {
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
      return messages.map((m) => ({ token: m.to, status: 'ok' as const }));
    },
  };
}

function makePreferences(enabled: boolean): NotificationPreferenceReader {
  return {
    async getPreference() {
      return { pushNotificationsEnabled: enabled };
    },
  };
}

function makePushTokens(tokens: readonly string[]): PushTokenTargeter {
  return {
    async listActiveTokensForUser() {
      return tokens;
    },
    async invalidateByToken() {
      return true;
    },
  };
}

const INVITE_EVENT: TripInviteCreatedEvent = {
  inviteId: 'invite-1',
  tripId: 'trip-1',
  inviterId: 'inviter-1',
  inviteeId: 'invitee-1',
};

const TAG_EVENT: RodeWithTagCreatedEvent = {
  tagId: 'tag-1',
  tripLogEntryId: 'log-1',
  taggingMemberId: 'tagger-1',
  taggedMemberId: 'tagged-1',
};

// ---------------------------------------------------------------------------
// handleTripInviteCreated (R6.6, R6.7)
// ---------------------------------------------------------------------------

describe('Notification_Service — handleTripInviteCreated (R6.6, R6.7)', () => {
  it('notifies the invitee with the inviter name and a { tripInviteId } deep link', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[INVITE]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Mickey',
      resolveExperienceName: async () => null,
    });

    await service.handleTripInviteCreated(INVITE_EVENT);

    expect(expoClient.sendCount()).toBe(1);
    const [message] = expoClient.allMessages;
    expect(message?.title).toBe('Mickey');
    expect(message?.body).toBe(TRIP_INVITE_LABEL);
    expect(message?.data).toEqual({ tripInviteId: 'invite-1' });
  });

  it('sends no notification when the invitee has push disabled (master preference gate)', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(false),
      pushTokens: makePushTokens(['ExponentPushToken[INVITE]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Mickey',
      resolveExperienceName: async () => null,
    });

    await service.handleTripInviteCreated(INVITE_EVENT);

    expect(expoClient.sendCount()).toBe(0);
  });

  it('never rejects when a dependency throws', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[INVITE]']),
      expoClient,
      resolveSenderDisplayName: async () => {
        throw new Error('name lookup failed');
      },
      resolveExperienceName: async () => null,
    });

    await expect(
      service.handleTripInviteCreated(INVITE_EVENT),
    ).resolves.toBeUndefined();
    expect(expoClient.sendCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleRodeWithTagCreated (R10.8)
// ---------------------------------------------------------------------------

describe('Notification_Service — handleRodeWithTagCreated (R10.8)', () => {
  it('notifies the tagged Member with the tagging Member name and a { rodeWithTagId, tripLogEntryId } deep link', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[TAG]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Minnie',
      resolveExperienceName: async () => null,
    });

    await service.handleRodeWithTagCreated(TAG_EVENT);

    expect(expoClient.sendCount()).toBe(1);
    const [message] = expoClient.allMessages;
    expect(message?.title).toBe('Minnie');
    expect(message?.body).toBe(RODE_WITH_TAG_LABEL);
    expect(message?.data).toEqual({
      rodeWithTagId: 'tag-1',
      tripLogEntryId: 'log-1',
    });
  });

  it('sends no notification when the tagged Member has push disabled (master preference gate)', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(false),
      pushTokens: makePushTokens(['ExponentPushToken[TAG]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Minnie',
      resolveExperienceName: async () => null,
    });

    await service.handleRodeWithTagCreated(TAG_EVENT);

    expect(expoClient.sendCount()).toBe(0);
  });

  it('never rejects when a dependency throws', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[TAG]']),
      expoClient,
      resolveSenderDisplayName: async () => {
        throw new Error('name lookup failed');
      },
      resolveExperienceName: async () => null,
    });

    await expect(
      service.handleRodeWithTagCreated(TAG_EVENT),
    ).resolves.toBeUndefined();
    expect(expoClient.sendCount()).toBe(0);
  });
});
