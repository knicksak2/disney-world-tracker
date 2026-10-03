/**
 * FestivalTagRepo — persistence for festival booth tags.
 *
 * Owned by catalog/festivalTags. Used by the `tag-festival-booth` CLI and read
 * by tests.
 *
 * Validates: Requirements 2.2, 2.5, 3.3, 3.5, 3.6
 */

import type { FestivalSlug, MenuDTO } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { festivalMatchingItemNames, menuMatchesFestival } from './menuMatch.js';

/**
 * Which Requirement 3 discovery signal produced a Festival_Tag (R9.1):
 * `'facet'` for the `Festival Kiosk`-faceted (temporary booth) path (R3.3),
 * `'menu'` for the menu-keyword (permanent-restaurant) path (R3.8).
 */
export type MatchKind = 'facet' | 'menu';

export interface FestivalTagRow {
  readonly experienceId: string;
  readonly festivalSlug: FestivalSlug;
  readonly festivalYear: number;
  readonly taggedAt: string;
  readonly matchKind: MatchKind;
}

export interface DiscoveredBooth {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  /** Existing tag for the target year under a DIFFERENT festival, if any (Requirement 3.5). */
  readonly conflictingTag: FestivalTagRow | null;
  /** Which signal (R3.3 vs R3.8) found this candidate (R9.1). */
  readonly matchKind: MatchKind;
  /**
   * Food_Items at this booth whose name matched the Festival's menu-keyword
   * pattern inside a matching menu group (R10.1). Empty for a `'facet'`
   * match (R10.2) — a temporary booth's dishes are never individually
   * tagged.
   */
  readonly matchingFoodItemIds: readonly string[];
}

export interface FestivalTagRepo {
  /**
   * Active, EPCOT, category=Restaurant experiences carrying either the
   * `Festival Kiosk` facet (R3.3) or a festival-named menu group (R3.8).
   * Scoped to EPCOT because every EPCOT festival's booths — temporary or
   * permanent-with-a-menu-overlay — are located there; no booth has ever been
   * observed outside EPCOT (verified against this app's own tagged data).
   */
  listActiveFestivalBooths(year: number, slug: FestivalSlug): Promise<DiscoveredBooth[]>;
  /**
   * Active, EPCOT, category=Restaurant experience ids (R3.10). Scoped to
   * EPCOT for the same reason as {@link listActiveFestivalBooths} — the
   * pre-discovery menu-refresh pass only needs to warm the restaurants
   * discovery can possibly match, not the ~450-restaurant full catalog.
   */
  listActiveEpcotRestaurantIds(): Promise<readonly string[]>;
  /**
   * Upsert one tag per (experienceId, year). Booths with a conflicting tag are
   * skipped unless `force` is true, in which case the existing row for that
   * year is overwritten. Returns the ids actually written (Requirement 3.4, 3.5, 3.6).
   *
   * When an entry's `matchKind` is `'menu'` and `matchingFoodItemIds` is
   * non-empty, also writes one `food_item_festival_tags` row per id, in the
   * SAME transaction as that entry's `experience_festival_tags` upsert
   * (R10.1). An entry with `matchKind: 'facet'` never writes a dish tag,
   * even if `matchingFoodItemIds` is (defensively) non-empty (R10.2).
   */
  upsertTags(
    entries: readonly {
      experienceId: string;
      year: number;
      slug: FestivalSlug;
      matchKind: MatchKind;
      matchingFoodItemIds: readonly string[];
    }[],
    opts: { force: boolean },
  ): Promise<string[]>;
  /**
   * Upsert a Festival_Edition's date window for `(slug, year)` (R9.3).
   * `endsOn: null` is interpreted as "leave the window open" and SHALL NOT
   * overwrite a previously-set `ends_on` with blank — the write only clears
   * an existing `ends_on` when the caller explicitly supplies a NEW date, by
   * omitting the WHERE guard when `endsOn` is non-null.
   */
  upsertFestivalEdition(
    slug: FestivalSlug,
    year: number,
    startsOn: string,
    endsOn: string | null,
  ): Promise<void>;
}

interface RawFacet {
  readonly id?: unknown;
  readonly name?: unknown;
}

function hasFestivalKioskFacet(groupedFacets: unknown): boolean {
  if (groupedFacets === null || typeof groupedFacets !== 'object' || Array.isArray(groupedFacets)) {
    return false;
  }
  const qs = (groupedFacets as Record<string, unknown>)['quickService'];
  if (!Array.isArray(qs)) return false;
  return qs.some((entry: unknown) => (entry as RawFacet | null)?.name === 'Festival Kiosk');
}

async function listActiveFestivalBooths(
  pool: DbPool,
  year: number,
  slug: FestivalSlug,
): Promise<DiscoveredBooth[]> {
  // LEFT JOIN experience_menus so a Restaurant can also be discovered via a
  // festival-named menu group (R3.8) even when it carries no `Festival Kiosk`
  // facet — several permanent restaurants (Tangierine Cafe, Marketplace -
  // Hawai'i, Swirled Showcase, La Poutinerie, Regal Eagle Smokehouse, Block &
  // Hans) were verified to carry genuine festival menu items without that
  // facet. The menu-keyword predicate is festival-specific (R3.9), so this
  // join's filter is parameterized by the currently-selected `slug`, not just
  // the facet rule.
  const expRes = await pool.query<{
    id: string;
    name: string;
    park: string | null;
    grouped_facets: unknown;
    menus: readonly MenuDTO[] | null;
  }>(
    `SELECT e.id, e.name, e.park, e.grouped_facets, m.menus
       FROM experiences e
       LEFT JOIN experience_menus m ON m.experience_id = e.id
      WHERE e.active = TRUE AND e.category = 'Restaurant' AND e.park = 'EPCOT'
      ORDER BY e.name ASC`,
  );

  // Classify each candidate by discovery signal (R9.1) and, for a 'menu'
  // match, the matching dish NAMES (R10.1) — resolved to food_items.id below.
  const candidates = expRes.rows
    .map((row) => {
      const isFacetMatch = hasFestivalKioskFacet(row.grouped_facets);
      // The discovery match itself is on the GROUP name alone (R3.8, R3.9) —
      // a matching group with zero (or not-yet-synced) items still means
      // this restaurant serves festival food this year. `matchingNames` is
      // only used below to resolve WHICH dishes get a per-dish tag (R10.1);
      // it may legitimately be empty for a matched group.
      const isMenuMatch = !isFacetMatch && menuMatchesFestival(row.menus ?? [], slug);
      const matchingNames = isMenuMatch ? festivalMatchingItemNames(row.menus ?? [], slug) : [];
      const matchKind: MatchKind = isFacetMatch ? 'facet' : 'menu';
      const matched = isFacetMatch || isMenuMatch;
      return { row, matchKind, matchingNames, matched };
    })
    .filter((c) => c.matched);

  if (candidates.length === 0) {
    return [];
  }

  // Resolve each 'menu' candidate's matching dish names to food_items.id,
  // via one bulk query keyed by (experience_id, lower(name)) — menu-sync
  // already seeded these rows (food-item-logging R1.1) by the time this CLI
  // runs its pre-discovery menu refresh (R3.10).
  const menuCandidates = candidates.filter((c) => c.matchKind === 'menu' && c.matchingNames.length > 0);
  const foodItemIdsByExpAndLowerName = new Map<string, string>();
  if (menuCandidates.length > 0) {
    const expIds = menuCandidates.map((c) => c.row.id);
    const placeholders = expIds.map((_, i) => `$${i + 1}`).join(', ');
    const foodItemsRes = await pool.query<{ id: string; experience_id: string; name: string }>(
      `SELECT id, experience_id, name
         FROM food_items
        WHERE experience_id IN (${placeholders})`,
      expIds,
    );
    for (const row of foodItemsRes.rows) {
      foodItemIdsByExpAndLowerName.set(`${row.experience_id}:${row.name.toLowerCase()}`, row.id);
    }
  }

  const boothIds = candidates.map((c) => c.row.id);
  const placeholders = boothIds.map((_, i) => `$${i + 2}`).join(', ');
  const tagsRes = await pool.query<{
    experience_id: string;
    festival_slug: string;
    festival_year: number;
    tagged_at: Date | string;
    match_kind: MatchKind;
  }>(
    `SELECT experience_id, festival_slug, festival_year, tagged_at, match_kind
       FROM experience_festival_tags
      WHERE festival_year = $1 AND experience_id IN (${placeholders})`,
    [year, ...boothIds],
  );

  const tagsByExpId = new Map<string, {
    experience_id: string;
    festival_slug: string;
    festival_year: number;
    tagged_at: Date | string;
    match_kind: MatchKind;
  }>();
  for (const tag of tagsRes.rows) {
    tagsByExpId.set(tag.experience_id, tag);
  }

  return candidates.map(({ row: b, matchKind, matchingNames }) => {
    const existing = tagsByExpId.get(b.id);
    let conflictingTag: FestivalTagRow | null = null;
    if (existing && existing.festival_slug !== slug) {
      conflictingTag = {
        experienceId: existing.experience_id,
        festivalSlug: existing.festival_slug as FestivalSlug,
        festivalYear: existing.festival_year,
        taggedAt:
          existing.tagged_at instanceof Date
            ? existing.tagged_at.toISOString()
            : String(existing.tagged_at),
        matchKind: existing.match_kind,
      };
    }
    const matchingFoodItemIds =
      matchKind === 'menu'
        ? matchingNames
            .map((name) => foodItemIdsByExpAndLowerName.get(`${b.id}:${name.toLowerCase()}`))
            .filter((id): id is string => id !== undefined)
        : [];
    return {
      experienceId: b.id,
      name: b.name,
      park: b.park,
      conflictingTag,
      matchKind,
      matchingFoodItemIds,
    };
  });
}

async function listActiveEpcotRestaurantIds(pool: DbPool): Promise<readonly string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM experiences
      WHERE active = TRUE AND category = 'Restaurant' AND park = 'EPCOT'`,
  );
  return result.rows.map((r) => r.id);
}

async function upsertTags(
  pool: DbPool,
  entries: readonly {
    experienceId: string;
    year: number;
    slug: FestivalSlug;
    matchKind: MatchKind;
    matchingFoodItemIds: readonly string[];
  }[],
  opts: { force: boolean },
): Promise<string[]> {
  if (entries.length === 0) {
    return [];
  }

  // Deduplicate entries by (experienceId, year)
  const deduped = new Map<string, {
    experienceId: string;
    year: number;
    slug: FestivalSlug;
    matchKind: MatchKind;
    matchingFoodItemIds: readonly string[];
  }>();
  for (const entry of entries) {
    deduped.set(`${entry.experienceId}:${entry.year}`, entry);
  }

  const writtenIds: string[] = [];
  for (const entry of deduped.values()) {
    const res = await pool.query<{ experience_id: string; festival_slug: string }>(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year, match_kind)
       VALUES ($1, $2, $3, $5)
       ON CONFLICT (experience_id, festival_year) DO UPDATE
         SET festival_slug = EXCLUDED.festival_slug, tagged_at = now(), match_kind = EXCLUDED.match_kind
         WHERE $4::boolean
            OR experience_festival_tags.festival_slug = EXCLUDED.festival_slug
       RETURNING experience_id, festival_slug`,
      [entry.experienceId, entry.slug, entry.year, opts.force, entry.matchKind],
    );
    const wrote = res.rows.length > 0 && res.rows[0]?.festival_slug === entry.slug;
    if (wrote) {
      writtenIds.push(res.rows[0]!.experience_id);
    }

    // R10.1, R10.2: dish-level tags, written only for a 'menu' entry whose
    // experience tag was ACTUALLY written this call (never for 'facet' —
    // every dish at a temporary Festival Kiosk booth is already,
    // unambiguously, a festival dish, so no per-dish tag is needed for it).
    if (wrote && entry.matchKind === 'menu' && entry.matchingFoodItemIds.length > 0) {
      for (const foodItemId of entry.matchingFoodItemIds) {
        await pool.query(
          `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
           VALUES ($1, $2, $3)
           ON CONFLICT (food_item_id, festival_year) DO UPDATE
             SET festival_slug = EXCLUDED.festival_slug, tagged_at = now()
             WHERE $4::boolean
                OR food_item_festival_tags.festival_slug = EXCLUDED.festival_slug`,
          [foodItemId, entry.slug, entry.year, opts.force],
        );
      }
    }
  }

  return writtenIds;
}

async function upsertFestivalEdition(
  pool: DbPool,
  slug: FestivalSlug,
  year: number,
  startsOn: string,
  endsOn: string | null,
): Promise<void> {
  // R9.3: never overwrite a previously-set ends_on with blank. When the
  // caller supplies a non-null endsOn, the UPDATE arm always applies it;
  // when the caller supplies null, the UPDATE arm's COALESCE keeps whatever
  // ends_on already exists (or sets it to null for a brand-new row, via the
  // INSERT arm's VALUES).
  await pool.query(
    `INSERT INTO festival_editions (festival_slug, festival_year, starts_on, ends_on)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (festival_slug, festival_year) DO UPDATE
       SET starts_on = EXCLUDED.starts_on,
           ends_on = CASE
             WHEN $4::date IS NOT NULL THEN $4::date
             ELSE festival_editions.ends_on
           END,
           updated_at = now()`,
    [slug, year, startsOn, endsOn],
  );
}

export function createFestivalTagRepo(pool: DbPool): FestivalTagRepo {
  return {
    listActiveFestivalBooths: (year, slug) => listActiveFestivalBooths(pool, year, slug),
    listActiveEpcotRestaurantIds: () => listActiveEpcotRestaurantIds(pool),
    upsertTags: (entries, opts) => upsertTags(pool, entries, opts),
    upsertFestivalEdition: (slug, year, startsOn, endsOn) =>
      upsertFestivalEdition(pool, slug, year, startsOn, endsOn),
  };
}
