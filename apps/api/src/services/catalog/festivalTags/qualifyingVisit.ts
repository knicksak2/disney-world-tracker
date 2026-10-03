/**
 * Qualifying_Visit computation (festival-booth-tagging R9.4, R9.5, R10.3,
 * R11.1, R11.2, R11.3).
 *
 * The menu-keyword discovery signal (R3.8) tags PERMANENT restaurants as
 * Festival_Booths, but a permanent restaurant breaks two assumptions the
 * original `experience_festival_tags` design relied on: (1) that the tagged
 * entity eventually deactivates, which is what made a tag's permanence safe,
 * and (2) that a `completions` row unambiguously means "visited the
 * festival" (true for a temporary booth that sells nothing else; false for a
 * restaurant whose festival items are a seasonal add-on to a normal menu).
 *
 * This module is the pure core deciding, per `(User, tagged experience)`,
 * whether a visit QUALIFIES as a festival visit:
 *
 *   - `match_kind = 'facet'` (temporary booth): a qualifying `completions`
 *     row OR any Food_Item_Log at that experience suffices (R11.1) — every
 *     dish such a booth serves is already, unambiguously, a festival dish.
 *   - `match_kind = 'menu'` (permanent restaurant): a bare `completions` row
 *     never qualifies on its own; only a Food_Item_Log on a `food_items` row
 *     carrying a Food_Item_Festival_Tag for the SAME `(slug, year)` qualifies
 *     (R10.3, R11.2) — the dish-level signal is what distinguishes an
 *     ordinary visit from a festival visit for this case.
 *   - Either way, when a `FestivalEditionWindow` exists for the tag's
 *     `(slug, year)`, only a signal dated inside that window (inclusive)
 *     counts (R9.4, R9.5); an absent window applies no restriction.
 *
 * The repo pre-filters which Food_Item_Log dates are even ELIGIBLE to be
 * considered (per the `match_kind` rule above) before calling this function
 * — this pure core only applies the date-window filter and the final
 * boolean OR, it never re-derives which food_item ids qualify for a given
 * `match_kind`. Keeping that split means the two SQL call sites
 * (`pins/repo.ts`, `stats/repo.ts`) that must never diverge on this rule
 * share exactly one decision function (Property 32, Property 33).
 *
 * Validates: Requirements 9.4, 9.5, 10.3, 11.1, 11.2, 11.3
 */

import type { FestivalSlug } from '@dwt/shared';
import type { MatchKind } from './repo.js';

/**
 * An operator-set date window for one Festival_Edition (R9.3). `endsOn` of
 * `null` means "still running" — treated as "today" for window-membership
 * purposes (R9.5). `null` for the whole window (not this type) means "no
 * Festival_Edition row exists for this (slug, year)" — no restriction (R9.4).
 */
export interface FestivalEditionWindow {
  /** ISO-8601 calendar date (YYYY-MM-DD). */
  readonly startsOn: string;
  /** ISO-8601 calendar date (YYYY-MM-DD), or `null` for "still running" (R9.5). */
  readonly endsOn: string | null;
}

/**
 * Every signal the repo found for one `(User, tagged experience)` pair,
 * already filtered by the repo to the dates that are structurally ELIGIBLE
 * to qualify for this experience's `matchKind` (R11.1, R10.3, R11.2):
 *
 *   - `'facet'`: `qualifyingFoodLogDates` is every Food_Item_Log date at the
 *     experience (any dish; no per-dish tag required).
 *   - `'menu'`: `qualifyingFoodLogDates` is only the Food_Item_Log dates on a
 *     `food_items` row carrying a Food_Item_Festival_Tag for this SAME
 *     `(slug, year)` — a dish NOT individually tagged is never included here
 *     by the repo, regardless of `matchKind`.
 */
export interface QualifyingSignal {
  readonly matchKind: MatchKind;
  /** ISO-8601 date of a qualifying `completions` row, or `null` if none (R11.1 only). */
  readonly completionDate: string | null;
  /** ISO-8601 dates of every repo-pre-filtered qualifying Food_Item_Log. */
  readonly qualifyingFoodLogDates: readonly string[];
}

/**
 * Whether `date` falls inside `window` inclusive (R9.5), treating a `null`
 * `endsOn` as `today`. `window === null` means no restriction (R9.4) — every
 * date qualifies regardless of value. Pure and total.
 */
export function withinWindow(
  date: string,
  window: FestivalEditionWindow | null,
  today: string,
): boolean {
  if (window === null) {
    return true;
  }
  if (date < window.startsOn) {
    return false;
  }
  const effectiveEnd = window.endsOn ?? today;
  return date <= effectiveEnd;
}

/**
 * Decide whether a `QualifyingSignal` constitutes a qualifying festival
 * visit (Property 32, Property 33). Returns a single boolean — never a
 * count — so the caller (the repo) can safely contribute AT MOST ONE to a
 * distinct-experience aggregate regardless of how many completions and/or
 * Food_Item_Log rows fed into this signal (R11.3).
 *
 * Pure and total; no I/O, no clock access (`today` is injected by the
 * caller so the function stays deterministic and property-testable).
 */
export function isQualifyingVisit(
  signal: QualifyingSignal,
  window: FestivalEditionWindow | null,
  today: string,
): boolean {
  if (signal.matchKind === 'facet') {
    const completionQualifies =
      signal.completionDate !== null && withinWindow(signal.completionDate, window, today);
    const anyFoodLogQualifies = signal.qualifyingFoodLogDates.some((date) =>
      withinWindow(date, window, today),
    );
    return completionQualifies || anyFoodLogQualifies;
  }

  // 'menu': a bare completion never qualifies alone (R10.3, R11.2); only a
  // Food_Item_Log the repo has already restricted to a tagged dish for this
  // same (slug, year) can qualify.
  return signal.qualifyingFoodLogDates.some((date) => withinWindow(date, window, today));
}

/**
 * One raw row from the repo-read CTE described in design.md's "Repo reads
 * feeding the pure core" section — one row per (experience, tag year,
 * completion-or-null, each qualifying food-log date). Multiple rows share
 * the same `experienceId`/`festivalYear` when a tag has several qualifying
 * Food_Item_Log dates; `collectQualifyingVisits` groups them back together
 * before calling {@link isQualifyingVisit} exactly once per tag.
 */
export interface RawQualifyingSignalRow {
  readonly experienceId: string;
  readonly matchKind: MatchKind;
  readonly festivalSlug: FestivalSlug;
  readonly festivalYear: number;
  /** ISO-8601 date of the User's `completions` row for this experience, or `null`. */
  readonly completionDate: string | null;
  /** ISO-8601 date of ONE repo-pre-filtered qualifying Food_Item_Log, or `null` (a row with no food-log signal at all). */
  readonly qualifyingFoodLogDate: string | null;
  /** This tag's Festival_Edition `starts_on`, or `null` when no edition row exists for `(festivalSlug, festivalYear)` (R9.4). */
  readonly editionStartsOn: string | null;
  /** This tag's Festival_Edition `ends_on`, or `null` for "still running" (R9.5) or "no edition row". */
  readonly editionEndsOn: string | null;
}

/** One experience that qualified as a festival visit, with the festival it qualified for. */
export interface QualifyingVisitResult {
  readonly experienceId: string;
  readonly festivalSlug: FestivalSlug;
}

/**
 * Group {@link RawQualifyingSignalRow}s by `(experienceId, festivalYear)`,
 * fold each group into one {@link QualifyingSignal} + window pair, and call
 * {@link isQualifyingVisit} exactly once per group (Property 32) — the
 * single shared aggregation step both `pins/repo.ts` and `stats/repo.ts` use
 * so they can never diverge on this rule (R11.1-11.3).
 *
 * The caller still owns the FINAL distinct-experience collapse (a `Set` for
 * Pin_Service's flat `festivalTaggedCompletedIds`, or a per-slug `Set` for
 * Stats_Service's breakdown) — this function only guarantees that a single
 * tag's many qualifying signal rows never produce more than one result for
 * that tag.
 */
export function collectQualifyingVisits(
  rows: readonly RawQualifyingSignalRow[],
  today: string,
): QualifyingVisitResult[] {
  interface Group {
    matchKind: MatchKind;
    festivalSlug: FestivalSlug;
    completionDate: string | null;
    foodLogDates: Set<string>;
    window: FestivalEditionWindow | null;
  }

  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.experienceId}:${row.festivalYear}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        matchKind: row.matchKind,
        festivalSlug: row.festivalSlug,
        completionDate: row.completionDate,
        foodLogDates: new Set<string>(),
        window:
          row.editionStartsOn !== null
            ? { startsOn: row.editionStartsOn, endsOn: row.editionEndsOn }
            : null,
      };
      groups.set(key, group);
    }
    if (row.completionDate !== null) {
      group.completionDate = row.completionDate;
    }
    if (row.qualifyingFoodLogDate !== null) {
      group.foodLogDates.add(row.qualifyingFoodLogDate);
    }
  }

  const results: QualifyingVisitResult[] = [];
  for (const [key, group] of groups.entries()) {
    const experienceId = key.slice(0, key.lastIndexOf(':'));
    const signal: QualifyingSignal = {
      matchKind: group.matchKind,
      completionDate: group.completionDate,
      qualifyingFoodLogDates: Array.from(group.foodLogDates),
    };
    if (isQualifyingVisit(signal, group.window, today)) {
      results.push({ experienceId, festivalSlug: group.festivalSlug });
    }
  }
  return results;
}
