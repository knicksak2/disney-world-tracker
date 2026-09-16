/**
 * Unit tests for FoodListRoleChanged notification handler (Feature: food-lists, Task 6.5).
 *
 * Validates: Requirements 8.3, 8.4, Property 10
 */

import { describe, expect, it } from 'vitest';

import type {
  ExpoPushClient,
  ExpoPushDelivery,
  ExpoPushMessage,
} from '../expoPushClient.js';
import {
  createNotificationService,
  type FoodListRoleChangedEvent,
  type NotificationPreferenceReader,
  type PushTokenTargeter,
} from '../service.js';

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

const SENDER_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const FOOD_LIST_ID = '33333333-3333-4333-8333-333333333333';

const ROLE_CHANGED_TO_EDITOR_EVENT: FoodListRoleChangedEvent = {
  foodListId: FOOD_LIST_ID,
  senderId: SENDER_ID,
  recipientId: RECIPIENT_ID,
  newRole: 'editor',
  listName: 'Magic Kingdom Treats',
};

const ROLE_CHANGED_TO_VIEWER_EVENT: FoodListRoleChangedEvent = {
  foodListId: FOOD_LIST_ID,
  senderId: SENDER_ID,
  recipientId: RECIPIENT_ID,
  newRole: 'viewer',
  listName: 'Magic Kingdom Treats',
};

describe('Notification_Service — handleFoodListRoleChanged (R8.3, R8.4)', () => {
  it('notifies recipient when promoted to editor with customized message and { foodListId } data', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[recipient-token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Colette',
      resolveExperienceName: async () => null,
    });

    await service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT);

    expect(expoClient.allMessages).toHaveLength(1);
    const msg = expoClient.allMessages[0]!;
    expect(msg.to).toBe('ExponentPushToken[recipient-token-1]');
    expect(msg.title).toBe('Colette');
    expect(msg.body).toBe('You can now edit Magic Kingdom Treats');
    expect(msg.data).toEqual({ foodListId: FOOD_LIST_ID });
  });

  it('notifies recipient when demoted to viewer with view-only message', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[recipient-token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Colette',
      resolveExperienceName: async () => null,
    });

    await service.handleFoodListRoleChanged(ROLE_CHANGED_TO_VIEWER_EVENT);

    expect(expoClient.allMessages).toHaveLength(1);
    const msg = expoClient.allMessages[0]!;
    expect(msg.to).toBe('ExponentPushToken[recipient-token-1]');
    expect(msg.title).toBe('Colette');
    expect(msg.body).toBe('Your access to Magic Kingdom Treats changed to view-only');
    expect(msg.data).toEqual({ foodListId: FOOD_LIST_ID });
  });

  it('falls back to "A friend" when sender display name is empty or unresolvable', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => null,
      resolveExperienceName: async () => null,
    });

    await service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT);

    expect(expoClient.allMessages).toHaveLength(1);
    expect(expoClient.allMessages[0]!.title).toBe('A friend');
  });

  it('delivers to all active push tokens for the recipient', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens([
        'ExponentPushToken[token-phone]',
        'ExponentPushToken[token-tablet]',
      ]),
      expoClient,
      resolveSenderDisplayName: async () => 'Colette',
      resolveExperienceName: async () => null,
    });

    await service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT);

    expect(expoClient.allMessages).toHaveLength(2);
    expect(expoClient.allMessages.map((m) => m.to)).toEqual([
      'ExponentPushToken[token-phone]',
      'ExponentPushToken[token-tablet]',
    ]);
  });

  it('suppresses push notification when recipient has pushNotificationsEnabled = false', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(false),
      pushTokens: makePushTokens(['ExponentPushToken[token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Colette',
      resolveExperienceName: async () => null,
    });

    await service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT);

    expect(expoClient.allMessages).toHaveLength(0);
  });

  it('suppresses push and does not throw when preference lookup throws', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: {
        async getPreference() {
          throw new Error('Database disconnected');
        },
      },
      pushTokens: makePushTokens(['ExponentPushToken[token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Colette',
      resolveExperienceName: async () => null,
    });

    await expect(
      service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT),
    ).resolves.toBeUndefined();
    expect(expoClient.allMessages).toHaveLength(0);
  });

  it('catches and swallows unexpected sender resolver errors without throwing', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => {
        throw new Error('Resolver exploded');
      },
      resolveExperienceName: async () => null,
    });

    await expect(
      service.handleFoodListRoleChanged(ROLE_CHANGED_TO_EDITOR_EVENT),
    ).resolves.toBeUndefined();
    expect(expoClient.allMessages).toHaveLength(0);
  });
});
