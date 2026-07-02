/**
 * ThemeParks.wiki entity directory — resolves a Disney `Enterprise_Id` to the
 * ThemeParks.wiki entity id (a GUID) needed to fetch that entity's live feed.
 *
 * The live join is by `Enterprise_Id == ThemeParks externalId` (R11.2), but the
 * ThemeParks.wiki `GET /entity/{id}/live` endpoint is keyed by the entity's OWN
 * id (a GUID), NOT by its `externalId`. So before fetching live data we must
 * map the Experience's `Enterprise_Id` to the corresponding ThemeParks entity
 * id. There is no direct `externalId` lookup endpoint, so the mapping is built
 * by enumerating the Walt Disney World destination's parks and their children
 * (each child carries `id` + `externalId`) and indexing `externalId → id`.
 *
 * The directory is low-change-rate (entities are added/renamed rarely), so the
 * built map is cached in-memory with a TTL and rebuilt lazily on expiry.
 * Concurrent callers during a (re)build share a single in-flight build promise
 * so a burst of live requests triggers at most one enumeration. A build failure
 * is swallowed to an empty/stale map so the live path degrades to
 * `live_unavailable` rather than throwing.
 *
 * This module contacts ONLY ThemeParks.wiki (through the injected catalog
 * `ThemeParksClient`), never a Disney source (R11.10).
 */

import { createLogger } from '../../logger.js';
import type { ThemeParksClient } from '../catalog/themeparks.js';

/** Resolves an Experience `Enterprise_Id` to a ThemeParks.wiki entity id. */
export interface ThemeParksDirectory {
  /**
   * Resolve the ThemeParks.wiki entity id whose `externalId` equals
   * `enterpriseId` (R11.2), or `null` when no such entity exists (e.g. a resort
   * offering ThemeParks.wiki does not track). Builds/refreshes the directory
   * lazily; a build failure resolves to `null` rather than throwing.
   */
  resolveEntityId(enterpriseId: string): Promise<string | null>;
}

/** Minimal logger surface used to record directory build failures. */
export interface DirectoryLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export interface ThemeParksDirectoryDeps {
  /** Catalog ThemeParks client (destinations + children). */
  readonly client: ThemeParksClient;
  /** Injectable clock (ms since epoch); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Directory freshness window in ms; defaults to 12h. */
  readonly ttlMs?: number;
  /** Logger; defaults to the shared logger. */
  readonly logger?: DirectoryLogger;
  /**
   * Destination-name matcher used to pick the WDW destination from
   * `/destinations`. Defaults to a Walt Disney World match.
   */
  readonly destinationMatcher?: (name: string) => boolean;
}

/** Default directory TTL: 12 hours. Entities change far more slowly than this. */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

const DEFAULT_DESTINATION_MATCHER = (name: string): boolean =>
  /walt disney world/i.test(name);

/**
 * Build a {@link ThemeParksDirectory}. The map is built lazily on first
 * resolution and cached for `ttlMs`; concurrent (re)builds are de-duplicated.
 */
export function createThemeParksDirectory(
  deps: ThemeParksDirectoryDeps,
): ThemeParksDirectory {
  const { client } = deps;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const logger = deps.logger ?? createLogger();
  const matchDestination = deps.destinationMatcher ?? DEFAULT_DESTINATION_MATCHER;

  // externalId -> ThemeParks entity id. `null` until the first successful build.
  let map: ReadonlyMap<string, string> | null = null;
  let builtAtMs = 0;
  let inFlight: Promise<ReadonlyMap<string, string>> | null = null;

  /** Enumerate the WDW destination's parks and children into an externalId→id map. */
  async function build(): Promise<ReadonlyMap<string, string>> {
    const next = new Map<string, string>();
    const { destinations } = await client.getDestinations();
    const wdw = destinations.find((d) => matchDestination(d.name));
    if (wdw === undefined) {
      logger.warn(
        { destinationCount: destinations.length },
        'ThemeParks directory: no Walt Disney World destination found',
      );
      return next;
    }

    const parks = wdw.parks ?? [];
    // Index the parks themselves, then each park's children (rides, shows,
    // restaurants). A per-park failure is logged and skipped so one bad park
    // does not empty the whole directory.
    for (const park of parks) {
      try {
        const { children } = await client.getEntityChildren(park.id);
        for (const child of children) {
          if (child.externalId !== undefined && child.externalId.length > 0) {
            next.set(child.externalId, child.id);
          }
        }
      } catch (err) {
        logger.warn(
          { err, parkId: park.id, parkName: park.name },
          'ThemeParks directory: failed to enumerate a park\u2019s children',
        );
      }
    }

    logger.debug({ entries: next.size }, 'ThemeParks directory built');
    return next;
  }

  /** Ensure a fresh map, (re)building when absent or expired; dedupes builds. */
  async function ensureFresh(): Promise<ReadonlyMap<string, string>> {
    const fresh = map !== null && now() - builtAtMs <= ttlMs;
    if (fresh && map !== null) {
      return map;
    }
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = build()
      .then((built) => {
        map = built;
        builtAtMs = now();
        return built;
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'ThemeParks directory build failed');
        // Fall back to the prior map when one exists; otherwise an empty map so
        // resolution returns null and the live path degrades gracefully.
        return map ?? new Map<string, string>();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    async resolveEntityId(enterpriseId: string): Promise<string | null> {
      if (enterpriseId.length === 0) {
        return null;
      }
      const current = await ensureFresh();
      return current.get(enterpriseId) ?? null;
    },
  };
}
