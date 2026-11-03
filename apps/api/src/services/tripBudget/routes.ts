/**
 * Fastify route plugin for the Trip Budget feature.
 *
 * Implements:
 * - GET    /trips/:id/budget                    (view_budget) -> 200 + BudgetDetailDTO
 * - GET    /trips/:id/budget/suggestions        (view_budget) -> 200 + BudgetSuggestionDTO[]
 * - POST   /trips/:id/budget/lines              (edit_budget) -> 201 + BudgetLineDTO
 * - PATCH  /trips/:id/budget/lines/:lineId      (edit_budget) -> 200 + BudgetLineDTO
 * - DELETE /trips/:id/budget/lines/:lineId      (edit_budget) -> 204
 * - PUT    /trips/:id/budget/travelers          (edit_budget_travelers) -> 200 + TravelerProfileDTO
 * - DELETE /trips/:id/budget/travelers/:profileId (edit_budget_travelers) -> 204
 * - PATCH  /trips/:id/budget/settings           (edit_budget_settings) -> 200 + BudgetSettingsDTO
 * - POST   /trips/:id/budget/suggestions/dismiss (edit_budget) -> 204
 * - POST   /trips/:id/budget/quotes             (view_budget) -> 200 + PriceQuoteDTO[]
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 2.5, 4.6, 7.5, 12.9, 14.8, 14.12,
 *            18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.8, 18.9, 20.1, 20.6, 21.5
 */

import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  TICKET_PARK_BY_CANONICAL_PARK,
  budgetLineInputSchema,
  budgetLineReplaceSchema,
  budgetSettingsPatchSchema,
  dismissSuggestionBodySchema,
  priceQuoteBodySchema,
  travelerProfileInputSchema,
  uuidSchema,
  type BudgetDTO,
  type BudgetLineDTO,
  type BudgetLineInput,
  type BudgetSuggestionDTO,
  type PriceQuoteDTO,
  type TicketPriceRef,
  type LlPriceRef,
  type TravelerProfileDTO,
  type PriceRef,
  type PriceSource,
} from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { parseOrAppError } from '../tripExpenses/routes.js';
import { wdwToday } from '../trips/wdwClock.js';
import { requireBudgetAction } from './authz.js';
import { computeBudgetViews } from './budgetViews.js';
import { computeLine } from './budgetMath.js';
import { resolveLinePrices } from './resolveLinePrices.js';
import { computeSavingsPlan } from './savingsPlan.js';
import { deriveSuggestions } from './suggestions.js';
import type {
  BudgetSettingsEffective,
  PlannedItemRow,
  ResolvedLine,
  StoredLine,
} from './types.js';
import type { TripBudgetRepo } from './repo.js';
import { toNullableDateString } from './repo.js';
import { computeVsActual } from './vsActual.js';
import { ticketCacheState } from '../ticketPrices/cacheState.js';
import { resolveTicketPrice } from '../ticketPrices/resolveTicketPrice.js';
import type { TicketPriceKey } from '../ticketPrices/types.js';
import type { TicketPriceBook, TicketPricesRepo } from '../ticketPrices/repo.js';
import { lookupLlPrice } from '../lightningLane/lookupLlPrice.js';
import type { LightningLaneReadRepo } from '../lightningLane/repo.js';
import type { LlBook, ResolveCfg } from '../lightningLane/types.js';

// ---------------------------------------------------------------------------
// Path param schemas
// ---------------------------------------------------------------------------

const tripIdParamsSchema = z.object({ id: uuidSchema }).strict();
const lineParamsSchema = z.object({ id: uuidSchema, lineId: uuidSchema }).strict();
const travelerParamsSchema = z.object({ id: uuidSchema, profileId: uuidSchema }).strict();

// ---------------------------------------------------------------------------
// Ports & Options
// ---------------------------------------------------------------------------

export interface TicketPriceDemandService {
  noteDemand?(demand: {
    readonly groups: readonly string[];
    readonly numDays: readonly number[];
    readonly maxStartDate: string | null;
  }): void;
}

export interface TripBudgetRoutesOptions {
  readonly pool: DbPool;
  readonly repo: TripBudgetRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly ticketPricesRepo?: TicketPricesRepo;
  readonly ticketPricesService?: TicketPriceDemandService;
  readonly lightningLaneRepo?: LightningLaneReadRepo;
  readonly config?: {
    readonly ticketPrices?: {
      readonly enabled?: boolean;
      readonly groups?: readonly string[];
      readonly flResidentNumDays?: readonly number[];
      readonly minAttemptIntervalHours?: number;
      readonly staleAfterDays?: number;
    };
  };
}

function getUserId(request: FastifyRequest): string {
  const req = request as unknown as { userId?: string; session?: { userId?: string } };
  const userId = req.userId ?? req.session?.userId;
  if (!userId) {
    throw new AppError('unauthorized', 'Session required');
  }
  return userId;
}

function collectPriceKeys(lines: readonly StoredLine[]): {
  ticketKeys: TicketPriceKey[];
  demandKeys: Array<{ discountGroup: string; numDays: number; startDate: string }>;
  llKeys: LlPriceRef[];
} {
  const ticketKeys: TicketPriceKey[] = [];
  const demandKeys: Array<{ discountGroup: string; numDays: number; startDate: string }> = [];
  const llKeys: LlPriceRef[] = [];

  for (const line of lines) {
    if (line.priceSource === 'disney_ticket_calendar') {
      for (const a of line.allocations) {
        const ref = (a.priceRef ?? line.priceRef) as TicketPriceRef | null;
        if (ref && ref.kind === 'ticket') {
          ticketKeys.push({
            discountGroup: ref.discountGroup,
            numDays: ref.numDays,
            ageGroup: ref.ageGroup,
            optionCode: ref.optionCode,
            park: ref.park ?? 'any',
          });
          demandKeys.push({
            discountGroup: ref.discountGroup,
            numDays: ref.numDays,
            startDate: ref.startDate,
          });
        }
      }
    } else if (line.priceSource === 'themeparks_ll') {
      for (const a of line.allocations) {
        const ref = (a.priceRef ?? line.priceRef) as LlPriceRef | null;
        if (ref && ref.kind === 'll') {
          llKeys.push(ref);
        }
      }
    }
  }

  return { ticketKeys, demandKeys, llKeys };
}

function toBudgetLineDTO(
  tripId: string,
  line: ResolvedLine,
  settings: BudgetSettingsEffective,
  createdBy: string = '',
): BudgetLineDTO {
  const sortedAllocs = [...line.allocations].sort((a, b) => a.personKey.localeCompare(b.personKey));
  const math = computeLine(
    {
      category: line.category,
      applyTip: line.applyTip,
      allocations: sortedAllocs.map((a) => ({
        personKey: a.personKey,
        cents: a.effectiveCents,
      })),
    },
    settings,
  );

  const mathByPersonKey = new Map(math.perPerson.map((p) => [p.personKey, p]));

  return {
    id: line.id,
    tripId,
    createdBy: line.createdBy ?? createdBy,
    category: line.category,
    description: line.description,
    plannedDate: line.plannedDate,
    park: line.park,
    experienceId: line.experienceId,
    priceSource: line.priceSource,
    effectivePriceSource: line.effectivePriceSource,
    priceLabelKind: line.priceLabelKind,
    asOf: line.asOf.toISOString(),
    attribution: line.attribution,
    soldOut: line.soldOut,
    applyTip: line.applyTip,
    linkedExpenseId: line.linkedExpenseId ?? null,
    suggestionKey: line.suggestionKey ?? null,
    subtotalCents: math.subtotalCents,
    taxCents: math.taxCents,
    tipCents: math.tipCents,
    totalCents: math.totalCents,
    allocations: line.allocations.map((a) => {
      const isMember = a.personKey.startsWith('m:');
      const id = a.personKey.slice(2);
      const personMath = mathByPersonKey.get(a.personKey);
      return {
        id: a.allocationId,
        memberId: isMember ? id : null,
        guestId: isMember ? null : id,
        storedCents: a.storedCents,
        effectiveCents: a.effectiveCents,
        taxCents: personMath?.taxCents ?? 0,
        tipCents: personMath?.tipCents ?? 0,
        priceRef: a.priceRef as PriceRef | null,
      };
    }),
  };
}

export function tripBudgetRoutes(options: TripBudgetRoutesOptions): FastifyPluginAsync {
  const {
    pool,
    repo,
    requireSession,
    ticketPricesRepo,
    ticketPricesService,
    lightningLaneRepo,
    config,
  } = options;

  const tpConfig = config?.ticketPrices;
  const tpEnabled = tpConfig?.enabled ?? false;
  const tpGroups = tpConfig?.groups ?? ['std-gst'];
  const tpFlResidentNumDays = tpConfig?.flResidentNumDays ?? [4];
  const tpMinAttemptIntervalHours = tpConfig?.minAttemptIntervalHours ?? 24;

  const allowedNumDaysByGroup: Record<string, readonly number[]> = {
    'std-gst': tpGroups.includes('std-gst') ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [],
    'fl-resident': tpGroups.includes('fl-resident') ? tpFlResidentNumDays : [],
  };

  const resolveCfg: ResolveCfg = {
    freshDays: 30,
    estimateAfterDays: 30,
    allowedNumDaysByGroup,
    llStaleHours: 24,
    lookbackDays: 400,
    minSamples: 1,
  };

  return async (fastify) => {
    // -------------------------------------------------------------------------
    // 1. GET /trips/:id/budget
    // -------------------------------------------------------------------------
    fastify.get(
      '/trips/:id/budget',
      { preHandler: [requireSession] },
      async (request): Promise<BudgetDTO> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);

        // 1. Authorization
        await requireBudgetAction(pool, userId, tripId, 'view_budget');

        // 2. Load DB bundle (7 statements)
        const bundle = await repo.loadBudget(tripId);
        const today = wdwToday();
        const now = new Date();

        // 3. Collect price keys
        const { ticketKeys, demandKeys, llKeys } = collectPriceKeys(bundle.storedLines);

        // 4. Read ticket prices book (3 statements)
        let ticketBook: TicketPriceBook = { rows: [], sets: [], control: null };
        if (ticketPricesRepo) {
          ticketBook = await ticketPricesRepo.readBook(ticketKeys, today);
        }

        // 5. Read LL book (2 statements)
        let llBook: LlBook = { stored: [], history: new Map() };
        if (lightningLaneRepo) {
          llBook = await lightningLaneRepo.readBook(llKeys, today);
        }

        // 6. Note demand for future ticket keys
        if (ticketPricesService?.noteDemand && tpEnabled) {
          for (const k of demandKeys) {
            if (k.startDate >= today) {
              ticketPricesService.noteDemand({
                groups: [k.discountGroup],
                numDays: [k.numDays],
                maxStartDate: k.startDate,
              });
            }
          }
        }

        // 7. Pure price resolution
        const resolvedLines = resolveLinePrices({
          lines: bundle.storedLines,
          ticketBook,
          llBook,
          today,
          now,
          cfg: resolveCfg,
        });

        // 8. Pure views computation
        const views = computeBudgetViews(resolvedLines, bundle.settingsEffective, bundle.people);

        // 9. Pure savings plan
        const savings = computeSavingsPlan({
          targetCents: bundle.settingsEffective.savingsTargetCents ?? views.total.totalCents,
          savedCents: bundle.settingsEffective.savedCents,
          today,
          tripStartDate: bundle.trip.startDate,
        });

        // 10. Pure vsActual
        const lineTotalsByBudgetCategory: Record<string, number> = {};
        for (const bucket of views.byCategory) {
          lineTotalsByBudgetCategory[bucket.key] = bucket.totalCents;
        }
        const vsActual = computeVsActual({
          lineTotalsByBudgetCategory,
          actualByExpenseCategory: bundle.vsActualByExpenseCategory,
        });

        const linesDTO: BudgetLineDTO[] = resolvedLines.map((line) =>
          toBudgetLineDTO(tripId, line, bundle.settingsEffective),
        );

        return {
          tripId,
          lines: linesDTO,
          travelers: bundle.travelers,
          settings: bundle.settings,
          totalCents: views.total.totalCents,
          subtotalCents: views.total.subtotalCents,
          taxCents: views.total.taxCents,
          tipCents: views.total.tipCents,
          byPerson: views.byPerson,
          byDay: views.byDay,
          byPark: views.byPark,
          byCategory: views.byCategory,
          savings,
          vsActual,
        };
      },
    );

    // -------------------------------------------------------------------------
    // 2. GET /trips/:id/budget/suggestions
    // -------------------------------------------------------------------------
    fastify.get(
      '/trips/:id/budget/suggestions',
      { preHandler: [requireSession] },
      async (request): Promise<BudgetSuggestionDTO[]> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);

        await requireBudgetAction(pool, userId, tripId, 'view_budget');

        // Load trip row for dates and day_touring_hours
        const tripRes = await pool.query<{ start_date: string; day_touring_hours: unknown }>(
          `SELECT start_date, day_touring_hours FROM trips WHERE id = $1`,
          [tripId],
        );
        const tripRow = tripRes.rows[0];
        if (!tripRow) {
          throw new AppError('trip_not_found', 'Trip not found');
        }

        const dayTouringHours = (tripRow.day_touring_hours ?? {}) as Record<string, { startingPark?: string }>;
        const tripStart = toNullableDateString(tripRow.start_date) ?? '';

        // Read planned items, traveler profiles, dismissed suggestions, and existing lines
        const plannedItems = await repo.listPlannedItemsForSuggestions(tripId);
        const profiles = await repo.listTravelerProfiles(tripId);
        const dismissedKeys = await repo.listDismissedSuggestions(tripId);

        const existingLinesRes = await pool.query<{ suggestion_key: string | null }>(
          `SELECT suggestion_key FROM trip_budget_lines WHERE trip_id = $1 AND suggestion_key IS NOT NULL`,
          [tripId],
        );
        const existingKeys = new Set(
          existingLinesRes.rows.map((r) => r.suggestion_key!).filter(Boolean),
        );

        // Experience park map
        const expIds = plannedItems
          .map((p: PlannedItemRow) => p.experienceId)
          .filter((id): id is string => Boolean(id));
        const expParkMap = new Map<string, string | null>();
        if (expIds.length > 0) {
          const expRes = await pool.query<{ id: string; park: string | null }>(
            `SELECT id, park FROM experiences WHERE id = ANY($1::uuid[])`,
            [expIds],
          );
          for (const row of expRes.rows) {
            expParkMap.set(row.id, row.park);
          }
        }

        // Service styles for dining
        const serviceStyleByExperience = await repo.getServiceStylesForExperiences(expIds);

        // Single pass availability
        const today = wdwToday();
        const singleAvailRes = await pool.query<{ date: string; experience_id: string }>(
          `SELECT date, experience_id
           FROM lightning_lane_single_prices
           WHERE available = true AND date >= $1`,
          [today],
        );
        const llSingleAvailable = new Set(
          singleAvailRes.rows.map((r) => `${toNullableDateString(r.date) ?? ''}:${r.experience_id}`),
        );

        return deriveSuggestions({
          plannedItems,
          dayTouringHours,
          profiles,
          tripStart,
          existingKeys,
          dismissedKeys,
          llSingleAvailable,
          experiencePark: expParkMap,
          serviceStyleByExperience,
        });
      },
    );

    // -------------------------------------------------------------------------
    // 3. POST /trips/:id/budget/lines
    // -------------------------------------------------------------------------
    fastify.post(
      '/trips/:id/budget/lines',
      { preHandler: [requireSession] },
      async (request, reply): Promise<BudgetLineDTO> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const body = parseOrAppError(budgetLineInputSchema, request.body) as BudgetLineInput;

        await requireBudgetAction(pool, userId, tripId, 'edit_budget');

        const today = wdwToday();
        let resolvedInfo: Parameters<TripBudgetRepo['createLine']>[3] & { perPersonCents?: number[] } = {
          effectivePriceSource: body.priceSource as PriceSource,
          amounts: body.allocations.map((a) => a.amountCents ?? 0),
          perPersonCents: body.allocations.map((a) => a.amountCents ?? 0),
        };

        // Ticket price server-side resolution
        if (body.priceSource === 'disney_ticket_calendar') {
          const ticketAllocations = body.allocations.map((a) => {
            const ref = (a.priceRef ?? body.priceRef) as TicketPriceRef | null;
            if (!ref || ref.kind !== 'ticket') {
              throw new AppError('trip_validation_failed', 'Ticket priceRef required on each allocation');
            }
            let parkCode = ref.park;
            if (ref.numDays === 1 && ref.optionCode === 'base' && !parkCode && body.park) {
              const mapped = TICKET_PARK_BY_CANONICAL_PARK[body.park as keyof typeof TICKET_PARK_BY_CANONICAL_PARK];
              if (mapped) parkCode = mapped;
            }
            return {
              ...ref,
              ...(parkCode ? { park: parkCode } : {}),
            };
          });

          let book: TicketPriceBook = { rows: [], sets: [], control: null };
          if (ticketPricesRepo) {
            book = await ticketPricesRepo.readBook(ticketAllocations, today);
          }

          const resolvedCents: number[] = [];
          let lastQuote: ReturnType<typeof resolveTicketPrice> | null = null;
          for (let i = 0; i < ticketAllocations.length; i++) {
            const allocRef = ticketAllocations[i]!;
            const allowed = allowedNumDaysByGroup[allocRef.discountGroup] ?? [];
            const pairPermitted = allowed.includes(allocRef.numDays);
            const quote = resolveTicketPrice(allocRef, book, today, resolveCfg, pairPermitted);
            if (quote.priceCents === null) {
              throw new AppError('trip_validation_failed', 'No price available, use user_entered');
            }
            resolvedCents.push(quote.priceCents);
            lastQuote = quote;
            if (allocRef.startDate >= today && ticketPricesService?.noteDemand && tpEnabled) {
              ticketPricesService.noteDemand({
                groups: [allocRef.discountGroup],
                numDays: [allocRef.numDays],
                maxStartDate: allocRef.startDate,
              });
            }
          }
          resolvedInfo = {
            effectivePriceSource: 'disney_ticket_calendar',
            amounts: resolvedCents,
            perPersonCents: resolvedCents,
            allocationPriceRefs: ticketAllocations,
            labelKind: lastQuote?.labelKind ?? 'current',
            asOf: lastQuote?.asOf ? (typeof lastQuote.asOf === 'string' ? new Date(lastQuote.asOf) : lastQuote.asOf) : new Date(),
          };
        } else if (body.priceSource === 'themeparks_ll') {
          const llAllocations = body.allocations.map((a) => {
            const ref = (a.priceRef ?? body.priceRef) as LlPriceRef | null;
            if (!ref || ref.kind !== 'll') {
              throw new AppError('trip_validation_failed', 'Lightning Lane priceRef required');
            }
            return ref;
          });

          let llBook: LlBook = { stored: [], history: new Map() };
          if (lightningLaneRepo) {
            llBook = await lightningLaneRepo.readBook(llAllocations, today);
          }

          const resolvedCents: number[] = [];
          const now = new Date();
          let lastLlQuote: ReturnType<typeof lookupLlPrice> | null = null;
          for (const allocRef of llAllocations) {
            const histKey = `${allocRef.passType}|${allocRef.park}|${allocRef.experienceId ?? ''}`;
            const history = llBook.history.get(histKey) ?? [];
            const quote = lookupLlPrice(allocRef, llBook.stored, history, today, now, {
              staleHours: 24,
              lookbackDays: 400,
              minSamples: 1,
            });
            if (quote.priceCents === null) {
              throw new AppError('trip_validation_failed', 'No Lightning Lane estimate available');
            }
            resolvedCents.push(quote.priceCents);
            lastLlQuote = quote;
          }
          resolvedInfo = {
            effectivePriceSource: 'themeparks_ll',
            amounts: resolvedCents,
            perPersonCents: resolvedCents,
            allocationPriceRefs: llAllocations,
            labelKind: lastLlQuote?.priceLabelKind ?? 'current',
            asOf: lastLlQuote?.asOf ? new Date(lastLlQuote.asOf) : now,
          };
        }

        const createdLine = await repo.createLine(tripId, userId, body, resolvedInfo);
        reply.status(201);
        return createdLine;
      },
    );

    // -------------------------------------------------------------------------
    // 4. PATCH /trips/:id/budget/lines/:lineId
    // -------------------------------------------------------------------------
    fastify.patch(
      '/trips/:id/budget/lines/:lineId',
      { preHandler: [requireSession] },
      async (request): Promise<BudgetLineDTO> => {
        const userId = getUserId(request);
        const { id: tripId, lineId } = parseOrAppError(lineParamsSchema, request.params);
        const body = parseOrAppError(budgetLineReplaceSchema, request.body) as BudgetLineInput;

        const role = await requireBudgetAction(pool, userId, tripId, 'edit_budget');

        // Check line existence on this trip
        const checkRes = await pool.query<{ id: string; created_by: string }>(
          `SELECT id, created_by FROM trip_budget_lines WHERE id = $1 AND trip_id = $2`,
          [lineId, tripId],
        );
        const lineRow = checkRes.rows[0];
        if (!lineRow) {
          throw new AppError('trip_not_found', 'Budget line not found');
        }

        const today = wdwToday();
        let resolvedInfo: Parameters<TripBudgetRepo['createLine']>[3] & { perPersonCents?: number[] } = {
          effectivePriceSource: body.priceSource as PriceSource,
          amounts: body.allocations.map((a) => a.amountCents ?? 0),
          perPersonCents: body.allocations.map((a) => a.amountCents ?? 0),
        };

        if (body.priceSource === 'disney_ticket_calendar') {
          const ticketAllocations = body.allocations.map((a) => {
            const ref = (a.priceRef ?? body.priceRef) as TicketPriceRef | null;
            if (!ref || ref.kind !== 'ticket') {
              throw new AppError('trip_validation_failed', 'Ticket priceRef required on each allocation');
            }
            let parkCode = ref.park;
            if (ref.numDays === 1 && ref.optionCode === 'base' && !parkCode && body.park) {
              const mapped = TICKET_PARK_BY_CANONICAL_PARK[body.park as keyof typeof TICKET_PARK_BY_CANONICAL_PARK];
              if (mapped) parkCode = mapped;
            }
            return {
              ...ref,
              ...(parkCode ? { park: parkCode } : {}),
            };
          });

          let book: TicketPriceBook = { rows: [], sets: [], control: null };
          if (ticketPricesRepo) {
            book = await ticketPricesRepo.readBook(ticketAllocations, today);
          }

          const resolvedCents: number[] = [];
          let lastQuote: ReturnType<typeof resolveTicketPrice> | null = null;
          for (let i = 0; i < ticketAllocations.length; i++) {
            const allocRef = ticketAllocations[i]!;
            const allowed = allowedNumDaysByGroup[allocRef.discountGroup] ?? [];
            const pairPermitted = allowed.includes(allocRef.numDays);
            const quote = resolveTicketPrice(allocRef, book, today, resolveCfg, pairPermitted);
            if (quote.priceCents === null) {
              throw new AppError('trip_validation_failed', 'No price available, use user_entered');
            }
            resolvedCents.push(quote.priceCents);
            lastQuote = quote;
            if (allocRef.startDate >= today && ticketPricesService?.noteDemand && tpEnabled) {
              ticketPricesService.noteDemand({
                groups: [allocRef.discountGroup],
                numDays: [allocRef.numDays],
                maxStartDate: allocRef.startDate,
              });
            }
          }
          resolvedInfo = {
            effectivePriceSource: 'disney_ticket_calendar',
            amounts: resolvedCents,
            perPersonCents: resolvedCents,
            allocationPriceRefs: ticketAllocations,
            labelKind: lastQuote?.labelKind ?? 'current',
            asOf: lastQuote?.asOf ? (typeof lastQuote.asOf === 'string' ? new Date(lastQuote.asOf) : lastQuote.asOf) : new Date(),
          };
        } else if (body.priceSource === 'themeparks_ll') {
          const llAllocations = body.allocations.map((a) => {
            const ref = (a.priceRef ?? body.priceRef) as LlPriceRef | null;
            if (!ref || ref.kind !== 'll') {
              throw new AppError('trip_validation_failed', 'Lightning Lane priceRef required');
            }
            return ref;
          });

          let llBook: LlBook = { stored: [], history: new Map() };
          if (lightningLaneRepo) {
            llBook = await lightningLaneRepo.readBook(llAllocations, today);
          }

          const resolvedCents: number[] = [];
          const now = new Date();
          let lastLlQuote: ReturnType<typeof lookupLlPrice> | null = null;
          for (const allocRef of llAllocations) {
            const histKey = `${allocRef.passType}|${allocRef.park}|${allocRef.experienceId ?? ''}`;
            const history = llBook.history.get(histKey) ?? [];
            const quote = lookupLlPrice(allocRef, llBook.stored, history, today, now, {
              staleHours: 24,
              lookbackDays: 400,
              minSamples: 1,
            });
            if (quote.priceCents === null) {
              throw new AppError('trip_validation_failed', 'No Lightning Lane estimate available');
            }
            resolvedCents.push(quote.priceCents);
            lastLlQuote = quote;
          }
          resolvedInfo = {
            effectivePriceSource: 'themeparks_ll',
            amounts: resolvedCents,
            perPersonCents: resolvedCents,
            allocationPriceRefs: llAllocations,
            labelKind: lastLlQuote?.priceLabelKind ?? 'current',
            asOf: lastLlQuote?.asOf ? new Date(lastLlQuote.asOf) : now,
          };
        }

        const editedLine = await repo.editLine(tripId, lineId, userId, role, body, resolvedInfo);
        return editedLine;
      },
    );

    // -------------------------------------------------------------------------
    // 5. DELETE /trips/:id/budget/lines/:lineId
    // -------------------------------------------------------------------------
    fastify.delete(
      '/trips/:id/budget/lines/:lineId',
      { preHandler: [requireSession] },
      async (request, reply): Promise<void> => {
        const userId = getUserId(request);
        const { id: tripId, lineId } = parseOrAppError(lineParamsSchema, request.params);

        const role = await requireBudgetAction(pool, userId, tripId, 'edit_budget');

        // Check line existence on this trip
        const checkRes = await pool.query<{ id: string }>(
          `SELECT id FROM trip_budget_lines WHERE id = $1 AND trip_id = $2`,
          [lineId, tripId],
        );
        if (checkRes.rows.length === 0) {
          throw new AppError('trip_not_found', 'Budget line not found');
        }

        await repo.removeLine(tripId, lineId, userId, role);
        reply.status(204);
      },
    );

    // -------------------------------------------------------------------------
    // 6. PUT /trips/:id/budget/travelers
    // -------------------------------------------------------------------------
    fastify.put(
      '/trips/:id/budget/travelers',
      { preHandler: [requireSession] },
      async (request): Promise<TravelerProfileDTO> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const body = parseOrAppError(travelerProfileInputSchema, request.body);

        const role = await requireBudgetAction(pool, userId, tripId, 'edit_budget_travelers');
        return repo.upsertProfile(tripId, userId, role, body);
      },
    );

    // -------------------------------------------------------------------------
    // 7. DELETE /trips/:id/budget/travelers/:profileId
    // -------------------------------------------------------------------------
    fastify.delete(
      '/trips/:id/budget/travelers/:profileId',
      { preHandler: [requireSession] },
      async (request, reply): Promise<void> => {
        const userId = getUserId(request);
        const { id: tripId, profileId } = parseOrAppError(travelerParamsSchema, request.params);

        const role = await requireBudgetAction(pool, userId, tripId, 'edit_budget_travelers');

        // Check profile existence on this trip
        const checkRes = await pool.query<{ id: string }>(
          `SELECT id FROM trip_traveler_profiles WHERE id = $1 AND trip_id = $2`,
          [profileId, tripId],
        );
        if (checkRes.rows.length === 0) {
          throw new AppError('trip_not_found', 'Traveler profile not found');
        }

        await repo.deleteProfile(tripId, profileId, userId, role);
        reply.status(204);
      },
    );

    // -------------------------------------------------------------------------
    // 8. PATCH /trips/:id/budget/settings
    // -------------------------------------------------------------------------
    fastify.patch(
      '/trips/:id/budget/settings',
      { preHandler: [requireSession] },
      async (request) => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const body = parseOrAppError(budgetSettingsPatchSchema, request.body);

        await requireBudgetAction(pool, userId, tripId, 'edit_budget_settings');
        return repo.patchSettings(tripId, body);
      },
    );

    // -------------------------------------------------------------------------
    // 9. POST /trips/:id/budget/suggestions/dismiss
    // -------------------------------------------------------------------------
    fastify.post(
      '/trips/:id/budget/suggestions/dismiss',
      { preHandler: [requireSession] },
      async (request, reply): Promise<void> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const body = parseOrAppError(dismissSuggestionBodySchema, request.body);

        await requireBudgetAction(pool, userId, tripId, 'edit_budget');
        await repo.dismissSuggestion(tripId, body.suggestionKey);
        reply.status(204);
      },
    );

    // -------------------------------------------------------------------------
    // 10. POST /trips/:id/budget/quotes
    // -------------------------------------------------------------------------
    fastify.post(
      '/trips/:id/budget/quotes',
      { preHandler: [requireSession] },
      async (request): Promise<PriceQuoteDTO[]> => {
        const userId = getUserId(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        const body = parseOrAppError(priceQuoteBodySchema, request.body);

        await requireBudgetAction(pool, userId, tripId, 'view_budget');

        const today = wdwToday();
        const now = new Date();

        // Segregate requests
        const ticketRequests: TicketPriceRef[] = [];
        const llRequests: LlPriceRef[] = [];

        for (const req of body.requests) {
          if (req.kind === 'ticket') {
            ticketRequests.push(req);
          } else if (req.kind === 'll') {
            llRequests.push(req);
          }
        }

        // Fetch ticket book
        let ticketBook: TicketPriceBook = { rows: [], sets: [], control: null };
        if (ticketRequests.length > 0 && ticketPricesRepo) {
          ticketBook = await ticketPricesRepo.readBook(ticketRequests, today);
        }

        // Fetch LL book
        let llBook: LlBook = { stored: [], history: new Map() };
        if (llRequests.length > 0 && lightningLaneRepo) {
          llBook = await lightningLaneRepo.readBook(llRequests, today);
        }

        const quotes: PriceQuoteDTO[] = [];

        for (const req of body.requests) {
          if (req.kind === 'ticket') {
            const allowed = allowedNumDaysByGroup[req.discountGroup] ?? [];
            const pairPermitted = allowed.includes(req.numDays);
            const set = ticketBook.sets.find(
              (s) => s.discountGroup === req.discountGroup && s.numDays === req.numDays,
            ) ?? null;

            const cacheState = ticketCacheState({
              enabled: tpEnabled,
              now,
              control: ticketBook.control ?? {
                blockedUntil: null,
                inProgressSince: null,
                lastAttemptAt: null,
              },
              pairPermitted,
              set,
              cfg: {
                attemptIntervalHours: tpMinAttemptIntervalHours,
                claimTimeoutMinutes: 15,
              },
            });

            const isFlResident = req.discountGroup === 'fl-resident';
            const flUnavailable = isFlResident
              ? !pairPermitted || set?.lastError === 'not_offered'
              : undefined;

            const resolved = resolveTicketPrice(req, ticketBook, today, resolveCfg, pairPermitted);

            // Note demand if permitted, switch is on, and future start date
            if (pairPermitted && tpEnabled && req.startDate >= today && ticketPricesService?.noteDemand) {
              ticketPricesService.noteDemand({
                groups: [req.discountGroup],
                numDays: [req.numDays],
                maxStartDate: req.startDate,
              });
            }

            const asOfStr = resolved.asOf
              ? (typeof resolved.asOf === 'string' ? resolved.asOf : resolved.asOf.toISOString())
              : now.toISOString();

            quotes.push({
              priceCents: resolved.priceCents,
              taxCents: resolved.taxCents,
              effectivePriceSource: 'disney_ticket_calendar',
              priceLabelKind: resolved.labelKind,
              asOf: asOfStr,
              attribution: 'disney',
              ...(resolved.resolvedStartDate ? { resolvedStartDate: resolved.resolvedStartDate } : {}),
              parkAssumed: resolved.parkAssumed,
              ...(flUnavailable !== undefined ? { flUnavailable } : {}),
              ...(resolved.estimateReason !== undefined ? { estimateReason: resolved.estimateReason } : {}),
              cacheState,
            });
          } else if (req.kind === 'll') {
            const histKey = `${req.passType}|${req.park}|${req.experienceId ?? ''}`;
            const history = llBook.history.get(histKey) ?? [];
            const quote = lookupLlPrice(req, llBook.stored, history, today, now, {
              staleHours: 24,
              lookbackDays: 400,
              minSamples: 1,
            });
            quotes.push(quote);
          }
        }

        return quotes;
      },
    );
  };
}