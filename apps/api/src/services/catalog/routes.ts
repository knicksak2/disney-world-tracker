/**
 * Catalog_Service HTTP routes.
 *
 * Wires the read endpoints from the design's section 12 "Routes" table:
 *
 *   GET /catalog                       list active Experiences (filterable),
 *                                      with a { staleCache, cacheAgeHours }
 *                                      staleness indicator (R12.1, R16.3, R16.4)
 *   GET /catalog/:experienceId         single Experience detail incl.
 *                                      enrichment + menus (R5.6, R5.7, R8.5)
 *   GET /resorts                       list active Resort DTOs (R6.8, R16.5)
 *   GET /catalog/:experienceId/live    Disney-sourced Live_Detail keyed by
 *                                      Enterprise_Id (R9.1)
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
  AreaType,
  ErrorCode,
  ExperienceCategory,
  ExperienceDTO,
  LiveDetailDTO,
  MealPeriodDTO,
  MenuDTO,
  Park,
  ResortDTO,
} from '@dwt/shared';
import {
  AREA_TYPES,
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
  readonly areaType?: AreaType;
  readonly q?: string;
  /**
   * Case-sensitive exact Land filter (R3.4). When present, the repo returns
   * only active Experiences whose persisted Land equals this value, combined
   * conjunctively with every other supplied filter (R3.7).
   */
  readonly land?: string;
}

/**
 * Outcome of the read-decision helper. Mirrors the `ReadDecision` interface
 * exported by `readDecision.ts`; we re-declare it here as a structural
 * type so this module does not have to import the helper's concrete
 * dependency types (`ReadDecisionDeps`, etc.).
 */
export interface CatalogReadDecisionResult {
  readonly staleCache: boolean;
  /**
   * Age of the cache being served, in hours, threaded into the `/catalog`
   * response so the App receives the cache's age alongside the staleness
   * indicator (R12.1). `null` when the cache was just refreshed within the
   * read deadline (no meaningful staleness to report) or when no successful
   * sync has ever run. Optional at the type level so pre-existing decision
   * stubs that only signal `staleCache` remain assignable; the route emits
   * `null` when it is absent.
   */
  readonly cacheAgeHours?: number | null;
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
 * Port owned by task 8.4 (`CatalogRepo.getMenusFor`). Returns the persisted
 * dining menus for a restaurant Experience, or an empty array for a
 * non-restaurant / a restaurant whose menu fetch returned nothing or failed
 * (R8.3, R8.4, R8.5). The detail route attaches the result to the Experience
 * detail response (R8.5).
 */
export type CatalogGetMenusFor = (
  experienceId: string,
) => Promise<readonly MenuDTO[]>;

/**
 * Port owned by task 8.4 (`CatalogRepo.listActiveResorts`). Returns the
 * active (non-soft-deleted) Resort DTOs backing `GET /resorts` (R6.8, R16.5).
 */
export type CatalogListActiveResorts = () => Promise<readonly ResortDTO[]>;

/**
 * Identifier for one Catalog_Home Destination surfaced by
 * `GET /catalog/destinations`: either one of the seven `Park` values (the four
 * theme parks, the two water parks, and Disney Springs) or the literal
 * `'Resorts'` for the single aggregate Resorts Destination. Declared
 * structurally here (mirroring the repo's `DestinationId`) so this module does
 * not import the repo's concrete types.
 */
export type CatalogDestinationId = Park | 'Resorts';

/**
 * The active-Experience count for one Destination. Mirrors the repo's
 * `DestinationCount` structurally (R3.6, R4.5, R4.6).
 */
export interface CatalogDestinationCount {
  readonly destination: CatalogDestinationId;
  readonly count: number;
}

/**
 * Port owned by task 5.2 (`CatalogRepo.listDestinationCounts`). Returns the
 * active-Experience count for each of the eight Destinations — the seven `Park`
 * Destinations counted by `park` plus the aggregate `'Resorts'` Destination
 * counting every active `Resort`-area Experience (R3.6, R4.5) — always
 * including zero-count Destinations (R4.6). `GET /catalog/destinations` is
 * registered only when this port is wired.
 */
export type CatalogListDestinationCounts = () => Promise<
  readonly CatalogDestinationCount[]
>;

/**
 * Result served by `GET /catalog/:experienceId/live`. Structurally the Disney
 * live orchestrator's result: the projected `liveDetail` (from
 * `disney/liveProject.ts`, keyed by the Experience's Enterprise_Id, R9.1), the
 * `retrievedAt` instant, a `stale` fallback indicator, and the optional
 * `upstreamLastUpdated`. Declared structurally here so the route module does
 * not depend on the live-service concrete types.
 */
export interface CatalogLiveDetailResult {
  readonly liveDetail: LiveDetailDTO;
  readonly retrievedAt: string;
  readonly stale: boolean;
  readonly upstreamLastUpdated?: string;
}

/**
 * Port that resolves an Experience's Enterprise_Id and projects its Disney
 * live documents into a {@link CatalogLiveDetailResult} (R9.1). The route is a
 * thin boundary over it: the Enterprise_Id resolution and the
 * `projectLiveDetail` call live in the injected implementation.
 *
 * Optional on {@link CatalogRoutesOptions}: while the ThemeParks.wiki-sourced
 * live route is still wired through the legacy `live/routes.ts` plugin, the
 * catalog plugin leaves `/catalog/:experienceId/live` unregistered to avoid a
 * duplicate-route registration. Once the Disney live orchestrator is composed
 * (ThemeParks.wiki retirement), wiring this port registers the endpoint here.
 */
export type CatalogGetLiveDetail = (
  experienceId: string,
) => Promise<CatalogLiveDetailResult>;

/**
 * Shape of the `GET /catalog/:experienceId` response body.
 *
 * The detail view carries the full Experience projection — the core catalog
 * fields (`id`, `name`, `park`, `category`, `description`, `imageUrl`,
 * `areaType`) plus every persisted enrichment field (`resortId`, coordinates,
 * `accessibility`, `priceTier`, `mealPeriods`) and the restaurant's `menus`
 * (R5.6, R5.7, R8.5). Each enrichment field is present only when persisted,
 * exactly as the {@link ExperienceDTO} models it; `menus` is attached from the
 * separate `getMenusFor` read and is present only when the Experience has
 * persisted menus.
 *
 * `park` is `null` for a `Resort`-area Experience with no park ancestor
 * (R4.14, R4.15). The `image_attribution` field is gone: Disney-sourced
 * imagery needs no third-party credit (R14.8).
 *
 * The `active` flag is intentionally NOT exposed: a soft-deleted Experience
 * reachable through a User's existing Completion/Rating/Note continues to
 * render through this endpoint (R10.6 preservation), and the client treats
 * every row returned here as a valid detail view.
 */
export interface ExperienceDetailResponse {
  readonly id: string;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly description: string;
  /** Representative image URL, or `null` when none is present upstream. */
  readonly imageUrl: string | null;
  /** Owning Area_Type, so the App can group by area (R5.7). */
  readonly areaType: AreaType;
  /** Referenced Resort Internal_Id for a `Resort` area (R5.7). */
  readonly resortId?: string | null;
  /** Latitude when persisted (R5.1, R5.6). */
  readonly latitude?: number | null;
  /** Longitude when persisted (R5.1, R5.6). */
  readonly longitude?: number | null;
  /** Accessibility tags when persisted (R5.3, R5.6). */
  readonly accessibility?: readonly string[];
  /** Dining price tier when persisted (R5.4, R5.6). */
  readonly priceTier?: string | null;
  /** Meal periods when persisted (R5.5, R5.6). */
  readonly mealPeriods?: readonly MealPeriodDTO[];
  /** Persisted dining menus, present only when the Experience has any (R8.5). */
  readonly menus?: readonly MenuDTO[];
  /**
   * Themed Land within a `ThemePark`/`WaterPark`, present only when persisted;
   * `null` or absent for `DisneySprings`/`Resort` Experiences and for park
   * Experiences with no resolvable Land (R3.1, R3.2, R3.3).
   */
  readonly land?: string | null;
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
  /**
   * Reads a restaurant Experience's persisted menus for the detail view
   * (R8.5). Optional so the detail route still serves without menus when a
   * harness omits it; when absent the detail response simply carries no
   * `menus` field.
   */
  readonly getMenusFor?: CatalogGetMenusFor;
  /**
   * Lists the active Resort DTOs for `GET /resorts` (R6.8, R16.5). When
   * absent, the `/resorts` route is not registered.
   */
  readonly listActiveResorts?: CatalogListActiveResorts;
  /**
   * Reports the per-Destination active-Experience counts for
   * `GET /catalog/destinations` (R3.6, R4.5, R4.6). When absent, the
   * destinations route is not registered (existing optional-port pattern).
   */
  readonly listDestinationCounts?: CatalogListDestinationCounts;
  /**
   * Projects an Experience's Disney live documents keyed by Enterprise_Id
   * (R9.1) for `GET /catalog/:experienceId/live`. When absent, the live route
   * is not registered here (it remains served by the legacy live plugin until
   * ThemeParks.wiki retirement).
   */
  readonly getLiveDetail?: CatalogGetLiveDetail;
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
 * - `areaType` is optional and validated against the AreaType enum
 *   (`ThemePark`/`WaterPark`/`DisneySprings`/`Resort`), so the browse path
 *   can present each Area in its own section (R16.3).
 * - `q` is optional and constrained to 1..100 characters by
 *   `searchQuerySchema` (length cap aligned with the shared user-search
 *   schema, kept consistent across endpoints). The trim-and-non-empty
 *   rule of R1.20 is enforced post-validation in the handler.
 * - `land` is optional and constrained to 1..200 characters, mirroring the
 *   Land persistence cap (R1.7). The route maps it to the repo's `land`
 *   filter, which applies a case-sensitive exact match (R3.4) combined
 *   conjunctively with every other supplied parameter (R3.5, R3.7).
 *
 * Invalid enum values fail the schema and surface as `validation_failed`.
 */
const catalogQuerySchema = z
  .object({
    parkId: parkSchema.optional(),
    category: experienceCategorySchema.optional(),
    areaType: z.enum(AREA_TYPES).optional(),
    q: searchQuerySchema.optional(),
    land: z.string().min(1).max(200).optional(),
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
      // throw (R12.2) is propagated by the global error hook before we
      // touch the database for the row read. When the decision returns
      // `staleCache: true`, the read is still allowed because the repo
      // has the prior successful cache contents (R12.7).
      const decision = await options.decideRead();
      const experiences = await options.listActiveExperiences(filters);

      return {
        experiences,
        // Staleness indicator (R12.1): whether the response was served from a
        // stale cache and, when known, the cache's age in hours.
        staleCache: decision.staleCache,
        cacheAgeHours: decision.cacheAgeHours ?? null,
      };
    });

    app.get('/catalog/:experienceId', async (request, reply) => {      const { experienceId } = parseDetailParams(request.params);
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
      // Attach the persisted dining menus for the detail view (R8.5). The
      // menu read is a separate port because menus live in their own table;
      // a missing port or a non-restaurant Experience yields no menus.
      const menus = options.getMenusFor
        ? await options.getMenusFor(experienceId)
        : [];
      return toDetailResponse(experience, menus);
    });

    // GET /catalog/destinations — per-Destination active-Experience counts for
    // Catalog_Home (R3.6, R4.5, R4.6). Registered only when the repo port is
    // wired (existing optional-port pattern). Fastify resolves static routes
    // ahead of parametric ones, so `/catalog/destinations` is matched here and
    // never captured by the `/catalog/:experienceId` param route regardless of
    // registration order.
    if (options.listDestinationCounts !== undefined) {
      const listDestinationCounts = options.listDestinationCounts;
      app.get('/catalog/destinations', async () => {
        // Order matters, exactly as for `GET /catalog`: decide first so a
        // `catalog_unavailable` throw with no prior cache propagates (R10.2)
        // and a stale cache is flagged (R10.1) before the counts read.
        const decision = await options.decideRead();
        const destinations = await listDestinationCounts();
        return {
          destinations,
          staleCache: decision.staleCache,
          cacheAgeHours: decision.cacheAgeHours ?? null,
        };
      });
    }

    // GET /resorts — list active Resort DTOs (R6.8, R16.5). Registered only
    // when the repo port is wired.
    if (options.listActiveResorts !== undefined) {
      const listActiveResorts = options.listActiveResorts;
      app.get('/resorts', async () => {
        const resorts = await listActiveResorts();
        return { resorts };
      });
    }

    // GET /catalog/:experienceId/live — Disney-sourced Live_Detail keyed by
    // the Experience's Enterprise_Id (R9.1). Registered only when the Disney
    // live port is wired, so it does not collide with the legacy live plugin
    // that still serves this path until ThemeParks.wiki retirement.
    if (options.getLiveDetail !== undefined) {
      const getLiveDetail = options.getLiveDetail;
      app.get('/catalog/:experienceId/live', async (request) => {
        const { experienceId } = parseDetailParams(request.params);
        // The injected implementation resolves the Enterprise_Id and runs the
        // pure Disney live projection; a failed retrieval with no cached value
        // throws `AppError('live_unavailable')` (R12.10), which the global
        // error hook turns into the uniform 503 envelope.
        return getLiveDetail(experienceId);
      });
    }
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
  if (parsed.areaType !== undefined) {
    filters.areaType = parsed.areaType;
  }
  if (parsed.q !== undefined) {
    const trimmed = parsed.q.trim();
    if (trimmed.length > 0) {
      filters.q = trimmed;
    }
  }
  if (parsed.land !== undefined) {
    filters.land = parsed.land;
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
 * response shape (which does not), attaching the separately-read dining
 * `menus` (R8.5). Every persisted enrichment field on the DTO is carried
 * through verbatim — the DTO already omits any field that was not persisted
 * (R5.6, R5.7) — while `active` is dropped and `menus` is attached only when
 * the Experience has persisted menus.
 */
function toDetailResponse(
  experience: ExperienceDTO,
  menus: readonly MenuDTO[],
): ExperienceDetailResponse {
  // Strip `active` (browse-path only); keep all other DTO fields, including
  // the present-only-when-persisted enrichment fields.
  const { active: _active, menus: _dtoMenus, ...rest } = experience;
  void _active;
  void _dtoMenus;
  return {
    ...rest,
    ...(menus.length > 0 ? { menus } : {}),
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
