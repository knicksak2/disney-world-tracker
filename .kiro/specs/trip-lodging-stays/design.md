# Design Document

## Overview

Trip Lodging Stays adds one table (`trip_stays`), one shared pure module (`@dwt/shared` `tripStays.ts`), one route (`PUT /trips/:id/stays`), and small changes to four existing consumers: the Trip read projection, the Trip hub and edit screen, the Live Glance, and the booking timeline derivation. It leaves `trip_resorts` in place as a derived projection so no existing reader changes.

The central idea is a single resolver, `effectiveStays(trip, stays)`, that every consumer calls. It turns whatever lodging data a Trip has (dated stays, undated stays from legacy data, or nothing) into an ordered list of segments with a kind, dates and optionally a party subset. Features stop reasoning about "the resort" and reason about segments.

### Key design decisions

1. **A Stay is one booking, not one hotel.** The same resort can appear twice, a stay can be off-site, and a single package that moves between two Disney hotels is simply one Stay. The calculator cares about reservations, not building names.
2. **Nights are disjoint; hand-off dates are shared.** `[check_in, check_out)` ranges may not intersect, but one stay's check-out may equal the next stay's check-in. This is how real split stays work and it gives dining credits a clean rule (`dining-plan-calculator` Requirement 25).
3. **Warnings, not errors, for incomplete data.** Gaps, nights outside the trip dates and undated stays are common while planning. Only impossible data (overlap, backwards dates, bad references) is rejected.
4. **Replace, with stable ids.** `PUT /trips/:id/stays` replaces the whole list atomically but keeps the id of every stay the client names, so features keyed by stay id (the dining plan's per-stay settings) survive an edit.
5. **`trip_resorts` stays, derived.** It is rewritten in the same transaction as every stay change. Booking, stats, summaries and pins keep reading it. The legacy `resortIds` field keeps working through documented translation rules.
6. **Legacy behavior is a special case of the resolver.** A Trip with no stays resolves to one implicit off-site segment (today's behavior for a Trip with no resorts); a Trip with only undated stays resolves to one `legacy_resorts` segment (today's behavior for a Trip with resorts). The booking timeline is therefore unchanged for every existing Trip, and a property test pins it.
7. **The party subset is plain text.** `party_keys` carries Person_Keys with no user foreign key, so account deletion needs no disposition and a departed person's key is inert.
8. **Uncovered trip nights are off-site.** When some nights have no stay, the resolver synthesizes off-site segments for them. That is the conservative reading for booking windows (no resort-guest timing is granted for lodging the app does not know about) and for dining plans (no plan without a Disney resort reservation).

## Architecture

### Placement

| Concern | Location |
| --- | --- |
| Constants, Zod, DTOs, pure helpers | `packages/shared/src/tripStays.ts` (new), `packages/shared/src/index.ts` (explicit named exports) |
| Migrations | `apps/api/migrations/0073_trip_lodging_stays.sql` (table, DDL only) and `apps/api/migrations/0074_trip_stays_backfill.sql` (data-only backfill, written to run under pg-mem as well as Postgres, so no helper skip is needed) |
| Repo | `apps/api/src/services/trips/stays.ts` (new, the `trip_stays` SQL and the projection rewrite), `apps/api/src/services/trips/repo.ts` (additive: `stays` and `stayWarnings` on the Trip projection, legacy `resortIds` translation, trip-date follow) |
| Route | `apps/api/src/services/trips/routes.ts` (additive: `PUT /trips/:id/stays`) |
| Booking timeline | `apps/api/src/services/tripBooking/timeline.ts`, `tripBooking/repo.ts` (load stays), `packages/shared/src/tripBooking.ts` (DTO widening) |
| Mobile | `apps/mobile/src/screens/trips/TripEditScreen.tsx` (section), `TripStaySheet.tsx` (new), `TripStaysCard.tsx` (new, used by the hub), `TripDetailScreen.tsx` (card and Live Glance name), `BookingSettingsModal.tsx` (disable two controls), `tripDetailQueryKeys.ts` and the trip API module (cache update) |

No composition change in `composeServices.ts` is needed: the route and repo changes live inside the existing Trip repo and routes. The booking repo loads stays through its own query (one statement).

### Write flow: `PUT /trips/:id/stays`

```
1. requireSession -> assertTripMember -> can(role, 'edit_settings')            (Organizer-only, as for resorts)
2. parse body with tripStaysPutSchema                                         (<= 8 stays, kinds, dates, keys)
3. BEGIN; SELECT id FROM trips WHERE id = $1 FOR UPDATE                      (serialize concurrent edits)
4. load current stays for the trip; check every input id belongs to it
5. validateStays(input, tripDates)  ->  overlap / span / nights errors  -> trip_validation_failed (ROLLBACK)
6. verify every resort_id exists and is active                             -> trip_validation_failed (ROLLBACK)
7. DELETE stays whose id is absent from the input; UPDATE the ones named; INSERT the rest; set position = array index
8. rewrite trip_resorts = distinct resort_id of the stays                  (DELETE then INSERT, as replaceTripResorts does)
9. COMMIT; respond { stays, stayWarnings }
```

### Read flow

The Trip list and detail projections already batch `trip_resorts` for all returned Trips in one statement (`selectTripResortsByTrip`). Stays are loaded the same way: one `SELECT ... FROM trip_stays s LEFT JOIN resorts r ON r.id = s.resort_id WHERE s.trip_id IN (...)` for all Trips, fanned out in memory. Warnings are computed in memory per Trip. No per-Trip query is added.

### Legacy `resortIds` translation

`POST /trips` and `PATCH /trips/:id` keep accepting `resortIds`. In the same transaction as today's `replaceTripResorts` call:

```
current = distinct resort ids of the Trip's resort Stays
if set(resortIds) == set(current): no change to stays
else:
   delete every stay of the trip
   0 ids  -> none
   1 id   -> one resort Stay, check_in = trip.start_date, check_out = trip.end_date  (unscheduled if start == end)
   n ids  -> n unscheduled resort Stays in the order given
rewrite trip_resorts from the new stays (it then equals set(resortIds))
```

Trip-date follow (Requirement 4.4): on a date edit, if the Trip has exactly one Scheduled_Stay whose `check_in` and `check_out` equal the previous Trip start and end, update that Stay to the new dates (to unscheduled if the new dates are the same day). This keeps the common single-hotel trip correct when the user changes the trip dates.

## Components and Interfaces

### Shared module `packages/shared/src/tripStays.ts`

```ts
import { STAY_TYPES, type StayType } from './enums.js';

export const TRIP_STAY_LIMIT = 8;
export const TRIP_STAY_MAX_NIGHTS = 60;
export const TRIP_STAY_SPAN_MAX_DAYS = 90;
export const TRIP_STAY_PLACE_NAME_MAX = 100;
export const TRIP_STAY_PARTY_KEYS_MAX = 50;

export const personKeySchema = z.string().regex(/^[mg]:[A-Za-z0-9_-]{1,64}$/);

export const tripStayInputSchema = z.object({
  id: uuidSchema.optional(),
  lodgingKind: z.enum(STAY_TYPES),
  resortId: uuidSchema.nullable().optional(),
  placeName: z.string().trim().min(1).max(TRIP_STAY_PLACE_NAME_MAX).nullable().optional(),
  checkIn: tripCalendarDateSchema.nullable().optional(),
  checkOut: tripCalendarDateSchema.nullable().optional(),
  partyKeys: z.array(personKeySchema).max(TRIP_STAY_PARTY_KEYS_MAX).nullable().optional(),
}).strict().superRefine(/* kind rules (resort needs resortId and forbids placeName; others need placeName and forbid resortId); checkIn and checkOut both or neither; checkOut > checkIn */);

export const tripStaysPutSchema = z.object({
  stays: z.array(tripStayInputSchema).max(TRIP_STAY_LIMIT),
}).strict();

export interface TripStayDTO {
  readonly id: string; readonly position: number; readonly lodgingKind: StayType;
  readonly resortId: string | null; readonly placeName: string | null; readonly displayName: string;
  readonly checkIn: string | null; readonly checkOut: string | null; readonly nights: number | null;
  readonly partyKeys: readonly string[] | null;
}
export type TripStayWarningCode = 'gap' | 'outside_trip' | 'unscheduled' | 'trip_not_covered';
export interface TripStayWarningDTO { readonly code: TripStayWarningCode; readonly stayId?: string; readonly from?: string; readonly to?: string }

export type EffectiveStaySource = 'stay' | 'legacy_resorts' | 'implicit_no_lodging' | 'implicit_gap';
export interface EffectiveStay {
  readonly id: string | null; readonly source: EffectiveStaySource; readonly lodgingKind: StayType; readonly displayName: string;
  readonly resortId: string | null; readonly checkIn: string; readonly checkOut: string; readonly nights: number;
  readonly partyKeys: readonly string[] | null;
}

export function stayNights(checkIn: string, checkOut: string): string[];             // checkIn .. checkOut-1
export function validateStays(stays: readonly StayRecord[], trip?: { startDate: string; endDate: string }): StayValidationError[];
export function effectiveStays(trip: { startDate: string; endDate: string }, stays: readonly StayRecord[]): EffectiveStay[];
export function stayForNight(effective: readonly EffectiveStay[], date: string): EffectiveStay | null;
export function tonightsStay(effective: readonly EffectiveStay[], today: string): EffectiveStay | null;
export function computeStayWarnings(trip: { startDate: string; endDate: string }, stays: readonly StayRecord[]): TripStayWarningDTO[];
```

`StayRecord` is the shared minimal shape (`id`, `position`, `lodgingKind`, `resortId`, `displayName`, `checkIn`, `checkOut`, `partyKeys`) that both `TripStayDTO` and the repo rows satisfy. Date helpers use the existing UTC-midnight functions in `tripBooking.ts` (`addCalendarDays`, `diffCalendarDays`, `listCalendarDates`); no new date library.

#### `validateStays`

Errors (each `{ code, stayIndex?, message }`): `count_exceeded` (more than 8), `dates_inverted`, `nights_exceeded` (more than 60), `overlap` (two Scheduled_Stays whose nights intersect), `span_exceeded` (earliest check-in to latest check-out more than 90 days). Sort Scheduled_Stays by `checkIn`, then compare each with its predecessor: overlap iff `a.checkOut > b.checkIn`. Touching ranges (`a.checkOut === b.checkIn`) are valid.

#### `effectiveStays`

```
scheduled = stays with checkIn/checkOut, sorted by checkIn then position
if scheduled.length > 0:
   segments = scheduled mapped to { source: 'stay', ... }
   tripNights = stayNights(trip.startDate, trip.endDate)
   uncovered = tripNights not in any scheduled stay's nights
   for each maximal run of consecutive uncovered nights:
        segments.push({ id: null, source: 'implicit_gap', lodgingKind: 'offsite', displayName: 'No lodging recorded',
                        checkIn: run.first, checkOut: addDays(run.last, 1), nights: run.length, partyKeys: null })
   return segments sorted by checkIn
else if stays.length > 0 (all unscheduled):
   first = stays sorted by position, id [0]
   return [{ id: null, source: 'legacy_resorts', lodgingKind: first.lodgingKind, displayName: first.displayName,
             resortId: first.resortId, checkIn: trip.startDate, checkOut: trip.endDate, nights: max(0, diff), partyKeys: null }]
else:
   return [{ id: null, source: 'implicit_no_lodging', lodgingKind: 'offsite', displayName: 'No lodging recorded',
             resortId: null, checkIn: trip.startDate, checkOut: trip.endDate, nights: max(0, diff), partyKeys: null }]
```

`stayForNight(eff, d)`: the first segment with `checkIn <= d < checkOut`. `tonightsStay(eff, today)`: `stayForNight(eff, today)` ?? the segment with `checkOut === today` ?? null. On a Hand_Off_Date the incoming stay wins because its Night is that date.

#### `computeStayWarnings`

`unscheduled` per undated stay; if scheduled stays exist: `gap` for each run of uncovered Trip nights lying strictly between two scheduled stays (`from`, `to`), `trip_not_covered` for uncovered Trip nights before the first or after the last scheduled stay, and `outside_trip` for each scheduled stay with any Night before `trip.startDate` or on/after `trip.endDate`.

### Booking timeline (`tripBooking/timeline.ts`)

`TimelineTripInput` gains an optional `stays: readonly StayRecord[]` (the existing `hasResortStay` and `settings` stay). The derivation becomes:

```
eff = effectiveStays({ startDate, endDate }, stays ?? [])
legacy = eff.length === 1 && (eff[0].source === 'legacy_resorts' || eff[0].source === 'implicit_no_lodging')
if legacy (or `stays` omitted):  run the existing code unchanged                    // identical output, Requirement 9.4
else:
   timingOverride = settings?.lightningLaneTiming
   for each segment g in eff:
        stayDates = listCalendarDates(g.checkIn, g.checkOut)                          // inclusive, like today's checkIn..endDate
        dining = applyRule('dining', BOOKING_RULES.dining.byStayType[g.lodgingKind], stayDates, g.checkIn)
        timing = timingOverride ?? BOOKING_RULES.lightning_lane.defaultTimingByStayType[g.lodgingKind]
        ll     = applyRule('lightning_lane', BOOKING_RULES.lightning_lane.byTiming[timing], stayDates, g.checkIn)
   merged = merge windows by windowKey (kind:dropOn): union of coveredDates (sorted, unique), dropAt from the first
   windows = merged sorted by compareWindows
   top-level stayType / arrival = first segment's kind and checkIn, with source 'stays'
   stayDates (top-level) = union of segments' dates
```

`hasResortStay` is still passed for the legacy path. The booking repo query loads `trip_stays` rows for the trip (one statement) beside its existing reads, and the reminder runner (which loads many Trips) loads stays for all of them in one statement.

Output widening (additive): in the wire DTO `BookingTimelineDTO` (`packages/shared/src/tripBooking.ts`) `stayType.source` and `arrivalDate.source` gain the literal `'stays'` (the internal `DerivedTimeline` in `timeline.ts` calls the second field `arrival`; the mapping between the two already exists and is unchanged); `DerivedTimeline` gains an optional `stays` that is attached only when the stays path ran, so the legacy path's output (and `timeline.prop.test.ts`, which calls `deriveBookingTimeline` directly) is unchanged; `BookingTimelineDTO` gains `stays: { stayId: string | null; lodgingKind: StayType; checkIn: string; checkOut: string; source: EffectiveStaySource }[]`. The mobile booking screens that switch on `source` must treat `'stays'` as non-overridable (Requirement 9.6).

### Repo functions (`trips/stays.ts`)

**Table-existence probe.** More than twenty existing `trips` and `tripBooking` tests (for example `repo.resorts.integration.test.ts`, `repo.setDayPark.integration.test.ts`, `routes.dayPark.test.ts`, `tripFoodLists.prop.test.ts`, `experienceListAttachment.test.ts`, `favoritesShared.test.ts`, and `tripBooking/__tests__/testDb.ts`) load a fixed list of migrations that does not include `0073`. Requirements 4.5 and 9.4 require them to pass unmodified, so every read or write of `trip_stays` outside the new stays tests goes through `isTripStaysAvailable(pool)`, built exactly like `isTripFoodListsAvailable` in `trips/repo.ts` (a `WeakMap<object, boolean>` cache keyed by the pool, one probe query the first time). When the table is absent: `selectTripStaysByTrip` returns an empty map, `followTripDates` does nothing, `translateLegacyResortIds` falls back to the existing `replaceTripResorts` behavior, `rewriteTripResorts` is skipped, and the booking repo passes no stays. In production the table always exists, so the probe is a one-time cost per process.

`selectTripStaysByTrip(q, tripIds): Map<string, TripStayDTO[]>` (one statement), `replaceTripStays(client, trip, input): TripStayDTO[]` (Write flow steps 4 to 8), `translateLegacyResortIds(client, trip, resortIds)`, `followTripDates(client, tripId, oldDates, newDates)`, `rewriteTripResorts(client, tripId)`. All run inside the caller's transaction after the Trip row lock.

### Mobile

| File | Role |
| --- | --- |
| `TripStaySheet.tsx` | The Stay sheet of Requirement 7.5 (kind, resort single-select via `ResortPicker`, name, dates, who's staying) |
| `TripStaysCard.tsx` | In `mode="read"` (hub): a compact, collapsible 2-line stay summary header embedded at the top of `heroCard` above the Crew row, expanding on tap to list compact 1-line Stay rows (`shortStayName` on the left, `Dec 15–16 · 1n` on the right) and warnings (read-only unless Organizer). In `mode="edit"` (edit screen): the full editable "Where you're staying" card |
| `TripEditScreen.tsx` | Replaces the resort picker section; saves with `PUT /trips/:id/stays`; the legacy `resortIds` is no longer sent |
| `TripDetailScreen.tsx` | Embeds `TripStaysCard` inside `heroCard` above the Crew row; Live Glance name from `tonightsStay(effectiveStays(trip, trip.stays), wdwToday)` |
| `BookingSettingsModal.tsx` | Disables stay type and check-in override with "Set per stay in Trip settings" when `timeline.stayType.source === 'stays'` |
| `tripStaysApi.ts` | `putTripStays(tripId, stays)` and a mutation hook that writes the returned stays and warnings into the cached `TripDTO` and invalidates the booking timeline query |

`TripEditScreen.tsx`, `ResortPickerModal.tsx`, `BookingSettingsModal.tsx` and other trips screens may carry uncommitted user edits: run `git status` first and make small additive edits only.

## Data Models

Two migrations (re-list `apps/api/migrations/` first; highest at spec time is `0072_hidden_mickeys.sql`; the `dining-plan-calculator` spec reserves the number after these two). `0073_trip_lodging_stays.sql` is DDL only and is safe for the pg-mem migration helper (`accountDeletion/__tests__/helpers.ts` `buildMigratedDb`, which runs every migration file): it uses only functions the helper registers (`jsonb_typeof`, `char_length`, `btrim`), no `NULLS LAST` in an index and no non-unique partial index. `0074_trip_stays_backfill.sql` is the data-only backfill described below.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS trip_stays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  position     SMALLINT NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 7),
  lodging_kind TEXT NOT NULL CHECK (lodging_kind IN ('resort','partner_hotel','offsite')),
  resort_id    UUID REFERENCES resorts(id),
  place_name   VARCHAR(100) CHECK (place_name IS NULL OR char_length(btrim(place_name)) BETWEEN 1 AND 100),
  check_in     DATE,
  check_out    DATE,
  party_keys   JSONB CHECK (party_keys IS NULL OR jsonb_typeof(party_keys) = 'array'),   -- the 50-key limit is enforced by Zod and the repo (pg-mem has no jsonb_array_length)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_stays_dates_pair CHECK ((check_in IS NULL) = (check_out IS NULL)),
  CONSTRAINT chk_trip_stays_dates_order CHECK (check_in IS NULL OR check_out > check_in),
  CONSTRAINT chk_trip_stays_kind CHECK (
    (lodging_kind = 'resort' AND resort_id IS NOT NULL AND place_name IS NULL) OR
    (lodging_kind <> 'resort' AND resort_id IS NULL AND place_name IS NOT NULL))
);
-- Plain B-tree indexes only. pg-mem's parser rejects NULLS LAST inside CREATE INDEX, and a NON-unique partial index
-- (WHERE col IS NOT NULL) makes pg-mem hide the rows where the column is NULL from unpredicated SELECTs (see the
-- comment on mickey_progress in accountDeletion/__tests__/helpers.ts). Queries order with ORDER BY check_in ASC NULLS LAST.
CREATE INDEX IF NOT EXISTS idx_trip_stays_trip ON trip_stays (trip_id, check_in, position);
CREATE INDEX IF NOT EXISTS idx_trip_stays_resort ON trip_stays (resort_id);

COMMIT;
```

The 60-night limit is enforced by `validateStays` and the repo, not a SQL CHECK, because date subtraction in a CHECK may not be portable to pg-mem; if it is, add `CHECK (check_in IS NULL OR check_out - check_in <= 60)` too. The no-overlap rule cannot be a portable SQL constraint (an `EXCLUDE USING gist` needs `btree_gist` and is not supported by pg-mem); the repo checks it under the Trip row lock and Property 3 pins it.

### Backfill migration `0074_trip_stays_backfill.sql`

The backfill is its own data-only file, wrapped in `BEGIN`/`COMMIT`, and idempotent (only Trips with no `trip_stays` rows). As built, it is written so pg-mem can run it, which means NO helper skip is needed (unlike `0070_backfill_completion_logged_feed_items.sql`, which `buildMigratedDb()` skips). It avoids every construct pg-mem lacks or mishandles: no correlated subqueries and no window functions (derived tables, uncorrelated `IN` / `NOT IN` and a self-join rank instead), no `substr` (use `substring(x from 1 for 100)`), and no `HAVING` (pg-mem silently ignores `HAVING`, which made the single-resort branch match every Trip; the per-Trip resort count is computed in a derived table and filtered in an outer `WHERE`). It is verified twice: against the local Postgres in `migration0074.livedb.test.ts` (skips cleanly when no database is reachable, but a skip does not satisfy task 3; the executor runs it and pastes the output) and under pg-mem in `migration0073.test.ts`, which also asserts the file contains no `HAVING`, `OVER (` or `substr(`.

Backfill (a), in intent:

```sql
INSERT INTO trip_stays (trip_id, position, lodging_kind, resort_id, place_name, check_in, check_out)
SELECT t.id, 0,
       COALESCE(s.stay_type, 'resort'),
       CASE WHEN COALESCE(s.stay_type, 'resort') = 'resort' THEN r.id END,
       CASE WHEN COALESCE(s.stay_type, 'resort') = 'resort' THEN NULL ELSE left(r.name, 100) END,
       <ci>,                                           -- see below
       CASE WHEN t.end_date > <ci> THEN t.end_date END -- NULL pair when the trip is a single day
FROM trips t
JOIN trip_resorts tr ON tr.trip_id = t.id
JOIN resorts r ON r.id = tr.resort_id
LEFT JOIN trip_booking_settings s ON s.trip_id = t.id
WHERE NOT EXISTS (SELECT 1 FROM trip_stays x WHERE x.trip_id = t.id)
  AND (SELECT count(*) FROM trip_resorts z WHERE z.trip_id = t.id) = 1;
-- <ci> = CASE WHEN s.check_in_override IS NOT NULL AND s.check_in_override BETWEEN t.start_date - 30 AND t.start_date
--             THEN s.check_in_override ELSE t.start_date END; the check_in is NULL when the check_out is NULL
```

(b) uses `ROW_NUMBER() OVER (PARTITION BY tr.trip_id ORDER BY r.name, r.id) - 1` for `position`. Because the whole file runs only on a real Postgres, these constructs are fine in the SQL; the livedb test SHALL cover every backfill case of Requirement 10.

## Configuration & Constants

No environment variables and no admin-editable values. Code constants in `@dwt/shared`: `TRIP_STAY_LIMIT` 8, `TRIP_STAY_MAX_NIGHTS` 60, `TRIP_STAY_SPAN_MAX_DAYS` 90, `TRIP_STAY_PLACE_NAME_MAX` 100, `TRIP_STAY_PARTY_KEYS_MAX` 50. `TRIP_STAY_LIMIT` must not exceed the existing `TRIP_RESORT_LIMIT` (read it; if it is smaller, the projection write must still succeed for 8 distinct resorts, so raise nothing and report). Lodging kinds reuse `STAY_TYPES` (`resort`, `partner_hotel`, `offsite`).

## External Interfaces

None. No outbound call, no new Disney data. The catalog `resorts` table is read by id for validation and display names. Partner hotels (Swan and Dolphin, Shades of Green) are entered as free text; whether the catalog contains them was not checked and does not matter because only the `resort` kind references the catalog.

## Correctness Properties

### Property 1: The resolver is total, ordered and consistent with its source data

For any Trip dates and any set of stays (including none, only undated, only dated, and mixed), `effectiveStays` returns a list without throwing, ordered by `checkIn`, each element with `nights = max(0, checkOut - checkIn)`; with no stays it returns exactly one `implicit_no_lodging` segment spanning the Trip's dates; with only undated stays it returns exactly one `legacy_resorts` segment whose kind and name are those of the first stay by position; with at least one dated stay it returns every dated stay unchanged plus only `implicit_gap` off-site segments.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7**

### Property 2: Gap filling covers every uncovered Trip night exactly once

For any dated stays and Trip dates, every Trip night is covered by exactly one of: a dated stay, or an `implicit_gap` segment; no `implicit_gap` night is covered by a dated stay; each `implicit_gap` segment is a maximal run of consecutive uncovered nights; and the union of dated-stay nights and gap nights contains the Trip's nights.

**Validates: Requirements 3.2**

### Property 3: Stay validation accepts exactly the valid sets

For any list of stays, `validateStays` reports `overlap` iff two dated stays share a Night, and never reports it for stays that only touch at a hand-off date; reports `dates_inverted` iff `checkOut <= checkIn`; `nights_exceeded` iff a stay has more than 60 nights; `span_exceeded` iff the earliest check-in and latest check-out are more than 90 days apart; `count_exceeded` iff there are more than 8; and the result is independent of input order. Undated stays never produce date errors.

**Validates: Requirements 2.1, 2.2, 2.3, 2.7, 1.4**

### Property 4: `trip_resorts` always equals the resorts of the stays

For any sequence of `PUT /trips/:id/stays`, legacy `resortIds` writes and Trip date edits that succeeds, `trip_resorts` for the Trip equals the set of distinct `resort_id` of its `resort` stays after every step; and a rejected write leaves both tables unchanged.

**Validates: Requirements 4.1, 4.6, 2.8, 5.3**

### Property 5: The legacy resort write translates as specified

For any current stays and any `resortIds`: an equal set changes nothing; an empty set clears every stay; one id produces one resort stay spanning the Trip's dates (undated for a one-day Trip); several ids produce that many undated stays in the order given; and the projected `TripDTO.resorts` is ordered by name then id as before.

**Validates: Requirements 4.2, 4.3**

### Property 6: Trip-date follow moves only the matching single stay

For any Trip edit that changes the dates, a Trip with exactly one dated stay equal to the previous Trip dates ends with that stay equal to the new dates; any other combination of stays is left unchanged.

**Validates: Requirements 4.4**

### Property 7: Replace preserves ids and is atomic

For any current stays and any `PUT` body, the stays named by an `id` keep that id and row; ids absent from the body are deleted; unnamed stays are created; an `id` from another Trip or an invalid body changes nothing; and two concurrent `PUT`s leave the Trip with exactly the stays of one of them.

**Validates: Requirements 5.3, 5.4, 5.5, 2.8**

### Property 8: Warnings are exactly the documented findings

For any Trip dates and stays, `computeStayWarnings` returns `unscheduled` once per undated stay; with dated stays present returns `gap` for each run of uncovered Trip nights between two dated stays, `trip_not_covered` for uncovered Trip nights before the first or after the last dated stay, and `outside_trip` for each dated stay with a Night outside the Trip's nights; and returns nothing for a Trip whose single dated stay equals the Trip's dates.

**Validates: Requirements 5.7, 2.6**

### Property 9: Tonight's stay follows the nights

For any effective stays and date, `stayForNight` returns the segment whose half-open range contains the date or null; on a hand-off date `tonightsStay` returns the incoming stay; on the final check-out date it returns the stay being left; outside every range it returns null.

**Validates: Requirements 3.6, 8.1, 8.5**

### Property 10: The timeline is unchanged for single-segment Trips

For any Trip that resolves to one `legacy_resorts` or `implicit_no_lodging` segment, `deriveBookingTimeline` returns output deeply equal to the pre-change derivation for the same inputs. For any Trip with one dated stay equal to the Trip's dates and kind `K`, the windows equal the pre-change derivation with `stayType` override `K` and no check-in override.

**Validates: Requirements 9.4, 10.6**

### Property 11: Merged timeline windows are unique and complete

For any Trip with two or more segments, no two windows share a `windowKey`; every window produced by any single segment's rules appears in the merged list with that window's covered dates contained in the merged covered dates; covered dates are sorted and unique; and the list is in `compareWindows` order.

**Validates: Requirements 9.1, 9.2, 9.3, 9.8**

### Property 12: Override precedence in the timeline

For any settings, the trip-level `stayType` and `checkInOverride` change the result only when the resolver returns a `legacy_resorts` or `implicit_no_lodging` segment, and the trip-level `lightningLaneTiming` changes the Lightning Lane windows of every segment.

**Validates: Requirements 9.5, 9.6**

### Property 13: The backfill is conservative and idempotent

For any set of existing Trips, running the migration twice yields the same rows as running it once; a single-resort Trip gets exactly one stay with the kind, check-in and check-out of Requirement 10.2; a multi-resort Trip gets one undated stay per resort in name-then-id order; a Trip with no resorts gets none; `trip_resorts` and `trip_booking_settings` are unchanged; and the derived booking timeline of every Trip is deeply equal before and after.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

### Property 14: Authorization and visibility

For any user and Trip, a non-member and an unknown Trip id receive the same `trip_forbidden` on `PUT /trips/:id/stays`; a Member who is not an Organizer receives `trip_forbidden`; an Organizer succeeds; and the Trip read paths expose stays only to Members.

**Validates: Requirements 5.6, 11.3**

### Property 15: The Trip read path stays batched

For a list of N Trips with any number of stays, the number of SQL statements to load their stays is constant (one), and each Trip receives only its own stays and warnings.

**Validates: Requirements 5.1**

### Property 16: Schemas round-trip and reject malformed input

For any valid stay input and PUT body, parse then serialize then parse yields an equal value; an unknown key, a malformed date, a bad person key, more than 8 stays, more than 50 keys, a `resort` kind without `resortId` or with a `placeName`, and a non-resort kind without `placeName` or with a `resortId` are rejected.

**Validates: Requirements 1.2, 1.4, 2.5, 6.1, 12.1**

## Error Handling

| Condition | Result |
| --- | --- |
| Non-member or unknown Trip | `trip_forbidden` (403), identical response |
| Member who is not an Organizer calls `PUT /trips/:id/stays` | `trip_forbidden` |
| Invalid body, overlap, inverted dates, over-limit stays, bad kind/resort/name combination | `trip_validation_failed` (400) with `field` naming the stay index; nothing written |
| Resort id missing or inactive | `trip_validation_failed` with `field: 'stays[i].resortId'`; nothing written |
| Input `id` belongs to another Trip | `trip_validation_failed` |
| Dates outside the Trip, gaps, undated stays | Accepted; returned as `stayWarnings` |
| Legacy `resortIds` with an unknown resort | Existing `trip_validation_failed` (unchanged) |
| Booking derivation given malformed stays | The resolver is total; malformed rows (a stay with one date) are treated as undated |
| Mobile network failure on save | Sheet stays open with an error message and the unsaved edits |

## Testing Strategy

Per the execution-discipline steering: Vitest in `apps/api` and `packages/shared`, Jest (`jest-expo`) in `apps/mobile`; property tests use `fast-check` with at least 100 runs and the tag `// Feature: trip-lodging-stays, Property N: <title>`.

| Layer | Tests |
| --- | --- |
| Shared (`tripStays.test.ts`, `tripStays.prop.test.ts`) | Schema valid and invalid cases; `validateStays` table tests (touching, overlapping, one-night overlap, 60 and 61 nights, 90 and 91 day span, 8 and 9 stays); `effectiveStays` examples (the three-hotel trip of the screenshot with and without dates, a gap, a stay before the trip, a one-day trip); `stayForNight` and `tonightsStay` on hand-off and checkout dates; warnings; Properties 1, 2, 3, 8, 9, 16 |
| Repo (`trips/__tests__/stays.test.ts`, pg-mem, reading rows back) | `replaceTripStays` create, update with id preserved, delete, reorder; rejected overlap changes nothing; foreign id rejected; inactive resort rejected; `trip_resorts` projection after each operation; legacy `resortIds` translation cases; trip-date follow cases; cascade on Trip delete; batched read for several Trips; Properties 4, 5, 6, 7, 15 |
| Concurrency | Two `PUT`s with `Promise.all` serialize under the Trip lock (Property 7) |
| Migration (`migration0073.test.ts` on pg-mem for the DDL; `migration0074.livedb.test.ts` on real Postgres for the backfill) | DDL: table, columns, every CHECK (kind rules, date pair, date order), indexes, NULL-column rows visible to an unpredicated select, cascade, idempotent re-apply, `buildMigratedDb()` still builds; backfill (livedb): single resort, with and without a valid `check_in_override`, with a `partner_hotel` `stay_type` override, single-day trip; multi-resort ordering; no resort; existing stays untouched on re-run; `trip_resorts` and `trip_booking_settings` unchanged (Property 13) |
| Routes (`server.inject`) | Auth gate (Property 14), happy path, each validation error, response `{ stays, stayWarnings }`, `TripDTO` carries stays |
| Booking timeline (`tripBooking/__tests__/timeline.stays.test.ts`) | Properties 10, 11, 12 with a golden multi-stay case (two resort stays and an off-site gap) and the existing timeline tests unmodified and green; reminder runner uses the new input |
| Guards | `roleReader.guard.test.ts`, `trip_memberships.guard.test.ts`, `visibility.guard.test.ts`, account-deletion registry test, `themeRetrofit.guard.test.ts` pass unchanged |
| Mobile (`@testing-library/react-native`) | Hub card renders stays, dates, nights, kind badge, "N of M people", "Dates not set" and each warning in words; Organizer sees edit controls and a Member does not; edit screen: add a Disney Resort stay (pick resort, dates default from the previous stay) and assert the `PUT` body; add an off-site stay by name; remove a stay; reorder by changing dates; "Everyone" versus a checklist and the stored `partyKeys`; save error keeps the sheet open; Live Glance names the stay for today, the incoming stay on a hand-off date, and falls back when none; booking settings disables the two controls with the explanation |

## Cross-Spec Dependencies and Build Order

- Built after: `trips`, `trip-booking-timeline`, `account-deletion`, `dark-mode`. Built **before**: `dining-plan-calculator`.
- Amended additively (Requirement 13): `trips`, `trip-booking-timeline`; `dining-plan-calculator` consumes `effectiveStays`.
- Order inside this plan: shared module, migration, repo, route, booking timeline, API checkpoint, mobile, amendments, final gate.
