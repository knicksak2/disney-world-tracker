/**
 * Trip lodging Stays: the `trip_stays` SQL (trip-lodging-stays spec, tasks 4 and 5).
 *
 * Every function takes the caller's {@link Queryable} (a pool for plain reads, a `PoolClient` inside a transaction) and
 * assumes the table exists. The functions that WRITE also assume the caller's transaction already holds
 * `SELECT id FROM trips WHERE id = $1 FOR UPDATE`, which serializes concurrent edits of one Trip.
 *
 * {@link isTripStaysAvailable} is the per-pool probe the Trip repo consults before touching this module, because many
 * existing suites load a fixed migration list that predates `0073`. The probe runs on the POOL (never on a client that
 * is inside a transaction), since a failing statement would abort that transaction in Postgres.
 *
 * Person keys in `party_keys` are plain text with no reference to a user account (Requirement 6.3), so nothing here reads
 * `trip_memberships`, `users` or `profiles`.
 */

import type {
  StayType,
  TripStayDTO,
  TripStayInput,
} from '@dwt/shared';
import { stayNights, tripStayInputSchema, validateStays, TRIP_STAY_LIMIT } from '@dwt/shared';
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

/** Pool or in-transaction client: both expose `query`. */
export type Queryable = Pick<PoolClient, 'query'>;

/** The Trip facts a write needs; the caller already holds the Trip row lock. */
export interface StayTripRef {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
}

interface StayRow {
  id: string;
  trip_id: string;
  position: number;
  lodging_kind: StayType;
  resort_id: string | null;
  place_name: string | null;
  resort_name: string | null;
  check_in: Date | string | null;
  check_out: Date | string | null;
  party_keys: unknown;
}

// ---------------------------------------------------------------------------
// Table-existence probe
// ---------------------------------------------------------------------------

const tripStaysAvailableCache = new WeakMap<object, boolean>();

/**
 * True when `trip_stays` exists. Cached per pool; the first call costs one `SELECT 1 ... LIMIT 0`. Built like
 * `isTripFoodListsAvailable` in `trips/repo.ts`.
 */
export async function isTripStaysAvailable(pool: DbPool): Promise<boolean> {
  const cached = tripStaysAvailableCache.get(pool as unknown as object);
  if (cached !== undefined) return cached;
  try {
    await pool.query('SELECT 1 FROM trip_stays LIMIT 0');
    tripStaysAvailableCache.set(pool as unknown as object, true);
    return true;
  } catch {
    tripStaysAvailableCache.set(pool as unknown as object, false);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` from a `DATE` value (`pg` returns a `Date` at UTC midnight; a custom parser may return a string). */
function toYmd(value: Date | string): string {
  if (typeof value === 'string') return value.length >= 10 ? value.slice(0, 10) : value;
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parsePartyKeys(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : null;
}

function rowToStay(row: StayRow): TripStayDTO {
  // `== null`: a driver or scripted pool may omit a NULL column instead of returning null.
  const checkIn = row.check_in == null ? null : toYmd(row.check_in);
  const checkOut = row.check_out == null ? null : toYmd(row.check_out);
  const scheduled = checkIn !== null && checkOut !== null && checkOut > checkIn;
  return {
    id: row.id,
    position: row.position,
    lodgingKind: row.lodging_kind,
    resortId: row.resort_id,
    placeName: row.place_name,
    displayName: row.lodging_kind === 'resort' ? (row.resort_name ?? '') : (row.place_name ?? ''),
    checkIn,
    checkOut,
    nights: scheduled ? stayNights(checkIn, checkOut).length : null,
    partyKeys: parsePartyKeys(row.party_keys),
  };
}

/** Requirement 1.1: scheduled Stays by `check_in`, then unscheduled Stays, each tie broken by `position` then id. */
function byStoredOrder(a: TripStayDTO, b: TripStayDTO): number {
  const aScheduled = a.checkIn !== null;
  const bScheduled = b.checkIn !== null;
  if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;
  if (aScheduled && bScheduled && a.checkIn !== b.checkIn) return (a.checkIn as string) < (b.checkIn as string) ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read the Stays of one or more Trips in a SINGLE statement, grouped by Trip. A Trip with no Stay is absent from the map.
 * Ordering is done in memory so the SQL needs no `NULLS LAST` (pg-mem rejects it).
 */
export async function selectTripStaysByTrip(
  q: Queryable,
  tripIds: readonly string[],
): Promise<Map<string, TripStayDTO[]>> {
  const byTrip = new Map<string, TripStayDTO[]>();
  if (tripIds.length === 0) return byTrip;
  const placeholders = tripIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await q.query<StayRow>(
    `SELECT s.id, s.trip_id, s.position, s.lodging_kind, s.resort_id, s.place_name,
            r.name AS resort_name, s.check_in, s.check_out, s.party_keys
       FROM trip_stays s
       LEFT JOIN resorts r ON r.id = s.resort_id
      WHERE s.trip_id IN (${placeholders})
      ORDER BY s.trip_id ASC, s.position ASC, s.id ASC`,
    [...tripIds],
  );
  for (const row of result.rows) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(rowToStay(row));
    byTrip.set(row.trip_id, list);
  }
  for (const list of byTrip.values()) list.sort(byStoredOrder);
  return byTrip;
}

// ---------------------------------------------------------------------------
// Writes (the caller holds the Trip row lock)
// ---------------------------------------------------------------------------

function fail(message: string, field: string): never {
  throw new AppError('trip_validation_failed', message, { field });
}

/**
 * Make `trip_resorts` equal to the distinct Resorts of the Trip's Stays (Requirement 4.1), so every existing reader of
 * `trip_resorts` keeps working. A `partner_hotel` or `offsite` Stay has no `resort_id` and contributes nothing.
 */
export async function rewriteTripResorts(client: Queryable, tripId: string): Promise<void> {
  const res = await client.query<{ resort_id: string }>(
    `SELECT resort_id FROM trip_stays WHERE trip_id = $1 AND resort_id IS NOT NULL ORDER BY position ASC, id ASC`,
    [tripId],
  );
  const distinct = [...new Set(res.rows.map((r) => r.resort_id))];
  await client.query(`DELETE FROM trip_resorts WHERE trip_id = $1`, [tripId]);
  if (distinct.length > 0) {
    const values = distinct.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ${values}`, [tripId, ...distinct]);
  }
}

interface StayColumns {
  readonly lodgingKind: StayType;
  readonly resortId: string | null;
  readonly placeName: string | null;
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly partyKeys: readonly string[] | null;
}

function columnsFromInput(s: TripStayInput): StayColumns {
  const resort = s.lodgingKind === 'resort';
  return {
    lodgingKind: s.lodgingKind,
    resortId: resort ? (s.resortId ?? null) : null,
    placeName: resort ? null : (s.placeName ?? null),
    checkIn: s.checkIn ?? null,
    checkOut: s.checkOut ?? null,
    partyKeys: s.partyKeys ?? null,
  };
}

async function insertStay(client: Queryable, tripId: string, position: number, c: StayColumns): Promise<void> {
  await client.query(
    `INSERT INTO trip_stays (trip_id, position, lodging_kind, resort_id, place_name, check_in, check_out, party_keys)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tripId,
      position,
      c.lodgingKind,
      c.resortId,
      c.placeName,
      c.checkIn,
      c.checkOut,
      c.partyKeys === null ? null : JSON.stringify(c.partyKeys),
    ],
  );
}

/** Every `resortIds` entry must reference an existing, active catalog Resort; returns the ids missing or inactive. */
async function missingActiveResorts(client: Queryable, ids: readonly string[]): Promise<Set<string>> {
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) return new Set();
  const placeholders = distinct.map((_, i) => `$${i + 1}`).join(', ');
  const found = await client.query<{ id: string }>(
    `SELECT id FROM resorts WHERE id IN (${placeholders}) AND active = TRUE`,
    distinct,
  );
  const ok = new Set(found.rows.map((r) => r.id));
  return new Set(distinct.filter((id) => !ok.has(id)));
}

/**
 * Replace the Trip's Stays with exactly `input` (Requirement 5.3): an input with an `id` updates that Stay and keeps the
 * id, an input without one creates a Stay, and a stored Stay whose id is absent is deleted. `position` becomes the array
 * index. Everything is validated before the first write, so a rejected request changes nothing. Ends by rewriting
 * `trip_resorts`.
 *
 * Throws `trip_validation_failed` with `field` naming the offending entry (`stays[2]`, `stays[0].resortId`, `stays[1].id`).
 */
export async function replaceTripStays(
  client: Queryable,
  trip: StayTripRef,
  input: readonly TripStayInput[],
): Promise<TripStayDTO[]> {
  if (input.length > TRIP_STAY_LIMIT) fail(`A Trip can have at most ${TRIP_STAY_LIMIT} stays.`, 'stays');

  const current = (await selectTripStaysByTrip(client, [trip.id])).get(trip.id) ?? [];
  const currentIds = new Set(current.map((s) => s.id));

  const seen = new Set<string>();
  input.forEach((s, i) => {
    if (s.id === undefined) return;
    if (!currentIds.has(s.id)) fail('That stay does not belong to this Trip.', `stays[${i}].id`);
    if (seen.has(s.id)) fail('A stay appears more than once.', `stays[${i}].id`);
    seen.add(s.id);
  });

  // Defense in depth for direct callers: the route already parsed the body, but the table CHECKs would otherwise
  // surface as a raw database error.
  input.forEach((s, i) => {
    const parsed = tripStayInputSchema.safeParse(s);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path.join('.') ?? '';
      fail('That stay is not valid.', path === '' ? `stays[${i}]` : `stays[${i}].${path}`);
    }
  });

  const problem = validateStays(
    input.map((s) => ({ checkIn: s.checkIn ?? null, checkOut: s.checkOut ?? null })),
  )[0];
  if (problem) fail(problem.message, problem.stayIndex === undefined ? 'stays' : `stays[${problem.stayIndex}]`);

  const wanted = input.flatMap((s, i) =>
    s.lodgingKind === 'resort' && s.resortId != null ? [{ id: s.resortId, index: i }] : [],
  );
  const missing = await missingActiveResorts(client, wanted.map((w) => w.id));
  const bad = wanted.find((w) => missing.has(w.id));
  if (bad) fail('That resort does not exist or is unavailable.', `stays[${bad.index}].resortId`);

  for (const stored of current) {
    if (!seen.has(stored.id)) {
      await client.query(`DELETE FROM trip_stays WHERE id = $1 AND trip_id = $2`, [stored.id, trip.id]);
    }
  }
  for (const [i, s] of input.entries()) {
    const c = columnsFromInput(s);
    if (s.id === undefined) {
      await insertStay(client, trip.id, i, c);
    } else {
      await client.query(
        `UPDATE trip_stays
            SET position = $1, lodging_kind = $2, resort_id = $3, place_name = $4,
                check_in = $5, check_out = $6, party_keys = $7, updated_at = now()
          WHERE id = $8 AND trip_id = $9`,
        [
          i,
          c.lodgingKind,
          c.resortId,
          c.placeName,
          c.checkIn,
          c.checkOut,
          c.partyKeys === null ? null : JSON.stringify(c.partyKeys),
          s.id,
          trip.id,
        ],
      );
    }
  }

  await rewriteTripResorts(client, trip.id);
  return (await selectTripStaysByTrip(client, [trip.id])).get(trip.id) ?? [];
}

/**
 * The legacy `resortIds` field of `POST /trips` and `PATCH /trips/:id` (Requirement 4.2). When the requested set equals
 * the Resorts of the Trip's `resort` Stays nothing changes. Otherwise every Stay is replaced: no ids none; one id one
 * resort Stay dated like the Trip (unscheduled for a one-day Trip); several ids that many unscheduled Stays in the order
 * given. `trip_resorts` is then rewritten from the new Stays.
 */
export async function translateLegacyResortIds(
  client: Queryable,
  trip: StayTripRef,
  resortIds: readonly string[],
): Promise<void> {
  const distinct = [...new Set(resortIds)];
  if (distinct.length > TRIP_STAY_LIMIT) {
    fail(`A Trip can have at most ${TRIP_STAY_LIMIT} stays.`, 'resortIds');
  }
  if ((await missingActiveResorts(client, distinct)).size > 0) {
    fail('One or more resorts do not exist or are unavailable.', 'resortIds');
  }

  const current = (await selectTripStaysByTrip(client, [trip.id])).get(trip.id) ?? [];
  const currentResorts = new Set(
    current.filter((s) => s.lodgingKind === 'resort' && s.resortId !== null).map((s) => s.resortId as string),
  );
  const same = currentResorts.size === distinct.length && distinct.every((id) => currentResorts.has(id));
  if (same) {
    // Keep trip_resorts in step even when the Stays are untouched (a Trip that predates the table, or a drifted row).
    await rewriteTripResorts(client, trip.id);
    return;
  }

  await client.query(`DELETE FROM trip_stays WHERE trip_id = $1`, [trip.id]);
  const dated = distinct.length === 1 && trip.endDate > trip.startDate;
  for (const [i, resortId] of distinct.entries()) {
    await insertStay(client, trip.id, i, {
      lodgingKind: 'resort',
      resortId,
      placeName: null,
      checkIn: dated ? trip.startDate : null,
      checkOut: dated ? trip.endDate : null,
      partyKeys: null,
    });
  }
  await rewriteTripResorts(client, trip.id);
}

/**
 * Requirement 4.4: when the Trip's dates change and the Trip has exactly one Scheduled_Stay whose dates equal the PREVIOUS
 * Trip start and end, move that Stay to the new dates (to unscheduled when the new Trip is a single day). Any other shape
 * is left alone.
 */
export async function followTripDates(
  client: Queryable,
  tripId: string,
  oldDates: { readonly startDate: string; readonly endDate: string },
  newDates: { readonly startDate: string; readonly endDate: string },
): Promise<void> {
  if (oldDates.startDate === newDates.startDate && oldDates.endDate === newDates.endDate) return;
  const stays = (await selectTripStaysByTrip(client, [tripId])).get(tripId) ?? [];
  const scheduled = stays.filter((s) => s.checkIn !== null && s.checkOut !== null);
  const only = scheduled.length === 1 ? scheduled[0] : undefined;
  if (!only || only.checkIn !== oldDates.startDate || only.checkOut !== oldDates.endDate) return;

  const dated = newDates.endDate > newDates.startDate;
  await client.query(
    `UPDATE trip_stays SET check_in = $1, check_out = $2, updated_at = now() WHERE id = $3 AND trip_id = $4`,
    [dated ? newDates.startDate : null, dated ? newDates.endDate : null, only.id, tripId],
  );
}
