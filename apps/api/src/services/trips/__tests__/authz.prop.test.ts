// Feature: trips, Property 11: Trip data access requires membership and does not disclose existence
/**
 * Property-based test for the Trip authorization gate `authz.ts` (task 5.6).
 *
 * Validates: Requirements 9.2, 10.7, 12.7, 13.10, 14.8, 15.1, 15.2, 15.4, 15.6
 *
 * Design Property 11 (design.md → Correctness Properties): "Trip data access
 * requires membership and does not disclose existence." For any authenticated
 * User and any Trip read / Trip_Summary request, the Trip_Service returns the
 * requested data scoped to that Trip only when the User is a current
 * Trip_Member (R15.1), and otherwise denies the request with an authorization
 * error carrying no Trip data and making no change (R15.2) — and, critically,
 * the denial for a Trip the User is not a member of is **byte-for-byte
 * identical** to the denial for a Trip that does not exist, so a former Member
 * (R15.6) and a stranger are both denied and neither can infer whether the
 * Trip exists (R15.4).
 *
 * The two gate functions `assertTripMember` / `assertTripOrganizer` are the
 * single choke point every gated Trip endpoint funnels through (the reads and
 * summary of R9.2, R10.7, R12.7, R13.10, R14.8 all sit behind them), so
 * exercising the gate directly is exactly the surface Property 11 constrains.
 *
 * Test strategy: drive the real `assertTripMember` / `assertTripOrganizer`
 * against a tiny in-memory fake `pg.Pool` that models only the one lookup the
 * gate performs — `SELECT role FROM trip_memberships WHERE trip_id = $1 AND
 * user_id = $2`. The fake pool is seeded with a membership set; whether a Trip
 * "exists" is modelled by whether it has *any* membership rows at all, which is
 * precisely how a non-existent Trip and an existing-but-inaccessible Trip both
 * reduce to "no row for (trip_id, caller)". Denials are captured into the full
 * wire response the global error hook would emit (status + envelope body:
 * code / message / field / details) so equality is a faithful stand-in for the
 * byte-for-byte identity the property demands. `numRuns: 100` per the spec
 * convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { errorCodeToHttpStatus } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import type { TripRole } from '../permissions.js';
import { assertTripMember, assertTripOrganizer } from '../authz.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// In-memory model of the single table the gate queries
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  readonly role: TripRole;
}

/**
 * Build a fake pool exposing only the `query` the gate uses. It answers the
 * membership lookup from `rows` and fails loudly on any other SQL so a future
 * change to the gate's query is surfaced by the test rather than silently
 * mis-modelled. A Trip with no rows is indistinguishable, at this layer, from
 * a Trip that does not exist — which is the whole point of Property 11.
 */
function makeFakePool(rows: ReadonlyArray<MembershipRow>): DbPool {
  return {
    async query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: unknown[] }> {
      const trimmed = text.trim();
      if (trimmed.startsWith('SELECT role FROM trip_memberships')) {
        const tripId = String(params?.[0]);
        const userId = String(params?.[1]);
        const matches = rows.filter(
          (r) => r.tripId === tripId && r.userId === userId,
        );
        return { rows: matches.map((r) => ({ role: r.role })) };
      }
      throw new Error(`unhandled SQL in fake pool: ${trimmed.slice(0, 64)}`);
    },
  } as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Denial capture
// ---------------------------------------------------------------------------

/**
 * The full wire response the global error hook would emit for a thrown
 * `AppError`: the HTTP status plus the envelope body fields (`code`,
 * `message`, and the optional `field` / `details`). Comparing two of these for
 * deep equality is a faithful stand-in for the "byte-for-byte identical"
 * denial the property requires — if any of these differed, the serialized
 * response would differ and existence could be probed.
 */
interface Denial {
  readonly threw: true;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly field: string | undefined;
  readonly details: unknown;
}

interface Granted {
  readonly threw: false;
  /** The role the gate resolved to (for `assertTripMember`) or `null`. */
  readonly role: TripRole | null;
}

type Outcome = Denial | Granted;

async function capture(fn: () => Promise<TripRole | void>): Promise<Outcome> {
  try {
    const role = await fn();
    return { threw: false, role: (role as TripRole | undefined) ?? null };
  } catch (err) {
    if (err instanceof AppError) {
      return {
        threw: true,
        status: errorCodeToHttpStatus[err.code],
        code: err.code,
        message: err.message,
        field: err.field,
        details: err.details,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const roleArb: fc.Arbitrary<TripRole> = fc.constantFrom('organizer', 'member');

/**
 * A scenario for the non-disclosure comparison: a Trip that genuinely exists
 * (it has one-or-more *other* Members) plus a caller who is NOT one of them.
 * The caller stands in for both a stranger and a former Member — the gate
 * cannot tell them apart, and neither can the test.
 */
const nonMemberScenarioArb = fc
  .record({
    tripId: fc.uuid(),
    callerId: fc.uuid(),
    otherMembers: fc.array(
      fc.record({ userId: fc.uuid(), role: roleArb }),
      { minLength: 1, maxLength: 6 },
    ),
  })
  .map((s) => ({
    tripId: s.tripId,
    callerId: s.callerId,
    otherMembers: s.otherMembers.filter((m) => m.userId !== s.callerId),
  }))
  .filter((s) => s.otherMembers.length >= 1);

/** A scenario where the caller holds a known role on the Trip. */
const memberScenarioArb = fc.record({
  tripId: fc.uuid(),
  callerId: fc.uuid(),
  role: roleArb,
});

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

describe('authz — Property 11: access requires membership and does not disclose existence', () => {
  it('collapses a non-member of an existing Trip and a non-existent Trip to an identical trip_forbidden denial (assertTripMember)', async () => {
    await fc.assert(
      fc.asyncProperty(nonMemberScenarioArb, async (s) => {
        // Case A: the Trip exists (it has other Members) but the caller is not
        // one of them.
        const existingRows: MembershipRow[] = s.otherMembers.map((m) => ({
          tripId: s.tripId,
          userId: m.userId,
          role: m.role,
        }));
        const poolExists = makeFakePool(existingRows);

        // Case B: the Trip does not exist at all — no membership rows anywhere.
        const poolAbsent = makeFakePool([]);

        const denialExisting = await capture(() =>
          assertTripMember(poolExists, s.callerId, s.tripId),
        );
        const denialAbsent = await capture(() =>
          assertTripMember(poolAbsent, s.callerId, s.tripId),
        );

        // Both are denials, both carry the opaque trip_forbidden code and
        // nothing else (no Trip data leaked): R15.2.
        expect(denialExisting.threw).toBe(true);
        expect(denialAbsent.threw).toBe(true);
        expect((denialExisting as Denial).code).toBe('trip_forbidden');

        // Non-disclosure: the two denials are byte-for-byte identical, so a
        // stranger / former Member cannot tell an inaccessible Trip from a
        // non-existent one: R15.4, R15.6.
        expect(denialExisting).toEqual(denialAbsent);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('collapses a non-member of an existing Trip and a non-existent Trip to an identical trip_forbidden denial (assertTripOrganizer)', async () => {
    await fc.assert(
      fc.asyncProperty(nonMemberScenarioArb, async (s) => {
        const existingRows: MembershipRow[] = s.otherMembers.map((m) => ({
          tripId: s.tripId,
          userId: m.userId,
          role: m.role,
        }));
        const poolExists = makeFakePool(existingRows);
        const poolAbsent = makeFakePool([]);

        const denialExisting = await capture(() =>
          assertTripOrganizer(poolExists, s.callerId, s.tripId),
        );
        const denialAbsent = await capture(() =>
          assertTripOrganizer(poolAbsent, s.callerId, s.tripId),
        );

        expect(denialExisting.threw).toBe(true);
        expect(denialAbsent.threw).toBe(true);
        expect((denialExisting as Denial).code).toBe('trip_forbidden');
        expect(denialExisting).toEqual(denialAbsent);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('grants member access only when a membership row exists, returning the exact stored role', async () => {
    await fc.assert(
      fc.asyncProperty(memberScenarioArb, async (s) => {
        const pool = makeFakePool([
          { tripId: s.tripId, userId: s.callerId, role: s.role },
        ]);

        // A current Trip_Member is granted access and the gate reports their
        // exact role — access requires (and is granted by) membership: R15.1.
        const outcome = await capture(() =>
          assertTripMember(pool, s.callerId, s.tripId),
        );
        expect(outcome.threw).toBe(false);
        expect((outcome as Granted).role).toBe(s.role);

        // The organizer gate admits the same Member iff they are an organizer;
        // a plain member is denied with the identical opaque trip_forbidden
        // error (no Trip data, no probing signal): R15.2, R15.5.
        const organizerOutcome = await capture(() =>
          assertTripOrganizer(pool, s.callerId, s.tripId),
        );
        if (s.role === 'organizer') {
          expect(organizerOutcome.threw).toBe(false);
        } else {
          expect(organizerOutcome.threw).toBe(true);
          expect((organizerOutcome as Denial).code).toBe('trip_forbidden');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
