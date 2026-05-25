/**
 * Request-ID plugin.
 *
 * Attaches a UUID v4 `request_id` to every request, exposes it on the
 * per-request logger so every domain log event carries it (R-design
 * "Observability"), and echoes it back to the client in the `x-request-id`
 * response header so the uniform error envelope (task 2.3) can include the
 * same value an operator can trace in the logs.
 *
 * The module is independent of `server.ts` so task 2.1 can wire it via:
 *
 * ```ts
 * import { genRequestId, registerRequestId } from "./plugins/requestId.js";
 *
 * const app = Fastify({ logger: loggerOptions, genReqId: genRequestId });
 * await registerRequestId(app);
 * ```
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Header name used to expose the request id to the client. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Generates a UUID v4 to use as the request id.
 *
 * If the caller provides an inbound `x-request-id` value that already looks
 * like a UUID v4, we honor it so a multi-service trace can correlate;
 * otherwise we mint a fresh one. This is the function passed to Fastify's
 * `genReqId` constructor option.
 */
export function genRequestId(req?: { headers?: Record<string, unknown> }): string {
  const inbound = req?.headers?.[REQUEST_ID_HEADER];
  if (typeof inbound === "string" && isUuidV4(inbound)) {
    return inbound;
  }
  return randomUUID();
}

/**
 * Registers the `onRequest` and `onSend` hooks that bind `request_id` onto
 * the per-request logger and echo it on the response.
 *
 * Idempotent: registering twice is harmless because Fastify hooks are
 * additive, but callers should register exactly once during `buildServer`.
 */
export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Fastify already assigned `req.id` via `genReqId`; rebind the per-request
    // logger so every subsequent `req.log.*` call carries `request_id` instead
    // of pino's default `reqId`. Domain handlers should always log via
    // `req.log` (or a child of it) to inherit this binding automatically.
    req.log = req.log.child({ request_id: req.id });
    reply.header(REQUEST_ID_HEADER, String(req.id));
  });
}

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}
