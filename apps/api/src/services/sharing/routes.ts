/**
 * Sharing_Service HTTP routes (task 12.1).
 *
 * Wires the four endpoints from the design's Sharing_Service "Endpoints"
 * table:
 *
 *   POST   /me/shares                        send share (R9.1, R9.2, R9.3, R9.4-R9.7)
 *   GET    /me/inbox                         recipient inbox (R9.8)
 *   POST   /me/inbox/:shareId/open           open share (R9.9)
 *   DELETE /me/inbox/:shareId                recipient soft delete (R9.10)
 *
 * The route layer is responsible for composing the payload per
 * `SharePayloadKind` before handing it to the repo:
 *
 *   - `experience` shares (R9.1): the client supplies `experienceId`,
 *     optional `rating` (the sender's current Rating in 1..10), and an
 *     optional `note` (the sender's current Note body). The route
 *     normalizes these into the `ExperienceSharePayload` shape:
 *
 *       * `rating` field is set when present (R9.4); when explicitly
 *         requested but absent, `rating: null` + `ratingUnavailable: true`
 *         is included as a notice to the recipient (R9.5);
 *       * `note` field is included when supplied; the input schema's
 *         `noteBodySchema` already trims and rejects bodies outside
 *         1..2000 (R9.6) so we never persist a body that violates the
 *         constraint.
 *
 *   - `progress` shares (R9.7): the client supplies a `statsSnapshot`
 *     containing overall, per-Park, and per-Experience_Category
 *     percentages. The route caps each to [0.0, 100.0] before persisting
 *     and rounds nothing further (the Stats_Service already produces
 *     rounded values via `computePercent`).
 *
 * Design references:
 *   - design.md "Sharing_Service" → atomic creation flow
 *   - design.md "Share Delivery (atomic friend check)" sequence diagram
 *
 * Validates: Requirements R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7,
 *            R9.8, R9.9, R9.10.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type {
  ExperienceCategory,
  ExperienceSharePayload,
  Park,
  ProgressSharePayload,
  SharePayload,
} from '@dwt/shared';
import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  noteBodySchema,
  ratingValueSchema,
  recipientListSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { CuratedProgressStats } from '../stats/curatedShare.js';
import type { SharingRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Curated Progress_Share stats seam (Requirement 10)
// ---------------------------------------------------------------------------

/**
 * Live-computation port that produces the curated subset of the sender's
 * statistics captured into a `progress` Share at creation time (R10.1-R10.8).
 *
 * The port is injected (rather than depending on the Stats_Service directly) so
 * the Sharing_Service stays decoupled from the stats wiring and remains unit-
 * testable with a fake. The composition root binds it to the Stats_Service's
 * snapshot repository + `buildCuratedProgressStats`, so the fields are a
 * send-time snapshot of the same single `REPEATABLE READ READ ONLY` computation
 * the Stats_Page uses (R10.6). It resolves the sender's `overallPercent`,
 * optional `topFacet`, and `percentileRank`.
 */
export type ProgressShareStatsProvider = (
  senderId: string,
) => Promise<CuratedProgressStats>;

// ---------------------------------------------------------------------------
// ShareDelivered dispatch seam (R7.7)
// ---------------------------------------------------------------------------

/**
 * Event emitted after a Share is durably delivered (`createShareAtomic`
 * commits). Carries exactly what the Notification_Service needs to target and
 * compose a push without re-reading the `shares` row: the recipients to
 * notify, the sender to name, and — for an `experience` Share — the referenced
 * `experienceId` whose name becomes the content label. A `progress` Share needs
 * no extra field; its notification label is fixed.
 *
 * The type is declared here (rather than imported from the Notification_Service)
 * so the Sharing_Service stays decoupled from the notification wiring, mirroring
 * how the rating repo depends only on a structural `RatingChangedEvent` port.
 * It is structurally identical to the Notification_Service's `ShareDeliveredEvent`,
 * so the composition root can hand this straight to it.
 */
export type ShareDeliveredNotice =
  | {
      readonly shareId: string;
      readonly senderId: string;
      readonly recipientIds: readonly string[];
      readonly payloadKind: 'experience';
      readonly experienceId: string;
    }
  | {
      readonly shareId: string;
      readonly senderId: string;
      readonly recipientIds: readonly string[];
      readonly payloadKind: 'progress';
    };

/**
 * Background dispatch port for {@link ShareDeliveredNotice}. It returns `void`
 * (not a promise) so the route handler cannot await — and therefore cannot be
 * blocked or failed by — the notification path (R7.7). The port implementation
 * (wired in `composeServices.ts`) owns the fire-and-forget scheduling and its
 * own bounded retry; `POST /me/shares` returns `201` regardless of push
 * outcome.
 */
export type ShareDeliveredDispatch = (event: ShareDeliveredNotice) => void;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `sharingRoutes`. Each dependency is supplied
 * explicitly so unit tests can wire fakes without monkey-patching
 * modules.
 */
export interface SharingRoutesOptions {
  /** Persistence surface from `./repo.ts`. */
  readonly repo: SharingRepo;
  /**
   * Pre-handler from task 6.2 that authenticates the request and
   * assigns `request.userId`. Reused on every route in this plugin.
   */
  readonly requireSession: preHandlerHookHandler;
  /**
   * Optional background dispatch invoked after `createShareAtomic` commits so
   * the Notification_Service can deliver a push (R7, R7.7). Omitted in unit
   * tests and in any harness that does not exercise the notification path; when
   * absent, `POST /me/shares` behaves exactly as before. The dispatch is
   * best-effort and decoupled — it never blocks or fails the request.
   */
  readonly emitShareDelivered?: ShareDeliveredDispatch;
  /**
   * Optional live-computation port that captures the curated stats subset into
   * a `progress` Share at creation time (R10.1-R10.8). When supplied, a
   * `progress` share's `overallPercent`, `topFacet`, and `percentileRank` are
   * computed server-side from the sender's live stats and written into the
   * payload snapshot, overriding any client-supplied `overallPercent`. When
   * omitted (unit tests, harnesses that do not exercise the stats path), the
   * `progress` payload is composed from the request body exactly as before.
   */
  readonly computeProgressShareStats?: ProgressShareStatsProvider;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * Body schema for `POST /me/shares`.
 *
 * The route accepts a flat shape that mirrors the client UI: the kind,
 * the recipient list, plus the kind-specific fields. The route then
 * composes the canonical `SharePayload` (the discriminated union from
 * `@dwt/shared`) before handing it to the repo. This keeps the wire
 * format ergonomic for the mobile client without forcing the schema
 * for the persisted snapshot to leak its internals.
 */
const experienceShareInputSchema = z
  .object({
    kind: z.literal('experience'),
    recipientIds: recipientListSchema,
    experienceId: uuidSchema,
    /**
     * `rating` is `null` to explicitly opt into the "include sender's
     * rating but it's unavailable" path (R9.5); `undefined` (omitted)
     * means the sender did not request a rating in the share.
     *
     * `rating` of an integer 1..10 is the include-and-present path
     * (R9.4). The `ratingValueSchema` enforces the integer range; any
     * non-integer or out-of-range value surfaces as
     * `rating_out_of_range` via the existing zod-error mapper.
     */
    rating: ratingValueSchema.nullable().optional(),
    /**
     * Whether the sender's rating was explicitly requested. Used to
     * disambiguate "rating unavailable" (true + rating: null) from
     * "did not request a rating" (false / undefined).
     *
     * The flag is optional; when not supplied, the route infers it from
     * the presence of `rating` in the body.
     */
    includeRating: z.boolean().optional(),
    note: noteBodySchema.optional(),
  })
  .strict();

/**
 * Per-Park percentage map. All keys optional; each value is in [0, 100].
 * Server-side capping at 100.0 is applied in `composeProgressPayload`
 * for defense in depth.
 */
const perParkPercentInputSchema = z
  .object(
    Object.fromEntries(
      PARKS.map((park) => [park, z.number().optional()] as const),
    ) as { [K in Park]: z.ZodOptional<z.ZodNumber> },
  )
  .strict();

const perCategoryPercentInputSchema = z
  .object(
    Object.fromEntries(
      EXPERIENCE_CATEGORIES.map(
        (cat) => [cat, z.number().optional()] as const,
      ),
    ) as { [K in ExperienceCategory]: z.ZodOptional<z.ZodNumber> },
  )
  .strict();

const progressShareInputSchema = z
  .object({
    kind: z.literal('progress'),
    recipientIds: recipientListSchema,
    statsSnapshot: z
      .object({
        overallPercent: z.number(),
        perParkPercent: perParkPercentInputSchema,
        perCategoryPercent: perCategoryPercentInputSchema,
      })
      .strict(),
  })
  .strict();

const shareCreateBodySchema = z.discriminatedUnion('kind', [
  experienceShareInputSchema,
  progressShareInputSchema,
]);

type ShareCreateBody = z.infer<typeof shareCreateBodySchema>;

/**
 * Path-param schema for the inbox routes.
 */
const inboxParamsSchema = z.object({ shareId: uuidSchema }).strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Sharing_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(sharingRoutes({ repo, requireSession }));
 * ```
 */
export function sharingRoutes(
  options: SharingRoutesOptions,
): FastifyPluginAsync {
  const { repo, requireSession, emitShareDelivered, computeProgressShareStats } =
    options;

  return async function sharingRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // POST /me/shares
    // -------------------------------------------------------------------
    app.post(
      '/me/shares',
      { preHandler: requireSession },
      async (request, reply) => {
        const senderId = requireUser(request);
        const body = parseOrAppError(shareCreateBodySchema, request.body);
        let payload = composePayload(body);
        // R10: for a `progress` share, capture a send-time snapshot of the
        // sender's curated stats via the live computation (when the port is
        // wired) and write `overallPercent`, `topFacet`, and `percentileRank`
        // into the payload, overriding the client-supplied `overallPercent`.
        if (
          payload.kind === 'progress' &&
          computeProgressShareStats !== undefined
        ) {
          const curated = await computeProgressShareStats(senderId);
          payload = applyCuratedProgressStats(payload, curated);
        }
        const result = await repo.createShareAtomic(
          senderId,
          body.recipientIds,
          payload,
        );

        // R7.7: the Share is durably delivered — hand it to the background
        // notification dispatch (when wired) and return 201 immediately. The
        // dispatch is fire-and-forget (`void` return) so nothing about the push
        // path can block or fail this request.
        if (emitShareDelivered !== undefined) {
          emitShareDelivered(
            buildShareDeliveredNotice(result.shareId, senderId, body.recipientIds, payload),
          );
        }

        reply.code(201);
        return {
          shareId: result.shareId,
          deliveredTo: result.deliveredTo,
        };
      },
    );

    // -------------------------------------------------------------------
    // GET /me/inbox
    // -------------------------------------------------------------------
    app.get(
      '/me/inbox',
      { preHandler: requireSession },
      async (request) => {
        const recipientId = requireUser(request);
        return repo.listInbox(recipientId);
      },
    );

    // -------------------------------------------------------------------
    // GET /me/shares
    // -------------------------------------------------------------------
    // List the Shares the caller sent, most-recent first. Backs the mobile
    // Sent Shares surface, which then reads each Share's reactions via the
    // sender-gated `GET /me/shares/:shareId/reactions` (R11.7). The repo's
    // `sender_id = $1` predicate keeps the list scoped to the caller's own
    // Shares, so no request parameters are needed.
    app.get(
      '/me/shares',
      { preHandler: requireSession },
      async (request) => {
        const senderId = requireUser(request);
        return repo.listSentShares(senderId);
      },
    );

    // -------------------------------------------------------------------
    // POST /me/inbox/:shareId/open
    // -------------------------------------------------------------------
    app.post<{ Params: { shareId: string } }>(
      '/me/inbox/:shareId/open',
      { preHandler: requireSession },
      async (request) => {
        const recipientId = requireUser(request);
        const { shareId } = parseOrAppError(
          inboxParamsSchema,
          request.params,
        );
        const detail = await repo.openShare(recipientId, shareId);
        if (!detail) {
          // Both "no such share" and "not addressed to this recipient"
          // collapse to one response so the response cannot be used to
          // enumerate shareIds owned by others.
          throw new AppError(
            'validation_failed',
            'Share not found in your inbox.',
          );
        }
        return detail;
      },
    );

    // -------------------------------------------------------------------
    // DELETE /me/inbox/:shareId
    // -------------------------------------------------------------------
    app.delete<{ Params: { shareId: string } }>(
      '/me/inbox/:shareId',
      { preHandler: requireSession },
      async (request, reply) => {
        const recipientId = requireUser(request);
        const { shareId } = parseOrAppError(
          inboxParamsSchema,
          request.params,
        );
        const removed = await repo.softDeleteForRecipient(
          recipientId,
          shareId,
        );
        if (!removed) {
          throw new AppError(
            'validation_failed',
            'Share not found in your inbox.',
          );
        }
        // 204 No Content for a successful soft delete; the recipient's
        // inbox listing is the read path and reflects the change on the
        // next call.
        reply.code(204);
        reply.send();
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Payload composition
// ---------------------------------------------------------------------------

/**
 * Build the {@link ShareDeliveredNotice} for the background notification
 * dispatch from the committed share's id and its composed payload. The
 * `experience` branch carries the `experienceId` so the Notification_Service
 * can resolve the Experience name for the content label without re-reading the
 * `shares` row; the `progress` branch needs no extra field (its label is
 * fixed).
 */
function buildShareDeliveredNotice(
  shareId: string,
  senderId: string,
  recipientIds: ReadonlyArray<string>,
  payload: SharePayload,
): ShareDeliveredNotice {
  if (payload.kind === 'experience') {
    return {
      shareId,
      senderId,
      recipientIds,
      payloadKind: 'experience',
      experienceId: payload.experienceId,
    };
  }
  return {
    shareId,
    senderId,
    recipientIds,
    payloadKind: 'progress',
  };
}

/**
 * Compose the canonical `SharePayload` from the validated request body.
 *
 * Splits on `kind` so each branch is straight-line; both branches return
 * the same union type so the caller is single-shape.
 */
function composePayload(body: ShareCreateBody): SharePayload {
  if (body.kind === 'experience') {
    return composeExperiencePayload(body);
  }
  return composeProgressPayload(body);
}

/**
 * Compose an `ExperienceSharePayload` (R9.4, R9.5, R9.6).
 *
 * Decision table for the rating field:
 *
 *   includeRating | rating value     | resulting payload
 *   --------------|------------------|----------------------------------
 *   omitted, false| omitted          | rating fields omitted
 *   omitted       | int in 1..10     | rating: int (R9.4)
 *   omitted       | null             | rating: null + ratingUnavailable (R9.5)
 *   true          | omitted          | rating: null + ratingUnavailable (R9.5)
 *   true          | int in 1..10     | rating: int (R9.4)
 *   true          | null             | rating: null + ratingUnavailable (R9.5)
 *   false         | <any>            | rating fields omitted
 *
 * Note truncation (R9.6): the input schema already enforces a 2000-char
 * upper bound (and rejects empty bodies after trim). For belt-and-braces
 * — and to honor the task brief's explicit "include note truncated to
 * 2000 chars" instruction — we re-truncate here so a future schema
 * relaxation cannot let an over-long body slip into a payload snapshot.
 */
function composeExperiencePayload(
  body: Extract<ShareCreateBody, { kind: 'experience' }>,
): ExperienceSharePayload {
  // The discriminator type lets `rating: null` and `rating: undefined`
  // share the optional shape; we treat them distinctly here.
  const includesRating = body.includeRating === true || 'rating' in body;
  const ratingPresent =
    typeof body.rating === 'number' && Number.isFinite(body.rating);

  // Build the payload object in stages so we only assign keys we
  // actually want present (matching the DTO's `?:` optional fields).
  const payload: { -readonly [K in keyof ExperienceSharePayload]: ExperienceSharePayload[K] } = {
    kind: 'experience',
    experienceId: body.experienceId,
  };

  if (includesRating) {
    if (ratingPresent) {
      // R9.4: include the integer rating verbatim.
      payload.rating = body.rating as number;
    } else {
      // R9.5: include rating-unavailable notice when the sender chose
      // to include their rating but none exists at delivery time. The
      // explicit `null` keeps the payload's wire shape consistent with
      // `experienceSharePayloadSchema` (rating optional+nullable).
      payload.rating = null;
      payload.ratingUnavailable = true;
    }
  }

  if (body.note !== undefined) {
    // R9.6: truncate to 2000 chars. The schema already trims and
    // bounds; this is defense in depth.
    payload.note = body.note.length > 2000 ? body.note.slice(0, 2000) : body.note;
  }

  return payload;
}

/**
 * Compose a `ProgressSharePayload` (R9.7).
 *
 * Caps every percentage at 100.0 and floors negative values at 0 so the
 * persisted snapshot is always in `[0.0, 100.0]`. The Stats_Service
 * already enforces this on the read path via `computePercent`; the cap
 * here is defense in depth against a buggy or malicious client.
 */
function composeProgressPayload(
  body: Extract<ShareCreateBody, { kind: 'progress' }>,
): ProgressSharePayload {
  const perPark: { [K in Park]?: number } = {};
  for (const park of PARKS) {
    const v = body.statsSnapshot.perParkPercent[park];
    if (typeof v === 'number') {
      perPark[park] = clampPercent(v);
    }
  }
  const perCategory: { [K in ExperienceCategory]?: number } = {};
  for (const category of EXPERIENCE_CATEGORIES) {
    const v = body.statsSnapshot.perCategoryPercent[category];
    if (typeof v === 'number') {
      perCategory[category] = clampPercent(v);
    }
  }
  return {
    kind: 'progress',
    overallPercent: clampPercent(body.statsSnapshot.overallPercent),
    perParkPercent: perPark,
    perCategoryPercent: perCategory,
  };
}

/**
 * Overlay the curated, live-computed stats onto a composed `progress` payload
 * (R10.1, R10.2, R10.3, R10.6, R10.7, R10.8).
 *
 * The server-computed `overallPercent` replaces the client-supplied value so
 * the snapshot reflects the sender's actual send-time completion (R10.1). The
 * `topFacet` is included only when the provider returned one (R10.7 / R10.8);
 * omitting it entirely when the sender has no facet statistic keeps the payload
 * clean. The `percentileRank` is always written (R10.3). The per-Park /
 * per-Category breakdown maps from the client body are preserved as-is; the
 * verbose stats excluded by R10.5 (rating distribution, highest/lowest) never
 * enter this payload shape in the first place.
 *
 * `clampPercent` guards the curated percentages defensively even though the
 * Stats_Service already produces values in `[0.0, 100.0]`.
 */
function applyCuratedProgressStats(
  payload: ProgressSharePayload,
  curated: CuratedProgressStats,
): ProgressSharePayload {
  const next: {
    -readonly [K in keyof ProgressSharePayload]: ProgressSharePayload[K];
  } = {
    kind: 'progress',
    overallPercent: clampPercent(curated.overallPercent),
    perParkPercent: payload.perParkPercent,
    perCategoryPercent: payload.perCategoryPercent,
    percentileRank: clampPercent(curated.percentileRank),
  };
  if (curated.topFacet !== undefined) {
    next.topFacet = curated.topFacet;
  }
  return next;
}

/**
 * Clamp a percentage into `[0.0, 100.0]`. NaN inputs collapse to 0.0;
 * `+Infinity`/`-Infinity` are clamped to 100/0. The result is otherwise
 * the input value unchanged (no rounding).
 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Infinity ? 100 : 0;
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
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
 * Run a Zod schema and translate any `ZodError` into an `AppError`.
 *
 * Recognized issue messages map to dedicated domain codes:
 *   - `share_recipient_count_invalid` (from `recipientListSchema`) →
 *     400 with the same code
 *   - `note_length_invalid` (from `noteBodySchema`) → 400 with the same
 *     code
 *   - `rating_out_of_range` (from `ratingValueSchema`) → 400 with the
 *     same code
 *
 * Anything else collapses to `validation_failed` so unknown messages
 * cannot accidentally produce a misleading code.
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

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'validation_failed';

  if (rawMessage === 'share_recipient_count_invalid') {
    return field !== undefined
      ? new AppError(
          'share_recipient_count_invalid',
          'Recipient list must contain 1 to 50 unique user ids.',
          { field },
        )
      : new AppError(
          'share_recipient_count_invalid',
          'Recipient list must contain 1 to 50 unique user ids.',
        );
  }
  if (rawMessage === 'note_length_invalid') {
    return field !== undefined
      ? new AppError(
          'note_length_invalid',
          'Note must be 1 to 2000 characters after trimming.',
          { field },
        )
      : new AppError(
          'note_length_invalid',
          'Note must be 1 to 2000 characters after trimming.',
        );
  }
  if (rawMessage === 'rating_out_of_range') {
    return field !== undefined
      ? new AppError(
          'rating_out_of_range',
          'Rating must be an integer between 1 and 10 inclusive.',
          { field },
        )
      : new AppError(
          'rating_out_of_range',
          'Rating must be an integer between 1 and 10 inclusive.',
        );
  }

  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError('validation_failed', message, { field })
    : new AppError('validation_failed', message);
}
