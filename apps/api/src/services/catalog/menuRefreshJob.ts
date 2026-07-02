/**
 * Optional background restaurant-menu refresh job (Requirement 8.3).
 *
 * The shipped Catalog_Sync fetched every restaurant's menu on every run — a
 * burst of up to ~576 back-to-back Menu_Service calls that contributed to the
 * Akamai edge block. Menu retrieval is now demand-driven at read time
 * ({@link ../menuRetrieval.getMenuForRestaurant}); this job is the *optional*
 * background trickle that keeps caches warm without a burst.
 *
 * It iterates the restaurant Experiences and refreshes each one through the
 * lazy menu-retrieval seam. That seam already:
 *
 *   - decides freshness via `decideMenuFetch`, so a restaurant whose cached
 *     menu is still fresh costs only a repo read and no Menu_Service call
 *     (R8.4);
 *   - routes any actual fetch through `Facilities_Client.getMenus` →
 *     `Disney_Transport`, which acquires a lease from the shared `Rate_Limiter`
 *     before every dispatch, so the refresh is paced within the `Request_Budget`
 *     and rate-limited by the same shared limiter every other Disney caller uses
 *     (R8.3); and
 *   - swallows a per-menu fetch failure, serving any prior cached menu unchanged
 *     and recording the failure without raising (R8.5).
 *
 * On top of those guarantees this job adds a second best-effort envelope so it
 * can *never* fail an enclosing operation (R8.3): the restaurant listing is
 * wrapped in try/catch (a listing failure logs and yields an empty pass rather
 * than throwing), and every per-restaurant refresh is individually guarded so
 * one unexpected throw neither aborts the remaining restaurants nor propagates
 * to the caller. The job always resolves — it never rejects.
 *
 * Because each refresh is awaited sequentially, outbound Menu_Service requests
 * are naturally serialized and paced by the shared limiter rather than issued as
 * a burst. The job is deliberately *not* wired into a scheduler here; it is
 * exposed as a plain injectable function so the scheduler (task 10.1) or an
 * operator can invoke it, and so it is testable without real timers, network, or
 * a database.
 *
 * Validates: Requirements 8.3
 */

import type { ExperienceCategory } from '@dwt/shared';

import { createLogger } from '../../logger.js';
import type { MenuRetrieval } from './menuRetrieval.js';

// ---------------------------------------------------------------------------
// Collaborator surfaces
// ---------------------------------------------------------------------------

/** The `ExperienceCategory` value identifying restaurant Experiences. */
const RESTAURANT_CATEGORY: ExperienceCategory = 'Restaurant';

/**
 * The narrow repo surface the refresh job needs to enumerate the restaurants
 * whose menus may be stale or missing. `CatalogRepo` satisfies this
 * structurally via `listActiveExperiences({ category })`; declaring the minimal
 * shape here keeps the job decoupled from the rest of the repo surface and
 * trivially fakeable in tests.
 *
 * Only the `id` (the Experience's Internal_Id) is consumed — it is the key the
 * menu-retrieval seam serves by — so the returned rows are typed down to just
 * that field.
 */
export interface MenuRefreshRepo {
  listActiveExperiences(filters?: {
    readonly category?: ExperienceCategory;
  }): Promise<readonly { readonly id: string }[]>;
}

/**
 * The portion of the lazy menu-retrieval seam the job drives. Refreshing a
 * restaurant is exactly "serve its menu": the seam fetches through the transport
 * only when the cache is missing or stale and otherwise no-ops (R8.4), so the
 * job need not re-implement any freshness or transport logic.
 */
export type MenuRefreshRetrieval = Pick<MenuRetrieval, 'getMenuForRestaurant'>;

/** The minimal logger surface used to record best-effort outcomes (R8.3). */
export interface MenuRefreshLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

/** Dependencies for {@link createMenuRefreshJob}. */
export interface MenuRefreshJobDeps {
  /** Repo used to enumerate restaurant Experiences (by `id`). */
  readonly repo: MenuRefreshRepo;
  /** Lazy menu-retrieval seam through which each restaurant is refreshed. */
  readonly menuRetrieval: MenuRefreshRetrieval;
  /** Injectable clock; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Logger used to record best-effort outcomes; defaults to the shared logger. */
  readonly logger?: MenuRefreshLogger;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Summary of one refresh pass, returned for observability. The job never throws,
 * so this is always resolved even when the listing failed.
 *
 *   - `listed`    — how many restaurant Experiences were enumerated (0 when the
 *     listing itself failed).
 *   - `processed` — how many restaurants the seam was invoked for without an
 *     unexpected throw. Because the seam serves fresh caches without a
 *     Menu_Service call and swallows fetch failures internally (R8.4, R8.5), a
 *     processed restaurant may or may not have hit the network — the job neither
 *     knows nor needs to.
 *   - `errored`   — how many restaurants raised an unexpected error out of the
 *     seam (should be zero given R8.5, but counted defensively so the second
 *     best-effort envelope is observable).
 *   - `listingFailed` — `true` when enumerating restaurants threw; the pass then
 *     processes nothing and still resolves.
 */
export interface MenuRefreshResult {
  readonly listed: number;
  readonly processed: number;
  readonly errored: number;
  readonly listingFailed: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** The background menu-refresh job. Returned by {@link createMenuRefreshJob}. */
export interface MenuRefreshJob {
  /**
   * Run one best-effort refresh pass over every restaurant Experience. Resolves
   * with a {@link MenuRefreshResult} summary and NEVER rejects: a listing
   * failure or any per-restaurant error is caught, logged, and folded into the
   * summary so this pass can never fail an enclosing operation (R8.3).
   *
   * @param now - Optional current instant; defaults to the injected clock. Passed
   *   through to the retrieval seam so the freshness decision uses a single,
   *   consistent instant across the whole pass.
   */
  refreshStaleMenus(now?: Date): Promise<MenuRefreshResult>;
}

/**
 * Build a {@link MenuRefreshJob} from its injected collaborators.
 *
 * The returned job is stateless beyond its dependencies, so a single instance
 * can be shared. The clock and logger default to production implementations but
 * are overridable for deterministic tests.
 */
export function createMenuRefreshJob(
  deps: MenuRefreshJobDeps,
): MenuRefreshJob {
  const clock = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createLogger();

  return {
    async refreshStaleMenus(nowArg?: Date): Promise<MenuRefreshResult> {
      const now = nowArg ?? clock();

      // (1) Enumerate restaurants. A listing failure must never propagate; we
      // log it and return an empty pass (R8.3).
      let restaurants: readonly { readonly id: string }[];
      try {
        restaurants = await deps.repo.listActiveExperiences({
          category: RESTAURANT_CATEGORY,
        });
      } catch (err) {
        logger.warn(
          { err },
          'Background menu refresh: listing restaurants failed; skipping pass',
        );
        return { listed: 0, processed: 0, errored: 0, listingFailed: true };
      }

      // (2) Refresh each restaurant sequentially so outbound Menu_Service
      // requests are paced by the shared limiter rather than bursting. The
      // retrieval seam already skips fresh caches (R8.4) and swallows fetch
      // failures (R8.5); the extra guard here keeps any unexpected throw from
      // aborting the remaining restaurants or escaping the job (R8.3).
      let processed = 0;
      let errored = 0;
      for (const restaurant of restaurants) {
        try {
          await deps.menuRetrieval.getMenuForRestaurant(restaurant.id, now);
          processed += 1;
        } catch (err) {
          errored += 1;
          logger.warn(
            { err, experienceId: restaurant.id },
            'Background menu refresh: refreshing a restaurant failed; continuing',
          );
        }
      }

      logger.debug(
        { listed: restaurants.length, processed, errored },
        'Background menu refresh pass complete',
      );

      return {
        listed: restaurants.length,
        processed,
        errored,
        listingFailed: false,
      };
    },
  };
}
