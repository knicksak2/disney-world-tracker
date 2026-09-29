/**
 * Unit tests for ExperienceListShared notification handler (Feature: experience-lists, Task 6.5).
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */

import { describe, expect, it } from 'vitest';

import type {
  ExpoPushClient,
  ExpoPushDelivery,
  ExpoPushMessage,
} from '../expoPushClient.js';
import {
  createNotificationService,
  EXPERIENCE_LIST_SHARED_LABEL,
  type ExperienceListSharedEvent,
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
const EXPERIENCE_LIST_ID = '33333333-3333-4333-8333-333333333333';

const SHARED_EVENT: ExperienceListSharedEvent = {
  experienceListId: EXPERIENCE_LIST_ID,
  senderId: SENDER_ID,
  recipientId: RECIPIENT_ID,
};

describe('Notification_Service — handleExperienceListShared (R8.1, R8.2)', () => {
  it('delivers exactly-once push notification on first share with title, body, and { experienceListId } data', async () => {
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[recipient-token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Aki',
      resolveExperienceName: async () => null,
    });

    await service.handleExperienceListShared(SHARED_EVENT);

    expect(expoClient.allMessages).toHaveLength(1);
    const msg = expoClient.allMessages[0]!;
    expect(msg.to).toBe('ExponentPushToken[recipient-token-1]');
    expect(msg.title).toBe('Aki');
    expect(msg.body).toBe(EXPERIENCE_LIST_SHARED_LABEL);
    expect(msg.data).toEqual({ experienceListId: EXPERIENCE_LIST_ID });
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

    await service.handleExperienceListShared(SHARED_EVENT);

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
      resolveSenderDisplayName: async () => 'Sora',
      resolveExperienceName: async () => null,
    });

    await service.handleExperienceListShared(SHARED_EVENT);

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
      resolveSenderDisplayName: async () => 'Aki',
      resolveExperienceName: async () => null,
    });

    await service.handleExperienceListShared(SHARED_EVENT);

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
      resolveSenderDisplayName: async () => 'Aki',
      resolveExperienceName: async () => null,
    });

    await expect(
      service.handleExperienceListShared(SHARED_EVENT),
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
      service.handleExperienceListShared(SHARED_EVENT),
    ).resolves.toBeUndefined();
    expect(expoClient.allMessages).toHaveLength(0);
  });
});

describe('Notification_Service — no dispatch path for like/save/item-mutation (R8.2)', () => {
  it('exposes no handler for Experience_List_Like, Experience_List_Save, or item add/remove/reorder', async () => {
    // Requirement 8.2: "THE Experience_List_Service SHALL NOT dispatch any notification for an
    // Experience_List_Like, Experience_List_Save, item add/remove/reorder, or a role change that
    // leaves the `role` unchanged."
    //
    // At the notification-service layer this is a structural guarantee, not a runtime branch:
    // NotificationService's Experience_List-related surface is exactly
    // `handleExperienceListShared` and `handleExperienceListRoleChanged` (see service.ts) — there
    // is no `handleExperienceListLiked`/`handleExperienceListSaved`/`handleExperienceListItemAdded`
    // (etc.) method on the interface at all, so no dispatch path exists for those actions to reach.
    // The route-level guarantee that like/save/add/remove/reorder handlers never call
    // `emitExperienceListShared`/`emitExperienceListRoleChanged` — and that a repeat share of the
    // same role (`action: 'unchanged'`) also triggers neither — is covered by
    // `apps/api/src/services/experienceLists/__tests__/routes.test.ts` (task 6.4).
    const expoClient = makeExpoClient();
    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[token-1]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Aki',
      resolveExperienceName: async () => null,
    });

    const methodNames = Object.keys(service);
    expect(methodNames).not.toContain('handleExperienceListLiked');
    expect(methodNames).not.toContain('handleExperienceListSaved');
    expect(methodNames).not.toContain('handleExperienceListItemAdded');
    expect(methodNames).not.toContain('handleExperienceListItemRemoved');
    expect(methodNames).not.toContain('handleExperienceListItemReordered');
    expect(methodNames).not.toContain('handleExperienceListItemMutated');

    // Sanity: the two methods R8.1/R8.3 do specify are present.
    expect(methodNames).toContain('handleExperienceListShared');
    expect(methodNames).toContain('handleExperienceListRoleChanged');
  });
});
