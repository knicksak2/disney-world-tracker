/**
 * Tracking_Service note routes.
 *
 * Task 10.3 of the disney-world-tracker plan. Wires the two endpoints from
 * the design's Tracking_Service "Endpoints" table that this task owns:
 *
 *   PUT    /me/experiences/:id/note    set or edit the caller's note
 *   DELETE /me/experiences/:id/note    delete the caller's note
 *
 * Both endpoints require an authenticated session: the `requireSession`
 * pre-handler from task 6.2 must populate `request.userId` before the
 * route handler runs. The routes themselves are intentionally thin — all
 * persistence is owned by the injected `NoteRepo` so the same module can
 * be exercised end-to-end against a real Postgres in integration tests
 * or against an in-memory fake in unit tests.
 *
 * Validation rules (R5.2, R5.10):
 *
 *   - The PUT body is parsed against the shared `noteInputSchema`, which
 *     trims the body and enforces 1..2000 characters with at least one
 *     non-whitespace character. Whitespace-only inputs are rejected
 *     because trimming reduces them to length 0, which fails the
 *     `min(1)` constraint and surfaces the embedded
 *     `note_length_invalid` message — which in turn maps to the
 *     `note_length_invalid` error code via `VALIDATION_MESSAGE_TO_CODE`.
 *
 *   - The path's `:id` is validated as a UUID (the experience id is a
 *     UUIDv5 of the upstream entity id per R1.7); a malformed id
 *     produces a `validation_failed` error rather than reaching the
 *     repo with an invalid value.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.10
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode, NoteDTO } from '@dwt/shared';
import { noteInputSchema, uuidSchema } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { NoteRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `noteRoutes`.
 *
 * Dependencies are passed in explicitly so the plugin can be wired in
 * `buildServer` (or in a test harness) without reaching for module-level
 * singletons. The shapes mirror the public surfaces of the peer Tracking
 * tasks 10.1/10.2 so the three sibling option blocks (completion, rating,
 * note) all share the same dependency-injection style.
 */
export interface NoteRoutesOptions {
  /** Note repository from `./repo.ts`. */
  readonly repo: NoteRepo;
  /**
   * Pre-handler from task 6.2 that authenticates the request and assigns
   * `request.userId`. Required for both routes; the handlers refuse to
   * proceed if `request.userId` is unset.
   */
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Path schema for both endpoints. The `:id` field carries the
 * Experience's stable internal id (a UUID, per R1.7). Accepting any UUID
 * keeps the schema agnostic to the v5 derivation strategy.
 */
const notePathSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/**
 * Validation issue messages produced by the shared schemas that we map
 * to specific error codes. `note_length_invalid` is embedded in
 * `noteBodySchema`'s min/max messages; anything else collapses to the
 * generic `validation_failed` code.
 */
const VALIDATION_MESSAGE_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  validation_failed: 'validation_failed',
  note_length_invalid: 'note_length_invalid',
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Tracking_Service note Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(noteRoutes({ repo, requireSession }));
 * ```
 *
 * The factory closes over the options so the returned plugin's signature
 * stays the standard `FastifyPluginAsync` and Fastify can register it
 * without bespoke typing.
 */
export function noteRoutes(options: NoteRoutesOptions): FastifyPluginAsync {
  return async function noteRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.put(
      '/me/experiences/:id/note',
      { preHandler: options.requireSession },
      (request, reply) => handlePut(options, request, reply),
    );

    app.delete(
      '/me/experiences/:id/note',
      { preHandler: options.requireSession },
      (request, reply) => handleDelete(options, request, reply),
    );
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * `PUT /me/experiences/:id/note` — UPSERT the caller's Note for the
 * Experience.
 *
 * The handler:
 *   1. Resolves the requester id from the session pre-handler. A missing
 *      `request.userId` is treated as `unauthorized` rather than silently
 *      coercing to an empty string.
 *   2. Parses the path and body with the shared schemas. The body's
 *      trim + 1..2000 + non-whitespace rule is enforced inside Zod, so
 *      whitespace-only bodies surface as `note_length_invalid` (R5.10).
 *   3. Delegates to `repo.upsertNote`, which performs the
 *      `INSERT ... ON CONFLICT DO UPDATE` so a save and an edit both
 *      reach the same code path (R5.3, R5.4, R5.5).
 *
 * Returns 200 with the persisted `NoteDTO`. The DTO carries the post-
 * write `updatedAt` so the client can render the saved-time indicator
 * without an extra round-trip.
 *
 * Validates: R5.1, R5.2, R5.3, R5.4, R5.5, R5.10
 */
async function handlePut(
  opts: NoteRoutesOptions,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<NoteDTO> {
  const userId = requireUserId(request);
  const { id: experienceId } = parseInput(notePathSchema, request.params);
  const { body } = parseInput(noteInputSchema, request.body);

  // The shared schema already trimmed the body; pass the parsed value
  // straight through to the repo so the DB stores exactly what the
  // validation rule observed.
  return opts.repo.upsertNote(userId, experienceId, body);
}

/**
 * `DELETE /me/experiences/:id/note` — remove the caller's Note for the
 * Experience.
 *
 * Returns 204 on success. Returns 404 `note_not_found` when no Note
 * exists for `(userId, experienceId)` (R5.7). The 204 is preferred over
 * 200-with-empty-body so the response is unambiguous to caches and proxies.
 *
 * Validates: R5.6, R5.7
 */
async function handleDelete(
  opts: NoteRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = requireUserId(request);
  const { id: experienceId } = parseInput(notePathSchema, request.params);

  const removed = await opts.repo.deleteNote(userId, experienceId);
  if (!removed) {
    throw new AppError(
      'note_not_found',
      'No note exists for this experience.',
    );
  }
  reply.code(204);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the requesting user's id from the request, raising `unauthorized`
 * if the session pre-handler did not supply one. Surfacing this as a
 * dedicated error (instead of relying on truthy access) avoids a much
 * subtler bug where `request.userId === undefined` silently coerces into
 * an empty-string filter on the SQL parameters.
 */
function requireUserId(request: FastifyRequest): string {
  const userId = request.userId;
  if (!userId) {
    throw new AppError('unauthorized', 'Authentication required.');
  }
  return userId;
}

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`. Mirrors
 * the helpers in `services/auth/routes.ts` and `services/catalog/routes.ts`
 * (intentionally duplicated to keep the route modules independent and to
 * dodge an import cycle).
 *
 * The first issue's path becomes the envelope's `field`. Issues whose
 * `message` matches a recognized error-catalog code (e.g.
 * `note_length_invalid` from `noteBodySchema`) surface that specific
 * code; everything else collapses to the generic `validation_failed` so
 * R5's input validation still produces a 400 with a `field` hint.
 */
function parseInput<S extends z.ZodTypeAny>(
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
 * Map a single Zod issue to an `AppError`. The function is intentionally
 * conservative: only the explicit codes embedded in the shared schemas
 * are re-emitted; anything else falls through to `validation_failed` so
 * the catch-all stays predictable.
 */
function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'Invalid request.';
  const code: ErrorCode =
    VALIDATION_MESSAGE_TO_CODE[rawMessage] ?? 'validation_failed';
  const humanMessage =
    code === 'note_length_invalid'
      ? 'Note body must be 1-2000 characters after trimming and contain at least one non-whitespace character.'
      : `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, humanMessage, { field })
    : new AppError(code, humanMessage);
}
