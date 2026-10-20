/**
 * Sharing service route for reading a shared trip recap from the recipient's inbox.
 *
 * Routes: GET /me/inbox/:shareId/trip-recap, GET /me/inbox/:shareId/trip-recap/photos (D35)
 *
 * Implements: Task 21.3, Task 21.6
 * Validates: Requirements 12.10, 15.3, 15.4, 15.5, 15.7, 15.12, 15.14, 15.15, 15.16, 15.17, 15.20, 15.25 to 15.30, 16.8, 17.1
 */

import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors/AppError.js';
import {
  tripRecapPhotosQuerySchema,
  uuidSchema,
  type TripRecapDTO,
  type TripRecapPhotosDTO,
  type TripSummaryPhotosDTO,
} from '@dwt/shared';
import type { RecapPhotoPort, RecapShareGate, TripShareFacts } from './ports.js';
import { photoAccessFor, resolveShareAccess } from './tripRecapAccess.js';
import { projectRecapFigures } from './tripRecapProjection.js';

/** Default album page size (Requirement 9.4); the schema caps `limit` at 100. */
const RECAP_ALBUM_DEFAULT_LIMIT = 40;

const inboxParamsSchema = z.object({ shareId: uuidSchema }).strict();

function requireUser(request: FastifyRequest): string {
  const userId = request.userId ?? request.user?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function parseOrAppError<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError('validation_failed', 'Validation failed.');
    }
    throw err;
  }
}

export interface TripRecapRoutesOptions {
  readonly requireSession: preHandlerHookHandler;
  readonly recapShareGate: RecapShareGate;
  readonly tripShareFacts: TripShareFacts;
  readonly recapPhotoPort?: RecapPhotoPort | undefined;
}

export function registerTripRecapRoutes(
  app: FastifyInstance,
  options: TripRecapRoutesOptions,
): void {
  app.get<{ Params: { shareId: string }; Reply: TripRecapDTO }>(
    '/me/inbox/:shareId/trip-recap',
    { preHandler: options.requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { shareId } = parseOrAppError(inboxParamsSchema, request.params);

      // 1. The gate: resolve share + recipient + Friendship re-check
      const access = await resolveShareAccess(options.recapShareGate, shareId, userId);

      // 2. Check if trip exists and sharer is still a member (unavailable wins over not_included)
      if (!access.tripAvailable) {
        reply.header('Cache-Control', 'private, no-store');
        return {
          tripId: access.tripId,
          tripName: access.tripName ?? '',
          sharerDisplayName: access.sharerDisplayName ?? '',
          recap: null,
          photos: { access: 'unavailable', photos: [] },
        };
      }

      // 3. Live trip summary figures
      const summary = await options.tripShareFacts.summary(access.tripId);
      if (!summary) {
        reply.header('Cache-Control', 'private, no-store');
        return {
          tripId: access.tripId,
          tripName: access.tripName ?? '',
          sharerDisplayName: access.sharerDisplayName ?? '',
          recap: null,
          photos: { access: 'unavailable', photos: [] },
        };
      }

      const recap = projectRecapFigures(summary);

      // 4. Photos
      const port = options.recapPhotoPort;
      const photoAccess = photoAccessFor(access, port);
      let photos: TripSummaryPhotosDTO;
      if (photoAccess === 'granted' && port) {
        const photoItems = await port.highlights(access, userId);
        photos = { access: 'granted', photos: photoItems };
      } else {
        photos = { access: photoAccess, photos: [] };
      }

      reply.header('Cache-Control', 'private, no-store');
      return {
        tripId: access.tripId,
        tripName: access.tripName ?? '',
        sharerDisplayName: access.sharerDisplayName ?? '',
        recap,
        photos,
      };
    },
  );

  /**
   * Recap album: every approved Trip photo of the share's Trip, newest first, keyset-paged.
   * Same gate and order as the recap route (via resolveShareAccess / photoAccessFor); never
   * reads the Trip summary.
   *
   * Implements: Task 21.6
   * Validates: Requirements 15.25 to 15.30
   */
  app.get<{ Params: { shareId: string }; Querystring: unknown; Reply: TripRecapPhotosDTO }>(
    '/me/inbox/:shareId/trip-recap/photos',
    { preHandler: options.requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { shareId } = parseOrAppError(inboxParamsSchema, request.params);
      const query = parseOrAppError(tripRecapPhotosQuerySchema, request.query);

      const access = await resolveShareAccess(options.recapShareGate, shareId, userId);

      reply.header('Cache-Control', 'private, no-store');

      const port = options.recapPhotoPort;
      const photoAccess = photoAccessFor(access, port);
      if (photoAccess !== 'granted' || !port) {
        return { access: photoAccess, photos: [], nextCursor: null };
      }

      const page = await port.albumPage(access, userId, {
        limit: query.limit ?? RECAP_ALBUM_DEFAULT_LIMIT,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      });
      return { access: 'granted', photos: page.photos, nextCursor: page.nextCursor };
    },
  );
}
