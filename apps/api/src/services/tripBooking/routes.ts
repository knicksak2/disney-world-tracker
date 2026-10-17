/**
 * Fastify route plugin for the Trip Booking Timeline feature.
 *
 * Exposes:
 *  - Timeline: GET /trips/:id/booking-timeline
 *  - Settings: PATCH /trips/:id/booking-settings
 *  - Done marks: PUT /trips/:id/booking-windows/:kind/:dropOn/done
 *  - Reminder mutes: PUT /me/trips/:id/booking-reminders
 *  - Packing items: GET /trips/:id/packing-items, POST /trips/:id/packing-items, POST /trips/:id/packing-items/starter
 *  - Packing item edits: PATCH /trips/:id/packing-items/:itemId, DELETE /trips/:id/packing-items/:itemId, PUT /trips/:id/packing-items/:itemId/packed
 *
 * Validates: Requirements 2.4, 2.5, 2.6, 2.8, 2.10, 3.1, 3.8, 3.9, 3.10, 3.11,
 *                        5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.8, 9.9, 9.13,
 *                        11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.10, 11.12, 11.13,
 *                        12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 14.5, 14.7, 15.3, 15.6
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import {
  bookingSettingsUpdateSchema,
  packingItemCreateSchema,
  packingItemPackedSchema,
  packingItemUpdateSchema,
  reminderMuteSchema,
  uuidSchema,
  windowDoneParamsSchema,
  windowDoneSchema,
  type BookingReminderMuteDTO,
  type BookingSettingsDTO,
  type BookingTimelineDTO,
  type BookingWindowDTO,
  type PackingItemDTO,
  type PackingListDTO,
} from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertTripMember } from '../trips/authz.js';
import { can } from '../trips/permissions.js';
import { annotateWindows, deriveBookingTimeline } from './timeline.js';
import { canModifyPackingItem } from './packingAuth.js';
import { secretMatches } from './passGate.js';
import type { TripBookingRepo } from './repo.js';
import type { ReminderRunner } from './runner.js';

export interface TripBookingRoutesOptions {
  readonly repo: TripBookingRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
  readonly reminderRunner?: ReminderRunner;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Path parameter schemas
// ---------------------------------------------------------------------------

const tripIdParamsSchema = z.object({ id: uuidSchema }).strict();

const tripPackingItemParamsSchema = z
  .object({ id: uuidSchema, itemId: uuidSchema })
  .strict();

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

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

// ---------------------------------------------------------------------------
// Route Plugin Factory
// ---------------------------------------------------------------------------

export function tripBookingRoutes(
  options: TripBookingRoutesOptions,
): FastifyPluginAsync {
  const { repo, pool, requireSession } = options;

  return async function tripBookingRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------------
    // Booking Timeline
    // -----------------------------------------------------------------------

    // GET /trips/:id/booking-timeline
    app.get(
      '/trips/:id/booking-timeline',
      { preHandler: requireSession },
      async (request): Promise<BookingTimelineDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);

        const now = (options.now ?? (() => new Date()))();
        const rm = await repo.getTimelineInputs(tripId, userId);
        if (!rm) {
          throw new AppError('trip_forbidden', 'You may not view this trip.');
        }

        const d = deriveBookingTimeline({
          startDate: rm.trip.startDate,
          endDate: rm.trip.endDate,
          hasResortStay: rm.hasResortStay,
          settings: rm.settings,
        });

        const windows = annotateWindows(d, {
          now,
          doneMarks: rm.doneMarks,
          reservations: rm.reservations,
        });

        return {
          tripId,
          rulesVersion: d.rulesVersion,
          stayType: d.stayType,
          lightningLaneTiming: d.lightningLaneTiming,
          arrivalDate: d.arrival,
          muted: rm.viewerMuted,
          windows,
        };
      },
    );

    // PATCH /trips/:id/booking-settings
    app.patch(
      '/trips/:id/booking-settings',
      { preHandler: requireSession },
      async (request, reply): Promise<BookingSettingsDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'edit_booking_settings')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const input = parseOrAppError(bookingSettingsUpdateSchema, request.body);
        const updated = await repo.patchBookingSettings(tripId, input);

        reply.code(200);
        return updated;
      },
    );

    // PUT /trips/:id/booking-windows/:kind/:dropOn/done
    app.put(
      '/trips/:id/booking-windows/:kind/:dropOn/done',
      { preHandler: requireSession },
      async (request, reply): Promise<BookingWindowDTO> => {
        const userId = requireUser(request);
        const { id: tripId, kind, dropOn } = parseOrAppError(
          windowDoneParamsSchema,
          request.params,
        );
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'mark_booking_window_done')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const { done } = parseOrAppError(windowDoneSchema, request.body);

        const now = (options.now ?? (() => new Date()))();
        const rm = await repo.getTimelineInputs(tripId, userId);
        if (!rm) {
          throw new AppError('trip_forbidden', 'You may not view this trip.');
        }

        const d = deriveBookingTimeline({
          startDate: rm.trip.startDate,
          endDate: rm.trip.endDate,
          hasResortStay: rm.hasResortStay,
          settings: rm.settings,
        });

        const targetWindow = d.windows.find((w) => w.kind === kind && w.dropOn === dropOn);
        if (!targetWindow) {
          throw new AppError('trip_validation_failed', `Unknown booking window: ${kind}:${dropOn}`);
        }

        await repo.setWindowDone(tripId, kind, dropOn, done, userId);

        const updatedRm = await repo.getTimelineInputs(tripId, userId);
        if (!updatedRm) {
          throw new AppError('trip_forbidden', 'You may not view this trip.');
        }

        const annotated = annotateWindows(d, {
          now,
          doneMarks: updatedRm.doneMarks,
          reservations: updatedRm.reservations,
        });

        const resultWindow = annotated.find((w) => w.kind === kind && w.dropOn === dropOn);
        if (!resultWindow) {
          throw new AppError('trip_validation_failed', `Unknown booking window: ${kind}:${dropOn}`);
        }

        reply.code(200);
        return resultWindow;
      },
    );

    // PUT /me/trips/:id/booking-reminders
    app.put(
      '/me/trips/:id/booking-reminders',
      { preHandler: requireSession },
      async (request, reply): Promise<BookingReminderMuteDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'set_booking_reminder_mute')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const { muted } = parseOrAppError(reminderMuteSchema, request.body);
        const resultingMuted = await repo.setReminderMute(tripId, userId, muted);

        reply.code(200);
        return {
          tripId,
          muted: resultingMuted,
        };
      },
    );

    // -----------------------------------------------------------------------
    // Packing Items
    // -----------------------------------------------------------------------

    // GET /trips/:id/packing-items
    app.get(
      '/trips/:id/packing-items',
      { preHandler: requireSession },
      async (request): Promise<PackingListDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);

        return repo.listPacking(tripId);
      },
    );

    // POST /trips/:id/packing-items
    app.post(
      '/trips/:id/packing-items',
      { preHandler: requireSession },
      async (request, reply): Promise<PackingItemDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'add_packing_item')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const input = parseOrAppError(packingItemCreateSchema, request.body);
        const item = await repo.addPackingItem(tripId, userId, input);

        reply.code(201);
        return item;
      },
    );

    // POST /trips/:id/packing-items/starter
    app.post(
      '/trips/:id/packing-items/starter',
      { preHandler: requireSession },
      async (request, reply): Promise<{ added: number }> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'add_packing_item')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const added = await repo.addStarterItems(tripId, userId);

        reply.code(200);
        return { added };
      },
    );

    // PATCH /trips/:id/packing-items/:itemId
    app.patch(
      '/trips/:id/packing-items/:itemId',
      { preHandler: requireSession },
      async (request, reply): Promise<PackingItemDTO> => {
        const userId = requireUser(request);
        const { id: tripId, itemId } = parseOrAppError(
          tripPackingItemParamsSchema,
          request.params,
        );
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'edit_packing_item')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const input = parseOrAppError(packingItemUpdateSchema, request.body);

        const owner = await repo.getPackingItemOwner(tripId, itemId);
        if (!owner) {
          throw new AppError('trip_not_found', 'Packing item not found.');
        }

        if (!canModifyPackingItem(role, userId, owner.addedBy)) {
          throw new AppError('trip_forbidden', 'You may not modify this packing item.');
        }

        const updated = await repo.updatePackingItem(tripId, itemId, input);

        reply.code(200);
        return updated;
      },
    );

    // DELETE /trips/:id/packing-items/:itemId
    app.delete(
      '/trips/:id/packing-items/:itemId',
      { preHandler: requireSession },
      async (request, reply): Promise<void> => {
        const userId = requireUser(request);
        const { id: tripId, itemId } = parseOrAppError(
          tripPackingItemParamsSchema,
          request.params,
        );
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'edit_packing_item')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const owner = await repo.getPackingItemOwner(tripId, itemId);
        if (!owner) {
          throw new AppError('trip_not_found', 'Packing item not found.');
        }

        if (!canModifyPackingItem(role, userId, owner.addedBy)) {
          throw new AppError('trip_forbidden', 'You may not modify this packing item.');
        }

        await repo.removePackingItem(tripId, itemId);

        reply.code(204);
        return;
      },
    );

    // PUT /trips/:id/packing-items/:itemId/packed
    app.put(
      '/trips/:id/packing-items/:itemId/packed',
      { preHandler: requireSession },
      async (request, reply): Promise<PackingItemDTO> => {
        const userId = requireUser(request);
        const { id: tripId, itemId } = parseOrAppError(
          tripPackingItemParamsSchema,
          request.params,
        );
        const role = await assertTripMember(pool, userId, tripId);

        if (!can(role, 'toggle_packing_item')) {
          throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
        }

        const { packed } = parseOrAppError(packingItemPackedSchema, request.body);

        const owner = await repo.getPackingItemOwner(tripId, itemId);
        if (!owner) {
          throw new AppError('trip_not_found', 'Packing item not found.');
        }

        const updated = await repo.setPacked(tripId, itemId, userId, packed);

        reply.code(200);
        return updated;
      },
    );

    // -------------------------------------------------------------------------
    // Internal Cron Endpoints (R8.1, R8.2, R8.3, R8.4)
    // -------------------------------------------------------------------------
    const INTERNAL_CRON_PATH = '/internal/trip-booking-reminders/run';

    const gateCronSecret = (request: FastifyRequest): void => {
      const expectedSecret = app.config?.tripBooking?.cronSecret ?? '';
      if (!secretMatches(request.headers['x-cron-secret'], expectedSecret)) {
        throw new AppError('unauthorized', 'Missing or invalid cron secret');
      }
    };

    app.post(INTERNAL_CRON_PATH, async (request, reply) => {
      gateCronSecret(request);
      if (!options.reminderRunner) {
        throw new AppError('internal_error', 'Reminder runner not configured');
      }
      const r = options.reminderRunner.tryStart();
      return reply.code(202).send(
        r.started ? { status: 'accepted' } : { status: 'skipped', reason: r.reason },
      );
    });

    app.head(INTERNAL_CRON_PATH, async (request, reply) => {
      gateCronSecret(request);
      if (!options.reminderRunner) {
        throw new AppError('internal_error', 'Reminder runner not configured');
      }
      options.reminderRunner.tryStart();
      return reply.code(202).send();
    });
  };
}
