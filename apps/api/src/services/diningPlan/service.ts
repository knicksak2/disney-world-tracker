/**
 * Dining Plan service (dining-plan-calculator Requirements 3, 4.4, 5.1 to 5.10, 6.3 to 6.6, 16.1, 16.8, 25.1 to 25.3,
 * 25.14, 25.17; design.md "Service, repo and routes", "Party assembly", "Multi-Stay Extension / Service, party port
 * and read path").
 *
 * The routes authorize; this service loads a Trip's scenario, Party, stays, suggestions, locations and prices,
 * builds the pure engine's input, and returns `DiningPlanDTO`. Every write returns the recomputed plan.
 *
 * Person_Keys: `m:<user id>` and `g:<guest id>`. The member id is the one `listMembers` returns
 * (`active_trip_memberships.user_id`). It equals the public id the other Trip DTOs show, because `profile_identity`
 * (0064_account_deletion.sql) maps `public_id` to `user_id` for every account whose `deletion_state` is `active`, and
 * `listMembers` returns active accounts only. Keys stored in settings and `excluded_keys` are therefore the real ids,
 * and no mapping at the boundary is needed (checked for task 7.2).
 */

import {
  DINING_PLAN_PARTY_MAX,
  DINING_PLAN_SPAN_MAX_DAYS,
  DINING_STAY_PLAN_SETTING_DEFAULT,
  diningExportKey,
  effectiveStays,
  type DiningBudgetExportBody,
  type DiningBudgetExportLineDTO,
  type DiningBudgetExportResultDTO,
  type DiningCalculateBody,
  type DiningEntryDTO,
  type DiningMealPeriod,
  type DiningPartyPersonDTO,
  type DiningPlanDTO,
  type DiningPlanEntryBody,
  type DiningPlanImportBody,
  type DiningPlanImportResultDTO,
  type DiningPlanResultDTO,
  type DiningPlanSettings,
  type EnginePlanStay,
  type StayRecord,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import { daysBetween } from '../ticketPrices/dates.js';
import { can } from '../trips/permissions.js';
import { wdwToday } from '../trips/wdwClock.js';
import type { TripBudgetWritePort } from './budgetPort.js';
import { buildBudgetExport, type BudgetExportLine, type ExistingExportLine, type ExportPartyRef } from './engine/budgetExport.js';
import { computeDiningPlan, evaluateForExport, type ComputeOptions, type ExportCombinationProblem } from './engine/computeDiningPlan.js';
import { suggestFromPlannedItems } from './engine/reservations.js';
import { isInStay } from './engine/stay.js';
import type { EngineEntry, EngineInput, EnginePerson } from './engine/types.js';
import type { DiningPlanPartyPort, TripMembershipPort, TripStaysPort } from './partyPort.js';
import type { DiningLocationRecord, DiningPlanRepo, DiningScenarioRecord, DiningTripCore } from './types.js';

export interface DiningPlanServiceDeps {
  readonly repo: DiningPlanRepo;
  readonly partyPort: DiningPlanPartyPort;
  readonly staysPort: TripStaysPort;
  /** The Budget export only (Requirement 26). */
  readonly budgetPort: TripBudgetWritePort;
  readonly membership: TripMembershipPort;
  readonly now?: () => Date;
  /** The engine; injectable so a test can observe the input it receives. */
  readonly compute?: (input: EngineInput, options?: ComputeOptions) => DiningPlanResultDTO;
}

export interface DiningPlanService {
  getPlan(tripId: string): Promise<DiningPlanDTO>;
  putSettings(tripId: string, settings: DiningPlanSettings): Promise<DiningPlanDTO>;
  putEntry(tripId: string, date: string, mealPeriod: DiningMealPeriod, body: DiningPlanEntryBody): Promise<DiningPlanDTO>;
  deleteEntry(tripId: string, date: string, mealPeriod: DiningMealPeriod): Promise<DiningPlanDTO>;
  importReservations(tripId: string, body: DiningPlanImportBody): Promise<DiningPlanImportResultDTO>;
  calculateStateless(body: DiningCalculateBody): Promise<DiningPlanResultDTO>;
  /** Authorizes the caller itself (Requirement 26.2): the route only parses the body. */
  exportToBudget(tripId: string, userId: string, body: DiningBudgetExportBody): Promise<DiningBudgetExportResultDTO>;
}

const COMBINATION_MESSAGES: Readonly<Record<ExportCombinationProblem['reason'], string>> = {
  unknown_stay: 'The combination names a hotel stay that is not part of this trip.',
  missing_stay: 'The combination must give an option for every hotel stay of this trip.',
  held_plan: 'This hotel stay is set to a dining plan you already have; export that plan or change the stay setting.',
  no_plan: 'This hotel stay is set to no dining plan.',
  unavailable: 'That dining plan is not available for this hotel stay.',
};

/** The Person_Key's Budget allocation target: `m:<user id>` is a member, `g:<guest id>` a guest. */
function partyRefOf(key: string): ExportPartyRef {
  return key.startsWith('m:') ? { memberId: key.slice(2) } : { guestId: key.slice(2) };
}

/** The Party as the engine and the DTO see it (Requirements 3.1, 3.2, 3.7). */
export interface AssembledParty {
  readonly persons: readonly EnginePerson[];
}

function validation(message: string, field: string): AppError {
  return new AppError('trip_validation_failed', message, { field });
}

function spanDays(stays: readonly { readonly checkIn: string; readonly checkOut: string }[]): number {
  const checkIn = stays.reduce((min, s) => (s.checkIn < min ? s.checkIn : min), stays[0]!.checkIn);
  const checkOut = stays.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), stays[0]!.checkOut);
  return daysBetween(checkIn, checkOut);
}

/**
 * The Trip's Plan_Stays (Requirements 25.1 to 25.3): one per Effective_Stay, keyed by the stay id or
 * `implicit:<checkIn>` for a synthesized segment, with `settings.stayPlans[key]` (a missing key is the default). The
 * earlier single-stay settings apply only when the Trip has one synthesized segment: `settings.stay` replaces its
 * dates, `stayType: 'not_disney_resort'` makes it an off-site stay, and `dvc_or_passholder_resort` sets its channel
 * unless `stayPlans` already does.
 */
export function buildPlanStays(
  core: DiningTripCore,
  records: readonly StayRecord[],
  settings: DiningPlanSettings,
): { readonly stays: EnginePlanStay[]; readonly source: 'trip' | 'custom' } {
  const effective = effectiveStays({ startDate: core.startDate, endDate: core.endDate }, records);
  const single = effective.length === 1 && effective[0]!.source !== 'stay';
  let source: 'trip' | 'custom' = 'trip';
  const stays = effective.map((s): EnginePlanStay => {
    const key = s.id ?? `implicit:${s.checkIn}`;
    const stored = settings.stayPlans[key];
    let { checkIn, checkOut, lodgingKind } = s;
    let staySource = s.source;
    let channel = stored?.channel ?? DINING_STAY_PLAN_SETTING_DEFAULT.channel;
    if (single) {
      if (settings.stay !== null) {
        checkIn = settings.stay.checkIn;
        checkOut = settings.stay.checkOut;
        source = 'custom';
      }
      if (settings.stayType === 'not_disney_resort') {
        lodgingKind = 'offsite';
        staySource = 'stay';
      }
      if (stored === undefined && settings.stayType === 'dvc_or_passholder_resort') channel = 'dvc_or_passholder';
    }
    return {
      key,
      label: s.displayName,
      lodgingKind,
      source: staySource,
      checkIn,
      checkOut,
      partyKeys: s.partyKeys,
      setting: { ...(stored ?? DINING_STAY_PLAN_SETTING_DEFAULT), channel },
    };
  });
  return { stays, source };
}

function toEngineEntries(entries: DiningScenarioRecord['entries']): EngineEntry[] {
  return entries.map((e) => ({
    date: e.date,
    mealPeriod: e.mealPeriod,
    kind: e.kind,
    experienceId: e.experienceId,
    placeholderKind: e.placeholderKind,
    excludedKeys: e.excludedKeys,
  }));
}

function partyDto(persons: readonly EnginePerson[]): DiningPartyPersonDTO[] {
  return persons.map((p) => ({ key: p.key, label: p.label, ageBracket: p.ageBracket, passType: p.passType }));
}

function withUnknownExperienceWarnings(
  result: DiningPlanResultDTO,
  entries: readonly { readonly date: string; readonly mealPeriod: DiningMealPeriod; readonly kind: string; readonly experienceId: string | null }[],
  known: (id: string) => boolean,
): DiningPlanResultDTO {
  const unknown = entries
    .filter((e) => e.kind === 'restaurant' && e.experienceId !== null && !known(e.experienceId))
    .map((e) => ({ code: 'unknown_experience' as const, date: e.date, mealPeriod: e.mealPeriod }));
  return unknown.length === 0 ? result : { ...result, warnings: [...result.warnings, ...unknown] };
}

export function createDiningPlanService(deps: DiningPlanServiceDeps): DiningPlanService {
  const { repo, partyPort, staysPort, budgetPort, membership } = deps;
  const now = deps.now ?? (() => new Date());
  const compute = deps.compute ?? computeDiningPlan;

  async function tripCore(tripId: string): Promise<DiningTripCore> {
    const core = await repo.loadTripCore(tripId);
    if (core === null) throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
    return core;
  }

  /** Members and guests, without accounts that are not visible, with their traveler profiles (Requirement 3). */
  async function assembleParty(tripId: string): Promise<AssembledParty> {
    const members = await partyPort.listMembers(tripId);
    const guests = await partyPort.listTripGuests(tripId);
    const hidden = await partyPort.findNonVisible(tripId, { userIds: members.map((m) => m.userId), guestIds: guests.map((g) => g.id) });
    const profiles = await repo.loadProfiles(tripId);
    const hiddenUsers = new Set(hidden.userIds);
    const hiddenGuests = new Set(hidden.guestIds);
    const memberProfile = new Map(profiles.filter((p) => p.memberId !== null).map((p) => [p.memberId!, p]));
    const guestProfile = new Map(profiles.filter((p) => p.guestId !== null).map((p) => [p.guestId!, p]));
    const persons: EnginePerson[] = [];
    for (const m of members) {
      if (hiddenUsers.has(m.userId)) continue;
      const profile = memberProfile.get(m.userId);
      persons.push({ key: `m:${m.userId}`, label: m.displayName, ageBracket: profile?.ageBracket ?? 'adult', passType: profile?.passType ?? 'none' });
    }
    for (const g of guests) {
      if (hiddenGuests.has(g.id)) continue;
      const profile = guestProfile.get(g.id);
      persons.push({ key: `g:${g.id}`, label: g.name, ageBracket: profile?.ageBracket ?? 'adult', passType: profile?.passType ?? 'none' });
    }
    if (persons.length > DINING_PLAN_PARTY_MAX) {
      throw validation(`The calculator handles at most ${DINING_PLAN_PARTY_MAX} people.`, 'party');
    }
    return { persons };
  }

  async function planStaysOf(tripId: string, core: DiningTripCore, settings: DiningPlanSettings) {
    const built = buildPlanStays(core, await staysPort.listStays(tripId), settings);
    if (spanDays(built.stays) > DINING_PLAN_SPAN_MAX_DAYS) {
      throw validation(`The calculator handles trips of at most ${DINING_PLAN_SPAN_MAX_DAYS} days.`, 'stays');
    }
    return built;
  }

  /** Everything the read path loads, and the engine input built from it (shared by `getPlan` and the export). */
  async function loadInput(tripId: string) {
    const core = await tripCore(tripId);
    const scenario = await repo.loadScenario(tripId);
    const { persons } = await assembleParty(tripId);
    const planned = await repo.loadPlannedDiningItems(tripId);
    const { stays, source } = await planStaysOf(tripId, core, scenario.settings);
    const eligibleCount = persons.filter((p) => p.ageBracket !== 'under3').length;
    const { suggestions, suggestionsNeedingMealPeriod } = suggestFromPlannedItems(planned, { entries: scenario.entries, eligibleCount });
    const ids = [
      ...scenario.entries.map((e) => e.experienceId).filter((id): id is string => id !== null),
      ...suggestions.map((s) => s.experienceId),
    ];
    const locations = await repo.loadLocations(ids);
    const globals = await repo.loadGlobals();
    const span = { checkIn: stays[0]!.checkIn, checkOut: stays.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), stays[0]!.checkOut) };
    const input: EngineInput = {
      persons,
      stay: { ...span, source },
      settings: scenario.settings,
      entries: toEngineEntries(scenario.entries),
      locations,
      priceRows: globals.priceRows,
      config: globals.config,
      today: wdwToday(now()),
      stays,
    };
    return { scenario, persons, suggestions, suggestionsNeedingMealPeriod, locations, input };
  }

  async function getPlan(tripId: string, options: ComputeOptions = {}): Promise<DiningPlanDTO> {
    const { scenario, persons, suggestions, suggestionsNeedingMealPeriod, locations, input } = await loadInput(tripId);
    const result = withUnknownExperienceWarnings(compute(input, options), scenario.entries, (id) => locations.has(id));
    const entries: DiningEntryDTO[] = scenario.entries.map((e) => ({
      date: e.date,
      mealPeriod: e.mealPeriod,
      kind: e.kind,
      experienceId: e.experienceId,
      experienceName: e.experienceId === null ? null : (locations.get(e.experienceId)?.name ?? null),
      placeholderKind: e.placeholderKind,
      plannedItemId: e.plannedItemId,
      excludedKeys: e.excludedKeys,
    }));
    return {
      settings: scenario.settings,
      entries,
      party: partyDto(persons),
      stay: result.stay,
      suggestions,
      suggestionsNeedingMealPeriod,
      result,
    };
  }

  return {
    getPlan: (tripId) => getPlan(tripId),

    async putSettings(tripId, settings) {
      const core = await tripCore(tripId);
      const { persons } = await assembleParty(tripId);
      const eligible = persons.filter((p) => p.ageBracket !== 'under3').length;
      // Requirement 6.4: a key not in the Party is ignored at calculation time; a Party member who is not an adult is
      // an error the user can fix.
      const nonAdult = new Set(persons.filter((p) => p.ageBracket !== 'adult').map((p) => p.key));
      if (settings.alcoholDrinkerKeys.some((k) => nonAdult.has(k))) {
        throw validation('Only adults can be counted as drinking alcohol.', 'alcoholDrinkerKeys');
      }
      if (settings.mugsWanted > eligible) {
        throw validation('There can be at most one refillable mug per person aged 3 or over.', 'mugsWanted');
      }
      if (settings.stay !== null && daysBetween(settings.stay.checkIn, settings.stay.checkOut) > DINING_PLAN_SPAN_MAX_DAYS) {
        throw validation(`The calculator handles stays of at most ${DINING_PLAN_SPAN_MAX_DAYS} days.`, 'stay');
      }
      // A `stayPlans` key that names no current Plan_Stay is dropped (design.md "Service, party port and read path").
      const { stays } = buildPlanStays(core, await staysPort.listStays(tripId), settings);
      const keys = new Set(stays.map((s) => s.key));
      const stayPlans = Object.fromEntries(Object.entries(settings.stayPlans).filter(([k]) => keys.has(k)));
      await repo.saveSettings(tripId, { ...settings, stayPlans });
      return getPlan(tripId);
    },

    async putEntry(tripId, date, mealPeriod, body) {
      await tripCore(tripId);
      await repo.upsertEntry(tripId, { date, mealPeriod, ...body });
      return getPlan(tripId);
    },

    async deleteEntry(tripId, date, mealPeriod) {
      await tripCore(tripId);
      await repo.deleteEntry(tripId, date, mealPeriod);
      return getPlan(tripId);
    },

    async importReservations(tripId, body) {
      const before = await getPlan(tripId);
      const requested = body.plannedItemIds === undefined ? null : new Set(body.plannedItemIds);
      const chosen = before.suggestions.filter((s) => requested === null || requested.has(s.plannedItemId));
      // A requested item already imported is not a suggestion any more; it is reported as already there (Req 5.5).
      const alreadyLinked = new Set(before.entries.map((e) => e.plannedItemId).filter((id): id is string => id !== null));
      const requestedLinked = requested === null ? 0 : [...requested].filter((id) => alreadyLinked.has(id)).length;
      const span = { checkIn: before.stay.checkIn, checkOut: before.stay.checkOut };
      const inStay = chosen.filter((s) => isInStay(s.date, span));
      const counts = await repo.importEntries(
        tripId,
        inStay.map((s) => ({ plannedItemId: s.plannedItemId, experienceId: s.experienceId, date: s.date, mealPeriod: s.mealPeriod })),
        body.overwrite,
      );
      return {
        plan: await getPlan(tripId),
        created: counts.created,
        skippedExisting: counts.skippedExisting + requestedLinked,
        skippedOutOfStay: chosen.length - inStay.length,
      };
    },

    async calculateStateless(body) {
      const stayList = body.stays ?? [body.stay];
      if (spanDays(stayList) > DINING_PLAN_SPAN_MAX_DAYS) {
        throw new AppError('validation_failed', `The calculator handles trips of at most ${DINING_PLAN_SPAN_MAX_DAYS} days.`, { field: 'stay' });
      }
      const ids = body.entries.map((e) => e.experienceId).filter((id): id is string => id !== null);
      const loaded = await repo.loadLocations(ids);
      const globals = await repo.loadGlobals();
      // Requirement 16.8: only active Restaurants are valued; anything else is dropped with a warning.
      const usable = new Map<string, DiningLocationRecord>([...loaded].filter(([, l]) => l.active && l.category === 'Restaurant'));
      const entries: EngineEntry[] = body.entries
        .filter((e) => e.kind !== 'restaurant' || (e.experienceId !== null && usable.has(e.experienceId)))
        .map((e) => ({ date: e.date, mealPeriod: e.mealPeriod, kind: e.kind, experienceId: e.experienceId, placeholderKind: e.placeholderKind, excludedKeys: e.excludedKeys }));
      const input: EngineInput = {
        persons: body.party,
        stay: { checkIn: body.stay.checkIn, checkOut: body.stay.checkOut, source: 'custom' },
        settings: body.settings,
        entries,
        locations: usable,
        priceRows: globals.priceRows,
        config: globals.config,
        today: wdwToday(now()),
        ...(body.stays === undefined ? {} : { stays: body.stays }),
      };
      return withUnknownExperienceWarnings(compute(input), body.entries, (id) => usable.has(id));
    },

    async exportToBudget(tripId, userId, body) {
      // Requirement 26.2: a member of the Trip who may edit both the dining plan and the Budget.
      const role = await membership.roleOf(userId, tripId);
      if (!can(role, 'edit_dining_plan') || !can(role, 'edit_budget')) {
        throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
      }
      const { persons, input } = await loadInput(tripId);
      const outcome = evaluateForExport(input, body.combination);
      if (!outcome.ok) {
        throw new AppError('trip_validation_failed', COMBINATION_MESSAGES[outcome.problem.reason], {
          field: 'combination',
          details: { stayKey: outcome.problem.stayKey, reason: outcome.problem.reason },
        });
      }
      const { evaluation } = outcome;
      const rates = await budgetPort.getTaxBps(tripId);
      const existing = await budgetPort.listExportedLines(tripId);
      const plan = buildBudgetExport({
        include: body.include,
        perPerson: evaluation.scenario.perPerson ?? [],
        stays: evaluation.stays,
        // `persons` holds active accounts only (Requirement 26.8).
        party: new Map(persons.map((p) => [p.key, partyRefOf(p.key)])),
        budgetTaxBps: rates.dining,
        calculatorTaxBps: evaluation.calculatorTaxBps,
        otherCategoryTaxBps: rates.other,
        planPricesIncludeTax: evaluation.planPricesIncludeTax,
        existing,
      });

      // Lines in display order: the plan lines by stay, then out of pocket, then tips.
      const rank = new Map<string, number>(evaluation.stays.map((s, i) => [diningExportKey('plan', s.key), i]));
      rank.set(diningExportKey('out_of_pocket'), evaluation.stays.length);
      rank.set(diningExportKey('tips'), evaluation.stays.length + 1);
      const writes = [...plan.creates, ...plan.edits].sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
      const lineDto = (l: BudgetExportLine, lineId: string | null): DiningBudgetExportLineDTO => ({
        key: l.key,
        lineId,
        description: l.input.description,
        category: l.input.category === 'other' ? 'other' : 'dining',
        subtotalCents: l.subtotalCents,
      });
      const counts = { created: plan.creates.length, updated: plan.edits.length, deleted: plan.deletes.length };
      if (body.preview) {
        return { ...counts, lines: writes.map((l) => lineDto(l, null)), warnings: plan.warnings };
      }

      // Each Budget call is its own transaction (Requirement 26.10): creates and edits first, deletes last, and a
      // failure names the keys already written so a retry, which edits them in place, can be understood.
      const byId = new Map<string, ExistingExportLine>(existing.map((l) => [l.id, l]));
      const done: string[] = [];
      const lines: DiningBudgetExportLineDTO[] = [];
      let current = '';
      try {
        for (const l of writes) {
          current = l.key;
          const written = l.existingId === null
            ? await budgetPort.createLine(tripId, userId, l.input)
            : await budgetPort.editLine(tripId, byId.get(l.existingId)!, userId, l.input);
          lines.push(lineDto(l, written.id));
          done.push(l.key);
        }
        for (const l of plan.deletes) {
          current = l.key;
          await budgetPort.removeLine(tripId, l, userId);
          done.push(l.key);
        }
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        throw new AppError(err.code, err.message, {
          ...(err.field === undefined ? {} : { field: err.field }),
          details: { ...err.details, completedKeys: done, failedKey: current },
          cause: err,
        });
      }
      return { ...counts, lines, warnings: plan.warnings };
    },
  };
}
