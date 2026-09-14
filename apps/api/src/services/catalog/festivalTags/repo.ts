/**
 * FestivalTagRepo — persistence for festival booth tags.
 *
 * Owned by catalog/festivalTags. Used by the `tag-festival-booth` CLI and read
 * by tests.
 *
 * Validates: Requirements 2.2, 2.5, 3.3, 3.5, 3.6
 */

import type { FestivalSlug } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';

export interface FestivalTagRow {
  readonly experienceId: string;
  readonly festivalSlug: FestivalSlug;
  readonly festivalYear: number;
  readonly taggedAt: string;
}

export interface DiscoveredBooth {
  readonly experienceId: string;
  readonly name: string;
  readonly park: string | null;
  /** Existing tag for the target year under a DIFFERENT festival, if any (Requirement 3.5). */
  readonly conflictingTag: FestivalTagRow | null;
}

export interface FestivalTagRepo {
  /** Active, category=Restaurant, `Festival Kiosk`-faceted experiences (R3.3). */
  listActiveFestivalBooths(year: number, slug: FestivalSlug): Promise<DiscoveredBooth[]>;
  /**
   * Upsert one tag per (experienceId, year). Booths with a conflicting tag are
   * skipped unless `force` is true, in which case the existing row for that
   * year is overwritten. Returns the ids actually written (Requirement 3.4, 3.5, 3.6).
   */
  upsertTags(
    entries: readonly { experienceId: string; year: number; slug: FestivalSlug }[],
    opts: { force: boolean },
  ): Promise<string[]>;
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
  const expRes = await pool.query<{
    id: string;
    name: string;
    park: string | null;
    grouped_facets: unknown;
  }>(
    `SELECT id, name, park, grouped_facets
       FROM experiences
      WHERE active = TRUE AND category = 'Restaurant'
      ORDER BY name ASC`,
  );

  const festivalBooths = expRes.rows.filter((row) => hasFestivalKioskFacet(row.grouped_facets));
  if (festivalBooths.length === 0) {
    return [];
  }

  const boothIds = festivalBooths.map((b) => b.id);
  const placeholders = boothIds.map((_, i) => `$${i + 2}`).join(', ');
  const tagsRes = await pool.query<{
    experience_id: string;
    festival_slug: string;
    festival_year: number;
    tagged_at: Date | string;
  }>(
    `SELECT experience_id, festival_slug, festival_year, tagged_at
       FROM experience_festival_tags
      WHERE festival_year = $1 AND experience_id IN (${placeholders})`,
    [year, ...boothIds],
  );

  const tagsByExpId = new Map<string, {
    experience_id: string;
    festival_slug: string;
    festival_year: number;
    tagged_at: Date | string;
  }>();
  for (const tag of tagsRes.rows) {
    tagsByExpId.set(tag.experience_id, tag);
  }

  return festivalBooths.map((b) => {
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
      };
    }
    return {
      experienceId: b.id,
      name: b.name,
      park: b.park,
      conflictingTag,
    };
  });
}

async function upsertTags(
  pool: DbPool,
  entries: readonly { experienceId: string; year: number; slug: FestivalSlug }[],
  opts: { force: boolean },
): Promise<string[]> {
  if (entries.length === 0) {
    return [];
  }

  // Deduplicate entries by (experienceId, year)
  const deduped = new Map<string, { experienceId: string; year: number; slug: FestivalSlug }>();
  for (const entry of entries) {
    deduped.set(`${entry.experienceId}:${entry.year}`, entry);
  }

  const writtenIds: string[] = [];
  for (const entry of deduped.values()) {
    const res = await pool.query<{ experience_id: string; festival_slug: string }>(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, $3)
       ON CONFLICT (experience_id, festival_year) DO UPDATE
         SET festival_slug = EXCLUDED.festival_slug, tagged_at = now()
         WHERE $4::boolean
            OR experience_festival_tags.festival_slug = EXCLUDED.festival_slug
       RETURNING experience_id, festival_slug`,
      [entry.experienceId, entry.slug, entry.year, opts.force],
    );
    if (res.rows.length > 0 && res.rows[0]?.festival_slug === entry.slug) {
      writtenIds.push(res.rows[0].experience_id);
    }
  }

  return writtenIds;
}

export function createFestivalTagRepo(pool: DbPool): FestivalTagRepo {
  return {
    listActiveFestivalBooths: (year, slug) => listActiveFestivalBooths(pool, year, slug),
    upsertTags: (entries, opts) => upsertTags(pool, entries, opts),
  };
}
