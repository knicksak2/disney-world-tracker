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
  // Validated as a well-formed absolute URL so a malformed override halts
  // startup with a message naming the offending value (R14.1, R14.5).
  THEMEPARKS_BASE_URL: z
    .string()
    .url('THEMEPARKS_BASE_URL must be a well-formed absolute URL')
    .default('https://api.themeparks.wiki/v1'),

  // Disney sources. The Sync Gateway base URL is optional and defaults to the
  // documented public endpoint (R13.1, R13.5); it is validated as a
  // well-formed absolute URL so a malformed override fails fast (R13.6).
  DISNEY_SYNC_GATEWAY_BASE_URL: z
    .string()
    .url('DISNEY_SYNC_GATEWAY_BASE_URL must be a well-formed absolute URL')
    .default('https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/'),

  // Static_Credentials for HTTP Basic auth against the Sync Gateway. Both are
  // required and must be non-empty; a missing/empty value halts startup with a
  // ConfigError naming the offending variable (R13.2, R13.3).
  DISNEY_SYNC_GATEWAY_USERNAME: z
    .string()
    .min(1, 'DISNEY_SYNC_GATEWAY_USERNAME is required and must not be empty'),
  DISNEY_SYNC_GATEWAY_PASSWORD: z
    .string()
    .min(1, 'DISNEY_SYNC_GATEWAY_PASSWORD is required and must not be empty'),

  // ---------------------------------------------------------------------------
  // Request_Budget (R2, R14.1). The shared outbound rate/concurrency limits the
  // Rate_Limiter enforces across every process that contacts Disney. Sane
  // defaults keep bursts well under Akamai's tripwire so only credentials are
  // strictly required at startup.
  // ---------------------------------------------------------------------------
  DISNEY_MAX_RPS: z.coerce.number().positive().default(5),
  DISNEY_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // ---------------------------------------------------------------------------
  // Backoff_Policy (R3, R14.1). Bounded exponential backoff with jitter applied
  // to retriable Disney failures. Defaults give ~0.5s, 1s, 2s, 4s, 8s growth
  // capped per-attempt at 30s and 2m cumulative before the transport rethrows.
  // ---------------------------------------------------------------------------
  DISNEY_BACKOFF_BASE_MS: z.coerce.number().positive().default(500),
  DISNEY_BACKOFF_FACTOR: z.coerce.number().min(1).default(2),
  DISNEY_BACKOFF_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  DISNEY_BACKOFF_MAX_DELAY_MS: z.coerce.number().positive().default(30_000),
  DISNEY_BACKOFF_MAX_TOTAL_MS: z.coerce.number().positive().default(120_000),

  // ---------------------------------------------------------------------------
  // Freshness intervals (R8, R9, R14.1). `MENU_FRESHNESS_MS` bounds how long a
  // cached restaurant menu is served without contacting the Menu_Service.
  // `CATALOG_SYNC_INTERVAL_MS` is the infrequent static-sync cadence; it
  // defaults to 24h and is floored at 24h so scheduled syncs stay rare.
  // ---------------------------------------------------------------------------
  MENU_FRESHNESS_MS: z.coerce.number().positive().default(86_400_000),
  CATALOG_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(86_400_000, 'CATALOG_SYNC_INTERVAL_MS must be at least 24h (86400000ms)')
    .default(86_400_000),
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
  readonly disney: {
    readonly syncGateway: {
      readonly baseUrl: string;
    };
    readonly credentials: {
      readonly username: string;
      readonly password: string;
    };
    // Shared outbound rate/concurrency budget the Rate_Limiter enforces (R2).
    readonly requestBudget: {
      readonly maxRequestsPerSecond: number;
      readonly maxConcurrency: number;
    };
    // Bounded exponential backoff parameters for retriable failures (R3).
    readonly backoff: {
      readonly baseDelayMs: number;
      readonly factor: number;
      readonly maxRetries: number;
      readonly maxDelayMs: number;
      readonly maxTotalDelayMs: number;
    };
    // How long a cached restaurant menu is served without a Menu_Service call (R8).
    readonly menuFreshnessMs: number;
    // Infrequent static-sync cadence, floored at 24h (R9).
    readonly syncIntervalMs: number;
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
    disney: {
      syncGateway: { baseUrl: data.DISNEY_SYNC_GATEWAY_BASE_URL },
      credentials: {
        username: data.DISNEY_SYNC_GATEWAY_USERNAME,
        password: data.DISNEY_SYNC_GATEWAY_PASSWORD,
      },
      requestBudget: {
        maxRequestsPerSecond: data.DISNEY_MAX_RPS,
        maxConcurrency: data.DISNEY_MAX_CONCURRENCY,
      },
      backoff: {
        baseDelayMs: data.DISNEY_BACKOFF_BASE_MS,
        factor: data.DISNEY_BACKOFF_FACTOR,
        maxRetries: data.DISNEY_BACKOFF_MAX_RETRIES,
        maxDelayMs: data.DISNEY_BACKOFF_MAX_DELAY_MS,
        maxTotalDelayMs: data.DISNEY_BACKOFF_MAX_TOTAL_MS,
      },
      menuFreshnessMs: data.MENU_FRESHNESS_MS,
      syncIntervalMs: data.CATALOG_SYNC_INTERVAL_MS,
    },
  };
}
