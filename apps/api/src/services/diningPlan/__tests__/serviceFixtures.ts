/**
 * Fakes for the Dining Plan service tests: an in-memory repo, party and stays ports, a Trip membership port and an
 * in-memory Trip Budget port. The real repo is pinned by repo.test.ts and the real Budget port by budgetPort.test.ts.
 */

import {
  DINING_CONFIG_DEFAULTS,
  DINING_EXPORT_KEY_PREFIX,
  diningPlanSettingsSchema,
  type BudgetLineInput,
  type DiningPlanSettingsInput,
  type StayRecord,
  type TripGuestDTO,
  type TripMemberDTO,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { TripRole } from '../../trips/permissions.js';
import type { BudgetTaxRates, TripBudgetWritePort } from '../budgetPort.js';
import type { ExistingExportLine } from '../engine/budgetExport.js';
import type { computeDiningPlan } from '../engine/computeDiningPlan.js';
import type { PlannedDiningItemRow } from '../engine/reservations.js';
import type { EngineInput } from '../engine/types.js';
import { LOCATIONS, SEEDED } from '../engine/__tests__/engineFixtures.js';
import type { DiningPlanPartyPort, TripMembershipPort, TripStaysPort } from '../partyPort.js';
import { createDiningPlanService } from '../service.js';
import type { DiningImportItem, DiningLocationRecord, DiningPlanRepo, DiningProfileRow, StoredDiningEntry } from '../types.js';

export const TRIP = '20000000-0000-4000-8000-000000000001';
export const ALEX = '30000000-0000-4000-8000-0000000000a1';
export const BLAIR = '30000000-0000-4000-8000-0000000000b2';
export const PENDING = '30000000-0000-4000-8000-0000000000c3';
export const KID = '40000000-0000-4000-8000-0000000000d4';
export const BABY = '40000000-0000-4000-8000-0000000000e5';
export const ORPHAN = '40000000-0000-4000-8000-0000000000f6';
export const NOW = new Date('2026-11-09T15:00:00Z');
export const RIDE = '00000000-0000-4000-8000-0000000000aa';

export function member(userId: string, displayName: string, role: 'organizer' | 'member' = 'member'): TripMemberDTO {
  return { userId, displayName, avatarPreset: null, role };
}
export function guest(id: string, name: string, sponsorMemberId: string, tripId = TRIP): TripGuestDTO {
  return { id, tripId, sponsorMemberId, name, createdAt: '2026-10-01T00:00:00.000Z' };
}
export function stay(id: string, position: number, lodgingKind: StayRecord['lodgingKind'], displayName: string, checkIn: string | null, checkOut: string | null): StayRecord {
  return { id, position, lodgingKind, resortId: lodgingKind === 'resort' ? `r-${id}` : null, displayName, checkIn, checkOut, partyKeys: null };
}

/** Locations as the repo returns them: the engine fixtures plus catalog category and active flag. */
export const LOCATION_RECORDS = new Map<string, DiningLocationRecord>(
  [...LOCATIONS].map(([id, l]) => [id, { ...l, category: 'Restaurant', active: true }]),
);
LOCATION_RECORDS.set(RIDE, { experienceId: RIDE, name: 'Space Mountain', priceTier: null, groupedFacets: {}, menus: null, rule: null, category: 'Ride', active: true });

/** An in-memory Trip Budget that behaves like the real repo for the lines the export writes. */
export interface FakeBudget extends TripBudgetWritePort {
  readonly lines: Map<string, { readonly id: string; readonly key: string | null; input: BudgetLineInput; readonly createdBy: string }>;
  /** Every port call in order: `rates`, `list`, `create:<key>`, `edit:<id>`, `remove:<id>`. */
  readonly calls: string[];
  rates: BudgetTaxRates;
  /** The write (create, edit or remove) with this 1-based number throws `trip_validation_failed`, once. */
  failOnWrite: number | null;
}

export function fakeBudget(seed: { id: string; key: string | null; input: BudgetLineInput; createdBy: string }[] = []): FakeBudget {
  let next = 0;
  let writes = 0;
  const budget: FakeBudget = {
    lines: new Map(seed.map((l) => [l.id, { ...l }])),
    calls: [],
    rates: { dining: 650, other: 0 },
    failOnWrite: null,
    async getTaxBps() {
      budget.calls.push('rates');
      return budget.rates;
    },
    async listExportedLines() {
      budget.calls.push('list');
      return [...budget.lines.values()]
        .filter((l) => l.key !== null && l.key.startsWith(DINING_EXPORT_KEY_PREFIX))
        .map((l): ExistingExportLine => ({ id: l.id, key: l.key!, linkedExpenseId: l.input.linkedExpenseId ?? null }));
    },
    async createLine(_trip, userId, input) {
      budget.calls.push(`create:${input.suggestionKey ?? ''}`);
      write();
      if ([...budget.lines.values()].some((l) => l.key !== null && l.key === input.suggestionKey)) {
        throw new AppError('trip_validation_failed', 'Duplicate suggestion key for this trip');
      }
      next += 1;
      const id = `line-${next}`;
      budget.lines.set(id, { id, key: input.suggestionKey ?? null, input, createdBy: userId });
      return { id };
    },
    async editLine(_trip, line, _userId, input) {
      budget.calls.push(`edit:${line.id}`);
      write();
      const stored = budget.lines.get(line.id)!;
      stored.input = input;
      return { id: line.id };
    },
    async removeLine(_trip, line) {
      budget.calls.push(`remove:${line.id}`);
      write();
      budget.lines.delete(line.id);
    },
  };
  function write(): void {
    writes += 1;
    if (budget.failOnWrite === writes) {
      budget.failOnWrite = null;
      throw new AppError('trip_validation_failed', `Budget line limit reached (200)`);
    }
  }
  return budget;
}

export interface World {
  readonly repo: DiningPlanRepo & { saved: unknown[]; imports: { items: readonly DiningImportItem[]; overwrite: boolean }[]; writes: string[] };
  readonly partyPort: DiningPlanPartyPort;
  readonly staysPort: TripStaysPort & { stays: StayRecord[] };
  readonly budget: FakeBudget;
  readonly membership: TripMembershipPort;
}

export function world(opts: {
  members?: TripMemberDTO[];
  guests?: TripGuestDTO[];
  hidden?: { userIds: string[]; guestIds: string[] };
  profiles?: DiningProfileRow[];
  entries?: StoredDiningEntry[];
  planned?: PlannedDiningItemRow[];
  settings?: DiningPlanSettingsInput;
  trip?: { startDate: string; endDate: string } | null;
  stays?: StayRecord[];
  budget?: FakeBudget;
  /** The caller's role per user id; anyone else, and every caller on an unknown Trip, gets `trip_forbidden`. */
  roles?: Readonly<Record<string, TripRole>>;
} = {}): World {
  let settings = diningPlanSettingsSchema.parse(opts.settings ?? {});
  let entries = [...(opts.entries ?? [])];
  const saved: unknown[] = [];
  const imports: { items: readonly DiningImportItem[]; overwrite: boolean }[] = [];
  const writes: string[] = [];
  const repo: World['repo'] = {
    saved,
    imports,
    writes,
    loadTripCore: async () => (opts.trip === undefined ? { startDate: '2027-03-01', endDate: '2027-03-06' } : opts.trip),
    loadScenario: async () => ({ settings, entries }),
    loadProfiles: async () => opts.profiles ?? [],
    loadPlannedDiningItems: async () => opts.planned ?? [],
    loadLocations: async (ids) => new Map([...LOCATION_RECORDS].filter(([id]) => ids.includes(id))),
    loadGlobals: async () => ({ priceRows: SEEDED, config: DINING_CONFIG_DEFAULTS }),
    saveSettings: async (_trip, s) => {
      writes.push('saveSettings');
      saved.push(s);
      settings = s;
    },
    upsertEntry: async (_trip, e) => {
      writes.push('upsertEntry');
      entries = [...entries.filter((x) => !(x.date === e.date && x.mealPeriod === e.mealPeriod)), { id: `e-${e.date}-${e.mealPeriod}`, plannedItemId: null, ...e }];
    },
    deleteEntry: async (_trip, date, mealPeriod) => {
      writes.push('deleteEntry');
      const before = entries.length;
      entries = entries.filter((x) => !(x.date === date && x.mealPeriod === mealPeriod));
      return entries.length < before;
    },
    importEntries: async (_trip, items, overwrite) => {
      writes.push('importEntries');
      imports.push({ items, overwrite });
      for (const i of items) entries.push({ id: `imp-${i.plannedItemId}`, date: i.date, mealPeriod: i.mealPeriod, kind: 'restaurant', experienceId: i.experienceId, placeholderKind: null, plannedItemId: i.plannedItemId, excludedKeys: [] });
      return { created: items.length, skippedExisting: 0 };
    },
  };
  const partyPort: DiningPlanPartyPort = {
    listMembers: async () => opts.members ?? [member(ALEX, 'Alex', 'organizer'), member(BLAIR, 'Blair')],
    listTripGuests: async () => opts.guests ?? [],
    findNonVisible: async (_trip, parties) => ({
      userIds: parties.userIds.filter((id) => opts.hidden?.userIds.includes(id) ?? false),
      guestIds: parties.guestIds.filter((id) => opts.hidden?.guestIds.includes(id) ?? false),
    }),
  };
  const staysPort = { stays: opts.stays ?? [], listStays: async () => staysPort.stays };
  const roles = opts.roles ?? { [ALEX]: 'organizer', [BLAIR]: 'member' };
  const membership: TripMembershipPort = {
    roleOf: async (userId) => {
      const role = opts.trip === null ? undefined : roles[userId];
      if (role === undefined) throw new AppError('trip_forbidden', 'You may not view this trip.');
      return role;
    },
  };
  return { repo, partyPort, staysPort, budget: opts.budget ?? fakeBudget(), membership };
}

export function service(w: World, compute?: (input: EngineInput) => ReturnType<typeof computeDiningPlan>) {
  return createDiningPlanService({
    repo: w.repo,
    partyPort: w.partyPort,
    staysPort: w.staysPort,
    budgetPort: w.budget,
    membership: w.membership,
    now: () => NOW,
    ...(compute === undefined ? {} : { compute }),
  });
}
