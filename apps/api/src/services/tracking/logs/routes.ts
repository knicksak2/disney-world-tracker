/**
 * Tracking_Service — Experience_Log routes.
 *
 * Wires the three activity-logging endpoints:
 *
 *   POST   /me/experiences/:id/logs           create a visit/ride log
 *   GET    /me/experiences/:id/logs           read the caller's Visit_History
 *   DELETE /me/experiences/:id/logs/:logId    delete one log
 *
 * All three require an authenticated session (`requireSession` populates
 * `request.userId`). Persistence and the completion/rating dual-write are owned
 * by the injected `ExperienceLogRepo`; these handlers only validate input, map
 * the repo result to the right status/envelope, and stay thin.
 *
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import { createExperienceLogInputSchema, uuidSchema } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { ExperienceLogRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface ExperienceLogRoutesOptions {
  readonly repo: ExperienceLogRepo;
  readonly requireSession: preHandlerHookHandler;
  /**
   * `() => Date` so the "not in the future" guard is deterministic in tests.
   * Defaults to `() => new Date()`. Mirrors the Completion route's clock.
   */
  readonly clock?: () => Date;
  /**
   * Pin_Service award hook (R2.1). After a log commits, this synchronously
   * evaluates the User's challenges and returns the ids of any newly-earned
   * Pins, which are surfaced as `newlyAwardedPinIds` in the log response so the
   * client can trigger the celebration animation. Best-effort: a failure here
   * never fails the already-committed log (the endpoint returns `[]`). Omitted
   * in tests that don't exercise pins; wired in `composeServices.ts`.
   */
  readonly awardPins?: (userId: string) => Promise<readonly string[]>;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const paramsSchema = z.object({ id: uuidSchema }).strict();
const deleteParamsSchema = z
  .object({ id: uuidSchema, logId: uuidSchema })
  .strict();

/**
 * Shared-schema issue messages we surface as specific error codes. `rating`
 * out-of-range and `note` length failures carry hand-tuned messages from the
 * shared primitives; everything else collapses to `validation_failed`.
 */
const VALIDATION_MESSAGE_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  validation_failed: 'validation_failed',
  rating_out_of_range: 'rating_out_of_range',
  note_length_invalid: 'note_length_invalid',
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function experienceLogRoutes(
  options: ExperienceLogRoutesOptions,
): FastifyPluginAsync {
  const clock = options.clock ?? (() => new Date());

  return async function experienceLogRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // --- POST /me/experiences/:id/logs (create) -------------------------
    app.post(
      '/me/experiences/:id/logs',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(paramsSchema, request.params);
        const body = parseOrAppError(
          createExperienceLogInputSchema,
          request.body,
        );

        // R1.5: a visit cannot be recorded for a date that has not yet
        // occurred. Reject any `visitedOn` strictly later than today in the
        // caller's own time zone before any DB I/O (so no completion/rating/
        // trip-link state is written). This guard lives only here — the
        // rode-with confirmation insert copies `visited_on` from an already
        // valid originating log and is intentionally unaffected.
        validateNotFutureVisitDate(body.visitedOn, body.userTz, clock());

        const dto = await options.repo.addLog({
          userId,
          experienceId,
          visitedOn: body.visitedOn,
          userTz: body.userTz,
          rating: body.rating ?? null,
          note: body.note ?? null,
          tripId: body.tripId ?? null,
        });

        // Synchronously award any newly-earned Pins and surface them so the
        // client can celebrate (R2.1, R5.5). Best-effort — see `awardPins` doc.
        const newlyAwardedPinIds = await awardPinsSafely(
          options.awardPins,
          userId,
          request,
        );

        reply.code(201);
        return { ...dto, newlyAwardedPinIds };
      },
    );

    // --- GET /me/experiences/:id/logs (visit history) ------------------
    app.get(
      '/me/experiences/:id/logs',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(paramsSchema, request.params);
        // An empty history is a valid 200 with repeatCount 0 (R4.3).
        return options.repo.getVisitHistory(userId, experienceId);
      },
    );

    // --- DELETE /me/experiences/:id/logs/:logId ------------------------
    app.delete(
      '/me/experiences/:id/logs/:logId',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId, logId } = parseOrAppError(
          deleteParamsSchema,
          request.params,
        );

        const result = await options.repo.deleteLog(userId, experienceId, logId);
        if (!result.deleted) {
          // Missing, or owned by another User — non-probing 404 (R5.1).
          throw new AppError(
            'log_not_found',
            'No experience log with that id exists for this experience.',
          );
        }

        reply.code(204);
        reply.send();
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

/**
 * Run the optional Pin award hook without letting it fail the enclosing
 * mutation. The triggering action (log/rating/note/rode-with) has already
 * committed, so a Pin-evaluation error must not turn a successful mutation into
 * a 5xx; it is logged and the caller simply sees no newly-awarded Pins this
 * round (they will be picked up on the next evaluation). Duplicated per route
 * module — like the other route helpers here — to keep the modules independent.
 */
async function awardPinsSafely(
  awardPins: ((userId: string) => Promise<readonly string[]>) | undefined,
  userId: string,
  request: FastifyRequest,
): Promise<string[]> {
  if (awardPins === undefined) return [];
  try {
    return [...(await awardPins(userId))];
  } catch (err) {
    request.log.error({ err }, 'pin award evaluation failed');
    return [];
  }
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

/**
 * Reject a `visitedOn` strictly later than today in the caller's `userTz`
 * (R1.5). The TZ has passed the shared `ianaTzSchema` structural check; here it
 * is resolved against the live IANA database via `Intl` to derive
 * `today_in_user_tz`, and the two `YYYY-MM-DD` strings are compared
 * lexicographically (zero-padded ISO dates make string order equal calendar
 * order). Mirrors the Completion route's `completion_future_date` guard.
 */
function validateNotFutureVisitDate(
  visitedOn: string,
  userTz: string,
  now: Date,
): void {
  const todayInUserTz = formatYmdInTimeZone(now, userTz);
  if (visitedOn > todayInUserTz) {
    throw new AppError(
      'log_future_date',
      'Visit date must not be later than today in the user time zone.',
      { field: 'visitedOn' },
    );
  }
}

/**
 * Format a `Date` as `YYYY-MM-DD` in the supplied IANA time zone via
 * `Intl.DateTimeFormat` (no bundled TZ database). An unknown zone raises
 * `RangeError`, which we translate to `validation_failed` on `userTz`; an
 * unexpected Intl shape fails closed the same way rather than letting a future
 * date slip through.
 */
function formatYmdInTimeZone(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new AppError(
        'validation_failed',
        'Unknown IANA time zone identifier.',
        { field: 'userTz' },
      );
    }
    throw err;
  }

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }

  if (yyyy.length === 0 || mm.length === 0 || dd.length === 0) {
    throw new AppError(
      'validation_failed',
      'Could not resolve current date in the user time zone.',
      { field: 'userTz' },
    );
  }

  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
  const rawMessage = issue?.message ?? 'Invalid request.';
  const code: ErrorCode =
    VALIDATION_MESSAGE_TO_CODE[rawMessage] ?? 'validation_failed';
  const message =
    code === 'rating_out_of_range'
      ? 'Rating must be an integer between 1 and 10 inclusive.'
      : code === 'note_length_invalid'
        ? 'Note must be 1-2000 characters after trimming.'
        : `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, message, { field })
    : new AppError(code, message);
}
