/**
 * Trip_Service HTTP routes.
 *
 * This is the single Fastify plugin for the Trip feature; like `repo.ts`, it is
 * built up one concern at a time across the implementation plan. This first
 * slice wires the Trip lifecycle endpoints (task 5.4):
 *
 *   POST   /me/trips        create a Trip                    (R1.1)
 *   GET    /trips/:id       read a Trip (Member-gated)       (R3.1, R15.1)
 *   PATCH  /trips/:id       edit a Trip (Organizer-gated)    (R3.1, R3.8)
 *   DELETE /trips/:id       delete a Trip (Organizer-gated)  (R3.8)
 *
 * The invite slice (task 6.4) adds:
 *
 *   POST /trips/:id/invites                     invite a Friend (Organizer)
 *   POST /trips/:id/invites/:inviteId/cancel    cancel a pending invite (Organizer)
 *   POST /me/trip-invites/:inviteId/accept      accept an invite (invitee)
 *   POST /me/trip-invites/:inviteId/decline     decline an invite (invitee)
 *   GET  /me/trip-invites/:inviteId             read an invite (deep-link target)
 *
 * A successful `POST /trips/:id/invites` fires the `TripInviteCreatedNotice` on
 * the injected background dispatch port after the repo commits (R6.6, R6.7).
 *
 * The membership-management slice (task 7.4) adds:
 *
 *   GET    /trips/:id/members                  list Trip_Members (Member-gated)
 *   POST   /trips/:id/members/:userId/promote  promote member → organizer (Org)
 *   POST   /trips/:id/members/:userId/demote   demote organizer → member (Org)
 *   DELETE /trips/:id/members/:userId          remove a member (Organizer)
 *   POST   /trips/:id/leave                    leave the Trip (any Member)
 *
 * The repo enforces the Last_Organizer_Rule and the role/target validity
 * checks, throwing the mapped `AppError` (`trip_last_organizer`,
 * `trip_role_invalid`, `trip_validation_failed`) which the shared error handler
 * renders. A Member removing themselves uses `POST /trips/:id/leave`, not the
 * Organizer-gated `DELETE /trips/:id/members/:userId`.
 *
 * Later tasks (the Planned_List, the Shared_Log
 * with confirmable rode-with tags, the Trip_Feed, and the derived reads) add
 * their endpoints to this same plugin, so the factory is shaped to be extended:
 * it closes its injected dependencies over the returned `FastifyPluginAsync` so
 * Fastify can register it with the standard plugin signature, exactly like the
 * Friends_Service and Sharing_Service route modules.
 *
 * Dependencies (constructor-injected via {@link TripRoutesOptions} so unit
 * tests can wire fakes without monkey-patching modules):
 *
 *   - `repo`           — the Trip persistence surface from `./repo.ts`.
 *   - `requireSession` — the shared pre-handler that authenticates the request
 *                        and assigns `request.userId` (R15.1, R15.3). It runs
 *                        on every route so the authenticated-session check
 *                        always precedes any Trip lookup.
 *   - `pool`           — used only by the `assertTripMember` / `assertTripOrganizer`
 *                        authorization gates (each a single membership lookup);
 *                        passing it in here (rather than baking it into the
 *                        repo) mirrors how the Stats_Service and Friend
 *                        Completions routes take a pool for `assertOwnerOrFriend`.
 *
 * Authorization layering (design "Errors" → Authorization; R15.2–R15.6):
 *   1. `requireSession` yields `unauthorized` (401) for a missing/expired
 *      session before any Trip is touched (R15.3).
 *   2. `assertTripMember` / `assertTripOrganizer` yield `trip_forbidden` (403)
 *      for a non-member / non-organizer. A Trip that does not exist and a Trip
 *      the caller cannot access collapse to the identical `trip_forbidden`
 *      response, so existence cannot be probed (R15.4, R15.6).
 *   3. Owner-side `trip_not_found` (404) is reserved for the narrow race in
 *      which an authorized-context read/edit/delete finds the Trip already gone
 *      between the membership check and the repo call (R3.9).
 *
 * `POST /me/trips` needs no membership gate: any authenticated User may create a
 * Trip, and creation makes them its sole Organizer (R1.1).
 *
 * Validates: Requirements 1.1, 3.1, 3.3, 3.8, 3.9, 15.1
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import {
  plannedItemAddSchema,
  plannedItemEditSchema,
  tripOptimizationInputSchema,
  rodeWithConfirmSchema,
  tripCommentInputSchema,
  tripCreateSchema,
  tripEditSchema,
  tripLogEntryCreateSchema,
  tripReactionInputSchema,
  tripReactionValueSchema,
  uuidSchema,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertTripMember, assertTripOrganizer } from './authz.js';
import { optimize } from '../planning/optimizer.js';
import type { OptimizeInput, OptimizeInputItem } from '../planning/optimizer.js';
import type {
  RodeWithTagCreatedNotice,
  TripInviteCreatedNotice,
} from './events.js';
import type { TripRepo } from './repo.js';

// ---------------------------------------------------------------------------
// TripInviteCreated dispatch seam
// ---------------------------------------------------------------------------

/**
 * Background dispatch port for {@link TripInviteCreatedNotice}. It returns
 * `void` (not a promise) so the route handler cannot await — and therefore
 * cannot be blocked or failed by — the notification path (R6.6, R6.7). The
 * port owns its own error handling and never throws, so the invite endpoint
 * returns `201` regardless of push outcome, mirroring the Friends_Service's
 * `emitFriendRequestReceived` and the Sharing_Service's delivery dispatch.
 */
export type TripInviteCreatedDispatch = (event: TripInviteCreatedNotice) => void;

// ---------------------------------------------------------------------------
// RodeWithTagCreated dispatch seam
// ---------------------------------------------------------------------------

/**
 * Background dispatch port for {@link RodeWithTagCreatedNotice}. Like
 * {@link TripInviteCreatedDispatch} it returns `void` (not a promise) so the
 * `POST /trips/:id/log-entries` handler cannot await — and therefore cannot be
 * blocked or failed by — the notification path (R10.8). The port owns its own
 * error handling and never throws, so the log endpoint returns `201`
 * regardless of push outcome. One notice is dispatched per `pending`
 * Rode_With_Tag created by the Completion (R10.8). Wired in
 * `composeServices.ts` (task 13.2).
 */
export type RodeWithTagCreatedDispatch = (
  event: RodeWithTagCreatedNotice,
) => void;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link tripRoutes}. Each dependency is supplied
 * explicitly so unit tests can register the plugin with fakes and integration
 * tests can wire the real repo, pool, and session pre-handler.
 */
export interface TripRoutesOptions {
  /** Trip persistence surface from `./repo.ts`. */
  readonly repo: TripRepo;
  /**
   * Shared pre-handler that authenticates the request and assigns
   * `request.userId`. Reused on every route so the session check precedes any
   * Trip lookup (R15.3).
   */
  readonly requireSession: preHandlerHookHandler;
  /**
   * Database pool used only by the `assertTripMember` / `assertTripOrganizer`
   * gates for their single membership lookup. Injected here (rather than via
   * the repo) to keep the authorization hop explicit and independently
   * testable, mirroring the Stats_Service / Friend Completions routes.
   */
  readonly pool: DbPool;
  /**
   * Optional background dispatch invoked after a `pending` Trip_Invite is
   * created, so the invited User receives an in-App + push notification whose
   * deep-link target opens the invite (R6.6, R6.7). Fire-and-forget: the
   * request returns `201` regardless of push outcome. Omitted in unit tests
   * that don't exercise the notification seam; wired in `composeServices.ts`.
   */
  readonly emitTripInviteCreated?: TripInviteCreatedDispatch;
  /**
   * Optional background dispatch invoked once per `pending` Rode_With_Tag
   * created by a logged Completion, so each Tagged_Member receives an in-App +
   * push notification whose deep-link target opens the tag's confirm/decline
   * view (R10.8). Fire-and-forget: the `POST /trips/:id/log-entries` request
   * returns `201` regardless of push outcome. Omitted in unit tests that don't
   * exercise the notification seam; wired in `composeServices.ts` (task 13.2).
   */
  readonly emitRodeWithTagCreated?: RodeWithTagCreatedDispatch;
  /**
   * Prediction service from crowd-calendar feature for day-planning optimization.
   */
  readonly predictionService?: {
    getDaySnapshot(experienceIds: string[], park: string, date: Date): Promise<Record<string, import('@dwt/shared').WaitSnapshot>>;
  };
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * `:id` path parameter for the Trip-scoped routes. Trip ids are UUIDs
 * (`gen_random_uuid()` per the migration), so the shared `uuidSchema` both
 * validates the shape and rejects a malformed id before any membership lookup.
 */
const tripIdParamsSchema = z.object({ id: uuidSchema }).strict();

/**
 * `:id` + `:inviteId` path parameters for the Organizer-side invite routes
 * nested under a Trip (`/trips/:id/invites/:inviteId/cancel`). Both are UUIDs.
 */
const tripInviteParamsSchema = z
  .object({ id: uuidSchema, inviteId: uuidSchema })
  .strict();

/**
 * `:inviteId` path parameter for the invitee-side routes under `/me`
 * (`/me/trip-invites/:inviteId/...`). The invite is scoped to the caller by the
 * repo, so no Trip id is needed on the path.
 */
const inviteIdParamsSchema = z.object({ inviteId: uuidSchema }).strict();

/**
 * `:id` + `:userId` path parameters for the Organizer-side membership routes
 * (`/trips/:id/members/:userId/...`). Both are UUIDs, so a malformed id is
 * rejected as `trip_validation_failed` before any authorization or repo call.
 */
const tripMemberParamsSchema = z
  .object({ id: uuidSchema, userId: uuidSchema })
  .strict();

/**
 * `:id` + `:itemId` path parameters for the Planned_Item removal route
 * (`/trips/:id/planned-items/:itemId`). Both are UUIDs, so a malformed id is
 * rejected as `trip_validation_failed` before any authorization or repo call.
 */
const tripPlannedItemParamsSchema = z
  .object({ id: uuidSchema, itemId: uuidSchema })
  .strict();

/**
 * Body of `POST /trips/:id/invites`: the invited User's id. Validated by the
 * shared `uuidSchema` so a malformed id is rejected as `trip_validation_failed`
 * before any Friend/membership check runs in the repo.
 */
const inviteCreateBodySchema = z.object({ userId: uuidSchema }).strict();

/**
 * `:tagId` path parameter for the caller-scoped Rode_With_Tag routes under
 * `/me` (`/me/rode-with-tags/:tagId/...`). The tag is scoped to the caller by
 * the repo (which asserts the caller is the Tagged_Member), so no Trip id is
 * needed on the path. Validated by the shared `uuidSchema` so a malformed id is
 * rejected before any repo call.
 */
const rodeWithTagParamsSchema = z.object({ tagId: uuidSchema }).strict();

/**
 * Query schema for the Notification_Center pending read
 * (`GET /me/rode-with-tags?state=pending`). `state` is **required** and must be
 * exactly the literal `pending`, and `.strict()` rejects any extra query key,
 * so a missing `state`, a `state` other than `pending`, or an unexpected key is
 * a client error and the collection path can never accidentally return a full
 * unfiltered list (R3.6). A failure here surfaces as `validation_failed` (400)
 * with no tags returned; unlike the Trip-domain input schemas this uses the
 * generic `validation_failed` code the design specifies for this read.
 */
const rodeWithPendingQuerySchema = z
  .object({ state: z.literal('pending') })
  .strict();

/**
 * `:targetType` path segment for the Trip_Feed reaction/comment routes. It must
 * be one of the closed `TripFeedTargetType` vocabulary (`feed_item` |
 * `log_entry`, R13.10); anything else is rejected as `trip_validation_failed`
 * before any membership lookup or repo call. Kept as a small local `z.enum`
 * that mirrors the shared `TripFeedTargetType` union.
 */
const tripFeedTargetTypeSchema = z.enum(['feed_item', 'log_entry']);

/**
 * `:id` + `:targetType` + `:targetId` path parameters shared by the add-reaction
 * and add-comment routes (`/trips/:id/feed/:targetType/:targetId/...`). The Trip
 * id and target id are UUIDs and the target type is the closed vocabulary, so a
 * malformed path is rejected as `trip_validation_failed` before authorization.
 */
const tripFeedTargetParamsSchema = z
  .object({
    id: uuidSchema,
    targetType: tripFeedTargetTypeSchema,
    targetId: uuidSchema,
  })
  .strict();

/**
 * Path parameters for the remove-own-reaction route
 * (`/trips/:id/feed/:targetType/:targetId/reactions/:type`). Extends the target
 * params with the reaction `:type`, validated against the closed
 * `Trip_Reaction` vocabulary so an unsupported value is rejected before the
 * (idempotent) repo delete runs (R13.7).
 */
const tripReactionRemoveParamsSchema = z
  .object({
    id: uuidSchema,
    targetType: tripFeedTargetTypeSchema,
    targetId: uuidSchema,
    type: tripReactionValueSchema,
  })
  .strict();

/**
 * `:id` + `:commentId` path parameters for the remove-own-comment route
 * (`/trips/:id/comments/:commentId`). Both are UUIDs, so a malformed id is
 * rejected as `trip_validation_failed` before any authorization or repo call.
 */
const tripCommentParamsSchema = z
  .object({ id: uuidSchema, commentId: uuidSchema })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Trip_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(tripRoutes({ repo, requireSession, pool }));
 * ```
 *
 * The factory closes over the options so the returned plugin keeps the standard
 * `FastifyPluginAsync` signature and Fastify can register it without bespoke
 * typing.
 */
export function tripRoutes(options: TripRoutesOptions): FastifyPluginAsync {
  const {
    repo,
    requireSession,
    pool,
    emitTripInviteCreated,
    emitRodeWithTagCreated,
  } = options;

  return async function tripRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // POST /me/trips — create a Trip (R1.1)
    // -------------------------------------------------------------------
    // Any authenticated User may create a Trip; creation makes them its sole
    // Organizer, so there is no membership gate. The body is validated by the
    // shared `tripCreateSchema` (name/description/date rules, R1.4–R1.8) before
    // the repo writes the Trip, its creator membership, and the `trip_created`
    // feed item in one transaction.
    app.post(
      '/me/trips',
      { preHandler: requireSession },
      async (request, reply) => {
        const creatorId = requireUser(request);
        const body = parseOrAppError(tripCreateSchema, request.body);
        const trip = await repo.createTrip(creatorId, body);
        reply.code(201);
        return trip;
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id — read a Trip (Member-gated) (R3.1, R15.1)
    // -------------------------------------------------------------------
    app.get<{ Params: { id: string } }>(
      '/trips/:id',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        // Membership gate first: a non-member (or a non-existent Trip) is
        // denied with the identical `trip_forbidden` so existence cannot be
        // probed (R15.2, R15.4).
        await assertTripMember(pool, userId, id);
        const trip = await repo.getTripForMember(id);
        if (!trip) {
          // Authorized context, but the Trip vanished between the membership
          // check and the read (a rare race). Surface the non-probing
          // owner-side not-found (R3.9).
          throw new AppError('trip_not_found', 'Trip not found.');
        }
        return trip;
      },
    );

    // -------------------------------------------------------------------
    // PATCH /trips/:id — edit a Trip (Organizer-gated) (R3.1, R3.8)
    // -------------------------------------------------------------------
    app.patch<{ Params: { id: string } }>(
      '/trips/:id',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        // Only an Organizer may edit Trip settings (R3.8); a non-organizer,
        // non-member, or non-existent Trip all collapse to `trip_forbidden`.
        await assertTripOrganizer(pool, userId, id);
        // The shared edit schema validates each supplied field by the same
        // rules used on create; the repo re-checks `end >= start` against the
        // merged dates and touches only the supplied fields (R3.1, R3.6).
        const body = parseOrAppError(tripEditSchema, request.body);
        const trip = await repo.editTrip(id, body);
        if (!trip) {
          throw new AppError('trip_not_found', 'Trip not found.');
        }
        return trip;
      },
    );

    // -------------------------------------------------------------------
    // DELETE /trips/:id — delete a Trip (Organizer-gated) (R3.8)
    // -------------------------------------------------------------------
    app.delete<{ Params: { id: string } }>(
      '/trips/:id',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        // Only an Organizer may delete a Trip (R3.8). The repo's cascade never
        // touches canonical Tracking data (R3.10).
        await assertTripOrganizer(pool, userId, id);
        const deleted = await repo.deleteTrip(id);
        if (!deleted) {
          throw new AppError('trip_not_found', 'Trip not found.');
        }
        // 204 No Content for a successful delete; there is no body to return.
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/invites — invite a Friend (Organizer-gated) (R6.1–R6.7)
    // -------------------------------------------------------------------
    // Only an Organizer may invite (R6.3); a non-organizer, non-member, or
    // non-existent Trip all collapse to `trip_forbidden`. The repo enforces the
    // Friend requirement (R6.2), the already-a-Member rule (R6.4), and the
    // one-pending-invite rule (R6.5), throwing the mapped `AppError`. On
    // success the fire-and-forget dispatch notifies the invited User with a
    // deep-link to the created invite (R6.6, R6.7).
    app.post<{ Params: { id: string } }>(
      '/trips/:id/invites',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripOrganizer(pool, userId, id);
        const { userId: inviteeId } = parseOrAppError(
          inviteCreateBodySchema,
          request.body,
        );
        const invite = await repo.sendInvite(id, userId, inviteeId);
        // Fire-and-forget push to the invited User. The dispatch returns void
        // and owns its own error handling, so it never blocks or fails the 201.
        emitTripInviteCreated?.({
          inviteId: invite.inviteId,
          tripId: invite.tripId,
          inviterId: invite.inviterId,
          inviteeId: invite.inviteeId,
        });
        reply.code(201);
        return invite;
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/invites/:inviteId/cancel — cancel a pending invite
    // (Organizer-gated) (R6.8, R6.9)
    // -------------------------------------------------------------------
    app.post<{ Params: { id: string; inviteId: string } }>(
      '/trips/:id/invites/:inviteId/cancel',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, inviteId } = parseOrAppError(
          tripInviteParamsSchema,
          request.params,
        );
        // Only an Organizer may cancel a pending invite (R6.9).
        await assertTripOrganizer(pool, userId, id);
        // The repo transitions `pending → cancelled` (R6.8); a missing invite
        // for this Trip surfaces the owner-side not-found, and an invite that
        // is not `pending` throws `trip_invite_state_invalid`.
        const cancelled = await repo.cancelInvite(id, inviteId);
        if (!cancelled) {
          throw new AppError('trip_not_found', 'Trip invite not found.');
        }
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /me/trip-invites — list the caller's pending invitations (inbox)
    // -------------------------------------------------------------------
    // The invitee-facing counterpart to the Organizer-gated
    // `GET /trips/:id/invites`. Scoped to the caller by the repo (only invites
    // with `invitee_id = request.userId` in state `pending`), so it never
    // discloses invites addressed to others. Backs the Trips_List invitations
    // section where a User discovers and accepts/declines invites without
    // depending on the push-notification deep-link (R7.1–R7.3).
    app.get(
      '/me/trip-invites',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.listMyInvites(userId);
      },
    );

    // -------------------------------------------------------------------
    // POST /me/trip-invites/:inviteId/accept — accept an invite (R7.1, R7.2,
    // R7.6)
    // -------------------------------------------------------------------
    // Scoped to the caller by the repo: it throws `trip_forbidden` when the
    // invite is not addressed to `request.userId` (non-probing, R7.4) and
    // `trip_invite_state_invalid` when it is not `pending` (R7.5). No Trip
    // membership gate is needed — the invitee is not yet a Member.
    app.post<{ Params: { inviteId: string } }>(
      '/me/trip-invites/:inviteId/accept',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { inviteId } = parseOrAppError(
          inviteIdParamsSchema,
          request.params,
        );
        return repo.acceptInvite(inviteId, userId);
      },
    );

    // -------------------------------------------------------------------
    // POST /me/trip-invites/:inviteId/decline — decline an invite (R7.3–R7.5)
    // -------------------------------------------------------------------
    app.post<{ Params: { inviteId: string } }>(
      '/me/trip-invites/:inviteId/decline',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { inviteId } = parseOrAppError(
          inviteIdParamsSchema,
          request.params,
        );
        await repo.declineInvite(inviteId, userId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /me/trip-invites/:inviteId — read an invite for the deep-link target
    // (R7.7–R7.9)
    // -------------------------------------------------------------------
    // Scoped to the caller by the repo. A `null` return (no invite with this id
    // addressed to the caller) maps to the non-probing `trip_not_found` so the
    // App can present the "no longer available" fallback without disclosing
    // whether the invite ever existed.
    app.get<{ Params: { inviteId: string } }>(
      '/me/trip-invites/:inviteId',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { inviteId } = parseOrAppError(
          inviteIdParamsSchema,
          request.params,
        );
        const invite = await repo.getInvite(inviteId, userId);
        if (!invite) {
          throw new AppError('trip_not_found', 'Trip invite not found.');
        }
        return invite;
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/members — list Trip_Members (Member-gated) (R4.1)
    // -------------------------------------------------------------------
    // Any Trip_Member may read the roster; a non-member (or non-existent Trip)
    // collapses to `trip_forbidden` so existence cannot be probed (R15.2,
    // R15.4). Returns the `TripMemberDTO[]` the mobile screens render.
    app.get<{ Params: { id: string } }>(
      '/trips/:id/members',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.listMembers(id);
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/invites — list pending Trip_Invites (Organizer-gated)
    // (R6.5, R6.8)
    // -------------------------------------------------------------------
    // Managing invites is an Organizer concern (invite/cancel are both
    // Organizer-gated), so listing outstanding invites is too; a non-organizer,
    // non-member, or non-existent Trip all collapse to `trip_forbidden` (R15.2,
    // R15.4). Returns the `TripPendingInviteDTO[]` the Members screen uses to
    // show outstanding invites and to exclude already-invited Friends from the
    // invite picker.
    app.get<{ Params: { id: string } }>(
      '/trips/:id/invites',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripOrganizer(pool, userId, id);
        return repo.listPendingInvites(id);
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/members/:userId/promote — promote a Member to Organizer
    // (Organizer-gated) (R4.5, R4.8)
    // -------------------------------------------------------------------
    // Only an Organizer may change roles (R4.5); a non-organizer, non-member,
    // or non-existent Trip all collapse to `trip_forbidden`. The repo rejects a
    // no-op change (`trip_role_invalid`, R4.8) and a target who is not a Member
    // (`trip_validation_failed`), throwing the mapped `AppError`.
    app.post<{ Params: { id: string; userId: string } }>(
      '/trips/:id/members/:userId/promote',
      { preHandler: requireSession },
      async (request, reply) => {
        const callerId = requireUser(request);
        const { id, userId: targetUserId } = parseOrAppError(
          tripMemberParamsSchema,
          request.params,
        );
        await assertTripOrganizer(pool, callerId, id);
        await repo.promote(id, targetUserId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/members/:userId/demote — demote an Organizer to Member
    // (Organizer-gated) (R4.6, R4.8, R5.2)
    // -------------------------------------------------------------------
    // Only an Organizer may change roles (R4.6). The repo rejects a no-op
    // change (`trip_role_invalid`, R4.8), a non-Member target
    // (`trip_validation_failed`), and — via the Last_Organizer_Rule — a
    // demotion that would leave the Trip with zero organizers
    // (`trip_last_organizer`, R5.2), throwing the mapped `AppError`.
    app.post<{ Params: { id: string; userId: string } }>(
      '/trips/:id/members/:userId/demote',
      { preHandler: requireSession },
      async (request, reply) => {
        const callerId = requireUser(request);
        const { id, userId: targetUserId } = parseOrAppError(
          tripMemberParamsSchema,
          request.params,
        );
        await assertTripOrganizer(pool, callerId, id);
        await repo.demote(id, targetUserId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // DELETE /trips/:id/members/:userId — remove a Member (Organizer-gated)
    // (R8.2, R8.3, R8.9, R5.4)
    // -------------------------------------------------------------------
    // Only an Organizer may remove another Member (R8.3). A Member removing
    // themselves uses `POST /trips/:id/leave` instead. The repo rejects a
    // non-Member target (`trip_validation_failed`, R8.9) and — via the
    // Last_Organizer_Rule — a removal that would strand the Trip without an
    // organizer (`trip_last_organizer`, R5.4), throwing the mapped `AppError`.
    app.delete<{ Params: { id: string; userId: string } }>(
      '/trips/:id/members/:userId',
      { preHandler: requireSession },
      async (request, reply) => {
        const callerId = requireUser(request);
        const { id, userId: targetUserId } = parseOrAppError(
          tripMemberParamsSchema,
          request.params,
        );
        await assertTripOrganizer(pool, callerId, id);
        await repo.removeMember(id, targetUserId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/leave — leave the Trip (Member-gated)
    // (R8.1, R8.8, R5.3, R5.6, R5.7)
    // -------------------------------------------------------------------
    // Any Trip_Member may leave their own Trip (R8.1); a non-member (or
    // non-existent Trip) collapses to `trip_forbidden`. The repo rejects a
    // departure that would strand a non-empty Trip without an organizer
    // (`trip_last_organizer`, R5.3) and cascade-deletes the Trip when the sole
    // Member leaves (R5.6, R5.7). The `{ tripDeleted }` outcome lets the client
    // decide whether to navigate back to a still-existing Trip.
    app.post<{ Params: { id: string } }>(
      '/trips/:id/leave',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.leaveTrip(id, userId);
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/planned-items — add a Planned_Item (Member-gated)
    // (R9.1–R9.5, R9.2)
    // -------------------------------------------------------------------
    // Any Trip_Member may add to the shared Planned_List (R9.2); a non-member
    // (or non-existent Trip) collapses to `trip_forbidden` so existence cannot
    // be probed. The body is validated by the shared `plannedItemAddSchema`
    // (well-formed `experienceId`) before the repo enforces the unknown-Catalog
    // (R9.4), duplicate (R9.3), and 500-item-limit (R9.5) rules, recording the
    // caller as the adder (R9.1). Returns the created item's read projection.
    app.post<{ Params: { id: string } }>(
      '/trips/:id/planned-items',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        const body = parseOrAppError(plannedItemAddSchema, request.body);
        const item = await repo.addPlannedItem(id, userId, body);
        reply.code(201);
        return item;
      },
    );

    // -------------------------------------------------------------------
    // DELETE /trips/:id/planned-items/:itemId — remove a Planned_Item
    // (Member-gated) (R9.6–R9.8, R9.2)
    // -------------------------------------------------------------------
    // Removal is permitted for the Member who added the item (R9.6) or for any
    // Organizer (R9.7); a `member` who did not add it is rejected with
    // `trip_forbidden` by the repo (R9.8). The membership gate returns the
    // caller's role, which is passed to the repo so it can apply that rule
    // without a second lookup. A `false` return (no such item on the Trip) maps
    // to the owner-side `trip_not_found`.
    app.delete<{ Params: { id: string; itemId: string } }>(
      '/trips/:id/planned-items/:itemId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, itemId } = parseOrAppError(
          tripPlannedItemParamsSchema,
          request.params,
        );
        const callerRole = await assertTripMember(pool, userId, id);
        const removed = await repo.removePlannedItem(
          id,
          itemId,
          userId,
          callerRole,
        );
        if (!removed) {
          throw new AppError('trip_not_found', 'Planned item not found.');
        }
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/planned-items — list Planned_Items (Member-gated)
    // (R9.9, R9.2)
    // -------------------------------------------------------------------
    // Any Trip_Member may read the shared Planned_List; a non-member (or
    // non-existent Trip) collapses to `trip_forbidden`. Returns the
    // `PlannedItemDTO[]` (Experience name/Park + adder display name) the mobile
    // Planned_List screen renders (R9.9).
    app.get<{ Params: { id: string } }>(
      '/trips/:id/planned-items',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.listPlannedItems(id);
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/log-entries — log a Completion + rode-with tags
    // (Member-gated) (R10.7, R10.8, R12.7, R15.1)
    // -------------------------------------------------------------------
    // Any Trip_Member may log a Completion against the Trip (R10.7); a
    // non-member (or non-existent Trip) collapses to `trip_forbidden` so
    // existence cannot be probed (R15.2, R15.4). The body is validated by the
    // shared `tripLogEntryCreateSchema` (well-formed `experienceId`, a
    // `rodeWith` list of ids, and an optional whole-number 1–10 `rating`)
    // before the repo runs the rest of the R10 rules where the membership set
    // is known: self-tags (R10.5), in-request duplicate tags (R10.6), and
    // non-member tags (R10.4) are rejected with `trip_validation_failed`. The
    // mobile picker excludes the logging Member from the tag choices, and the
    // repo enforces the self-tag rule server-side regardless (R10.5). The repo
    // ensures the logging Member's canonical Completion (never duplicated) and
    // applies the optional canonical Rating, delegating both to the injected
    // Tracking repos so no Trip-local copy exists (R12.1). After the repo
    // commits, one `RodeWithTagCreatedNotice` is fired per created `pending`
    // tag on the fire-and-forget dispatch port (R10.8); it returns void and
    // owns its own error handling, so it never blocks or fails the 201.
    app.post<{ Params: { id: string } }>(
      '/trips/:id/log-entries',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        const body = parseOrAppError(tripLogEntryCreateSchema, request.body);
        const { logEntryId, pendingTags } = await repo.logCompletion(
          id,
          userId,
          body,
        );
        // Fire-and-forget push to each Tagged_Member (R10.8). The dispatch
        // returns void and owns its own error handling, so it never blocks or
        // fails the 201. `userId` is the Tagging_Member who logged the entry.
        for (const tag of pendingTags) {
          emitRodeWithTagCreated?.({
            tagId: tag.tagId,
            tripLogEntryId: logEntryId,
            taggingMemberId: userId,
            taggedMemberId: tag.taggedMemberId,
          });
        }
        reply.code(201);
        return { logEntryId };
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/log-entries — read the Shared_Log (Member-gated)
    // (R12.4, R12.7, R12.8, R15.1)
    // -------------------------------------------------------------------
    // Any Trip_Member may read the Shared_Log; a non-member (or non-existent
    // Trip) collapses to `trip_forbidden` so existence cannot be probed (R15.2,
    // R15.4). The repo joins each entry's logging Member display name, the
    // completed Experience name, the logging Member's *current* canonical
    // Rating live (a whole number 1–10, or `null` — the unrated indicator —
    // when they have none, R12.4, R12.8), and each Rode_With_Tag's
    // Tagged_Member and current state, returning the `TripLogEntryDTO[]` the
    // mobile Shared_Log screen renders.
    app.get<{ Params: { id: string } }>(
      '/trips/:id/log-entries',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.listLogEntries(id);
      },
    );

    // -------------------------------------------------------------------
    // GET /me/rode-with-tags?state=pending — list the caller's pending
    // Rode_With_Tags for the Notification_Center (Tagged_Member-scoped)
    // (R3.1, R3.4, R3.5, R3.6)
    // -------------------------------------------------------------------
    // Registered BEFORE the parametric `/me/rode-with-tags/:tagId` routes so
    // the query form on the collection path wins over `:tagId` (mirrors the
    // `/me/inbox/unread-count` vs `/me/inbox/:shareId` ordering). Scoped to the
    // caller by the repo (only tags where the caller is the Tagged_Member in
    // state `pending`, ordered `created_at DESC`), so it never discloses other
    // users' tags (R3.1, R3.2). `requireSession` yields `unauthorized` (401)
    // before any repo call (R3.5). The strict query schema makes `state`
    // required and exactly `pending`; a missing/other `state` or any extra key
    // is rejected as `validation_failed` (400) and returns no tags (R3.6). An
    // empty result is returned as `200` with `[]` (R3.4).
    app.get(
      '/me/rode-with-tags',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const parsed = rodeWithPendingQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw new AppError(
            'validation_failed',
            'Unsupported "state" query value; only state=pending is supported.',
            { field: 'state' },
          );
        }
        return repo.listPendingRodeWithTags(userId);
      },
    );

    // -------------------------------------------------------------------
    // POST /me/rode-with-tags/:tagId/confirm — confirm a Rode_With_Tag
    // (Tagged_Member-scoped) (R11.7, R11.8, R11.9)
    // -------------------------------------------------------------------
    // Caller-scoped rather than Trip-membership gated: the repo asserts the
    // caller is the tag's Tagged_Member, so a missing tag or one addressed to
    // someone else collapses to the identical `trip_forbidden` (non-probing,
    // R11.7). The body is validated by the shared `rodeWithConfirmSchema` (an
    // optional whole-number 1–10 `rating`); an out-of-range value is rejected
    // by the repo with `rating_out_of_range` (R11.9), and a non-`pending` tag
    // with `trip_tag_state_invalid` (R11.8). On success the repo links the
    // Tagged_Member's canonical Completion, optionally applies the Rating, and
    // sets the tag `confirmed` (no Trip_Feed_Item is written — the originating
    // `completion_logged` entry already records the rode-with); the confirmed
    // result (tag + linked Trip/Experience) is returned with 200.
    app.post<{ Params: { tagId: string } }>(
      '/me/rode-with-tags/:tagId/confirm',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { tagId } = parseOrAppError(
          rodeWithTagParamsSchema,
          request.params,
        );
        const body = parseOrAppError(rodeWithConfirmSchema, request.body);
        return repo.confirmRodeWithTag(tagId, userId, body.rating);
      },
    );

    // -------------------------------------------------------------------
    // POST /me/rode-with-tags/:tagId/decline — decline a Rode_With_Tag
    // (Tagged_Member-scoped) (R11.6, R11.7, R11.8)
    // -------------------------------------------------------------------
    // Caller-scoped like the confirm route: the repo asserts the caller is the
    // Tagged_Member (a missing/foreign tag collapses to `trip_forbidden`,
    // R11.7) and the tag is `pending` (`trip_tag_state_invalid`, R11.8), sets
    // it `declined`, and writes nothing to the Tagged_Member's data (R11.6).
    app.post<{ Params: { tagId: string } }>(
      '/me/rode-with-tags/:tagId/decline',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { tagId } = parseOrAppError(
          rodeWithTagParamsSchema,
          request.params,
        );
        await repo.declineRodeWithTag(tagId, userId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /me/rode-with-tags/:tagId — read a Rode_With_Tag for the deep-link
    // target (Tagged_Member-scoped) (R11.5, R18.5)
    // -------------------------------------------------------------------
    // The deep-link target read for the mobile RodeWithConfirmScreen (task
    // 17.4). Scoped to the caller by the repo: a `null` return (no tag with
    // this id addressed to the caller) maps to the non-probing `trip_not_found`
    // so the App can present the "no longer available" fallback without
    // disclosing tags addressed to others. Returns the `RodeWithTagTarget` the
    // confirm view renders (tag identity/state, linked Trip/Trip_Log_Entry,
    // Experience, Tagging_Member display name, and the caller's current Rating).
    app.get<{ Params: { tagId: string } }>(
      '/me/rode-with-tags/:tagId',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { tagId } = parseOrAppError(
          rodeWithTagParamsSchema,
          request.params,
        );
        const target = await repo.getRodeWithTag(tagId, userId);
        if (!target) {
          throw new AppError('trip_not_found', 'Rode-with tag not found.');
        }
        return target;
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/feed — read the Trip_Feed (Member-gated)
    // (R13.1–R13.3, R15.1)
    // -------------------------------------------------------------------
    // Any Trip_Member may read the Trip_Feed; a non-member (or non-existent
    // Trip) collapses to `trip_forbidden` so existence cannot be probed (R15.2,
    // R15.4). The repo returns the `TripFeedItemDTO[]` in the total,
    // deterministic reverse-chronological order (R13.3) the mobile feed renders;
    // a Trip with no activity yields an empty list.
    app.get<{ Params: { id: string } }>(
      '/trips/:id/feed',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.getFeed(id, userId);
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/feed/:targetType/:targetId/reactions — add a
    // Trip_Reaction (Member-gated) (R13.4–R13.6, R13.10)
    // -------------------------------------------------------------------
    // Any Trip_Member may react to a Trip_Feed_Item or Trip_Log_Entry (R13.10);
    // a non-member (or non-existent Trip) collapses to `trip_forbidden`. The
    // body's `reaction` is validated against the closed `Trip_Reaction`
    // vocabulary by the shared `tripReactionInputSchema` (R13.6). The insert is
    // idempotent via the composite key, so re-adding the same reaction is a
    // no-op (R13.5); the repo throws `trip_not_found` when the target does not
    // belong to the Trip (R13.10). Returns 201 with no body.
    app.post<{
      Params: { id: string; targetType: string; targetId: string };
    }>(
      '/trips/:id/feed/:targetType/:targetId/reactions',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, targetType, targetId } = parseOrAppError(
          tripFeedTargetParamsSchema,
          request.params,
        );
        await assertTripMember(pool, userId, id);
        const { reaction } = parseOrAppError(
          tripReactionInputSchema,
          request.body,
        );
        await repo.addReaction(id, targetType, targetId, userId, reaction);
        reply.code(201);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // DELETE /trips/:id/feed/:targetType/:targetId/reactions/:type — remove the
    // caller's own Trip_Reaction (Member-gated) (R13.7)
    // -------------------------------------------------------------------
    // Any Trip_Member may remove their own reaction of `:type` from the target
    // (R13.7); a non-member (or non-existent Trip) collapses to `trip_forbidden`.
    // The repo scopes the delete to the caller so it can only remove its own
    // reaction, and the delete is idempotent — removing a reaction that does not
    // exist is a no-op. Returns 204 no content.
    app.delete<{
      Params: {
        id: string;
        targetType: string;
        targetId: string;
        type: string;
      };
    }>(
      '/trips/:id/feed/:targetType/:targetId/reactions/:type',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, targetType, targetId, type } = parseOrAppError(
          tripReactionRemoveParamsSchema,
          request.params,
        );
        await assertTripMember(pool, userId, id);
        await repo.removeReaction(id, targetType, targetId, userId, type);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/feed/:targetType/:targetId/comments — add a Trip_Comment
    // (Member-gated) (R13.8–R13.10)
    // -------------------------------------------------------------------
    // Any Trip_Member may comment on a Trip_Feed_Item or Trip_Log_Entry
    // (R13.10); a non-member (or non-existent Trip) collapses to
    // `trip_forbidden`. The body's `body` is trimmed and constrained to 1–2000
    // characters by the shared `tripCommentInputSchema` (R13.9); the repo throws
    // `trip_not_found` when the target does not belong to the Trip (R13.10).
    // Returns 201 with the created comment's identity (`{ commentId }`).
    app.post<{
      Params: { id: string; targetType: string; targetId: string };
    }>(
      '/trips/:id/feed/:targetType/:targetId/comments',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, targetType, targetId } = parseOrAppError(
          tripFeedTargetParamsSchema,
          request.params,
        );
        await assertTripMember(pool, userId, id);
        const { body } = parseOrAppError(
          tripCommentInputSchema,
          request.body,
        );
        const created = await repo.addComment(
          id,
          targetType,
          targetId,
          userId,
          body,
        );
        reply.code(201);
        return created;
      },
    );

    // -------------------------------------------------------------------
    // DELETE /trips/:id/comments/:commentId — remove the caller's own
    // Trip_Comment (Member-gated) (R13.11, R13.12)
    // -------------------------------------------------------------------
    // A comment may be removed only by its author (R13.11); the membership gate
    // denies a non-member (or non-existent Trip) with `trip_forbidden`, and the
    // repo throws `trip_forbidden` when the comment exists but was authored by
    // another User, leaving it in place (R13.12). A `false` return (no comment
    // with `commentId` belongs to the Trip) maps to the owner-side
    // `trip_not_found`. Returns 204 no content on success.
    app.delete<{ Params: { id: string; commentId: string } }>(
      '/trips/:id/comments/:commentId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, commentId } = parseOrAppError(
          tripCommentParamsSchema,
          request.params,
        );
        await assertTripMember(pool, userId, id);
        const removed = await repo.removeComment(id, commentId, userId);
        if (!removed) {
          throw new AppError('trip_not_found', 'Trip comment not found.');
        }
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /trips/:id/summary — read the Trip summary (Member-gated)
    // (R14.8, R19.1)
    // -------------------------------------------------------------------
    // Any Trip_Member may read the derived summary; a non-member (or
    // non-existent Trip) collapses to `trip_forbidden` so existence cannot be
    // probed (R15.2, R15.4). The repo returns the derived `TripSummaryDTO`
    // (per-Member counts alongside display names, R14.7) the mobile summary
    // screen renders.
    app.get<{ Params: { id: string } }>(
      '/trips/:id/summary',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, id);
        return repo.getSummary(id);
      },
    );

    // -------------------------------------------------------------------
    // PATCH /trips/:id/planned-items/:itemId — edit scheduling fields
    // -------------------------------------------------------------------
    app.patch<{ Params: { id: string; itemId: string } }>(
      '/trips/:id/planned-items/:itemId',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id, itemId } = parseOrAppError(
          z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
          request.params
        );
        await assertTripMember(pool, userId, id);
        
        const input = parseOrAppError(plannedItemEditSchema, request.body);
        return repo.editPlannedItem(id, itemId, input);
      }
    );

    // -------------------------------------------------------------------
    // POST /trips/:id/schedule/optimize — run optimizer
    // -------------------------------------------------------------------
    app.post<{ Params: { id: string } }>(
      '/trips/:id/schedule/optimize',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(
          z.object({ id: z.string().uuid() }),
          request.params
        );
        await assertTripMember(pool, userId, id);
        
        const { date, startHour, endHour } = parseOrAppError(tripOptimizationInputSchema, request.body);
        
        const items = await repo.listPlannedItems(id);
        
        if (items.length === 0) {
          return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
        }
        
        const tripRes = await pool.query<{ walking_speed: import('@dwt/shared').WalkingSpeed; early_entry_eligible: boolean; day_touring_hours: any }>(
          `SELECT walking_speed, early_entry_eligible, day_touring_hours FROM trips WHERE id = $1`,
          [id]
        );
        const tripRow = tripRes.rows[0];
        const rawDayHours = tripRow?.day_touring_hours;
        const dayHoursMap = typeof rawDayHours === 'string' ? JSON.parse(rawDayHours) : (rawDayHours ?? {});
        const dateSettings = dayHoursMap[date];

        const earlyEntryEligible = dateSettings?.useEarlyEntry ?? tripRow?.early_entry_eligible ?? false;
        const useExtendedEvening = dateSettings?.useExtendedEvening ?? false;
        const hasAfterHoursTicket = dateSettings?.hasAfterHoursTicket ?? false;
        const walkingSpeed = tripRow?.walking_speed ?? 'moderate';
        const resolvedStartHour = dateSettings?.startHour ?? startHour;
        const resolvedEndHour = dateSettings?.endHour ?? endHour;

        const expIds = items.map((i) => i.experienceId);
        const coordsRes = await pool.query<{ id: string; latitude: number | null; longitude: number | null; operates_during_early_entry: boolean | null; operates_during_extended_evening: boolean | null; operates_during_ticketed_event: boolean | null }>(
          `SELECT id, latitude, longitude, operates_during_early_entry, operates_during_extended_evening, operates_during_ticketed_event FROM experiences WHERE id = ANY($1)`,
          [expIds]
        );
        const specialHoursMap = new Map<string, { earlyEntry: boolean | null; extendedEvening: boolean | null; ticketedEvent: boolean | null }>(
          coordsRes.rows.map((r) => [r.id, {
            earlyEntry: r.operates_during_early_entry,
            extendedEvening: r.operates_during_extended_evening,
            ticketedEvent: r.operates_during_ticketed_event,
          }])
        );
        const coordsMap = new Map<string, { lat: number; lng: number } | null>(
          coordsRes.rows.map((r) => [
            r.id, 
            r.latitude != null && r.longitude != null ? { lat: Number(r.latitude), lng: Number(r.longitude) } : null
          ])
        );
        
        const optimizeItems: OptimizeInputItem[] = items.map((item) => ({
          id: item.id,
          experienceId: item.experienceId,
          park: item.park,
          isFixed: item.isFixed ?? false,
          isLightningLane: item.isLightningLane ?? false,
          useSingleRider: item.useSingleRider ?? false,
          priority: item.priority ?? 2,
          itemType: item.itemType ?? 'experience',
          durationMinutes: item.durationMinutes ?? null,
          plannedTime: item.plannedTime ?? null,
          coords: coordsMap.get(item.experienceId) ?? null,
          operatesDuringEarlyEntry: specialHoursMap.get(item.experienceId)?.earlyEntry ?? null,
          operatesDuringExtendedEvening: specialHoursMap.get(item.experienceId)?.extendedEvening ?? null,
          operatesDuringTicketedEvent: specialHoursMap.get(item.experienceId)?.ticketedEvent ?? null,
        }));
        
        const parks = [...new Set(items.map((i) => i.park))];
        const snapshots: Record<string, import('@dwt/shared').WaitSnapshot> = {};
        if (options.predictionService) {
          for (const park of parks) {
            const expIds = items.filter((i) => i.park === park).map((i) => i.experienceId);
            const parkSnap = await options.predictionService.getDaySnapshot(expIds, park, new Date(date));
            Object.assign(snapshots, parkSnap);
          }
        }
        
        const optInput: OptimizeInput = {
          items: optimizeItems,
          snapshots: snapshots,
          date,
          earlyEntryEligible,
          useExtendedEvening,
          hasAfterHoursTicket,
          walkingSpeed,
          ...(dateSettings?.startingPark ? { startingPark: dateSettings.startingPark } : {}),
          ...(resolvedStartHour !== undefined ? { startHour: resolvedStartHour } : {}),
          ...(resolvedEndHour !== undefined ? { endHour: resolvedEndHour } : {}),
        };
        
        const result = optimize(optInput);
        if (result.items.length > 0) {
          await repo.updatePlannedItemTimes(
            id,
            result.items.map((i) => ({
              itemId: i.plannedItemId,
              plannedTime: i.suggestedArrival,
              predictedWaitMinutes: i.predictedWaitMinutes,
              travelFromPrev: i.travelFromPrev,
            }))
          );
        }
        return result;
      }
    );

    // -------------------------------------------------------------------
    // GET /me/trips — list the caller's own Trips (R16.1)
    // -------------------------------------------------------------------
    // No membership gate: this lists the authenticated caller's own Trips, so
    // the `/me/...` pattern applies (mirrors `POST /me/trips`). The repo returns
    // the `TripListGroup[]` grouped by derived `Trip_Status` in the order the
    // mobile Trips list renders; a caller who belongs to no Trips yields an
    // empty list.
    app.get(
      '/me/trips',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.listMyTrips(userId);
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read `request.userId` or raise `unauthorized` if the middleware skipped. */
function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

/**
 * Run `schema.parse` against `input` and translate any `ZodError` into the
 * uniform `AppError` envelope. Mirrors the helper used by the Friends and
 * Sharing route modules; intentionally duplicated to keep route modules
 * independent and dodge import cycles.
 */
function parseOrAppError<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

/**
 * Translate the first Zod issue into an `AppError`. Every Trip input schema
 * emits the `trip_validation_failed` message for its rule violations
 * (name/description/date), so a recognized message maps to the dedicated
 * `trip_validation_failed` (400) code with a `field` pointer. Anything else
 * (e.g. a malformed `:id`) also collapses to `trip_validation_failed` since
 * every input on this plugin is Trip-domain validation.
 */
function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;

  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError('trip_validation_failed', message, { field })
    : new AppError('trip_validation_failed', message);
}
