/**
 * `AppError` is the single domain-error type thrown by every API handler in
 * the backend. The global Fastify error hook (see `./handler.ts`) intercepts
 * any thrown `AppError`, looks the `code` up in `errorCodeToHttpStatus` from
 * `@dwt/shared`, and serializes the instance into the uniform JSON envelope
 * defined by the `ErrorEnvelope` interface.
 *
 * Why a single class:
 *   - The closed `ErrorCode` union is the source of truth for which errors
 *     can ever leave the API. By forcing every domain-error throw to go
 *     through this class, no handler can return an ad-hoc shape that drifts
 *     from the catalog.
 *   - The fields here mirror `ErrorEnvelopeBody` exactly: `code`, `message`,
 *     optional `field`, optional `details`. The hook can then construct the
 *     envelope without per-handler glue.
 *
 * Validates: Requirements R1.13, R1.24 (catalog error codes), and every
 * domain code referenced by R2.6-R2.8, R4.7-R4.8, R5.7, R5.10, R6.3-R6.10,
 * R7.6-R7.8, R8.2, R8.7-R8.11, R9.2-R9.3 — all of which surface through
 * `AppError`.
 */

import type { ErrorCode } from '@dwt/shared';

/**
 * Optional construction inputs for `AppError`. Both `field` and `details`
 * mirror the corresponding optional fields on `ErrorEnvelopeBody` and are
 * forwarded verbatim into the response envelope by the error hook.
 *
 * `cause` is plumbed through the standard `Error` constructor so callers
 * can attach an underlying error (e.g. a DB constraint violation) for log
 * context without exposing it on the wire.
 */
export interface AppErrorOptions {
  /** Optional input field that the validation error pinpoints. */
  readonly field?: string;
  /** Optional structured context attached to the envelope. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Optional underlying error preserved for logging. */
  readonly cause?: unknown;
}

export class AppError extends Error {
  /** Closed-set domain code; drives the HTTP status via the shared map. */
  public readonly code: ErrorCode;
  /** Field-level pinpoint, present when `code === 'validation_failed'` and similar. */
  public readonly field?: string;
  /** Open-ended structured context (e.g. `{ retryAfterSeconds: 900 }`). */
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    // `cause` is only forwarded when actually provided so that we don't
    // emit `cause: undefined` under `exactOptionalPropertyTypes`.
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'AppError';
    this.code = code;
    if (options.field !== undefined) {
      this.field = options.field;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
    // Restore the prototype chain across transpilation targets so that
    // `instanceof AppError` works in handlers compiled to older targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
