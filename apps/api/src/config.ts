/**
 * Application configuration loader.
 *
 * This module is the single boundary between provider-specific environment
 * variables and the rest of the API. Every other module in `apps/api` MUST
 * receive its configuration through the `AppConfig` value returned by
 * `loadConfig()` and MUST NOT read `process.env` itself, so that hosting
 * provider names never leak into application code (R: hosting-agnostic
 * architecture, see design.md "Key Design Decisions").
 *
 * The environment schema is defined with `zod` so that:
 *   1. Missing or malformed required vars fail fast at startup with a single,
 *      readable error message instead of crashing later in some unrelated
 *      handler.
 *   2. Defaults are declared in one place (e.g. `THEMEPARKS_BASE_URL` per
 *      task 2.1).
 *   3. The derived `AppConfig` shape is fully typed and immutable for
 *      downstream consumers.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Env schema
// ---------------------------------------------------------------------------
//
// Required variables produce `ZodIssue`s when missing; optional variables
// declare defaults inline. `coerce.number` is used for `PORT` because env
// values are always strings.

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Persistence + cache + object storage. URLs are validated for shape; the
  // exact provider behind each URL is intentionally opaque to the API code.
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),

  // Session signing/secret material. 32-character minimum keeps low-entropy
  // values out of production deployments; the actual session token format is
  // a 256-bit opaque random string per design "Session strategy".
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Upstream catalog source. Defaults to the public ThemeParks.wiki v1 base
  // URL per requirements glossary; overridable for tests and local fixtures.
  THEMEPARKS_BASE_URL: z
    .string()
    .url()
    .default('https://api.themeparks.wiki/v1'),
});

type EnvShape = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// AppConfig
// ---------------------------------------------------------------------------
//
// Structured, namespaced view of configuration. Consumers receive grouped
// fields (`config.database.url`, `config.s3.bucket`, ...) so that no other
// module ever needs to know an env-var name. This makes provider swaps a
// hosting-only change.

export interface AppConfig {
  readonly env: EnvShape['NODE_ENV'];
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly logLevel: EnvShape['LOG_LEVEL'];
  };
  readonly database: {
    readonly url: string;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly session: {
    readonly secret: string;
  };
  readonly themeparks: {
    readonly baseUrl: string;
  };
}

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------
//
// Distinct error class so `loadConfig()` failures are easy to catch and
// format at the entrypoint without misclassifying them as runtime/internal
// errors.

export class ConfigError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n  - ${issues.join('\n  - ')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------
//
// Parses the supplied environment dictionary (defaulting to `process.env`)
// and returns the structured `AppConfig`. Throws `ConfigError` on any
// validation failure with one issue line per offending field.
//
// Accepting an injected `env` keeps `loadConfig` pure and trivially testable
// without monkey-patching `process.env`.

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  const data = parsed.data;
  return {
    env: data.NODE_ENV,
    server: {
      host: data.HOST,
      port: data.PORT,
      logLevel: data.LOG_LEVEL,
    },
    database: { url: data.DATABASE_URL },
    redis: { url: data.REDIS_URL },
    s3: {
      endpoint: data.S3_ENDPOINT,
      bucket: data.S3_BUCKET,
      accessKeyId: data.S3_ACCESS_KEY_ID,
      secretAccessKey: data.S3_SECRET_ACCESS_KEY,
    },
    session: { secret: data.SESSION_SECRET },
    themeparks: { baseUrl: data.THEMEPARKS_BASE_URL },
  };
}
