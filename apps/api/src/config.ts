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
import {
  type ReminderConfig,
  parseReminderLeads,
  parseClockMinutes,
} from './services/tripBooking/reminderConfig.js';

// ---------------------------------------------------------------------------
// Env schema
// ---------------------------------------------------------------------------
//
// Required variables produce `ZodIssue`s when missing; optional variables
// declare defaults inline. `coerce.number` is used for `PORT` because env
// values are always strings.

// Coerces number or nan so that invalid strings do not fail envSchema parsing
// when photos are disabled, leaving validation to superRefine.
const permissivePhotoNumber = (defaultValue: number) =>
  z.preprocess((val) => {
    if (val === undefined || val === '') return defaultValue;
    return Number(val);
  }, z.union([z.number(), z.nan()]).default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Persistence + cache. URLs are validated for shape; the exact provider
  // behind each URL is intentionally opaque to the API code.
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Session signing/secret material. 32-character minimum keeps low-entropy
  // values out of production deployments; the actual session token format is
  // a 256-bit opaque random string per design "Session strategy".
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Shared secret for the internal sampling cron (R3).
  SAMPLING_CRON_SECRET: z
    .string()
    .min(1, 'SAMPLING_CRON_SECRET is required and must not be empty'),

  // Shared secret for the internal Pin reconciliation cron (pin-collection
  // R21.2, R21.4) — a dedicated secret per the one-secret-per-cron-endpoint
  // convention, not reused from SAMPLING_CRON_SECRET.
  PIN_RECONCILE_CRON_SECRET: z
    .string()
    .min(1, 'PIN_RECONCILE_CRON_SECRET is required and must not be empty'),

  // Shared secret for the internal Trip Booking reminders cron (trip-booking-timeline R8.10, R8.15) —
  // a dedicated secret, required and non-blank after trim, distinct from other cron secrets.
  TRIP_BOOKING_CRON_SECRET: z
    .string()
    .trim()
    .min(1, 'TRIP_BOOKING_CRON_SECRET is required and must not be empty'),

  // Trip booking reminder runner parameters (trip-booking-timeline R7, R8, R14)
  BOOKING_REMINDER_LEADS: z.string().default('eve,open'),
  BOOKING_REMINDER_CATCHUP_MINUTES: z.coerce.number().int().positive().default(180),
  BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS: z.coerce
    .number()
    .int('BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS must be an integer')
    .min(60, 'BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS must be between 60 and 599')
    .max(599, 'BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS must be between 60 and 599')
    .default(300),
  BOOKING_REMINDER_SEND_START: z.string().default('06:00'),
  BOOKING_REMINDER_SEND_END: z.string().default('23:00'),
  BOOKING_REMINDER_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // HTTP Basic authentication credentials for the internal operator Admin Panel (admin-panel R1.5).
  ADMIN_PANEL_USERNAME: z
    .string()
    .min(1, 'ADMIN_PANEL_USERNAME is required and must not be empty'),
  ADMIN_PANEL_PASSWORD: z
    .string()
    .min(1, 'ADMIN_PANEL_PASSWORD is required and must not be empty'),

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

  // Public dining-menu API the anonymous Disney website itself calls
  // (`?searchTerm={facilityId|slug}`). This is the demand-driven Menu_Service
  // source: unlike the scoped explorer-service finder, it serves menus to
  // anonymous callers, so no guest token is required. Overridable for tests;
  // validated as a well-formed absolute URL.
  DISNEY_DINING_MENU_BASE_URL: z
    .string()
    .url('DISNEY_DINING_MENU_BASE_URL must be a well-formed absolute URL')
    .default('https://disneyworld.disney.go.com/dining/dinemenu/api/menu'),

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

  // Directory for historical crowd seed HTML files (Task 7.2)
  CROWD_SEED_DIR: z.string().default('seed-data/crowd/'),

  // ---------------------------------------------------------------------------
  // Photo uploads (photo-uploads spec)
  // ---------------------------------------------------------------------------
  PHOTOS_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return false;
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    }),
  PHOTOS_FOOD_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return true;
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    }),
  PHOTOS_TRIP_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return true;
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    }),
  PHOTOS_CRON_SECRET: z.string().optional(),
  PHOTO_STORE_ENDPOINT: z.string().optional(),
  PHOTO_STORE_BUCKET: z.string().optional(),
  PHOTO_STORE_ACCESS_KEY_ID: z.string().optional(),
  PHOTO_STORE_SECRET_ACCESS_KEY: z.string().optional(),
  PHOTO_STORE_REGION: z.string().default('auto'),
  PHOTO_HARM_API_KEY: z.string().optional(),
  PHOTO_HARM_BASE_URL: z.string().default('https://api.openai.com'),
  PHOTO_HARM_MODEL: z.string().default('omni-moderation-latest'),
  PHOTO_HARM_TIMEOUT_MS: permissivePhotoNumber(15000),
  PHOTO_HARM_INVALID_IMAGE_CODES: z
    .string()
    .optional()
    .default('')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PHOTO_HARM_BAD_REQUEST_ALERT_COUNT: permissivePhotoNumber(5),
  PHOTO_HARM_SCORE_THRESHOLD: permissivePhotoNumber(0.5),
  PHOTO_HARM_CHECK_THUMB: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return true;
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    }),
  PHOTO_VISION_API_KEY: z.string().optional(),
  PHOTO_VISION_BASE_URL: z.string().default('https://generativelanguage.googleapis.com'),
  PHOTO_VISION_MODEL: z.string().default('gemini-3.5-flash-lite'),
  PHOTO_VISION_FALLBACK_MODEL: z.string().default('gemini-3.1-flash-lite'),
  PHOTO_VISION_TIMEOUT_MS: permissivePhotoNumber(20000),
  PHOTO_VISION_MIN_FOOD_CONFIDENCE: permissivePhotoNumber(0.6),
  PHOTO_VISION_MAX_PROMINENT_FACES: permissivePhotoNumber(0),
  PHOTO_VISION_MAX_TEXT_FRACTION: permissivePhotoNumber(0.25),
  PHOTOS_DAILY_UPLOAD_CAP: permissivePhotoNumber(20),
  PHOTOS_GLOBAL_DAILY_CAP: permissivePhotoNumber(2000),
  PHOTOS_MAX_PER_FOOD_LOG: permissivePhotoNumber(4),
  PHOTOS_MAX_PER_TRIP: permissivePhotoNumber(300),
  PHOTOS_MAX_FEED_POST_PHOTOS: permissivePhotoNumber(4),
  PHOTOS_MAX_BATCH: permissivePhotoNumber(10),
  PHOTOS_MAX_BYTES: permissivePhotoNumber(1048576),
  PHOTOS_MAX_THUMB_BYTES: permissivePhotoNumber(65536),
  PHOTOS_PUT_URL_TTL_SECONDS: permissivePhotoNumber(900),
  PHOTOS_GET_URL_TTL_SECONDS: permissivePhotoNumber(3600),
  PHOTOS_ADMIN_URL_TTL_SECONDS: permissivePhotoNumber(300),
  PHOTOS_UPLOAD_EXPIRY_MINUTES: permissivePhotoNumber(120),
  PHOTOS_MODERATION_MAX_ATTEMPTS: permissivePhotoNumber(6),
  PHOTOS_MODERATION_LEASE_SECONDS: permissivePhotoNumber(180),
  PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS: permissivePhotoNumber(120),
  PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS: permissivePhotoNumber(7),
  PHOTOS_MODERATION_CONCURRENCY: permissivePhotoNumber(3),
  PHOTOS_REJECTED_RETENTION_HOURS: permissivePhotoNumber(24),
  PHOTOS_REPORT_AUTOHIDE_FOOD: permissivePhotoNumber(3),
  PHOTOS_REPORT_AUTOHIDE_TRIP: permissivePhotoNumber(1),
  PHOTOS_RECAP_HIGHLIGHT_MAX: permissivePhotoNumber(6),
  PHOTOS_EXPERIENCE_STRIP_MAX: permissivePhotoNumber(8),
  PHOTOS_SWEEP_BATCH: permissivePhotoNumber(200),
  PHOTOS_SWEEP_TIME_BUDGET_MS: permissivePhotoNumber(25000),
  PHOTOS_VISION_FIELDS_RETENTION_DAYS: permissivePhotoNumber(30),
  PHOTOS_EXIF_POLICY: z.string().default('log'),
  PHOTOS_EXIF_SCAN_BYTES: permissivePhotoNumber(65536),
})
  .superRefine((data, ctx) => {
    if (data.TRIP_BOOKING_CRON_SECRET) {
      const trimmedSecret = data.TRIP_BOOKING_CRON_SECRET.trim();
      const trimmedSampling = data.SAMPLING_CRON_SECRET?.trim();
      const trimmedPins = data.PIN_RECONCILE_CRON_SECRET?.trim();
      if (trimmedSecret === trimmedSampling || trimmedSecret === trimmedPins) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TRIP_BOOKING_CRON_SECRET'],
          message:
            'TRIP_BOOKING_CRON_SECRET must not equal SAMPLING_CRON_SECRET or PIN_RECONCILE_CRON_SECRET',
        });
      }
    }

    const startM = parseClockMinutes(data.BOOKING_REMINDER_SEND_START);
    if (startM === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BOOKING_REMINDER_SEND_START'],
        message: 'BOOKING_REMINDER_SEND_START must be in HH:MM format (00:00 - 23:59)',
      });
    }

    const endM = parseClockMinutes(data.BOOKING_REMINDER_SEND_END);
    if (endM === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BOOKING_REMINDER_SEND_END'],
        message: 'BOOKING_REMINDER_SEND_END must be in HH:MM format (00:00 - 23:59)',
      });
    }

    if (startM !== null && endM !== null && startM >= endM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BOOKING_REMINDER_SEND_START'],
        message: 'BOOKING_REMINDER_SEND_START must be strictly before BOOKING_REMINDER_SEND_END',
      });
    }

    // Property 23: Photos validation applies only when PHOTOS_ENABLED is true
    if (data.PHOTOS_ENABLED) {
      if (!data.PHOTO_STORE_ENDPOINT || data.PHOTO_STORE_ENDPOINT.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_STORE_ENDPOINT'],
          message: 'PHOTO_STORE_ENDPOINT is required when PHOTOS_ENABLED is true',
        });
      }
      if (!data.PHOTO_STORE_BUCKET || data.PHOTO_STORE_BUCKET.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_STORE_BUCKET'],
          message: 'PHOTO_STORE_BUCKET is required when PHOTOS_ENABLED is true',
        });
      }
      if (!data.PHOTO_STORE_ACCESS_KEY_ID || data.PHOTO_STORE_ACCESS_KEY_ID.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_STORE_ACCESS_KEY_ID'],
          message: 'PHOTO_STORE_ACCESS_KEY_ID is required when PHOTOS_ENABLED is true',
        });
      }
      if (!data.PHOTO_STORE_SECRET_ACCESS_KEY || data.PHOTO_STORE_SECRET_ACCESS_KEY.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_STORE_SECRET_ACCESS_KEY'],
          message: 'PHOTO_STORE_SECRET_ACCESS_KEY is required when PHOTOS_ENABLED is true',
        });
      }
      if (!data.PHOTO_HARM_API_KEY || data.PHOTO_HARM_API_KEY.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_HARM_API_KEY'],
          message: 'PHOTO_HARM_API_KEY is required when PHOTOS_ENABLED is true',
        });
      }
      if (!data.PHOTOS_CRON_SECRET || data.PHOTOS_CRON_SECRET.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_CRON_SECRET'],
          message: 'PHOTOS_CRON_SECRET is required when PHOTOS_ENABLED is true',
        });
      } else {
        const photoSecret = data.PHOTOS_CRON_SECRET.trim();
        const samplingSecret = data.SAMPLING_CRON_SECRET?.trim();
        const pinsSecret = data.PIN_RECONCILE_CRON_SECRET?.trim();
        const tripSecret = data.TRIP_BOOKING_CRON_SECRET?.trim();
        if (
          photoSecret === samplingSecret ||
          photoSecret === pinsSecret ||
          photoSecret === tripSecret
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PHOTOS_CRON_SECRET'],
            message:
              'PHOTOS_CRON_SECRET must not equal SAMPLING_CRON_SECRET, PIN_RECONCILE_CRON_SECRET, or TRIP_BOOKING_CRON_SECRET',
          });
        }
      }

      if (data.PHOTOS_FOOD_ENABLED) {
        if (!data.PHOTO_VISION_API_KEY || data.PHOTO_VISION_API_KEY.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['PHOTO_VISION_API_KEY'],
            message:
              'PHOTO_VISION_API_KEY is required when PHOTOS_ENABLED and PHOTOS_FOOD_ENABLED are true',
          });
        }
      }

      const harmTimeout = data.PHOTO_HARM_TIMEOUT_MS;
      const visionTimeout = data.PHOTO_VISION_TIMEOUT_MS;
      const minLease =
        Math.ceil(Math.max(2 * harmTimeout, 2 * (3 * visionTimeout + 2000)) / 1000) + 10;
      if (data.PHOTOS_MODERATION_LEASE_SECONDS < minLease) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_MODERATION_LEASE_SECONDS'],
          message: `PHOTOS_MODERATION_LEASE_SECONDS must be at least ${minLease} seconds`,
        });
      }

      if (
        data.PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS + 24 >
        data.PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS * 24
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS'],
          message:
            'PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS + 24 must be <= PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS * 24',
        });
      }

      if (
        !Number.isInteger(data.PHOTOS_RECAP_HIGHLIGHT_MAX) ||
        data.PHOTOS_RECAP_HIGHLIGHT_MAX < 1 ||
        data.PHOTOS_RECAP_HIGHLIGHT_MAX > 24
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_RECAP_HIGHLIGHT_MAX'],
          message: 'PHOTOS_RECAP_HIGHLIGHT_MAX must be an integer from 1 to 24',
        });
      }

      if (
        !Number.isInteger(data.PHOTOS_EXPERIENCE_STRIP_MAX) ||
        data.PHOTOS_EXPERIENCE_STRIP_MAX < 1 ||
        data.PHOTOS_EXPERIENCE_STRIP_MAX > 24
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_EXPERIENCE_STRIP_MAX'],
          message: 'PHOTOS_EXPERIENCE_STRIP_MAX must be an integer from 1 to 24',
        });
      }

      if (data.PHOTOS_EXIF_POLICY !== 'log' && data.PHOTOS_EXIF_POLICY !== 'reject') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTOS_EXIF_POLICY'],
          message: "PHOTOS_EXIF_POLICY must be 'log' or 'reject'",
        });
      }
    }
  });

type EnvShape = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// AppConfig
// ---------------------------------------------------------------------------
//
// Structured, namespaced view of configuration. Consumers receive grouped
// fields (`config.database.url`, `config.redis.url`, ...) so that no other
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
  readonly session: {
    readonly secret: string;
  };
  readonly intelligence: {
    readonly samplingCronSecret: string;
    readonly crowdSeedDir: string;
  };
  readonly pins: {
    readonly reconcileCronSecret: string;
  };
  readonly tripBooking: {
    readonly cronSecret: string;
    readonly reminder: ReminderConfig;
  };
  readonly admin: {
    readonly username: string;
    readonly password: string;
  };
  readonly themeparks: {
    readonly baseUrl: string;
  };
  readonly photos: PhotoConfig;
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
    // Public dining-menu API base (demand-driven menu source, R8).
    readonly diningMenuBaseUrl: string;
    // How long a cached restaurant menu is served without a Menu_Service call (R8).
    readonly menuFreshnessMs: number;
    // Infrequent static-sync cadence, floored at 24h (R9).
    readonly syncIntervalMs: number;
  };
}

export interface PhotoConfig {
  readonly enabled: boolean;
  readonly foodEnabled: boolean;
  readonly tripEnabled: boolean;
  readonly cronSecret: string;
  readonly recapHighlightMax: number;
  readonly experienceStripMax: number;
  readonly store: {
    readonly endpoint: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly region: string;
  };
  readonly harm: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly timeoutMs: number;
    readonly invalidImageCodes: readonly string[];
    readonly badRequestAlertCount: number;
    readonly scoreThreshold: number;
    readonly checkThumb: boolean;
  };
  readonly vision: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly fallbackModel: string;
    readonly timeoutMs: number;
    readonly minFoodConfidence: number;
    readonly maxProminentFaces: number;
    readonly maxTextFraction: number;
  };
  readonly limits: {
    readonly dailyUploadCap: number;
    readonly globalDailyCap: number;
    readonly maxPerFoodLog: number;
    readonly maxPerTrip: number;
    readonly maxFeedPostPhotos: number;
    readonly maxBatch: number;
    readonly maxBytes: number;
    readonly maxThumbBytes: number;
  };
  readonly urls: {
    readonly putTtlSeconds: number;
    readonly getTtlSeconds: number;
    readonly adminTtlSeconds: number;
  };
  readonly moderation: {
    readonly uploadExpiryMinutes: number;
    readonly maxAttempts: number;
    readonly leaseSeconds: number;
    readonly needsReviewMaxAgeHours: number;
    readonly uploadPrefixExpiryDays: number;
    readonly concurrency: number;
    readonly rejectedRetentionHours: number;
  };
  readonly reports: {
    readonly autohideFood: number;
    readonly autohideTrip: number;
  };
  readonly sweep: {
    readonly batch: number;
    readonly timeBudgetMs: number;
    readonly visionFieldsRetentionDays: number;
  };
  readonly exif: {
    readonly policy: 'log' | 'reject';
    readonly scanBytes: number;
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
    session: { secret: data.SESSION_SECRET },
    intelligence: { 
      samplingCronSecret: data.SAMPLING_CRON_SECRET,
      crowdSeedDir: data.CROWD_SEED_DIR,
    },
    pins: {
      reconcileCronSecret: data.PIN_RECONCILE_CRON_SECRET,
    },
    tripBooking: {
      cronSecret: data.TRIP_BOOKING_CRON_SECRET,
      reminder: {
        leads: parseReminderLeads(data.BOOKING_REMINDER_LEADS),
        catchupMinutes: data.BOOKING_REMINDER_CATCHUP_MINUTES,
        minPassIntervalSeconds: data.BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS,
        sendStartMinutes: parseClockMinutes(data.BOOKING_REMINDER_SEND_START) ?? 360,
        sendEndMinutes: parseClockMinutes(data.BOOKING_REMINDER_SEND_END) ?? 1380,
        retentionDays: data.BOOKING_REMINDER_RETENTION_DAYS,
      },
    },
    admin: {
      username: data.ADMIN_PANEL_USERNAME,
      password: data.ADMIN_PANEL_PASSWORD,
    },
    themeparks: { baseUrl: data.THEMEPARKS_BASE_URL },
    photos: {
      enabled: data.PHOTOS_ENABLED,
      foodEnabled: data.PHOTOS_FOOD_ENABLED,
      tripEnabled: data.PHOTOS_TRIP_ENABLED,
      cronSecret: data.PHOTOS_CRON_SECRET ?? '',
      recapHighlightMax: Number.isFinite(data.PHOTOS_RECAP_HIGHLIGHT_MAX) ? data.PHOTOS_RECAP_HIGHLIGHT_MAX : 6,
      experienceStripMax: Number.isFinite(data.PHOTOS_EXPERIENCE_STRIP_MAX) ? data.PHOTOS_EXPERIENCE_STRIP_MAX : 8,
      store: {
        endpoint: data.PHOTO_STORE_ENDPOINT ?? '',
        bucket: data.PHOTO_STORE_BUCKET ?? '',
        accessKeyId: data.PHOTO_STORE_ACCESS_KEY_ID ?? '',
        secretAccessKey: data.PHOTO_STORE_SECRET_ACCESS_KEY ?? '',
        region: data.PHOTO_STORE_REGION,
      },
      harm: {
        apiKey: data.PHOTO_HARM_API_KEY ?? '',
        baseUrl: data.PHOTO_HARM_BASE_URL,
        model: data.PHOTO_HARM_MODEL,
        timeoutMs: Number.isFinite(data.PHOTO_HARM_TIMEOUT_MS) ? data.PHOTO_HARM_TIMEOUT_MS : 15000,
        invalidImageCodes: data.PHOTO_HARM_INVALID_IMAGE_CODES,
        badRequestAlertCount: Number.isFinite(data.PHOTO_HARM_BAD_REQUEST_ALERT_COUNT) ? data.PHOTO_HARM_BAD_REQUEST_ALERT_COUNT : 5,
        scoreThreshold: Number.isFinite(data.PHOTO_HARM_SCORE_THRESHOLD) ? data.PHOTO_HARM_SCORE_THRESHOLD : 0.5,
        checkThumb: data.PHOTO_HARM_CHECK_THUMB,
      },
      vision: {
        apiKey: data.PHOTO_VISION_API_KEY ?? '',
        baseUrl: data.PHOTO_VISION_BASE_URL,
        model: data.PHOTO_VISION_MODEL,
        fallbackModel: data.PHOTO_VISION_FALLBACK_MODEL,
        timeoutMs: Number.isFinite(data.PHOTO_VISION_TIMEOUT_MS) ? data.PHOTO_VISION_TIMEOUT_MS : 20000,
        minFoodConfidence: Number.isFinite(data.PHOTO_VISION_MIN_FOOD_CONFIDENCE) ? data.PHOTO_VISION_MIN_FOOD_CONFIDENCE : 0.6,
        maxProminentFaces: Number.isFinite(data.PHOTO_VISION_MAX_PROMINENT_FACES) ? data.PHOTO_VISION_MAX_PROMINENT_FACES : 0,
        maxTextFraction: Number.isFinite(data.PHOTO_VISION_MAX_TEXT_FRACTION) ? data.PHOTO_VISION_MAX_TEXT_FRACTION : 0.25,
      },
      limits: {
        dailyUploadCap: Number.isFinite(data.PHOTOS_DAILY_UPLOAD_CAP) ? data.PHOTOS_DAILY_UPLOAD_CAP : 20,
        globalDailyCap: Number.isFinite(data.PHOTOS_GLOBAL_DAILY_CAP) ? data.PHOTOS_GLOBAL_DAILY_CAP : 2000,
        maxPerFoodLog: Number.isFinite(data.PHOTOS_MAX_PER_FOOD_LOG) ? data.PHOTOS_MAX_PER_FOOD_LOG : 4,
        maxPerTrip: Number.isFinite(data.PHOTOS_MAX_PER_TRIP) ? data.PHOTOS_MAX_PER_TRIP : 300,
        maxFeedPostPhotos: Number.isFinite(data.PHOTOS_MAX_FEED_POST_PHOTOS) ? data.PHOTOS_MAX_FEED_POST_PHOTOS : 4,
        maxBatch: Number.isFinite(data.PHOTOS_MAX_BATCH) ? data.PHOTOS_MAX_BATCH : 10,
        maxBytes: Number.isFinite(data.PHOTOS_MAX_BYTES) ? data.PHOTOS_MAX_BYTES : 1048576,
        maxThumbBytes: Number.isFinite(data.PHOTOS_MAX_THUMB_BYTES) ? data.PHOTOS_MAX_THUMB_BYTES : 65536,
      },
      urls: {
        putTtlSeconds: Number.isFinite(data.PHOTOS_PUT_URL_TTL_SECONDS) ? data.PHOTOS_PUT_URL_TTL_SECONDS : 900,
        getTtlSeconds: Number.isFinite(data.PHOTOS_GET_URL_TTL_SECONDS) ? data.PHOTOS_GET_URL_TTL_SECONDS : 3600,
        adminTtlSeconds: Number.isFinite(data.PHOTOS_ADMIN_URL_TTL_SECONDS) ? data.PHOTOS_ADMIN_URL_TTL_SECONDS : 300,
      },
      moderation: {
        uploadExpiryMinutes: Number.isFinite(data.PHOTOS_UPLOAD_EXPIRY_MINUTES) ? data.PHOTOS_UPLOAD_EXPIRY_MINUTES : 120,
        maxAttempts: Number.isFinite(data.PHOTOS_MODERATION_MAX_ATTEMPTS) ? data.PHOTOS_MODERATION_MAX_ATTEMPTS : 6,
        leaseSeconds: Number.isFinite(data.PHOTOS_MODERATION_LEASE_SECONDS) ? data.PHOTOS_MODERATION_LEASE_SECONDS : 180,
        needsReviewMaxAgeHours: Number.isFinite(data.PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS) ? data.PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS : 120,
        uploadPrefixExpiryDays: Number.isFinite(data.PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS) ? data.PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS : 7,
        concurrency: Number.isFinite(data.PHOTOS_MODERATION_CONCURRENCY) ? data.PHOTOS_MODERATION_CONCURRENCY : 3,
        rejectedRetentionHours: Number.isFinite(data.PHOTOS_REJECTED_RETENTION_HOURS) ? data.PHOTOS_REJECTED_RETENTION_HOURS : 24,
      },
      reports: {
        autohideFood: Number.isFinite(data.PHOTOS_REPORT_AUTOHIDE_FOOD) ? data.PHOTOS_REPORT_AUTOHIDE_FOOD : 3,
        autohideTrip: Number.isFinite(data.PHOTOS_REPORT_AUTOHIDE_TRIP) ? data.PHOTOS_REPORT_AUTOHIDE_TRIP : 1,
      },
      sweep: {
        batch: Number.isFinite(data.PHOTOS_SWEEP_BATCH) ? data.PHOTOS_SWEEP_BATCH : 200,
        timeBudgetMs: Number.isFinite(data.PHOTOS_SWEEP_TIME_BUDGET_MS) ? data.PHOTOS_SWEEP_TIME_BUDGET_MS : 25000,
        visionFieldsRetentionDays: Number.isFinite(data.PHOTOS_VISION_FIELDS_RETENTION_DAYS) ? data.PHOTOS_VISION_FIELDS_RETENTION_DAYS : 30,
      },
      exif: {
        policy: (data.PHOTOS_EXIF_POLICY as 'log' | 'reject') || 'log',
        scanBytes: Number.isFinite(data.PHOTOS_EXIF_SCAN_BYTES) ? data.PHOTOS_EXIF_SCAN_BYTES : 65536,
      },
    },
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
      diningMenuBaseUrl: data.DISNEY_DINING_MENU_BASE_URL,
      menuFreshnessMs: data.MENU_FRESHNESS_MS,
      syncIntervalMs: data.CATALOG_SYNC_INTERVAL_MS,
    },
  };
}
