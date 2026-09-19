/**
 * Resolves a canonical Park to its ThemeParks.wiki entity GUID.
 * (Requirement 9.2, design.md Section 8)
 *
 * Mirrors themeParksDirectory.ts: fetches destinations once, finds WDW,
 * indexes canonical Park enum -> park entity GUID, caches with TTL and
 * deduplicated in-flight builds, and degrades gracefully on failure.
 */

import type { Park } from '@dwt/shared';
import { createLogger } from '../../logger.js';
import type { ThemeParksClient } from '../catalog/themeparks.js';

export interface ParkGuidResolver {
  /**
   * Resolve a Park to its ThemeParks.wiki entity GUID, or null if unresolvable (R9.2).
   */
  resolveParkGuid(park: Park): Promise<string | null>;
}

export interface DirectoryLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export interface ParkGuidResolverDeps {
  /** ThemeParks client for destinations listing. */
  readonly client: ThemeParksClient;
  /** Injectable clock (ms since epoch); defaults to Date.now. */
  readonly now?: () => number;
  /** Freshness TTL in ms; defaults to 12h. */
  readonly ttlMs?: number;
  /** Logger; defaults to shared logger. */
  readonly logger?: DirectoryLogger;
  /** Matcher to identify WDW destination; defaults to /walt disney world/i. */
  readonly destinationMatcher?: (name: string) => boolean;
}

/** Default directory TTL: 12 hours. */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

const DEFAULT_DESTINATION_MATCHER = (name: string): boolean =>
  /walt disney world/i.test(name);

/**
 * Map a ThemeParks destination park name to a canonical Park enum member.
 * Mirrors the name-matching in catalog/disney/area.ts.
 */
export function matchParkName(name: string | undefined): Park | null {
  if (name === undefined) {
    return null;
  }
  const normalized = name.toLowerCase();
  if (/magic\s*kingdom/.test(normalized)) return 'Magic Kingdom';
  if (/epcot/.test(normalized)) return 'EPCOT';
  if (/hollywood\s*studios/.test(normalized)) return 'Hollywood Studios';
  if (/animal\s*kingdom/.test(normalized)) return 'Animal Kingdom';
  if (/typhoon\s*lagoon/.test(normalized)) return 'Typhoon Lagoon';
  if (/blizzard\s*beach/.test(normalized)) return 'Blizzard Beach';
  if (/disney\s*springs/.test(normalized)) return 'Disney Springs';
  return null;
}

export function createParkGuidResolver(
  deps: ParkGuidResolverDeps,
): ParkGuidResolver {
  const { client } = deps;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const logger = deps.logger ?? createLogger();
  const matchDestination = deps.destinationMatcher ?? DEFAULT_DESTINATION_MATCHER;

  let map: ReadonlyMap<Park, string> | null = null;
  let builtAtMs = 0;
  let inFlight: Promise<ReadonlyMap<Park, string>> | null = null;

  async function build(): Promise<ReadonlyMap<Park, string>> {
    const next = new Map<Park, string>();
    const { destinations } = await client.getDestinations();
    const wdw = destinations.find((d) => matchDestination(d.name));
    if (!wdw) {
      logger.warn(
        { destinationCount: destinations.length },
        'ParkGuidResolver: no Walt Disney World destination found',
      );
      return next;
    }

    const parks = wdw.parks ?? [];
    for (const park of parks) {
      const canonical = matchParkName(park.name);
      if (canonical !== null && park.id) {
        next.set(canonical, park.id);
      }
    }

    logger.debug({ entries: next.size }, 'ParkGuidResolver map built');
    return next;
  }

  async function ensureFresh(): Promise<ReadonlyMap<Park, string>> {
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
        logger.warn({ err }, 'ParkGuidResolver build failed');
        return map ?? new Map<Park, string>();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    async resolveParkGuid(park: Park): Promise<string | null> {
      const current = await ensureFresh();
      return current.get(park) ?? null;
    },
  };
}
