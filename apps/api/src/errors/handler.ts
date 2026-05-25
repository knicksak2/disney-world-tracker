/**
 * Global error hook for the Fastify API.
 *
 * The hook is registered via `registerErrorHandler(server)` so it can be
 * wired by `buildServer` (task 2.1) without this file having to reach into
 * `server.ts`. Every handler in the codebase is expected to either return a
 * value or throw an `AppError`; anything else is treated as an unhandled
 * exception and surfaces as a generic `internal_error` 500.
 *
 * Behavior summary:
 *   - `AppError` instances are translated to the uniform `ErrorEnvelope`
 *     defined in `@dwt/shared`, with HTTP status drawn from
 *     `errorCodeToHttpStatus`. `field` and `details` are forwarded when
 *     present.
 *   - Fastify's own validation/parse errors are mapped to
 *     `validation_failed` (HTTP 400), so the client sees a single error
 *     shape regardless of whether validation tripped at the schema layer
 *     or in handler code.
 *   - Anything else is logged with the request id and a redacted body
 *     (the redactor is configured by task 2.2's logger setup), and
 *     responded to with a generic `internal_error` envelope. The original
 *     message is intentionally not propagated to the client to avoid
 *     leaking constraint names or stack details.
 *
 * Validates: Requirements R1.13, R1.24, plus every error code from the
 * shared catalog (auth, catalog, tracking, profile, friends, sharing).
 */

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import type { ErrorCode, ErrorEnvelope, ErrorEnvelopeBody } from '@dwt/shared';
import { errorCodeToHttpStatus } from '@dwt/shared';

import { AppError } from './AppError.js';

// ---------------------------------------------------------------------------
// Envelope construction
// ---------------------------------------------------------------------------

/**
 * Build the uniform JSON envelope from an `AppError`. Optional `field` and
 * `details` are only included when actually set, so the wire shape stays
 * minimal and matches the `ErrorEnvelopeBody` contract (both fields are
 * optional in the type).
 */
function envelopeFromAppError(err: AppError): ErrorEnvelope {
  const body: { -readonly [K in keyof ErrorEnvelopeBody]: ErrorEnvelopeBody[K] } = {
    code: err.code,
    message: err.message,
  };
  if (err.field !== undefined) {
    body.field = err.field;
  }
  if (err.details !== undefined) {
    body.details = err.details;
  }
  return { error: body };
}

/**
 * Build a generic envelope for an unhandled exception. The client sees a
 * stable, redacted message; the original error is logged separately with
 * the request id.
 */
function genericEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

// ---------------------------------------------------------------------------
// Fastify validation-error detection
// ---------------------------------------------------------------------------

/**
 * Fastify surfaces JSON-schema validation failures with `validation` set to
 * the AJV error array and `statusCode === 400`. We collapse all of those
 * into our `validation_failed` code so the client never has to distinguish
 * between "Fastify rejected the body" and "the handler rejected the body".
 *
 * Body parse errors (e.g. malformed JSON) carry codes like
 * `FST_ERR_CTP_INVALID_*` and a 4xx `statusCode`; we treat those as
 * `validation_failed` for the same reason.
 */
function isFastifyValidationError(err: FastifyError): boolean {
  if (Array.isArray(err.validation) && err.validation.length > 0) {
    return true;
  }
  if (typeof err.code === 'string' && err.code.startsWith('FST_ERR_VALIDATION')) {
    return true;
  }
  if (
    typeof err.code === 'string' &&
    err.code.startsWith('FST_ERR_CTP_') &&
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public registration helper
// ---------------------------------------------------------------------------

/**
 * Register the global error hook on a Fastify instance. Idempotent in the
 * sense that calling it twice on the same instance overwrites the prior
 * hook with an identical one — Fastify only retains one error handler per
 * scope.
 *
 * The function is intentionally a free helper rather than a Fastify plugin
 * so that `buildServer` (task 2.1) can call it directly without committing
 * to a plugin lifecycle.
 */
export function registerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1) Domain errors raised by handlers.
    if (err instanceof AppError) {
      const status = errorCodeToHttpStatus[err.code];
      const envelope = envelopeFromAppError(err);
      // Domain errors are expected operational outcomes, not bugs; log at
      // `info` so they show up in audit trails without polluting the
      // error stream.
      request.log.info(
        {
          err: { code: err.code, message: err.message, field: err.field },
          requestId: request.id,
        },
        'request rejected with domain error',
      );
      reply.code(status).send(envelope);
      return;
    }

    // 2) Fastify-emitted validation/parse errors → unified `validation_failed`.
    if (isFastifyValidationError(err)) {
      const firstField =
        Array.isArray(err.validation) && err.validation.length > 0
          ? extractFieldFromAjvPath(extractAjvPath(err.validation[0]))
          : undefined;
      const body: { -readonly [K in keyof ErrorEnvelopeBody]: ErrorEnvelopeBody[K] } = {
        code: 'validation_failed',
        message: err.message || 'Request validation failed.',
      };
      if (firstField !== undefined) {
        body.field = firstField;
      }
      const envelope: ErrorEnvelope = { error: body };
      request.log.info(
        { err: { code: 'validation_failed', message: err.message }, requestId: request.id },
        'request rejected at validation layer',
      );
      reply.code(errorCodeToHttpStatus.validation_failed).send(envelope);
      return;
    }

    // 3) Anything else is an unhandled exception. The redactor configured by
    //    the logger setup (task 2.2) strips secrets from `req.body` and
    //    headers before this log line is emitted; we add the request id and
    //    nothing else. The client sees only a generic message.
    request.log.error(
      {
        err,
        requestId: request.id,
      },
      'unhandled exception',
    );
    reply
      .code(errorCodeToHttpStatus.internal_error)
      .send(genericEnvelope('internal_error', 'An internal error occurred.'));
  });
}

/**
 * Translate an AJV instancePath like `/email` or `/profile/displayName` into
 * a flat dotted field name (`email`, `profile.displayName`). Returns
 * `undefined` for missing or root paths so that the envelope omits `field`
 * rather than emitting an empty string.
 */
function extractFieldFromAjvPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.replace(/\//g, '.');
}

/**
 * Tolerantly extract the path string from an AJV-style validation entry.
 * Newer AJV uses `instancePath`; older versions and some Fastify-shimmed
 * shapes use `dataPath`. The Fastify type for `validation` is
 * intentionally loose, so we treat the entry as `unknown` and probe both
 * field names safely.
 */
function extractAjvPath(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const instancePath = record['instancePath'];
  if (typeof instancePath === 'string') {
    return instancePath;
  }
  const dataPath = record['dataPath'];
  if (typeof dataPath === 'string') {
    return dataPath;
  }
  return undefined;
}
