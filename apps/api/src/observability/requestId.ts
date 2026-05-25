/**
 * Observability surface for request correlation, structured domain
 * events, and per-request latency metrics.
 *
 * This module is the public observability boundary referenced by task
 * 13.4 in the disney-world-tracker spec. It does three jobs:
 *
 *   1. Re-export the existing `request_id` plugin (from
 *      `src/plugins/requestId.ts`) so callers that want to wire
 *      observability find a single import site.
 *   2. Provide a `createDomainEventLogger(logger)` factory that mints
 *      an `emit(event)` function. Every per-mutation domain event the
 *      design's "Observability" section calls for —
 *      `(request_id, user_id, action, target_id, outcome)` — flows
 *      through this emitter so the structured shape is enforced in
 *      one place. Routes opt in by calling `emit({...})` after their
 *      mutation succeeds or fails; the contract is intentionally
 *      light so existing tracking/sharing/friendship/auth routes can
 *      adopt it incrementally without a sweeping refactor.
 *   3. Register an `onResponse` hook (`registerLatencyMetrics`) that
 *      emits a structured log entry containing the request id, method,
 *      route, status code, and the request's elapsed time in
 *      milliseconds. This is the foundation for the SLA alerts the
 *      design's "Latency SLOs" section calls out: histograms can be
 *      derived from these structured lines by the log pipeline without
 *      coupling the API process to a specific metrics backend.
 *
 * Provider-agnostic by design: nothing in this file references a
 * specific log aggregator or metrics service. Hosting wires the log
 * stream to whatever sink is in use (Datadog, Loki, CloudWatch, plain
 * stdout) without code changes here.
 */

import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

export {
  REQUEST_ID_HEADER,
  genRequestId,
  registerRequestId,
} from '../plugins/requestId.js';

// ---------------------------------------------------------------------------
// Domain event shape
// ---------------------------------------------------------------------------

/**
 * Outcome of a domain mutation.
 *
 * `success` — the mutation completed and persisted its effect.
 * `failure` — the mutation failed (validation, authorization, conflict,
 *             upstream error). The associated error code travels in the
 *             error envelope; the domain event records only that the
 *             mutation did not succeed.
 */
export type DomainEventOutcome = 'success' | 'failure';

/**
 * Structured per-mutation domain event.
 *
 * Field choices mirror design.md "Observability":
 *
 * - `request_id` — UUID v4 set by `registerRequestId`. Lets an
 *   operator correlate the event with the access-log line, error
 *   envelope (which echoes the same id back to the client), and any
 *   downstream worker job that inherits the id.
 * - `user_id` — the acting user's id, or `null` for anonymous routes
 *   (e.g. `POST /auth/register` before a session exists). Never
 *   contains an email address or display name; PII redaction (task
 *   2.2) covers those fields elsewhere, but this field is constrained
 *   to opaque ids so a leaked log line cannot expose identity.
 * - `action` — a stable string token identifying the mutation. Use
 *   dotted, snake-cased names anchored to the requirement that
 *   defines the mutation (e.g. `rating.set`, `rating.delete`,
 *   `completion.mark`, `share.send`). Stability matters: dashboards
 *   group on this field.
 * - `target_id` — the id of the object the mutation affects (the
 *   experience id for ratings/completions/notes, the share id for
 *   share creation, the friendship id for friend ops). `null` when
 *   the mutation has no single target (e.g. bulk delete).
 * - `outcome` — `success` or `failure` per `DomainEventOutcome`.
 */
export interface DomainEvent {
  readonly request_id: string;
  readonly user_id: string | null;
  readonly action: string;
  readonly target_id: string | null;
  readonly outcome: DomainEventOutcome;
}

/**
 * Emitter handed out by `createDomainEventLogger`. The single `emit`
 * method is the contract route handlers depend on; it returns void so
 * callers can `void emit(...)` without awaiting (logging must never
 * block the response path).
 */
export interface DomainEventLogger {
  emit(event: DomainEvent): void;
}

/**
 * Marker discriminating domain events in structured logs. Sinks can
 * filter on `event_type === "domain_mutation"` to materialize the
 * event stream without scanning every log line.
 */
export const DOMAIN_EVENT_TYPE = 'domain_mutation';

/**
 * Marker discriminating per-request latency lines in structured logs.
 * Lets dashboards build response-time histograms by filtering on
 * `event_type === "request_latency"`.
 */
export const REQUEST_LATENCY_EVENT_TYPE = 'request_latency';

/**
 * Build a `DomainEventLogger` over a pino logger.
 *
 * The factory accepts the per-instance logger (typically Fastify's
 * `app.log` or the `pino` returned by `createLogger`). The returned
 * `emit` writes one structured line per call at `info` level with the
 * shape:
 *
 * ```json
 * {
 *   "level": 30,
 *   "event_type": "domain_mutation",
 *   "request_id": "...",
 *   "user_id": "...",
 *   "action": "rating.set",
 *   "target_id": "...",
 *   "outcome": "success",
 *   "msg": "domain_event"
 * }
 * ```
 *
 * Any additional fields the caller passes on the `event` object are
 * silently discarded: enforcing the canonical shape at the emitter
 * keeps dashboards from drifting if a route adds an ad-hoc field.
 */
export function createDomainEventLogger(logger: Logger): DomainEventLogger {
  return {
    emit(event: DomainEvent): void {
      logger.info(
        {
          event_type: DOMAIN_EVENT_TYPE,
          request_id: event.request_id,
          user_id: event.user_id,
          action: event.action,
          target_id: event.target_id,
          outcome: event.outcome,
        },
        'domain_event',
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Latency metrics
// ---------------------------------------------------------------------------

/**
 * Register an `onResponse` hook that logs request duration in
 * milliseconds with the request id. The numeric `duration_ms` is the
 * unit dashboards turn into Prometheus-style histograms (the histogram
 * itself is materialized by the log pipeline, not in-process).
 *
 * The hook reads `reply.elapsedTime`, which Fastify maintains for
 * every request (it is the canonical replacement for the deprecated
 * `reply.getResponseTime()`). The value is a floating-point millisecond
 * count measured from request receipt to response send.
 *
 * `route` is taken from `request.routeOptions.url` when available
 * (the parameterized template, e.g. `/users/:id`) so dashboards can
 * group by route shape rather than every concrete URL. Falls back to
 * `request.url` when the request did not match a registered route
 * (404 path), ensuring every response produces a metric.
 *
 * Idempotent: calling twice would log two lines per response, so
 * callers should register exactly once during `buildServer`.
 */
export async function registerLatencyMetrics(
  app: FastifyInstance,
): Promise<void> {
  app.addHook('onResponse', async (request, reply) => {
    // `reply.elapsedTime` is Fastify-maintained and replaces the
    // deprecated `getResponseTime()`. Defensive coercion keeps the
    // log entry well-formed even if a plugin somehow nulls the field.
    const durationMs =
      typeof reply.elapsedTime === 'number' ? reply.elapsedTime : 0;

    // Prefer the parameterized URL template (e.g. `/users/:id`) so a
    // metrics aggregator buckets by route shape, not concrete path.
    const route = request.routeOptions?.url ?? request.url;

    request.log.info(
      {
        event_type: REQUEST_LATENCY_EVENT_TYPE,
        request_id: request.id,
        method: request.method,
        route,
        status_code: reply.statusCode,
        duration_ms: durationMs,
      },
      'request_completed',
    );
  });
}
