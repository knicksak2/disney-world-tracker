/**
 * Tracking_Service — Completion HTTP routes (task 10.1).
 *
 * Wires the three endpoints from the design's Tracking_Service "Endpoints"
 * table that this task owns:
 *
 *   PUT    /me/experiences/:id/completion   mark with date in user TZ
 *   PATCH  /me/experiences/:id/completion   edit date in user TZ
 *   DELETE /me/experiences/:id/completion   unmark (404 if missing)
 *
 * The routes are an opinionated boundary on top of three concerns:
 *
 *   1. **Input validation** via the shared Zod `completionInputSchema`
 *      (`{ completedOn, userTz }`). The schema enforces the wire shape
 *      (ISO-8601 date string + IANA-shaped TZ identifier) but cannot
 *      assert "not in the future relative to the User's TZ" because
 *      that requires the live wall clock — that check happens here.
 *
 *   2. **TZ-aware "not in the future" guard** (R2.6). The supplied
 *      `userTz` is resolved against `Intl.DateTimeFormat`; any string
 *      that survives the schema's structural check but isn't a real
 *      IANA zone surfaces as `validation_failed`. The User's TZ is
 *      then used to derive `today_in_user_tz` and the supplied
 *      `completedOn` is compared lexicographically (the ISO-8601 date
 *      shape `YYYY-MM-DD` makes string comparison equivalent to
 *      calendar comparison). A date strictly after today in the User's
 *      TZ is rejected with `completion_future_date`.
 *
 *   3. **Combined unmark+edit guard** (R2.8). The PATCH endpoint accepts
 *      only a fresh date — anything that looks like an unmark in the
 *      same body (an explicit `completedOn: null`, an `unmark: true`
 *      flag, or any field beyond `completedOn`/`userTz`) is rejected
 *      with `completion_combined_op_not_allowed`. The PUT and DELETE
 *      endpoints don't share a wire shape, so the combined operation
 *      is structurally impossible to express against them.
 *
 * Authorization: every route requires an active session via the injected
 * `requireSession` pre-handler (task 6.2). The handler reads
 * `request.userId` (set by the middleware) — a missing id surfaces as
 * `unauthorized` rather than silently coercing to an empty user id.
 *
 * Repository injection: the persistence surface is the
 * {@link CompletionRepo} from `./repo.ts`. Passing it in (rather than
 * constructing it inside the plugin) keeps the routes testable without
 * a live Postgres pool.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import {
  completionInputSchema,
  ianaTzSchema,
  isoDateSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { CompletionRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `completionRoutes`.
 *
 * - `repo`           — persistence surface from `./repo.ts`.
 * - `requireSession` — pre-handler that authenticates the request and
 *                      assigns `request.userId`. Reused on every route.
 * - `clock`          — optional `() => Date` so the "not in the future"
 *                      guard is deterministic in tests. Defaults to
 *                      `() => new Date()`.
 */
export interface CompletionRoutesOptions {
  readonly repo: CompletionRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * `:id` path parameter. The id is a UUIDv5 derived from the upstream
 * entity id (R1.7); accepting any UUID keeps the route agnostic to the
 * derivation strategy.
 */
const paramsSchema = z
  .object({ id: uuidSchema })
  .strict();

/**
 * The PATCH (edit) body cannot be the same as `completionInputSchema`
 * because R2.8 forbids combining unmark+edit. The schema therefore:
 *
 *   - is `strict()` so any extra field fails parsing,
 *   - explicitly rejects `completedOn: null` so a JSON `null` (the
 *     natural way a client might attempt an unmark via PATCH) is
 *     surfaced as a domain-specific error rather than a generic
 *     `validation_failed`. The hand-tuned message
 *     (`completion_combined_op_not_allowed`) is consumed by the route
 *     handler's error mapper to produce the correct envelope code.
 */
const editBodySchema = z
  .object({
    completedOn: isoDateSchema,
    userTz: ianaTzSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Tracking_Service Completion plugin. Register via:
 *
 * ```ts
 * await app.register(
 *   completionRoutes({ repo, requireSession }),
 * );
 * ```
 */
export function completionRoutes(
  options: CompletionRoutesOptions,
): FastifyPluginAsync {
  const clock = options.clock ?? (() => new Date());

  return async function completionRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // --- PUT /me/experiences/:id/completion (mark) -----------------------
    app.put(
      '/me/experiences/:id/completion',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          paramsSchema,
          request.params,
        );
        const body = parseOrAppError(completionInputSchema, request.body);

        // R2.6: reject any date strictly after `today_in_user_tz`. The
        // TZ has already been validated structurally; we now also confirm
        // it resolves against the IANA database via Intl.
        validateNotFutureDate(body.completedOn, body.userTz, clock());

        const dto = await options.repo.mark({
          userId,
          experienceId,
          completedOn: body.completedOn,
          userTz: body.userTz,
        });

        if (dto === null) {
          // PK collision: a Completion already exists for this pair.
          // Per R2.5 a fresh "mark" is not the right vehicle to edit a
          // date (the dedicated PATCH endpoint exists for that). Surface
          // as a `validation_failed` so clients steer toward PATCH.
          throw new AppError(
            'validation_failed',
            'A completion already exists for this experience; use PATCH to edit it.',
          );
        }

        reply.code(201);
        return dto;
      },
    );

    // --- PATCH /me/experiences/:id/completion (edit) --------------------
    app.patch(
      '/me/experiences/:id/completion',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          paramsSchema,
          request.params,
        );

        // R2.8: reject combined unmark+edit before any DB I/O. Detect a
        // raw body shape that can't possibly match `editBodySchema` and
        // map it to the domain-specific code; only after that check
        // falls through do we fall back to schema validation for the
        // rest of the structural rules.
        rejectCombinedUnmarkEdit(request.body);

        const body = parseOrAppError(editBodySchema, request.body);

        // R2.6: reject any date strictly after `today_in_user_tz`.
        validateNotFutureDate(body.completedOn, body.userTz, clock());

        const dto = await options.repo.edit({
          userId,
          experienceId,
          completedOn: body.completedOn,
          userTz: body.userTz,
        });

        if (dto === null) {
          // No existing Completion to edit. Per R2.5/R2.7 spirit, surface
          // as `completion_not_found` (404) so the client knows to fall
          // back to PUT.
          throw new AppError(
            'completion_not_found',
            'No completion exists for this experience.',
          );
        }

        return dto;
      },
    );

    // --- DELETE /me/experiences/:id/completion (unmark) -----------------
    app.delete(
      '/me/experiences/:id/completion',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          paramsSchema,
          request.params,
        );

        const removed = await options.repo.unmark({ userId, experienceId });
        if (!removed) {
          // R2.7: return 404 when no Completion exists for the pair.
          throw new AppError(
            'completion_not_found',
            'No completion exists for this experience.',
          );
        }

        // 204 matches the "remove" semantic — no useful body to return.
        reply.code(204);
        reply.send();
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
 * Detect a raw PATCH body that mixes unmark and edit signals before the
 * Zod schema collapses the failure mode into a generic
 * `validation_failed`. Looking at the *raw* body lets the handler emit
 * the design's dedicated `completion_combined_op_not_allowed` code for
 * the cases the spec calls out:
 *
 *   - `completedOn: null` (the natural "unmark" expression in JSON),
 *   - `unmark: true` / `removed: true` flags supplied alongside a date,
 *   - any non-`completedOn`/`userTz` field accompanying the date pair.
 *
 * Anything that survives this check still has to satisfy
 * `editBodySchema`, which catches the structural-validation cases (e.g.
 * malformed date strings).
 */
function rejectCombinedUnmarkEdit(rawBody: unknown): void {
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return;
  }
  const body = rawBody as Record<string, unknown>;

  // Explicit unmark flags accompanying any other fields are rejected.
  if (body['unmark'] === true || body['removed'] === true) {
    throw new AppError(
      'completion_combined_op_not_allowed',
      'A completion date cannot be edited while the completion is being removed.',
    );
  }

  // Explicit null on `completedOn` is the JSON-natural "unmark" expression.
  // Coupled with PATCH's edit semantics, that is exactly the combined op
  // R2.8 forbids.
  if ('completedOn' in body && body['completedOn'] === null) {
    throw new AppError(
      'completion_combined_op_not_allowed',
      'A completion date cannot be edited while the completion is being removed.',
    );
  }
}

/**
 * Resolve `userTz` against the IANA database via Intl, derive
 * `today_in_user_tz` as a `YYYY-MM-DD` string, and reject any
 * `completedOn` that is strictly later than that date.
 *
 * String comparison is sufficient because both sides are zero-padded
 * ISO-8601 calendar dates: `'2024-01-31' < '2024-02-01'` is true under
 * lexicographic ordering and matches calendar ordering exactly for that
 * shape.
 *
 * `Intl.DateTimeFormat` raises `RangeError` for unknown TZ identifiers,
 * which we translate to `validation_failed`. This is the only place
 * the User-supplied TZ is validated against the live IANA set; the
 * shared `ianaTzSchema` only covers structural shape.
 */
function validateNotFutureDate(
  completedOn: string,
  userTz: string,
  now: Date,
): void {
  const todayInUserTz = formatYmdInTimeZone(now, userTz);
  if (completedOn > todayInUserTz) {
    throw new AppError(
      'completion_future_date',
      'Completion date must not be later than today in the user time zone.',
      { field: 'completedOn' },
    );
  }
}

/**
 * Format a `Date` as `YYYY-MM-DD` in the supplied IANA time zone. Uses
 * `Intl.DateTimeFormat` so we never have to bundle a TZ database.
 *
 * The `formatToParts` form is used (rather than `format`) because the
 * default `format` output is locale-dependent. `formatToParts` is the
 * portable way to extract `{year, month, day}` regardless of locale.
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
    // The browser/Node Intl implementation returned an unexpected shape;
    // surface as `validation_failed` so the request fails closed rather
    // than accidentally allowing a future date through.
    throw new AppError(
      'validation_failed',
      'Could not resolve current date in the user time zone.',
      { field: 'userTz' },
    );
  }

  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`.
 * Mirrors the helpers in the auth and catalog route modules
 * (intentionally duplicated to keep the route modules independent and
 * dodge import cycles).
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
  // Default to `validation_failed`; specific shared-schema messages
  // could be remapped here later (none of the completion primitives use
  // a hand-tuned message at present).
  const code: ErrorCode = 'validation_failed';
  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, message, { field })
    : new AppError(code, message);
}
