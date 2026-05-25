/**
 * Structured logger configuration for the API.
 *
 * Implements R6.11 (passwords are never stored or transmitted in plaintext) and
 * R7.8 (no analytics/audit on profile-deny) at the logging layer by ensuring the
 * fields that carry secrets, credentials, or PII bytes are scrubbed before any
 * log line is emitted, even if a developer accidentally hands them to a logger.
 *
 * The redactor uses two complementary layers:
 *
 *   1. `pino`'s built-in `redact.paths` — covers the explicit paths listed in
 *      the design (`req.body.password`, `req.headers.authorization`,
 *      `req.body.token`, `req.body.avatar`).
 *   2. A `formatters.log` recursive scrubber — guarantees that any field
 *      literally named `password` at any depth is replaced with the censor
 *      string before pino serializes the log entry.
 */

import pino, { type LoggerOptions } from "pino";

/** The placeholder substituted in for redacted values in log output. */
export const REDACT_CENSOR = "[REDACTED]";

/**
 * Explicit redact paths required by the design.
 *
 * The `*.password` patterns are kept as belt-and-braces against the recursive
 * scrubber; `pino`'s `redact` walks them with no allocation, so they are the
 * cheapest first line of defense for shallow shapes.
 */
export const REDACT_PATHS: readonly string[] = [
  // Required by task 2.2.
  "req.body.password",
  "req.headers.authorization",
  "req.body.token",
  "req.body.avatar",
  // `password` literal at top-level and shallow nesting (defense-in-depth;
  // deeper nesting is handled by the recursive scrubber below).
  "password",
  "*.password",
  "*.*.password",
  "*.*.*.password",
  // Defense-in-depth for common Fastify serializer shapes that omit the `req`
  // wrapper.
  "body.password",
  "body.token",
  "body.avatar",
  "headers.authorization",
];

const PASSWORD_FIELD = "password";
const MAX_SCRUB_DEPTH = 12;

/**
 * Recursively replaces the value of any field literally named `password` with
 * the redaction censor. Returns a new structure; the input is not mutated.
 *
 * The depth guard exists so that pathological self-referential structures, or
 * very deep accidental nesting, cannot turn a single log line into an infinite
 * loop. Twelve levels is well past anything the API legitimately logs.
 */
export function scrubPasswordsDeep(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SCRUB_DEPTH) return value;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => scrubPasswordsDeep(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === PASSWORD_FIELD) {
      out[key] = REDACT_CENSOR;
    } else {
      out[key] = scrubPasswordsDeep(val, depth + 1);
    }
  }
  return out;
}

/**
 * Pino logger options consumed by `buildServer` (task 2.1).
 *
 * Fastify accepts these as its `logger` option and constructs a per-request
 * child logger automatically. The `request_id` binding is added by the
 * `registerRequestId` hook in `src/plugins/requestId.ts`.
 */
export const loggerOptions: LoggerOptions = {
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: [...REDACT_PATHS],
    censor: REDACT_CENSOR,
    remove: false,
  },
  formatters: {
    log(object: Record<string, unknown>): Record<string, unknown> {
      return scrubPasswordsDeep(object) as Record<string, unknown>;
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Drop pid/hostname; we identify instances at the platform layer.
  base: null,
};

/**
 * Convenience factory for ad-hoc loggers (e.g. background workers that do not
 * own a Fastify instance). Production request logging always flows through
 * Fastify's built-in pino integration via `loggerOptions`.
 *
 * `destination` is optional and is primarily used by tests to capture emitted
 * lines without going through `process.stdout`.
 */
export function createLogger(
  opts: LoggerOptions = loggerOptions,
  destination?: pino.DestinationStream
): pino.Logger {
  return destination ? pino(opts, destination) : pino(opts);
}
