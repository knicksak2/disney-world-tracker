/**
 * Lazy, throttled restaurant-menu retrieval (Requirement 8).
 *
 * The shipped Catalog_Sync fetched every restaurant's menu on every run — up to
 * ~576 back-to-back Menu_Service calls that contributed to the Akamai edge
 * block. This module replaces that with demand-driven retrieval: menus are
 * fetched from the Menu_Service only when a restaurant's menu is actually
 * requested and the cached copy is missing or past its freshness window, and
 * are served from the cache otherwise without contacting Disney at all (R8.1,
 * R8.4).
 *
 * Two pieces:
 *
 *   - {@link decideMenuFetch} — a PURE function of `(fetchedAt, now, interval)`
 *     that answers "should we fetch?". It fetches when the cache is missing
 *     (`fetchedAt === null`) or stale (`now - fetchedAt > interval`), and serves
 *     the cache when it is fresh (`now - fetchedAt <= interval`). Keeping the
 *     freshness decision pure and injectable makes it a property-test target
 *     (Property 10 / task 9.2) independent of the DB, the clock, and the
 *     Menu_Service.
 *
 *   - {@link createMenuRetrieval} — the orchestration seam
 *     ({@link MenuRetrieval.getMenuForRestaurant}). It reads the cache freshness
 *     via the repo, consults {@link decideMenuFetch}, and either serves the
 *     cached menu (R8.4) or fetches through the `Facilities_Client` (which
 *     routes through the Disney_Transport within the Request_Budget), caches the
 *     result with a fresh `fetched_at`, and serves it (R8.2). A fetch failure
 *     never propagates: the seam serves any previously cached menu unchanged and
 *     records the failure without raising (R8.5).
 *
 * Every collaborator — the repo, the Facilities_Client, the freshness interval,
 * the clock, and the logger — is injected so the seam is testable without a
 * real database, network, or wall-clock.
 *
 * Validates: Requirements 8.1, 8.2, 8.4, 8.5
 */

import type { MenuDTO } from '@dwt/shared';

import { createLogger } from '../../logger.js';
import type { FacilitiesClient } from './disney/facilitiesClient.js';
import { projectMenus } from './disney/menu.js';
import type { MenuFetchState } from './repo.js';

// ---------------------------------------------------------------------------
// Pure freshness decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a restaurant's menu must be (re-)fetched from the Menu_Service.
 *
 * Pure, total, and deterministic — it depends only on its arguments and does no
 * I/O:
 *
 *   - `fetchedAt === null` (no cached menu) ⇒ `true` (fetch on demand, R8.2).
 *   - `now - fetchedAt > interval` (cache stale) ⇒ `true` (refresh, R8.2).
 *   - `now - fetchedAt <= interval` (cache fresh) ⇒ `false` (serve cached
 *     without contacting the Menu_Service, R8.4).
 *
 * The boundary is inclusive on the "fresh" side: a menu exactly `interval` old
 * is still served from cache. Negative ages (writer/reader clock skew, i.e.
 * `now` before `fetchedAt`) yield an age `<= interval` and are treated as fresh,
 * so skew never forces a spurious fetch.
 *
 * @param fetchedAt - When the cached menu was fetched, or `null` when none.
 * @param now       - The current instant.
 * @param interval  - The freshness window in milliseconds (`menuFreshnessMs`).
 * @returns `true` when the menu should be fetched, `false` to serve the cache.
 */
export function decideMenuFetch(
  fetchedAt: Date | null,
  now: Date,
  interval: number,
): boolean {
  if (fetchedAt === null) {
    return true;
  }
  const ageMs = now.getTime() - fetchedAt.getTime();
  return ageMs > interval;
}

// ---------------------------------------------------------------------------
// Seam types
// ---------------------------------------------------------------------------

/**
 * The repo surface the menu-retrieval seam needs. `CatalogRepo` satisfies this
 * structurally; declaring the narrow shape here keeps the seam decoupled from
 * the rest of the repo surface and trivially fakeable in tests.
 */
export interface MenuRetrievalRepo {
  getMenuFetchState(experienceId: string): Promise<MenuFetchState | null>;
  upsertMenus(
    experienceId: string,
    menus: readonly MenuDTO[],
    fetchedAt: Date,
  ): Promise<void>;
}

/**
 * The Menu_Service portion of the Facilities_Client the seam depends on. Only
 * `getMenus` is needed; the request is dispatched through the Disney_Transport
 * within the Request_Budget by the client itself (R8.2, R8.3).
 */
export type MenuFetchClient = Pick<FacilitiesClient, 'getMenus'>;

/** The minimal logger surface used to record a menu fetch failure (R8.5). */
export interface MenuRetrievalLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Dependencies for {@link createMenuRetrieval}. */
export interface MenuRetrievalDeps {
  /** Repo used to read cache freshness and write refreshed menus. */
  readonly repo: MenuRetrievalRepo;
  /** Facilities_Client whose `getMenus` routes through the Disney_Transport. */
  readonly client: MenuFetchClient;
  /** Freshness window in milliseconds (`config.disney.menuFreshnessMs`, R8.4). */
  readonly freshnessMs: number;
  /** Injectable clock; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Logger used to record fetch failures; defaults to the shared logger. */
  readonly logger?: MenuRetrievalLogger;
}

/** The lazy menu-retrieval seam. Returned by {@link createMenuRetrieval}. */
export interface MenuRetrieval {
  /**
   * Serve a restaurant Experience's menu, fetching lazily when the cache is
   * missing or stale (R8.2), serving the cache when fresh (R8.4), and falling
   * back to any cached menu on a fetch failure without raising (R8.5). Returns
   * an empty array when no such Experience exists.
   *
   * @param experienceId - The restaurant Experience's Internal_Id.
   * @param now - Optional current instant; defaults to the injected clock.
   */
  getMenuForRestaurant(
    experienceId: string,
    now?: Date,
  ): Promise<readonly MenuDTO[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link MenuRetrieval} from its injected collaborators.
 *
 * The returned seam is stateless beyond its dependencies, so a single instance
 * can be shared across requests. The clock and logger default to production
 * implementations but are overridable for deterministic tests.
 */
export function createMenuRetrieval(deps: MenuRetrievalDeps): MenuRetrieval {
  const clock = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createLogger();

  return {
    async getMenuForRestaurant(
      experienceId: string,
      nowArg?: Date,
    ): Promise<readonly MenuDTO[]> {
      const now = nowArg ?? clock();

      const state = await deps.repo.getMenuFetchState(experienceId);
      // No such Experience: nothing to serve, nothing to fetch.
      if (state === null) {
        return [];
      }

      const cachedMenus = state.cached?.menus ?? [];
      const fetchedAt = state.cached?.fetchedAt ?? null;

      // Fresh cache ⇒ serve without contacting the Menu_Service (R8.4).
      if (!decideMenuFetch(fetchedAt, now, deps.freshnessMs)) {
        return cachedMenus;
      }

      // Missing or stale ⇒ fetch on demand, project, cache, and serve (R8.2).
      try {
        const raw = await deps.client.getMenus(state.upstreamEntityId);
        const menus = projectMenus(raw);
        await deps.repo.upsertMenus(experienceId, menus, now);
        return menus;
      } catch (err) {
        // R8.5: serve any previously cached menu unchanged and record the
        // failure without raising, so the enclosing read never fails.
        logger.warn(
          {
            err,
            experienceId,
            upstreamEntityId: state.upstreamEntityId,
          },
          'Menu_Service fetch failed; serving cached menu unchanged',
        );
        return cachedMenus;
      }
    },
  };
}
