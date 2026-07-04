// Feature: social-sharing-loop, Task 15.4: Notification_Service integration tests against a fake Expo client
/**
 * Integration tests for the Notification_Service delivery path (task 15.4).
 *
 * Validates: Requirements 7.1, 7.4, 7.5, 7.6, 7.7
 *
 * Unlike the composition property test (task 15.2), these tests exercise the
 * end-to-end delivery behavior of the real `createNotificationService` wired to
 * a *fake* `ExpoPushClient` and fake preference/push-token ports. They drive a
 * `ShareDelivered` event through `handleShareDelivered` and assert on what the
 * fake provider observed and on how the service reacted to the provider's
 * receipts. The clock and inter-retry delay are injected so the 30-second
 * retry window (R7.1, R7.7) can be exercised deterministically without real
 * time passing.
 *
 * Coverage (task 15.4 bullets):
 *   - One delivery per active token within the window (R7.1).
 *   - Token invalidation on a "device not registered" receipt (R7.6).
 *   - At most 3 retries while the send keeps transiently failing, and
 *     `handleShareDelivered` still resolves so `POST /me/shares` returns 201
 *     regardless of push outcome (R7.7).
 *   - No notification when the recipient has no active Push_Registration (R7.5).
 *   - The fixed progress-share content label (R7.4).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createNotificationService,
  PROGRESS_LABEL,
} from '../service.js';
import type {
  ShareDeliveredEvent,
  NotificationPreferenceReader,
  PushTokenTargeter,
} from '../service.js';
import type {
  ExpoPushClient,
  ExpoPushMessage,
  ExpoPushDelivery,
  ExpoPushDeliveryStatus,
} from '../expoPushClient.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface RecordingExpoClient extends ExpoPushClient {
  /** Every batch handed to `send`, in call order. */
  readonly batches: ExpoPushMessage[][];
  /** Flattened messages across all batches. */
  readonly allMessages: ExpoPushMessage[];
  /** Number of times `send` was invoked. */
  sendCount(): number;
}

/**
 * Build a fake Expo client whose per-token outcome is decided by `statusFor`.
 * Records every batch so tests can assert on delivery counts and content.
 */
function makeExpoClient(
  statusFor: (token: string, attempt: number) => ExpoPushDeliveryStatus,
): RecordingExpoClient {
  const batches: ExpoPushMessage[][] = [];
  return {
    batches,
    get allMessages() {
      return batches.flat();
    },
    sendCount() {
      return batches.length;
    },
    async send(messages): Promise<readonly ExpoPushDelivery[]> {
      const attempt = batches.length; // 0 = initial send, 1.. = retries
      batches.push([...messages]);
      return messages.map((m) => ({
        token: m.to,
        status: statusFor(m.to, attempt),
      }));
    },
  };
}

/** A throwing Expo client — simulates the provider being unreachable (R7.7). */
function makeUnreachableExpoClient(): RecordingExpoClient {
  const batches: ExpoPushMessage[][] = [];
  return {
    batches,
    get allMessages() {
      return batches.flat();
    },
    sendCount() {
      return batches.length;
    },
    async send(messages): Promise<readonly ExpoPushDelivery[]> {
      batches.push([...messages]);
      throw new Error('provider unreachable');
    },
  };
}

/** Preference reader that always reports the given enabled state. */
function makePreferences(enabled: boolean): NotificationPreferenceReader {
  return {
    async getPreference() {
      return { pushNotificationsEnabled: enabled };
    },
  };
}

interface RecordingPushTokens extends PushTokenTargeter {
  readonly invalidated: string[];
}

/** Push-token port with a fixed active-token list and invalidation recorder. */
function makePushTokens(tokens: readonly string[]): RecordingPushTokens {
  const invalidated: string[] = [];
  return {
    invalidated,
    async listActiveTokensForUser() {
      return tokens;
    },
    async invalidateByToken(token: string) {
      invalidated.push(token);
      return true;
    },
  };
}

const EXPERIENCE_EVENT: ShareDeliveredEvent = {
  shareId: 'share-1',
  senderId: 'sender-1',
  recipientIds: ['recipient-1'],
  payloadKind: 'experience',
  experienceId: 'exp-1',
};

/** Common resolver stubs for an experience share. */
const experienceResolvers = {
  resolveSenderDisplayName: async () => 'Mickey',
  resolveExperienceName: async () => 'Space Mountain',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Notification_Service delivery — integration against a fake Expo client', () => {
  it('delivers exactly one notification per active token within the window (R7.1)', async () => {
    const tokens = ['ExponentPushToken[A]', 'ExponentPushToken[B]'];
    const expoClient = makeExpoClient(() => 'ok');
    const pushTokens = makePushTokens(tokens);

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      ...experienceResolvers,
    });

    await service.handleShareDelivered(EXPERIENCE_EVENT);

    // A single send batch (no retries needed) targeting both tokens once each.
    expect(expoClient.sendCount()).toBe(1);
    expect(expoClient.allMessages.map((m) => m.to).sort()).toEqual(
      [...tokens].sort(),
    );
    // Each token appears exactly once — no duplicate delivery.
    const perToken = new Map<string, number>();
    for (const m of expoClient.allMessages) {
      perToken.set(m.to, (perToken.get(m.to) ?? 0) + 1);
    }
    expect([...perToken.values()]).toEqual([1, 1]);
    // A successfully delivered token is never invalidated.
    expect(pushTokens.invalidated).toEqual([]);
  });

  it('invalidates a token reported "device not registered" and never retries it (R7.6)', async () => {
    const good = 'ExponentPushToken[GOOD]';
    const dead = 'ExponentPushToken[DEAD]';
    // The dead token always reports device_unregistered; the good one succeeds.
    const expoClient = makeExpoClient((token) =>
      token === dead ? 'device_unregistered' : 'ok',
    );
    const pushTokens = makePushTokens([good, dead]);

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      // immediate, deterministic retry timing (none should occur here)
      delay: async () => {},
      now: () => 1_000,
      ...experienceResolvers,
    });

    await service.handleShareDelivered(EXPERIENCE_EVENT);

    // The unregistered token was invalidated exactly once; the good one wasn't.
    expect(pushTokens.invalidated).toEqual([dead]);
    // Both outcomes are terminal on the first attempt, so there is no retry.
    expect(expoClient.sendCount()).toBe(1);
    // The dead token is never sent to again.
    const deadSends = expoClient.allMessages.filter((m) => m.to === dead);
    expect(deadSends).toHaveLength(1);
  });

  it('retries a transient failure at most 3 times and still resolves so POST /me/shares returns 201 (R7.7)', async () => {
    const token = 'ExponentPushToken[FLAKY]';
    // Every attempt transiently fails, forcing the full retry budget.
    const expoClient = makeExpoClient(() => 'error');
    const pushTokens = makePushTokens([token]);
    const delay = vi.fn(async () => {});

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      delay,
      now: () => 1_000, // constant clock keeps every retry inside the 30s window
      ...experienceResolvers,
    });

    // Must resolve (never reject): the request already returned 201 (R7.7).
    await expect(
      service.handleShareDelivered(EXPERIENCE_EVENT),
    ).resolves.toBeUndefined();

    // 1 initial attempt + 3 retries = 4 sends; no more.
    expect(expoClient.sendCount()).toBe(4);
    // Exactly 3 inter-retry delays.
    expect(delay).toHaveBeenCalledTimes(3);
    // A transient error is not a "device not registered" receipt — no invalidation.
    expect(pushTokens.invalidated).toEqual([]);
  });

  it('retries when the provider is unreachable (send throws) and still resolves (R7.7)', async () => {
    const token = 'ExponentPushToken[UNREACHABLE]';
    const expoClient = makeUnreachableExpoClient();
    const pushTokens = makePushTokens([token]);

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      delay: async () => {},
      now: () => 1_000,
      ...experienceResolvers,
    });

    await expect(
      service.handleShareDelivered(EXPERIENCE_EVENT),
    ).resolves.toBeUndefined();

    // A thrown send is treated as a transient failure of the whole batch:
    // 1 initial + 3 retries.
    expect(expoClient.sendCount()).toBe(4);
    expect(pushTokens.invalidated).toEqual([]);
  });

  it('stops retrying once the 30-second window has elapsed (R7.1, R7.7)', async () => {
    const token = 'ExponentPushToken[SLOW]';
    const expoClient = makeExpoClient(() => 'error');
    const pushTokens = makePushTokens([token]);

    // Advance the clock past the 30s window on the second reading so the first
    // retry is abandoned before a second send occurs.
    let calls = 0;
    const now = () => {
      calls += 1;
      // 1st read = startedAt (0); subsequent reads jump beyond the window.
      return calls === 1 ? 0 : 30_001;
    };

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      delay: async () => {},
      now,
      ...experienceResolvers,
    });

    await expect(
      service.handleShareDelivered(EXPERIENCE_EVENT),
    ).resolves.toBeUndefined();

    // Only the initial send happened; the retry was cut off by the window.
    expect(expoClient.sendCount()).toBe(1);
  });

  it('sends no notification when the recipient has no active Push_Registration (R7.5)', async () => {
    const expoClient = makeExpoClient(() => 'ok');
    const pushTokens = makePushTokens([]); // no active tokens

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      ...experienceResolvers,
    });

    await expect(
      service.handleShareDelivered(EXPERIENCE_EVENT),
    ).resolves.toBeUndefined();

    expect(expoClient.sendCount()).toBe(0);
    expect(pushTokens.invalidated).toEqual([]);
  });

  it('composes the fixed "shared progress" label for a Progress_Share (R7.4)', async () => {
    const token = 'ExponentPushToken[PROGRESS]';
    const expoClient = makeExpoClient(() => 'ok');
    const pushTokens = makePushTokens([token]);

    const service = createNotificationService({
      preferences: makePreferences(true),
      pushTokens,
      expoClient,
      resolveSenderDisplayName: async () => 'Minnie',
      // A progress share must not consult the experience resolver.
      resolveExperienceName: async () => {
        throw new Error('experience resolver must not be called for progress');
      },
    });

    const progressEvent: ShareDeliveredEvent = {
      shareId: 'share-2',
      senderId: 'sender-2',
      recipientIds: ['recipient-2'],
      payloadKind: 'progress',
    };

    await service.handleShareDelivered(progressEvent);

    expect(expoClient.sendCount()).toBe(1);
    const [message] = expoClient.allMessages;
    expect(message?.title).toBe('Minnie');
    expect(message?.body).toBe(PROGRESS_LABEL);
    expect(message?.body.length).toBeLessThanOrEqual(100);
  });
});
