/**
 * Shared SQL + row-mapping for the Qualifying_Visit computation's repo read
 * (festival-booth-tagging R9, R10, R11), used by BOTH `pins/repo.ts` and
 * `stats/repo.ts` so the two call sites can never diverge on the query that
 * feeds `collectQualifyingVisits`/`isQualifyingVisit` — the design's stated
 * goal for extracting this computation into its own module in the first
 * place (see `qualifyingVisit.ts`'s header comment).
 *
 * Replaces the old plain
 *
 *   SELECT DISTINCT e.upstream_entity_id
 *     FROM completions c
 *     JOIN experience_festival_tags t ON t.experience_id = c.experience_id
 *    WHERE c.user_id = $1
 *
 * which (incorrectly) treated every completion of a `match_kind = 'menu'`
 * restaurant as a lifetime festival visit.
 *
 * Validates: Requirements 9.1-9.5, 10.1-10.4, 11.1-11.3
 */

import type { FestivalSlug } from '@dwt/shared';
import type { MatchKind } from './repo.js';
import type { RawQualifyingSignalRow } from './qualifyingVisit.js';

/**
 * One raw row from {@link QUALIFYING_VISIT_SIGNAL_SQL}, as the driver returns
 * it (dates as `Date | string`, matching this app's other repos' DATE-column
 * handling).
 */
export interface RawQualifyingVisitSignalRow {
  readonly experience_id: string;
  readonly match_kind: MatchKind;
  readonly festival_slug: FestivalSlug;
  readonly festival_year: number;
  readonly completion_date: Date | string | null;
  readonly qualifying_food_log_date: Date | string | null;
  readonly edition_starts_on: Date | string | null;
  readonly edition_ends_on: Date | string | null;
}

/**
 * Every `QualifyingSignal` row the Qualifying_Visit computation (R11) needs,
 * for every `experience_festival_tags` row and every tagged experience's
 * Food_Item_Logs/completions for this User, per `design.md`'s "Repo reads
 * feeding the pure core" section.
 *
 * Takes exactly one bind parameter, `$1` = the target user id.
 */
export const QUALIFYING_VISIT_SIGNAL_SQL = `
  WITH tagged AS (
    SELECT t.id, t.experience_id, t.match_kind, t.festival_slug, t.festival_year
      FROM experience_festival_tags t
  ),
  qualifying_food_logs AS (
    -- 'facet': any Food_Item_Log at the tagged experience qualifies (R11.1).
    SELECT tg.id AS tag_id, fil.visited_on
      FROM tagged tg
      JOIN food_items fi ON fi.experience_id = tg.experience_id
      JOIN food_item_logs fil ON fil.food_item_id = fi.id AND fil.user_id = $1
     WHERE tg.match_kind = 'facet'
     UNION ALL
    -- 'menu': only a Food_Item_Log on a food_item carrying a matching dish
    -- tag for the SAME (slug, year) qualifies (R10.3).
    SELECT tg.id AS tag_id, fil.visited_on
      FROM tagged tg
      JOIN food_item_festival_tags ft
        ON ft.festival_slug = tg.festival_slug AND ft.festival_year = tg.festival_year
      JOIN food_items fi ON fi.id = ft.food_item_id AND fi.experience_id = tg.experience_id
      JOIN food_item_logs fil ON fil.food_item_id = fi.id AND fil.user_id = $1
     WHERE tg.match_kind = 'menu'
  )
  SELECT tg.experience_id AS experience_id,
         tg.match_kind AS match_kind,
         tg.festival_slug AS festival_slug,
         tg.festival_year AS festival_year,
         c.completed_on AS completion_date,
         qfl.visited_on AS qualifying_food_log_date,
         fe.starts_on AS edition_starts_on,
         fe.ends_on AS edition_ends_on
    FROM tagged tg
    LEFT JOIN completions c ON c.experience_id = tg.experience_id AND c.user_id = $1
    LEFT JOIN qualifying_food_logs qfl ON qfl.tag_id = tg.id
    LEFT JOIN festival_editions fe
      ON fe.festival_slug = tg.festival_slug AND fe.festival_year = tg.festival_year
`;

/** Normalize a DATE column to `YYYY-MM-DD` (UTC components for a `Date`). */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return value.toISOString().slice(0, 10);
}

/**
 * Map the driver's raw rows into the `RawQualifyingSignalRow[]`
 * `collectQualifyingVisits` consumes, normalizing every DATE column to
 * `YYYY-MM-DD`.
 */
export function toRawQualifyingSignalRows(
  rows: readonly RawQualifyingVisitSignalRow[],
): RawQualifyingSignalRow[] {
  return rows.map((row) => ({
    experienceId: row.experience_id,
    matchKind: row.match_kind,
    festivalSlug: row.festival_slug,
    festivalYear: row.festival_year,
    completionDate: row.completion_date === null ? null : toIsoDate(row.completion_date),
    qualifyingFoodLogDate:
      row.qualifying_food_log_date === null ? null : toIsoDate(row.qualifying_food_log_date),
    editionStartsOn: row.edition_starts_on === null ? null : toIsoDate(row.edition_starts_on),
    editionEndsOn: row.edition_ends_on === null ? null : toIsoDate(row.edition_ends_on),
  }));
}
