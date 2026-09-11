/**
 * Pin_Service — pure challenge evaluation engine.
 *
 * No I/O: every function derives unlocked pins and progress from an in-memory
 * `PinActivitySnapshot` the repo assembles from the DB. Keeping it pure lets the
 * whole ruleset be property-tested exhaustively (R2, R9–R19; Properties 1–4, 8,
 * 9, 12).
 *
 * Id space: everything works in `upstream_entity_id` space — the catalog's
 * curated sets are keyed by upstream id (R13), and the repo resolves the User's
 * completions to upstream ids when building the snapshot.
 *
 * Definitions pinned here (flagged for review; deterministic):
 *   - Attraction countable set (R9): Ride, Show, Character_Meet, Walkthrough,
 *     Parade, PlayArea.
 *   - "ride" (single-day marathons): category === 'Ride'.
 *   - Disney-owned resort / real restaurant: precomputed on each EvalExperience
 *     by the repo (`isDisneyResort` / `isRealRestaurant`), so the predicate rule
 *     lives in one place (repo) and the evaluator stays pure.
 */

import type { ExperienceCategory, Park, PinCriteria, PinDTO, UserPinProgressDTO } from '@dwt/shared';
import { PINS, PIN_SETS } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Snapshot types (assembled by the repo; the evaluator only reads them)
// ---------------------------------------------------------------------------

/** One active catalog experience, flattened to what evaluation needs. */
export interface EvalExperience {
  readonly upstreamId: string;
  readonly category: ExperienceCategory;
  readonly park: Park | null;
  readonly land: string | null;
  readonly worldShowcaseCountry: string | null;
  /** grouped_facets flattened to group -> value names. */
  readonly facets: Readonly<Record<string, readonly string[]>>;
  readonly isDisneyResort: boolean;
  readonly isRealRestaurant: boolean;
}

/** The completed experiences a User logged on one calendar date (visited_on). */
export interface DaySnapshot {
  readonly date: string;
  readonly experiences: readonly EvalExperience[];
}

/** Everything the evaluator needs about one User's activity. */
export interface PinActivitySnapshot {
  /** All active experiences — the denominators for completion criteria. */
  readonly catalog: readonly EvalExperience[];
  /** Upstream ids the User has completed (canonical `completions`). */
  readonly completed: ReadonlySet<string>;
  /** Per-date completed experiences (from `experience_logs`) for single-day feats. */
  readonly days: readonly DaySnapshot[];
  readonly friendRides: number;
  readonly ratings: number;
  readonly notes: number;
  readonly trips: number;
}

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

const ATTRACTION_CATEGORIES: ReadonlySet<ExperienceCategory> = new Set<ExperienceCategory>([
  'Ride', 'Show', 'Character_Meet', 'Walkthrough', 'Parade', 'PlayArea',
]);

const THEME_PARKS: ReadonlySet<Park> = new Set<Park>([
  'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom',
]);

const isAttraction = (e: EvalExperience): boolean => ATTRACTION_CATEGORIES.has(e.category);
const facetHas = (e: EvalExperience, group: string, value: string): boolean =>
  (e.facets[group] ?? []).includes(value);
const isFestivalBooth = (e: EvalExperience): boolean => facetHas(e, 'quickService', 'Festival Kiosk');
const isSnackLounge = (e: EvalExperience): boolean =>
  e.category === 'Restaurant' && !e.isRealRestaurant && !isFestivalBooth(e);

/** The canonical land set for `allLandsVisited` — the lands with a starter pin. */
const STARTER_LANDS: readonly string[] = PINS.flatMap((p) =>
  p.criteria.kind === 'firstInLand' ? [p.criteria.land] : [],
);

// ---------------------------------------------------------------------------
// Set + metric resolution
// ---------------------------------------------------------------------------

/** Resolve a named set's members against the catalog. */
export function resolveSet(setId: string, catalog: readonly EvalExperience[]): EvalExperience[] {
  const res = PIN_SETS[setId];
  if (!res) return [];
  switch (res.kind) {
    case 'ids': {
      const ids = new Set(res.ids);
      return catalog.filter((e) => ids.has(e.upstreamId));
    }
    case 'facet':
      return catalog.filter((e) => facetHas(e, res.group, res.value));
    case 'category':
      return catalog.filter((e) => e.category === res.category);
    case 'realRestaurants':
      return catalog.filter((e) => e.isRealRestaurant);
    case 'disneyResorts':
      return catalog.filter((e) => e.isDisneyResort);
    default:
      return [];
  }
}

function completedExperiences(snap: PinActivitySnapshot): EvalExperience[] {
  return snap.catalog.filter((e) => snap.completed.has(e.upstreamId));
}

function countCompleted(snap: PinActivitySnapshot, pred: (e: EvalExperience) => boolean): number {
  return completedExperiences(snap).filter(pred).length;
}

function metricValue(metric: string, snap: PinActivitySnapshot): number {
  switch (metric) {
    case 'attractions': return countCompleted(snap, isAttraction);
    case 'restaurants': return countCompleted(snap, (e) => e.isRealRestaurant);
    case 'festivalBooths': return countCompleted(snap, isFestivalBooth);
    case 'snacks': return countCompleted(snap, isSnackLounge);
    case 'characterMeets': return countCompleted(snap, (e) => e.category === 'Character_Meet');
    case 'shows': return countCompleted(snap, (e) => e.category === 'Show');
    case 'worldShowcaseCountries': {
      const s = new Set<string>();
      for (const e of completedExperiences(snap)) if (e.worldShowcaseCountry) s.add(e.worldShowcaseCountry);
      return s.size;
    }
    case 'resorts': return countCompleted(snap, (e) => e.isDisneyResort);
    case 'friendRides': return snap.friendRides;
    case 'ratings': return snap.ratings;
    case 'notes': return snap.notes;
    case 'reviews': return snap.ratings + snap.notes;
    case 'trips': return snap.trips;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Criteria evaluation
// ---------------------------------------------------------------------------

/** Progress toward a criteria: met flag plus current / target for the board. */
export interface CriteriaProgress {
  readonly met: boolean;
  readonly current: number;
  readonly target: number;
}

const done = (current: number, target: number): CriteriaProgress => ({
  met: target > 0 && current >= target,
  current,
  target,
});

function completedInScope(
  snap: PinActivitySnapshot,
  pred: (e: EvalExperience) => boolean,
): CriteriaProgress {
  const active = snap.catalog.filter(pred);
  const completed = active.filter((e) => snap.completed.has(e.upstreamId));
  return done(completed.length, active.length);
}

function bestDay(snap: PinActivitySnapshot, score: (d: DaySnapshot) => number): number {
  let best = 0;
  for (const d of snap.days) best = Math.max(best, score(d));
  return best;
}

function distinctThemeParks(d: DaySnapshot): number {
  const s = new Set<Park>();
  for (const e of d.experiences) if (e.park && THEME_PARKS.has(e.park)) s.add(e.park);
  return s.size;
}

export function evaluateCriteria(c: PinCriteria, snap: PinActivitySnapshot): CriteriaProgress {
  switch (c.kind) {
    case 'count':
      return done(metricValue(c.metric, snap), c.threshold);

    case 'firstInPark':
      return completedInScope(snap, (e) => e.park === c.park);

    case 'firstInLand':
      return done(
        completedExperiences(snap).some((e) => e.land === c.land) ? 1 : 0,
        1,
      );

    case 'landComplete': {
      const lands = new Set(c.lands);
      return completedInScope(snap, (e) => e.land !== null && lands.has(e.land) && isAttraction(e));
    }

    case 'allLandsVisited': {
      const completedLands = new Set<string>();
      for (const e of completedExperiences(snap)) if (e.land) completedLands.add(e.land);
      const visited = STARTER_LANDS.filter((l) => completedLands.has(l)).length;
      return done(visited, STARTER_LANDS.length);
    }

    case 'parkComplete':
      return completedInScope(
        snap,
        (e) => e.park === c.park && (c.scope === 'everything' || isAttraction(e)),
      );

    case 'parksAttractionsComplete':
      return completedInScope(snap, (e) => e.park !== null && THEME_PARKS.has(e.park) && isAttraction(e));

    case 'catalogComplete':
      return completedInScope(snap, (e) => (c.scope === 'attractions' ? isAttraction(e) : true));

    case 'set': {
      const members = resolveSet(c.setId, snap.catalog);
      const target = c.required === 'all' ? members.length : c.required;
      const current = members.filter((e) => snap.completed.has(e.upstreamId)).length;
      return done(current, target);
    }

    case 'singleDay': {
      const f = c.feat;
      switch (f.type) {
        case 'multiPark':
          return done(bestDay(snap, distinctThemeParks), f.parks);
        case 'rideMarathon':
          return done(bestDay(snap, (d) => d.experiences.filter((e) => e.category === 'Ride').length), f.rides);
        case 'grandSlam': {
          const ok = snap.days.some(
            (d) => distinctThemeParks(d) >= 4 && d.experiences.filter((e) => e.category === 'Ride').length >= 15,
          );
          return { met: ok, current: ok ? 1 : 0, target: 1 };
        }
        case 'diningAllParks': {
          const best = bestDay(snap, (d) => {
            const s = new Set<Park>();
            for (const e of d.experiences)
              if (e.category === 'Restaurant' && e.park && THEME_PARKS.has(e.park)) s.add(e.park);
            return s.size;
          });
          return done(best, 4);
        }
        case 'aroundTheWorld': {
          const best = bestDay(snap, (d) => {
            const s = new Set<string>();
            for (const e of d.experiences) if (e.worldShowcaseCountry) s.add(e.worldShowcaseCountry);
            return s.size;
          });
          return done(best, 11);
        }
        default:
          return done(0, 1);
      }
    }

    case 'compound': {
      const parts = c.all.map((sub) => evaluateCriteria(sub, snap));
      return {
        met: parts.every((p) => p.met),
        current: parts.filter((p) => p.met).length,
        target: parts.length,
      };
    }

    default:
      return done(0, 1);
  }
}

// ---------------------------------------------------------------------------
// Pin / board evaluation
// ---------------------------------------------------------------------------

/** Clamp a locked pin's progress to `[0, 99]` (Property 4). */
function lockedPercent(p: CriteriaProgress): number {
  if (p.target <= 0) return 0;
  const pct = Math.floor((p.current / p.target) * 100);
  return Math.max(0, Math.min(99, pct));
}

/** One User's award state for a single Pin — the repo's `readAwarded` result shape. */
export interface AwardState {
  readonly awardedAt: string;
  readonly claimedAt: string | null;
}

/**
 * Project one Pin for the board given whether/when it was awarded and (if
 * awarded) whether it has been claimed (Requirement 20.2). An awarded pin is
 * unlocked with its award timestamp, its `claimedAt` (or `null` if not yet
 * claimed — "ready to claim"), and null progress; otherwise it carries
 * clamped progress toward its target and `claimedAt` is always `null` — a
 * pin cannot be claimed before it is awarded (Property 13).
 */
export function evaluatePin(
  pin: PinDTO,
  snap: PinActivitySnapshot,
  award: AwardState | null,
): UserPinProgressDTO {
  if (award !== null) {
    return {
      pinId: pin.id,
      unlocked: true,
      awardedAt: award.awardedAt,
      currentValue: null,
      targetValue: null,
      percentComplete: null,
      claimedAt: award.claimedAt,
    };
  }
  const prog = evaluateCriteria(pin.criteria, snap);
  return {
    pinId: pin.id,
    unlocked: false,
    awardedAt: null,
    currentValue: prog.current,
    targetValue: prog.target,
    percentComplete: lockedPercent(prog),
    claimedAt: null,
  };
}

/** Project every catalog Pin for the board. `awarded` maps pinId -> its award state. */
export function evaluateBoard(
  snap: PinActivitySnapshot,
  awarded: ReadonlyMap<string, AwardState>,
): UserPinProgressDTO[] {
  return PINS.map((pin) => evaluatePin(pin, snap, awarded.get(pin.id) ?? null));
}

/**
 * The pin ids whose criteria are now satisfied but which have not yet been
 * awarded — the synchronous award set inserted after a mutation (R2.1).
 */
export function newlyAwardedPinIds(
  snap: PinActivitySnapshot,
  alreadyAwarded: ReadonlySet<string>,
): string[] {
  return PINS.filter((pin) => !alreadyAwarded.has(pin.id) && evaluateCriteria(pin.criteria, snap).met).map(
    (p) => p.id,
  );
}
