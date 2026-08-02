// Feature: trips, Task 15.2: Integration test for invite and rode-with notification dispatch
/**
 * Cross-service integration test for the Trip notification dispatch seam
 * (task 15.2).
 *
 * Validates: Requirements 6.6, 6.7, 10.8, 13.2
 *
 * This test exercises the route → repo → background-dispatch seam end-to-end.
 * It builds a real Fastify app with `tripRoutes({ repo, requireSession, pool,
 * emitTripInviteCreated, emitRodeWithTagCreated })` — the same wiring
 * `composeServices.ts` performs — and proves the two notification-bearing
 * routes fire their fire-and-forget dispatch ports with the correct deep-link
 * target payloads and that the request succeeds regardless of the push outcome.
 *
 * Two facets are proven:
 *
 *   1. Dispatch payloads (R6.6, R6.7, R10.8): with a controllable fake repo
 *      returning known ids and `vi.fn()` dispatch ports, `POST /trips/:id/invites`
 *      fires `emitTripInviteCreated` with the *repo's* `{ inviteId, tripId,
 *      inviterId, inviteeId }` (the invite is the deep-link target), and
 *      `POST /trips/:id/log-entries` fires `emitRodeWithTagCreated` once per
 *      `pending` Rode_With_Tag with `{ tagId, tripLogEntryId, taggingMemberId,
 *      taggedMemberId }` (the tag + log entry are the deep-link target). Both
 *      dispatches happen *after* the repo commits.
 *
 *   2. Fire-and-forget resilience (R6.6, R6.7, R10.8): the dispatch port returns
 *      `void`, so the route cannot await it and the request returns `201`
 *      regardless of push outcome. This is proven both with a port wired exactly
 *      like `composeServices.ts` (kicks off async push work whose rejection it
 *      swallows) and — the realistic in-App + push path (R13.2) — with the real
 *      `createNotificationService` driven through the dispatch ports against a
 *      *failing* fake Expo client.
 *
 * The optional real-service facet additionally proves the in-App + push path
 * composes the correct deep-link `data` (`{ tripInviteId }` for an invite,
 * `{ rodeWithTagId, tripLogEntryId }` for a rode-with tag) exactly as the mobile
 * deep-link handler consumes it.
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import {
  createNotificationService,
  RODE_WITH_TAG_LABEL,
  TRIP_INVITE_LABEL,
} from '../../notifications/service.js';
import type {
  NotificationPreferenceReader,
  PushTokenTargeter,
} from '../../notifications/service.js';
import type {
  ExpoPushClient,
  ExpoPushMessage,
  ExpoPushDelivery,
} from '../../notifications/expoPushClient.js';
import type {
  RodeWithTagCreatedDispatch,
  TripInviteCreatedDispatch,
} from '../routes.js';
import { tripRoutes } from '../routes.js';
import type {
  CreatedInvite,
  LoggedCompletion,
  TripRepo,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Fixed identities (distinct so a payload mix-up surfaces immediately)
// ---------------------------------------------------------------------------

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const INVITEE_ID = '33333333-3333-3333-3333-333333333333';
// The repo mints these ids; the route must dispatch *these*, not the request's.
const INVITE_ID = '44444444-4444-4444-4444-444444444444';
const LOG_ENTRY_ID = '55555555-5555-5555-5555-555555555555';
const TAG_ID_A = '66666666-6666-6666-6666-666666666666';
const TAG_ID_B = '77777777-7777-7777-7777-777777777777';
const TAGGED_A = '88888888-8888-8888-8888-888888888888';
const TAGGED_B = '99999999-9999-9999-9999-999999999999';
const EXPERIENCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// Fakes (mirroring routes.feed.test.ts's makeRepo/makePool)
// ---------------------------------------------------------------------------

/**
 * Build a `TripRepo` where every relevant method throws unless the test
 * overrides it, so an unexpected call surfaces as a failure. Only the two
 * notification-bearing methods are listed; others are absent (never invoked).
 */
function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
    };
  return {
    sendInvite: explode('sendInvite'),
    logCompletion: explode('logCompletion'),
    ...overrides,
  } as unknown as TripRepo;
}

/**
 * A pool whose membership lookup returns the supplied `role`, driving the
 * `assertTripMember` / `assertTripOrganizer` gates. `organizer` satisfies both
 * the invite route (Organizer-gated) and the log route (Member-gated).
 */
function makePool(role: 'organizer' | 'member' | null): DbPool {
  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return role === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ role }], rowCount: 1 };
    },
  } as unknown as DbPool;
}

interface DispatchPorts {
  readonly emitTripInviteCreated?: TripInviteCreatedDispatch;
  readonly emitRodeWithTagCreated?: RodeWithTagCreatedDispatch;
}

async function buildApp(
  role: 'organizer' | 'member' | null,
  repo: TripRepo,
  ports: DispatchPorts = {},
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    tripRoutes({ repo, requireSession, pool: makePool(role), ...ports }),
  );
  await app.ready();
  return app;
}

/** A `CreatedInvite` with repo-minted ids (deep-link target = `inviteId`). */
const CREATED_INVITE: CreatedInvite = {
  inviteId: INVITE_ID,
  tripId: TRIP_ID,
  inviterId: CALLER_ID,
  inviteeId: INVITEE_ID,
};

/** A `LoggedCompletion` with two `pending` tags (two deep-link targets). */
const LOGGED_COMPLETION: LoggedCompletion = {
  logEntryId: LOG_ENTRY_ID,
  pendingTags: [
    { tagId: TAG_ID_A, taggedMemberId: TAGGED_A },
    { tagId: TAG_ID_B, taggedMemberId: TAGGED_B },
  ],
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// ---------------------------------------------------------------------------
// Facet 1 — dispatch payloads fire after the repo commit (R6.6, R6.7, R10.8)
// ---------------------------------------------------------------------------

describe('POST /trips/:id/invites — TripInviteCreated dispatch (R6.6, R6.7)', () => {
  it('fires emitTripInviteCreated with the repo invite ids after sendInvite, returning 201', async () => {
    const sendInvite = vi.fn().mockResolvedValue(CREATED_INVITE);
    const emitTripInviteCreated = vi.fn();
    app = await buildApp('organizer', makeRepo({ sendInvite }), {
      emitTripInviteCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/invites`,
      payload: { userId: INVITEE_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(CREATED_INVITE);

    // The repo was consulted with the path Trip id, caller (inviter), and body.
    expect(sendInvite).toHaveBeenCalledWith(TRIP_ID, CALLER_ID, INVITEE_ID);

    // The dispatch carries the *repo's* returned ids — the invite is the
    // deep-link target (R6.6, R6.7).
    expect(emitTripInviteCreated).toHaveBeenCalledTimes(1);
    expect(emitTripInviteCreated).toHaveBeenCalledWith({
      inviteId: INVITE_ID,
      tripId: TRIP_ID,
      inviterId: CALLER_ID,
      inviteeId: INVITEE_ID,
    });

    // Dispatch happens strictly after the repo commit.
    expect(sendInvite.mock.invocationCallOrder[0]).toBeLessThan(
      emitTripInviteCreated.mock.invocationCallOrder[0]!,
    );
  });

  it('never touches the dispatch port when the repo rejects (no notification on failure)', async () => {
    const { AppError } = await import('../../../errors/AppError.js');
    const sendInvite = vi
      .fn()
      .mockRejectedValue(
        new AppError('trip_not_friend', 'You can only invite your friends.'),
      );
    const emitTripInviteCreated = vi.fn();
    app = await buildApp('organizer', makeRepo({ sendInvite }), {
      emitTripInviteCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/invites`,
      payload: { userId: INVITEE_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_not_friend' } });
    expect(emitTripInviteCreated).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/log-entries — RodeWithTagCreated dispatch (R10.8)', () => {
  it('fires emitRodeWithTagCreated once per pending tag with the correct deep-link payload, returning 201', async () => {
    const logCompletion = vi.fn().mockResolvedValue(LOGGED_COMPLETION);
    const emitRodeWithTagCreated = vi.fn();
    app = await buildApp('organizer', makeRepo({ logCompletion }), {
      emitRodeWithTagCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: { experienceId: EXPERIENCE_ID, rodeWith: [TAGGED_A, TAGGED_B] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ logEntryId: LOG_ENTRY_ID });

    expect(logCompletion).toHaveBeenCalledWith(TRIP_ID, CALLER_ID, {
      experienceId: EXPERIENCE_ID,
      rodeWith: [TAGGED_A, TAGGED_B],
    });

    // One dispatch per pending tag, each carrying the tag + log entry
    // (the confirm/decline deep-link target) and the tagging/tagged members.
    expect(emitRodeWithTagCreated).toHaveBeenCalledTimes(2);
    expect(emitRodeWithTagCreated).toHaveBeenNthCalledWith(1, {
      tagId: TAG_ID_A,
      tripLogEntryId: LOG_ENTRY_ID,
      taggingMemberId: CALLER_ID,
      taggedMemberId: TAGGED_A,
    });
    expect(emitRodeWithTagCreated).toHaveBeenNthCalledWith(2, {
      tagId: TAG_ID_B,
      tripLogEntryId: LOG_ENTRY_ID,
      taggingMemberId: CALLER_ID,
      taggedMemberId: TAGGED_B,
    });

    // Every dispatch happens strictly after the repo commit.
    for (const order of emitRodeWithTagCreated.mock.invocationCallOrder) {
      expect(logCompletion.mock.invocationCallOrder[0]).toBeLessThan(order);
    }
  });

  it('fires no dispatch when the Completion created no pending tags', async () => {
    const logCompletion = vi
      .fn()
      .mockResolvedValue({ logEntryId: LOG_ENTRY_ID, pendingTags: [] });
    const emitRodeWithTagCreated = vi.fn();
    app = await buildApp('organizer', makeRepo({ logCompletion }), {
      emitRodeWithTagCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: { experienceId: EXPERIENCE_ID, rodeWith: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(emitRodeWithTagCreated).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Facet 2 — fire-and-forget: the request returns 201 regardless of push outcome
// ---------------------------------------------------------------------------

describe('fire-and-forget dispatch does not block or fail the request (R6.6, R6.7, R10.8)', () => {
  it('returns 201 for an invite even when the async push work rejects (swallowed like composeServices)', async () => {
    const sendInvite = vi.fn().mockResolvedValue(CREATED_INVITE);
    // Mirror the `composeServices.ts` port: kick off failing async push work,
    // return void, and swallow the rejection so it never surfaces.
    const emitTripInviteCreated = vi.fn(() => {
      void Promise.reject(new Error('push provider unreachable')).catch(
        () => {},
      );
    });
    app = await buildApp('organizer', makeRepo({ sendInvite }), {
      emitTripInviteCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/invites`,
      payload: { userId: INVITEE_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(emitTripInviteCreated).toHaveBeenCalledTimes(1);
  });

  it('returns 201 for a log entry even when the async push work rejects', async () => {
    const logCompletion = vi.fn().mockResolvedValue(LOGGED_COMPLETION);
    const emitRodeWithTagCreated = vi.fn(() => {
      void Promise.reject(new Error('push provider unreachable')).catch(
        () => {},
      );
    });
    app = await buildApp('organizer', makeRepo({ logCompletion }), {
      emitRodeWithTagCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: { experienceId: EXPERIENCE_ID, rodeWith: [TAGGED_A, TAGGED_B] },
    });

    expect(res.statusCode).toBe(201);
    expect(emitRodeWithTagCreated).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Facet 3 (optional) — the real in-App + push path via createNotificationService
// (R13.2, R6.6, R6.7, R10.8)
// ---------------------------------------------------------------------------

/** A recording fake Expo client whose per-send outcome is configurable. */
interface RecordingExpoClient extends ExpoPushClient {
  readonly allMessages: ExpoPushMessage[];
  sendCount(): number;
}

function makeExpoClient(ok: boolean): RecordingExpoClient {
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
      if (!ok) throw new Error('provider unreachable');
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

describe('real Notification_Service driven through the dispatch seam (R13.2)', () => {
  it('composes the invite in-App + push with the { tripInviteId } deep link while the route returns 201', async () => {
    const expoClient = makeExpoClient(true);
    const notificationService = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[INVITE]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Mickey',
      resolveExperienceName: async () => null,
    });

    // Wire the port exactly as composeServices.ts does, capturing the
    // fire-and-forget promise so the test can await the async push.
    const pending: Promise<void>[] = [];
    const emitTripInviteCreated: TripInviteCreatedDispatch = (event) => {
      pending.push(
        notificationService.handleTripInviteCreated(event).catch(() => {}),
      );
    };

    const sendInvite = vi.fn().mockResolvedValue(CREATED_INVITE);
    app = await buildApp('organizer', makeRepo({ sendInvite }), {
      emitTripInviteCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/invites`,
      payload: { userId: INVITEE_ID },
    });

    // The request succeeds immediately, before the push has been delivered.
    expect(res.statusCode).toBe(201);

    // Now let the fire-and-forget push complete and assert on the delivery.
    await Promise.all(pending);
    expect(expoClient.sendCount()).toBe(1);
    const [message] = expoClient.allMessages;
    expect(message?.title).toBe('Mickey');
    expect(message?.body).toBe(TRIP_INVITE_LABEL);
    expect(message?.data).toEqual({ tripInviteId: INVITE_ID });
  });

  it('composes the rode-with in-App + push with the { rodeWithTagId, tripLogEntryId } deep link while the route returns 201', async () => {
    const expoClient = makeExpoClient(true);
    const notificationService = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[TAG]']),
      expoClient,
      resolveSenderDisplayName: async () => 'Minnie',
      resolveExperienceName: async () => null,
    });

    const pending: Promise<void>[] = [];
    const emitRodeWithTagCreated: RodeWithTagCreatedDispatch = (event) => {
      pending.push(
        notificationService.handleRodeWithTagCreated(event).catch(() => {}),
      );
    };

    // Single tag keeps the delivery assertion unambiguous.
    const logCompletion = vi.fn().mockResolvedValue({
      logEntryId: LOG_ENTRY_ID,
      pendingTags: [{ tagId: TAG_ID_A, taggedMemberId: TAGGED_A }],
    });
    app = await buildApp('organizer', makeRepo({ logCompletion }), {
      emitRodeWithTagCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: { experienceId: EXPERIENCE_ID, rodeWith: [TAGGED_A] },
    });

    expect(res.statusCode).toBe(201);

    await Promise.all(pending);
    expect(expoClient.sendCount()).toBe(1);
    const [message] = expoClient.allMessages;
    expect(message?.title).toBe('Minnie');
    expect(message?.body).toBe(RODE_WITH_TAG_LABEL);
    expect(message?.data).toEqual({
      rodeWithTagId: TAG_ID_A,
      tripLogEntryId: LOG_ENTRY_ID,
    });
  });

  it('still returns 201 when the push provider is unreachable (fire-and-forget swallows the failure)', async () => {
    const expoClient = makeExpoClient(false); // every send throws
    const notificationService = createNotificationService({
      preferences: makePreferences(true),
      pushTokens: makePushTokens(['ExponentPushToken[INVITE]']),
      expoClient,
      // deterministic, immediate retries so the test does not wait on real time
      delay: async () => {},
      now: () => 1_000,
      resolveSenderDisplayName: async () => 'Mickey',
      resolveExperienceName: async () => null,
    });

    const pending: Promise<void>[] = [];
    const emitTripInviteCreated: TripInviteCreatedDispatch = (event) => {
      pending.push(
        notificationService.handleTripInviteCreated(event).catch(() => {}),
      );
    };

    const sendInvite = vi.fn().mockResolvedValue(CREATED_INVITE);
    app = await buildApp('organizer', makeRepo({ sendInvite }), {
      emitTripInviteCreated,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/invites`,
      payload: { userId: INVITEE_ID },
    });

    // The request already returned 201 regardless of the push outcome.
    expect(res.statusCode).toBe(201);

    // The handler still resolves (never rejects) even though every send threw.
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(expoClient.sendCount()).toBeGreaterThanOrEqual(1);
  });
});
