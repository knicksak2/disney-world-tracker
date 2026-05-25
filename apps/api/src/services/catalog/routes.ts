/**
 * Catalog_Service HTTP routes.
 *
 * Task 9.6 of the disney-world-tracker plan. Wires the two read endpoints
 * from the design's Catalog_Service "Read endpoints" table:
 *
 *   GET /catalog                  list active Experiences (filterable)
 *   GET /catalog/:experienceId    single Experience detail view
 *
 * The plugin is a thin HTTP boundary on top of three injected ports:
 *
 *   - `decideRead` (task 9.4 `decideCatalogRead`) owns the cache-age and
 *     opportunistic-sync decision (R1.11, R1.12, R1.13, R1.24). The
 *     route awaits the decision *before* reading the experience rows so
 *     a 503 `catalog_unavailable` (no successful prior cache and upstream
 *     unreachable) short-circuits the row read entirely. The decision
 *     itself never returns the rows; it only signals whether the
 *     response must carry the `staleCache: true` flag.
 *
 *   - `listActiveExperiences` (task 9.2 `CatalogRepo.listActiveExperiences`)
 *     reads the active rows with optional `park`, `category`, and
 *     case-insensitive substring `q` filters, ordered by `park` then
 *     `lower(name)`. The ordering is established at the SQL layer so the
 *     client can group by Park for display without re-sorting (R1.17).
 *
 *   - `getExperience` (task 9.2 `CatalogRepo.getExperience`) reads the
 *     detail projection of a single Experience by stable internal id,
 *     regardless of `active`. The route layer does not gate the detail
 *     view on `active` because R1.18-R1.21 "active only" applies to the
 *     browse path; the detail view continues to serve a row a User has
 *     a Completion/Rating/Note for after that row has been retired
 *     upstream (R1.15 preservation rule).
 *
 * Inputs are validated with Zod against the shared `parkSchema`,
 * `experienceCategorySchema`, `searchQuerySchema`, and `uuidSchema`
 * primitives, so the validation rules cannot drift from the rest of the
 * codebase. The query parameter is named `parkId` per the design's
 * "Read endpoints" table; the value is a Park enum string and is mapped
 * to the repo's `park` filter on the server side.
 *
 * Validates: Requirements 1.17, 1.18, 1.19, 1.20, 1.21, 1.22
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';

import type {
  ErrorCode,
  ExperienceCategory,
  ExperienceDTO,
  Park,
} from '@dwt/shared';
import {
  experienceCategorySchema,
  parkSchema,
  searchQuerySchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Public dependency contract
// ---------------------------------------------------------------------------

/**
 * Filter set forwarded to `listActiveExperiences`. Names match the repo's
 * {@link CatalogListFilters} so the route only translates the wire-level
 * `parkId` query parameter into the internal `park` field — no other
 * adaptation is needed.
 */
export interface CatalogListFilters {
  readonly park?: Park;
  readonly category?: ExperienceCategory;
  readonly q?: string;
}

/**
 * Outcome of the read-decision helper. Mirrors the `ReadDecision` interface
 * exported by `readDecision.ts`; we re-declare it here as a structural
 * type so this module does not have to import the helper's concrete
 * dependency types (`ReadDecisionDeps`, etc.).
 */
export interface CatalogReadDecisionResult {
  readonly staleCache: boolean;
}

/**
 * Port owned by task 9.4 (`opportunistic 5-second sync race on read`).
 *
 * Implementations are expected to throw
 * `AppError('catalog_unavailable', ...)` when no successful prior cache
 * exists and upstream is unreachable so the uniform error envelope
 * produces the correct HTTP 503 response (R1.24).
 */
export type CatalogReadDecision = () => Promise<CatalogReadDecisionResult>;

/**
 * Port owned by task 9.2 (`CatalogRepo.listActiveExperiences`). The
 * filtering and ordering rules (`park`, `category`, case-insensitive
 * substring on `name`, `park ASC, lower(name) ASC`) are enforced inside
 * the repo so this module does not duplicate them.
 */
export type CatalogListActiveExperiences = (
  filters: CatalogListFilters,
) => Promise<readonly ExperienceDTO[]>;

/**
 * Port owned by task 9.2 (`CatalogRepo.getExperience`). Returns `null`
 * when no row with the supplied id exists; the route translates `null`
 * to a 404 via Fastify's standard `callNotFound()`.
 */
export type CatalogGetExperience = (
  experienceId: string,
) => Promise<ExperienceDTO | null>;

/**
 * Shape of the `GET /catalog/:experienceId` response body.
 *
 * Fields mirror the design's "single Experience detail" contract: `name`,
 * `park`, `category`, `description` are the four fields R1.22 calls out
 * for the App detail view. The internal `id` is also included because
 * the client uses it as the cache key for completions, ratings, and
 * notes; this does not violate R1.22, which lists the *minimum* set of
 * fields the App must display.
 *
 * The `active` flag is intentionally NOT exposed on the detail response:
 * a soft-deleted Experience reachable through a User's existing
 * Completion/Rating/Note continues to render through this endpoint
 * (R1.15 preservation), and the client treats every row returned here
 * as a valid detail view.
 */
export interface ExperienceDetailResponse {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly description: string;
}

/**
 * Options accepted by `catalogRoutes`. Dependencies are passed in
 * explicitly so the plugin can be wired in `buildServer` (or in a test
 * harness) without reaching for module-level singletons.
 */
export interface CatalogRoutesOptions {
  readonly decideRead: CatalogReadDecision;
  readonly listActiveExperiences: CatalogListActiveExperiences;
  readonly getExperience: CatalogGetExperience;
}

// ---------------------------------------------------------------------------
// Query and path validation schemas
// ---------------------------------------------------------------------------

/**
 * Zod schema for the `GET /catalog` query string.
 *
 * - `parkId` is optional and validated against the Park enum (R1.19). The
 *   field is named `parkId` per the design's read-endpoint table; the
 *   value is a Park enum string (e.g. `"Magic Kingdom"`), not a UUID.
 *   The route handler maps it to the repo's `park` filter.
 * - `category` is optional and validated against the ExperienceCategory
 *   enum (R1.18).
 * - `q` is optional and constrained to 1..100 characters by
 *   `searchQuerySchema` (length cap aligned with the shared user-search
 *   schema, kept consistent across endpoints). The trim-and-non-empty
 *   rule of R1.20 is enforced post-validation in the handler.
 *
 * Invalid enum values fail the schema and surface as `validation_failed`.
 */
const catalogQuerySchema = z
  .object({
    parkId: parkSchema.optional(),
    category: experienceCategorySchema.optional(),
    q: searchQuerySchema.optional(),
  })
  .strict();

/**
 * Zod schema for the `GET /catalog/:experienceId` path. The id is a UUID
 * (v5 of the upstream entity id per R1.7); accepting any UUID keeps the
 * schema agnostic to the internal-id derivation strategy.
 */
const catalogDetailParamsSchema = z
  .object({
    experienceId: uuidSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Catalog_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(
 *   catalogRoutes({ decideRead, listActiveExperiences, getExperience }),
 * );
 * ```
 *
 * The factory closes over the options so the returned plugin's signature
 * stays the standard `FastifyPluginAsync` and Fastify can register it
 * without bespoke typing.
 */
export function catalogRoutes(
  options: CatalogRoutesOptions,
): FastifyPluginAsync {
  return async function catalogRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.get('/catalog', async (request) => {
      const filters = parseListQuery(request.query);

      // Order matters: decide first so that a `catalog_unavailable`
      // throw (R1.24) is propagated by the global error hook before we
      // touch the database for the row read. When the decision returns
      // `staleCache: true`, the read is still allowed because the repo
      // has the prior successful cache contents (R1.13).
      const decision = await options.decideRead();
      const experiences = await options.listActiveExperiences(filters);

      return {
        experiences,
        staleCache: decision.staleCache,
      };
    });

    app.get('/catalog/:experienceId', async (request, reply) => {
      const { experienceId } = parseDetailParams(request.params);
      const experience = await options.getExperience(experienceId);
      if (experience === null) {
        // No catalog-specific "not found" code is defined in the shared
        // error catalog (only `catalog_unavailable` and `stale_cache`
        // exist for this domain). Defer to Fastify's standard 404 path
        // rather than misclassifying the response under an unrelated
        // domain code; the client treats a 404 here as "experience does
        // not exist" without requiring a new error code.
        reply.callNotFound();
        return reply;
      }
      return toDetailResponse(experience);
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse and normalize the `GET /catalog` query string into the repo's
 * `CatalogListFilters` shape.
 *
 * The Zod schema enforces the structural rules (enum validity, length
 * caps). Two normalization steps run after parsing:
 *
 *   1. The `q` value is trimmed. If trimming reduces the string to
 *      length 0, the field is dropped from the filter object — R1.20
 *      requires a search query to contain at least 1 non-whitespace
 *      character, so a whitespace-only query is treated as "no query"
 *      rather than rejected with a validation error. This matches the
 *      App's UX expectation that an empty search box does not raise a
 *      validation toast.
 *
 *   2. Optional fields are only set when defined so the resulting object
 *      satisfies `exactOptionalPropertyTypes`.
 *
 *   3. The wire-level `parkId` is renamed to the repo's `park` so the
 *      repo's filter contract stays internal-name only.
 */
function parseListQuery(raw: unknown): CatalogListFilters {
  const parsed = parseOrAppError(catalogQuerySchema, raw);
  const filters: { -readonly [K in keyof CatalogListFilters]: CatalogListFilters[K] } = {};
  if (parsed.parkId !== undefined) {
    filters.park = parsed.parkId;
  }
  if (parsed.category !== undefined) {
    filters.category = parsed.category;
  }
  if (parsed.q !== undefined) {
    const trimmed = parsed.q.trim();
    if (trimmed.length > 0) {
      filters.q = trimmed;
    }
  }
  return filters;
}

/**
 * Parse the `GET /catalog/:experienceId` path params.
 */
function parseDetailParams(raw: unknown): { experienceId: string } {
  return parseOrAppError(catalogDetailParamsSchema, raw);
}

/**
 * Project an `ExperienceDTO` (which carries `active`) onto the detail
 * response shape (which does not). Keeping the mapping in one place
 * makes it easy to extend later without bleeding extra fields onto the
 * wire by accident.
 */
function toDetailResponse(experience: ExperienceDTO): ExperienceDetailResponse {
  return {
    id: experience.id,
    name: experience.name,
    park: experience.park,
    category: experience.category,
    description: experience.description,
  };
}

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`. Mirrors
 * the helper in `services/auth/routes.ts` (intentionally duplicated to keep
 * the two route modules independent and to dodge an import cycle).
 *
 * The first issue's path becomes the envelope's `field`. Issues whose
 * `message` matches a recognized error-catalog code (e.g.
 * `search_query_length_invalid` from `searchQuerySchema`) surface that
 * specific code; everything else collapses to the generic
 * `validation_failed` so R1's input validation still produces a 400 with
 * a `field` hint.
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
    rawMessage === 'search_query_length_invalid'
      ? 'search_query_length_invalid'
      : 'validation_failed';
  const humanMessage =
    code === 'search_query_length_invalid'
      ? 'Search query length must be 1-100 characters.'
      : `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, humanMessage, { field })
    : new AppError(code, humanMessage);
}
