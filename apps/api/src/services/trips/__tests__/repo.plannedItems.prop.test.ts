// Feature: trips, Property 16: Planned_List add records the adder and rejects duplicates; removal is by adder or organizer
/**
 * Property-based test for the Planned_List add/remove rules (task 8.2).
 *
 * Validates: Requirements 9.1, 9.3, 9.6, 9.7
 *
 * Design Property 16 (design.md → Correctness Properties):
 *
 *   Adding an Experience to a Trip's Planned_List records the adding
 *   Trip_Member (R9.1) and rejects a duplicate Experience (R9.3), an Experience
 *   absent from the Catalog (R9.4), and any add past the 500-item cap (R9.5).
 *   Removing a Planned_Item is permitted for the Trip_Member who added it
 *   (R9.6) and for any Organizer (R9.7), while a Member removing another
 *   Member's item is rejected with `trip_forbidden` (R9.8).
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 8.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the tables the planned-item operations touch — `trips`
 * (row-lock target), `experiences` (Catalog existence, seeded read-only),
 * `planned_items`, and `profiles` (adder display-name join, seeded read-only).
 * The fake pool dispatches the SQL fragments the repo emits (`BEGIN`, the
 * lock/existence/duplicate/count `SELECT`s, the `INSERT ... RETURNING`, the
 * read-back join, the `DELETE`, and `COMMIT` / `ROLLBACK`) to a
 * snapshot-per-transaction layer so the property exercises the production code
 * path (`addPlannedItem` / `removePlannedItem`) rather than a re-implementation
 * of it. Per the tasks.md convention the stateful property runs against this
 * in-memory model; the SQL repo is pinned to the same behaviour by the
 * cross-service integration tests.
 *
 * The scenario fixes one Trip with a small membership — one Organizer and two
 * Members — and a fixed Catalog of Experiences plus a supply of Experience ids
 * absent from the Catalog. A random interleaving of add/remove commands is
 * generated; after every command a set of global invariants is re-checked:
 * model and store agree on the Planned_List contents, every stored item names a
 * known adder and a Catalog Experience, and no Experience appears twice on the
 * list.
 *
 * `numRuns: 100` per the spec convention. The 500-item cap (R9.5) is covered by
 * a dedicated seeded property below because it cannot be reached through a
 * bounded command sequence.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { Park, PlannedItemAddInput } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import type { TripRole } from '../permissions.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;
const PLANNED_ITEM_LIMIT = 500;

/** The fixed Trip every planned item in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The fixed membership: one Organizer and two Members. */
interface Member {
  readonly userId: string;
  readonly role: TripRole;
  readonly displayName: string;
}
const MEMBERS: readonly Member[] = [
  {
    userId: '00000000-0000-4000-8000-000000000000',
    role: 'organizer',
    displayName: 'Olivia Organizer',
  },
  {
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'member',
    displayName: 'Aaron Member',
  },
  {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'member',
    displayName: 'Bianca Member',
  },
] as const;

const ORGANIZER = MEMBERS[0]!;

/** A fixed Catalog of Experiences the Planned_List may reference (R9.4). */
interface CatalogExperience {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
}
const CATALOG: readonly CatalogExperience[] = [
  { id: 'e0000000-0000-4000-8000-000000000001', name: 'Space Mountain', park: 'Magic Kingdom' },
  { id: 'e0000000-0000-4000-8000-000000000002', name: 'Test Track', park: 'EPCOT' },
  { id: 'e0000000-0000-4000-8000-000000000003', name: 'Tower of Terror', park: 'Hollywood Studios' },
  { id: 'e0000000-0000-4000-8000-000000000004', name: 'Expedition Everest', park: 'Animal Kingdom' },
  { id: 'e0000000-0000-4000-8000-000000000005', name: 'Haunted Mansion', park: 'Magic Kingdom' },
] as const;

// ---------------------------------------------------------------------------
// In-memory model of the tables the planned-item operations touch
// ---------------------------------------------------------------------------

interface PlannedItemRow {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly addedBy: string;
}

/**
 * The whole backing store. `experiences` and `profiles` are read-only lookups
 * seeded at setup; `plannedItems` is snapshotted per transaction so a
 * `ROLLBACK` faithfully discards a rejected add/remove's partial writes (the
 * "SHALL NOT create/remove" clauses of R9.3–R9.8).
 */
interface Store {
  readonly experiences: ReadonlyMap<string, CatalogExperience>;
  readonly profiles: ReadonlyMap<string, string>;
  plannedItems: PlannedItemRow[];
}

function makeStore(seedItems: readonly PlannedItemRow[] = []): Store {
  const experiences = new Map<string, CatalogExperience>();
  for (const e of CATALOG) experiences.set(e.id, e);
  const profiles = new Map<string, string>();
  for (const m of MEMBERS) profiles.set(m.userId, m.displayName);
  return { experiences, profiles, plannedItems: seedItems.slice() };
}

interface Tx {
  plannedItems: PlannedItemRow[];
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

interface FakePool {
  connect(): Promise<FakeClient>;
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Project a stored planned item to the read-back join row `selectPlannedItem` returns. */
function projectRow(store: Store, item: PlannedItemRow): Record<string, unknown> {
  const exp = store.experiences.get(item.experienceId)!;
  return {
    id: item.id,
    experience_id: item.experienceId,
    experience_name: exp.name,
    park: exp.park,
    added_by_display_name: store.profiles.get(item.addedBy)!,
  };
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments the
 * planned-item operations emit are modelled; anything else fails loudly so a
 * future SQL drift is surfaced by the test rather than silently ignored.
 */
function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): { rows: unknown[]; rowCount: number } => ({
    rows,
    rowCount: rows.length,
  });

  const connect = async (): Promise<FakeClient> => {
    let tx: Tx | null = null;
    return {
      async query(
        text: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<{ rows: unknown[]; rowCount: number }> {
        const sql = norm(text);

        // ---- transaction control -----------------------------------
        if (sql.startsWith('BEGIN')) {
          tx = { plannedItems: store.plannedItems.slice() };
          return ok([]);
        }
        if (sql.startsWith('COMMIT')) {
          if (tx === null) throw new Error('COMMIT without BEGIN');
          store.plannedItems = tx.plannedItems.slice();
          tx = null;
          return ok([]);
        }
        if (sql.startsWith('ROLLBACK')) {
          tx = null;
          return ok([]);
        }

        if (tx === null) {
          throw new Error(`data-plane query without BEGIN: ${sql.slice(0, 64)}`);
        }

        // ---- addPlannedItem: row-lock the Trip (R9.5 race guard) ----
        if (sql.startsWith('SELECT 1 FROM trips')) {
          const [tripId] = params as [string];
          return ok(tripId === TRIP_ID ? [{ '?column?': 1 }] : []);
        }

        // ---- addPlannedItem: Catalog existence (R9.4) ---------------
        if (sql.startsWith('SELECT 1 FROM experiences')) {
          const [experienceId] = params as [string];
          return ok(store.experiences.has(experienceId) ? [{ '?column?': 1 }] : []);
        }

        // ---- addPlannedItem: 500-item count (R9.5) ------------------
        if (sql.startsWith('SELECT count(*) AS count FROM planned_items')) {
          const [tripId] = params as [string];
          const n = tx.plannedItems.filter((i) => i.tripId === tripId).length;
          return ok([{ count: String(n) }]);
        }

        // ---- addPlannedItem: duplicate Experience (R9.3) ------------
        if (sql.startsWith('SELECT 1 FROM planned_items')) {
          const [tripId, experienceId] = params as [string, string];
          const hit = tx.plannedItems.some(
            (i) => i.tripId === tripId && i.experienceId === experienceId,
          );
          return ok(hit ? [{ '?column?': 1 }] : []);
        }

        // ---- removePlannedItem: lock + read adder, scoped to Trip ---
        if (sql.startsWith('SELECT added_by FROM planned_items')) {
          const [itemId, tripId] = params as [string, string];
          const row = tx.plannedItems.find(
            (i) => i.id === itemId && i.tripId === tripId,
          );
          return ok(row ? [{ added_by: row.addedBy }] : []);
        }

        // ---- addPlannedItem: insert the item, recording the adder ---
        if (sql.startsWith('INSERT INTO planned_items')) {
          const [tripId, experienceId, addedBy] = params as [string, string, string];
          const id = randomUUID();
          tx.plannedItems.push({ id, tripId, experienceId, addedBy });
          return ok([{ id }]);
        }

        // ---- addPlannedItem: read-back join projection --------------
        if (sql.startsWith('SELECT pi.id')) {
          const [itemId] = params as [string];
          const row = tx.plannedItems.find((i) => i.id === itemId);
          return ok(row ? [projectRow(store, row)] : []);
        }

        // ---- removePlannedItem: delete the item ---------------------
        if (sql.startsWith('DELETE FROM planned_items')) {
          const [itemId] = params as [string];
          tx.plannedItems = tx.plannedItems.filter((i) => i.id !== itemId);
          return ok([]);
        }

        throw new Error(`unhandled SQL in fake pool: ${sql.slice(0, 80)}`);
      },
      release(): void {
        tx = null;
      },
    };
  };

  return {
    connect,
    // `listPlannedItems` uses the pool directly, but this property drives only
    // add/remove; a pool-level query outside a transaction is not expected.
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      throw new Error('pool.query is not modelled for the planned-item property');
    },
  };
}

/** Planned-item operations never touch the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface ModelItem {
  /** Real planned_items id, assigned on a successful add. */
  id: string;
  readonly experienceId: string;
  readonly addedBy: string;
}

interface Model {
  readonly items: ModelItem[];
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError(${code}) but the call resolved`);
}

/**
 * Global invariants re-checked after every command:
 *   - model and store agree on the set of planned items (by id/experience/adder),
 *   - every stored item references a Catalog Experience and a known adder,
 *   - no Experience appears more than once on the Trip's Planned_List (R9.3).
 */
function assertInvariants(m: Model, r: Real): void {
  const storeItems = r.store.plannedItems.filter((i) => i.tripId === TRIP_ID);

  // Model and store agree on contents (compared as id → experience/adder maps).
  expect(storeItems).toHaveLength(m.items.length);
  const storeById = new Map(storeItems.map((i) => [i.id, i]));
  for (const mi of m.items) {
    const si = storeById.get(mi.id);
    expect(si).toBeDefined();
    expect(si!.experienceId).toBe(mi.experienceId);
    expect(si!.addedBy).toBe(mi.addedBy);
  }

  // Every stored item is well-formed and Experiences are unique.
  const seenExperiences = new Set<string>();
  for (const si of storeItems) {
    expect(r.store.experiences.has(si.experienceId)).toBe(true);
    expect(r.store.profiles.has(si.addedBy)).toBe(true);
    expect(seenExperiences.has(si.experienceId)).toBe(false);
    seenExperiences.add(si.experienceId);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `AddPlannedItem(adderIndex, experienceIndex, unknownExperience)`: a
 * Trip_Member adds an Experience. A Catalog-absent Experience is rejected with
 * `trip_validation_failed` (R9.4); an Experience already on the list is
 * rejected with `trip_validation_failed` (R9.3); otherwise the item is created,
 * recording the adder (R9.1), and the returned projection carries the
 * Experience name/park and the adder's display name.
 */
class AddPlannedItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly adderIndex: number,
    public readonly experienceIndex: number,
    public readonly unknownExperience: boolean,
  ) {}

  private adder(): Member {
    return MEMBERS[this.adderIndex % MEMBERS.length]!;
  }

  private experienceId(): string {
    if (this.unknownExperience) {
      // A deterministic id absent from the Catalog.
      return `f0000000-0000-4000-8000-0000000000${String(
        this.experienceIndex % 100,
      ).padStart(2, '0')}`;
    }
    return CATALOG[this.experienceIndex % CATALOG.length]!.id;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const adder = this.adder();
    const experienceId = this.experienceId();
    const input: PlannedItemAddInput = { experienceId };

    if (this.unknownExperience) {
      // R9.4: unknown Catalog Experience is rejected; nothing is created.
      const before = r.store.plannedItems.length;
      await expectAppError(
        () => r.repo.addPlannedItem(TRIP_ID, adder.userId, input),
        'trip_validation_failed',
      );
      expect(r.store.plannedItems.length).toBe(before);
    } else if (m.items.some((i) => i.experienceId === experienceId)) {
      // R9.3: duplicate Experience is rejected; no duplicate item is created.
      const before = r.store.plannedItems.length;
      await expectAppError(
        () => r.repo.addPlannedItem(TRIP_ID, adder.userId, input),
        'trip_validation_failed',
      );
      expect(r.store.plannedItems.length).toBe(before);
    } else {
      const dto = await r.repo.addPlannedItem(TRIP_ID, adder.userId, input);

      // The item references the Experience and records the adder (R9.1, R9.9).
      const exp = CATALOG.find((e) => e.id === experienceId)!;
      expect(dto.experienceId).toBe(experienceId);
      expect(dto.experienceName).toBe(exp.name);
      expect(dto.park).toBe(exp.park);
      expect(dto.addedByDisplayName).toBe(adder.displayName);

      // The persisted row records the adding Trip_Member (R9.1).
      const stored = r.store.plannedItems.find((i) => i.id === dto.id);
      expect(stored).toBeDefined();
      expect(stored!.addedBy).toBe(adder.userId);

      m.items.push({ id: dto.id, experienceId, addedBy: adder.userId });
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `AddPlannedItem(adder=${this.adder().displayName}, exp=${this.experienceId().slice(
      0,
      10,
    )}, unknown=${this.unknownExperience})`;
  }
}

/**
 * `RemovePlannedItem(itemSelector, callerIndex)`: a Trip_Member removes an
 * existing Planned_Item. An Organizer may remove any item (R9.7); a Member may
 * remove only an item they added (R9.6). A Member removing another Member's
 * item is rejected with `trip_forbidden` and the item is left in place (R9.8).
 */
class RemovePlannedItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly itemSelector: number,
    public readonly callerIndex: number,
  ) {}

  private caller(): Member {
    return MEMBERS[this.callerIndex % MEMBERS.length]!;
  }

  check(m: Readonly<Model>): boolean {
    return m.items.length > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const idx = this.itemSelector % m.items.length;
    const item = m.items[idx]!;
    const caller = this.caller();
    const allowed = caller.role === 'organizer' || item.addedBy === caller.userId;

    if (allowed) {
      const removed = await r.repo.removePlannedItem(
        TRIP_ID,
        item.id,
        caller.userId,
        caller.role,
      );
      expect(removed).toBe(true);
      m.items.splice(idx, 1);
    } else {
      const before = r.store.plannedItems.length;
      await expectAppError(
        () =>
          r.repo.removePlannedItem(TRIP_ID, item.id, caller.userId, caller.role),
        'trip_forbidden',
      );
      // The rejected remove leaves the item in place.
      expect(r.store.plannedItems.length).toBe(before);
      expect(r.store.plannedItems.some((i) => i.id === item.id)).toBe(true);
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `RemovePlannedItem(#${this.itemSelector}, caller=${this.caller().displayName})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Planned_List add/remove — Property 16: adder recorded, duplicates rejected, removal by adder or organizer', () => {
  it('records the adder, rejects duplicate/unknown Experiences, and scopes removal to the adder or an Organizer', async () => {
    const commandArb = fc.oneof(
      fc
        .tuple(
          fc.nat({ max: MEMBERS.length - 1 }),
          fc.nat({ max: 20 }),
          fc.boolean(),
        )
        .map(([a, e, u]) => new AddPlannedItemCommand(a, e, u)),
      fc
        .tuple(fc.nat({ max: 1000 }), fc.nat({ max: MEMBERS.length - 1 }))
        .map(([s, c]) => new RemovePlannedItemCommand(s, c)),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            NOOP_DEPS,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { items: [] },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// The 500-item cap (R9.5)
// ---------------------------------------------------------------------------

/**
 * The 500-item cap cannot be reached through a bounded command sequence, so it
 * is exercised directly: seed a Planned_List of exactly `n` items and assert
 * that an add is rejected with `trip_planned_limit` when the list already holds
 * the maximum (and no item is created), while an add succeeds when the list
 * still has room.
 */
describe('addPlannedItem — Property 16: the Planned_List holds at most 500 items (R9.5)', () => {
  it('rejects an add at the cap and permits one below it, for any near-cap fill level', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: PLANNED_ITEM_LIMIT - 3, max: PLANNED_ITEM_LIMIT + 3 }),
        async (fill) => {
          // Seed `fill` items referencing distinct (synthetic) Catalog rows so
          // the duplicate check never short-circuits the count check.
          const seedExperiences = new Map<string, CatalogExperience>();
          const seeded: PlannedItemRow[] = [];
          for (let i = 0; i < fill; i += 1) {
            const id = `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
            seedExperiences.set(id, { id, name: `Seed ${i}`, park: 'EPCOT' });
            seeded.push({
              id: randomUUID(),
              tripId: TRIP_ID,
              experienceId: id,
              addedBy: ORGANIZER.userId,
            });
          }

          const store = makeStore(seeded);
          // Merge the synthetic Catalog rows into the read-only experiences map.
          const experiences = new Map(store.experiences);
          for (const [id, e] of seedExperiences) experiences.set(id, e);
          const freshExperienceId = 'c0000000-0000-4000-8000-000000000abc';
          experiences.set(freshExperienceId, {
            id: freshExperienceId,
            name: 'Fresh Experience',
            park: 'Magic Kingdom',
          });
          const store2: Store = {
            experiences,
            profiles: store.profiles,
            plannedItems: seeded.slice(),
          };

          const repo = createTripRepo(
            makeFakePool(store2) as unknown as DbPool,
            NOOP_DEPS,
          );
          const input: PlannedItemAddInput = { experienceId: freshExperienceId };

          if (fill >= PLANNED_ITEM_LIMIT) {
            const before = store2.plannedItems.length;
            await expectAppError(
              () => repo.addPlannedItem(TRIP_ID, ORGANIZER.userId, input),
              'trip_planned_limit',
            );
            expect(store2.plannedItems.length).toBe(before);
          } else {
            const dto = await repo.addPlannedItem(TRIP_ID, ORGANIZER.userId, input);
            expect(dto.experienceId).toBe(freshExperienceId);
            expect(store2.plannedItems.length).toBe(fill + 1);
          }
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
