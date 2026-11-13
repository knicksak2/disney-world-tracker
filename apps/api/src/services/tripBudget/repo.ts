/**
 * Trip Budget repository — persistence, visibility, and allocation integrity.
 *
 * Validates: Requirements 1.6, 2.1-2.9, 3.1-3.7, 4.1-4.8, 7.3, 7.5, 7.8,
 *            14.9, 16.5, 17.2, 18.5, 18.8, 20.4, 20.6
 *
 * Roster and visibility guards:
 * - Single raw `trip_memberships` read pinned for party validation in `getTripMemberUserIds`
 * - No `users` or `profiles` table queries; labels come from `profile_identity`
 * - Deletion detection via `findNonVisibleParties`
 */

import type { PoolClient } from 'pg';
import type {
  BudgetCategory,
  BudgetLineDTO,
  BudgetLineInput,
  BudgetLineReplace,
  BudgetSettingsDTO,
  BudgetSettingsPatch,
  MenuDTO,
  PriceLabelKind,
  PriceRef,
  PriceSource,
  TicketDiscountGroup,
  TicketOption,
  TicketPriceRef,
  LlPriceRef,
  TravelerPassType,
  TravelerProfileDTO,
  TravelerProfileInput,
} from '@dwt/shared';
import {
  BUDGET_ALLOCATIONS_PER_LINE_MAX,
  BUDGET_CATEGORIES,
  BUDGET_DEFAULT_DINING_TIP_BPS,
  BUDGET_DEFAULT_TAX_BPS,
  BUDGET_DISMISSED_LIMIT,
  BUDGET_LINE_LIMIT,
  BUDGET_TOTAL_CAP_CENTS,
  EXPENSE_AMOUNT_MAX_CENTS,
  TICKET_PARK_BY_CANONICAL_PARK,
  extractMenuPriceOffers,
  normalizeMenuName,
  normalizeTierName,
  parseMenuPriceString,
} from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { TripRole } from '../trips/permissions.js';
import { findNonVisibleParties } from '../tripExpenses/repo.js';
import { computeLine } from './budgetMath.js';
import { dateToInstant } from '../ticketPrices/dates.js';
import { ticketAgeClass } from '../ticketPrices/freshness.js';
import { wdwToday } from '../trips/wdwClock.js';
import type {
  BudgetSettingsEffective,
  PersonInfo,
  PersonKey,
  PlannedItemRow,
  RawBudgetBundle,
  StoredAllocation,
  StoredLine,
} from './types.js';

/**
 * Driver-safe cents parser (round 3 M2).
 * node-pg returns BIGINT and SUM() results as strings.
 * Throws Error('non_integer_cents') on non-finite or fractional input.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error('non_integer_cents');
    }
    return value;
  }
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) {
    throw new Error('non_integer_cents');
  }
  const parsed = parseInt(s, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error('non_integer_cents');
  }
  return parsed;
}

export function toDateString(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 10);
}

export function toNullableDateString(val: unknown): string | null {
  if (!val) return null;
  const res = toDateString(val);
  return res || null;
}

/**
 * Single pinned raw trip_memberships reader (hits: 1).
 * Used exclusively for party validation on line create/edit and profile upsert.
 */
async function getTripMemberUserIds(
  db: DbPool | PoolClient,
  tripId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const res = await db.query<{ user_id: string }>(
    `SELECT user_id FROM trip_memberships WHERE trip_id = $1 AND user_id = ANY($2::uuid[])`,
    [tripId, [...new Set(userIds)]],
  );
  return new Set(res.rows.map((r) => r.user_id));
}

function verifyMenuItem(
  menus: readonly MenuDTO[],
  name: string,
  priceCents: number,
): boolean {
  const normName = normalizeMenuName(name);
  const allItems: {
    name: string;
    price?: string | null;
    priceCents?: number | null;
    prices?: readonly { cents: number; label: string | null }[];
  }[] = [];

  for (const m of menus) {
    for (const g of m.groups ?? []) {
      for (const it of g.items ?? []) {
        allItems.push(it);
      }
    }
  }

  const matchingItems = allItems.filter((it) => normalizeMenuName(it.name) === normName);
  if (matchingItems.length === 0) return false;

  for (const it of matchingItems) {
    // 1. Shape 2: prices array
    if (it.prices && Array.isArray(it.prices) && it.prices.some((p) => p.cents === priceCents)) {
      return true;
    }
    // 1b. Shape 2: priceCents single field
    if (it.priceCents === priceCents) {
      return true;
    }
    // 2. Shape 1: parseMenuPriceString display string
    if (it.price && parseMenuPriceString(it.price).includes(priceCents)) {
      return true;
    }
  }
  return false;
}

function verifyMenuTier(
  menus: readonly MenuDTO[],
  tierName: string,
  priceCents: number,
): boolean {
  const offers = extractMenuPriceOffers(menus);
  return offers.some(
    (o) => normalizeTierName(o.label) === tierName && o.priceCents === priceCents,
  );
}

function applyParkDefaultToPriceRef(
  ref: PriceRef | null | undefined,
  linePark: string | null | undefined,
): PriceRef | null {
  if (!ref) return null;
  if (ref.kind === 'ticket' && ref.optionCode === 'base' && ref.numDays === 1 && !ref.park) {
    if (linePark && linePark in TICKET_PARK_BY_CANONICAL_PARK) {
      return {
        ...ref,
        park: TICKET_PARK_BY_CANONICAL_PARK[linePark as keyof typeof TICKET_PARK_BY_CANONICAL_PARK],
      };
    }
  }
  return ref;
}

export interface TripBudgetRepo {
  // Profiles (Task 14.1)
  upsertProfile(
    tripId: string,
    callerUserId: string,
    callerRole: TripRole,
    input: TravelerProfileInput,
  ): Promise<TravelerProfileDTO>;
  deleteProfile(
    tripId: string,
    profileId: string,
    callerUserId: string,
    callerRole: TripRole,
  ): Promise<void>;
  listTravelerProfiles(tripId: string): Promise<readonly TravelerProfileDTO[]>;

  // Settings & Dismissals (Task 14.1)
  getSettings(tripId: string): Promise<BudgetSettingsDTO>;
  patchSettings(tripId: string, patch: BudgetSettingsPatch): Promise<BudgetSettingsDTO>;
  dismissSuggestion(tripId: string, suggestionKey: string): Promise<void>;
  listDismissedSuggestions(tripId: string): Promise<ReadonlySet<string>>;

  // Line CRUD (Task 14.2)
  createLine(
    tripId: string,
    userId: string,
    input: BudgetLineInput,
    resolved?: {
      amounts?: readonly number[];
      priceSource?: PriceSource;
      asOf?: Date;
      newestSampleDate?: string;
      labelKind?: PriceLabelKind;
      effectivePriceSource?: PriceSource;
      priceRef?: TicketPriceRef | LlPriceRef | null;
      allocationPriceRefs?: readonly (PriceRef | null)[];
    },
  ): Promise<BudgetLineDTO>;
  editLine(
    tripId: string,
    lineId: string,
    userId: string,
    callerRole: TripRole,
    input: BudgetLineReplace,
    resolved?: {
      amounts?: readonly number[];
      priceSource?: PriceSource;
      asOf?: Date;
      newestSampleDate?: string;
      labelKind?: PriceLabelKind;
      effectivePriceSource?: PriceSource;
      priceRef?: TicketPriceRef | LlPriceRef | null;
      allocationPriceRefs?: readonly (PriceRef | null)[];
    },
  ): Promise<BudgetLineDTO>;
  removeLine(
    tripId: string,
    lineId: string,
    userId: string,
    callerRole: TripRole,
  ): Promise<void>;

  /**
   * Record that a Budget_Line was logged as an Expense (Requirement 23.5-23.8).
   * Writes only `trip_budget_lines.linked_expense_id`; reads `expenses` to verify the Trip.
   * Idempotent for the same Expense; rejects a different Expense on an already-linked line.
   */
  linkExpense(tripId: string, lineId: string, expenseId: string): Promise<void>;

  // Load Budget (Task 14.3)
  loadBudget(tripId: string): Promise<RawBudgetBundle>;
  listPlannedItemsForSuggestions(tripId: string): Promise<PlannedItemRow[]>;
  getServiceStylesForExperiences(
    experienceIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
}

export function createTripBudgetRepo(pool: DbPool): TripBudgetRepo {
  return {
    async upsertProfile(tripId, callerUserId, callerRole, input) {
      const memberId = input.memberId ?? null;
      const guestId = input.guestId ?? null;

      // 1. Check for deleted or pending_deletion accounts (Requirement 18.5, Property 41)
      const nonVisible = await findNonVisibleParties(pool, tripId, {
        userIds: memberId ? [memberId] : [],
        guestIds: guestId ? [guestId] : [],
      });
      if (nonVisible.userIds.length > 0 || nonVisible.guestIds.length > 0) {
        throw new AppError(
          'trip_party_deleted',
          "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.",
        );
      }

      // 2. On-trip check (Round 5 L13)
      let guestName: string | null = null;
      let guestSponsorId: string | null = null;

      if (memberId) {
        const onTrip = await getTripMemberUserIds(pool, tripId, [memberId]);
        if (!onTrip.has(memberId)) {
          throw new AppError('trip_validation_failed', 'User is not a member of this trip');
        }
      } else if (guestId) {
        const guestRes = await pool.query<{ id: string; sponsor_member_id: string; name: string }>(
          `SELECT id, sponsor_member_id, name FROM trip_guests WHERE trip_id = $1 AND id = $2`,
          [tripId, guestId],
        );
        const g = guestRes.rows[0];
        if (!g) {
          throw new AppError('trip_validation_failed', 'Guest does not belong to this trip');
        }
        guestName = g.name;
        guestSponsorId = g.sponsor_member_id;
      }

      // 3. Authorization check (Requirement 4.6)
      if (callerRole !== 'organizer') {
        if (memberId && memberId !== callerUserId) {
          throw new AppError('trip_forbidden', 'You may only edit your own traveler profile');
        }
        if (guestId && guestSponsorId !== callerUserId) {
          throw new AppError('trip_forbidden', 'Only the sponsor or an organizer may edit this guest traveler profile');
        }
      }

      // 4. Upsert into trip_traveler_profiles
      let row: {
        id: string;
        trip_id: string;
        member_id: string | null;
        guest_id: string | null;
        age_bracket: string;
        ticket_option: string | null;
        ticket_days: number | null;
        ticket_start_date: string | null;
        discount_group: string;
        pass_type: string;
      };

      try {
        const existing = await pool.query<{ id: string }>(
          memberId
            ? `SELECT id FROM trip_traveler_profiles WHERE trip_id = $1 AND member_id = $2`
            : `SELECT id FROM trip_traveler_profiles WHERE trip_id = $1 AND guest_id = $2`,
          [tripId, memberId ?? guestId],
        );

        if (existing.rows.length > 0) {
          const updateRes = await pool.query<{
            id: string;
            trip_id: string;
            member_id: string | null;
            guest_id: string | null;
            age_bracket: string;
            ticket_option: string | null;
            ticket_days: number | null;
            ticket_start_date: string | null;
            discount_group: string;
            pass_type: string;
          }>(
            `UPDATE trip_traveler_profiles
             SET age_bracket = $1,
                 ticket_option = $2,
                 ticket_days = $3,
                 ticket_start_date = $4,
                 discount_group = $5,
                 pass_type = $6,
                 updated_at = now()
             WHERE id = $7
             RETURNING id, trip_id, member_id, guest_id, age_bracket, ticket_option, ticket_days, ticket_start_date, discount_group, pass_type`,
            [
              input.ageBracket,
              input.ticketOption ?? null,
              input.ticketDays ?? null,
              input.ticketStartDate ?? null,
              input.discountGroup ?? 'std-gst',
              input.passType ?? 'none',
              existing.rows[0]!.id,
            ],
          );
          row = updateRes.rows[0]!;
        } else {
          const insertRes = await pool.query<{
            id: string;
            trip_id: string;
            member_id: string | null;
            guest_id: string | null;
            age_bracket: string;
            ticket_option: string | null;
            ticket_days: number | null;
            ticket_start_date: string | null;
            discount_group: string;
            pass_type: string;
          }>(
            `INSERT INTO trip_traveler_profiles (
               trip_id, member_id, guest_id, age_bracket, ticket_option, ticket_days,
               ticket_start_date, discount_group, pass_type, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
             RETURNING id, trip_id, member_id, guest_id, age_bracket, ticket_option, ticket_days, ticket_start_date, discount_group, pass_type`,
            [
              tripId,
              memberId,
              guestId,
              input.ageBracket,
              input.ticketOption ?? null,
              input.ticketDays ?? null,
              input.ticketStartDate ?? null,
              input.discountGroup ?? 'std-gst',
              input.passType ?? 'none',
            ],
          );
          row = insertRes.rows[0]!;
        }
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
          throw new AppError('trip_validation_failed', 'Referenced person does not exist');
        }
        throw err;
      }

      // 5. Resolve label from profile_identity or trip_guests
      let label = 'Deleted user';
      if (guestId) {
        label = guestName ?? 'Deleted user';
      } else if (memberId) {
        const idRes = await pool.query<{ display_name: string }>(
          `SELECT display_name FROM profile_identity WHERE user_id = $1`,
          [memberId],
        );
        label = idRes.rows[0]?.display_name ?? 'Deleted user';
      }

      return {
        id: row.id,
        memberId: row.member_id,
        guestId: row.guest_id,
        label,
        ageBracket: row.age_bracket as TravelerProfileDTO['ageBracket'],
        ticketOption: row.ticket_option as TicketOption | null,
        ticketDays: row.ticket_days,
        ticketStartDate: toNullableDateString(row.ticket_start_date),
        discountGroup: row.discount_group as TicketDiscountGroup,
        passType: row.pass_type as TravelerPassType,
      };
    },

    async deleteProfile(tripId, profileId, callerUserId, callerRole) {
      const existing = await pool.query<{ id: string; member_id: string | null; guest_id: string | null }>(
        `SELECT id, member_id, guest_id FROM trip_traveler_profiles WHERE id = $1 AND trip_id = $2`,
        [profileId, tripId],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new AppError('trip_not_found', 'Traveler profile not found');
      }

      if (callerRole !== 'organizer') {
        if (row.member_id && row.member_id !== callerUserId) {
          throw new AppError('trip_forbidden', 'You may only delete your own traveler profile');
        }
        if (row.guest_id) {
          const g = await pool.query<{ sponsor_member_id: string }>(
            `SELECT sponsor_member_id FROM trip_guests WHERE id = $1 AND trip_id = $2`,
            [row.guest_id, tripId],
          );
          if (!g.rows[0] || g.rows[0].sponsor_member_id !== callerUserId) {
            throw new AppError('trip_forbidden', 'Only the sponsor or an organizer may delete this guest traveler profile');
          }
        }
      }

      await pool.query(
        `DELETE FROM trip_traveler_profiles WHERE id = $1 AND trip_id = $2`,
        [profileId, tripId],
      );
    },

    async listTravelerProfiles(tripId) {
      const res = await pool.query<{
        id: string;
        trip_id: string;
        member_id: string | null;
        guest_id: string | null;
        age_bracket: string;
        ticket_option: string | null;
        ticket_days: number | null;
        ticket_start_date: string | null;
        discount_group: string;
        pass_type: string;
      }>(
        `SELECT id, trip_id, member_id, guest_id, age_bracket, ticket_option, ticket_days,
                ticket_start_date, discount_group, pass_type
         FROM trip_traveler_profiles
         WHERE trip_id = $1
         ORDER BY created_at ASC`,
        [tripId],
      );

      const memberIds = res.rows.map((r) => r.member_id).filter((id): id is string => Boolean(id));
      const nonVisible = memberIds.length > 0
        ? await findNonVisibleParties(pool, tripId, { userIds: memberIds, guestIds: [] })
        : { userIds: [], guestIds: [] };
      const nonVisibleMemberSet = new Set(nonVisible.userIds);

      // Omit profiles of pending_deletion or purged accounts (review F4, Property 41)
      const surviving = res.rows.filter((r) => !r.member_id || !nonVisibleMemberSet.has(r.member_id));
      if (surviving.length === 0) return [];

      const survivingMemberIds = surviving.map((r) => r.member_id).filter((id): id is string => Boolean(id));
      const survivingGuestIds = surviving.map((r) => r.guest_id).filter((id): id is string => Boolean(id));

      const memberLabels = new Map<string, string>();
      if (survivingMemberIds.length > 0) {
        const idRes = await pool.query<{ user_id: string; display_name: string }>(
          `SELECT user_id, display_name FROM profile_identity WHERE user_id = ANY($1::uuid[])`,
          [survivingMemberIds],
        );
        for (const row of idRes.rows) memberLabels.set(row.user_id, row.display_name);
      }

      const guestLabels = new Map<string, string>();
      if (survivingGuestIds.length > 0) {
        const gRes = await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
          [tripId, survivingGuestIds],
        );
        for (const row of gRes.rows) guestLabels.set(row.id, row.name);
      }

      return surviving.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        guestId: r.guest_id,
        label: (r.guest_id ? guestLabels.get(r.guest_id) : memberLabels.get(r.member_id!)) ?? 'Deleted user',
        ageBracket: r.age_bracket as TravelerProfileDTO['ageBracket'],
        ticketOption: r.ticket_option as TicketOption | null,
        ticketDays: r.ticket_days,
        ticketStartDate: toNullableDateString(r.ticket_start_date),
        discountGroup: r.discount_group as TicketDiscountGroup,
        passType: r.pass_type as TravelerPassType,
      }));
    },

    async getSettings(tripId) {
      const res = await pool.query<{
        tax_bps: unknown;
        dining_tip_bps: number | null;
        saved_cents: number | null;
        savings_target_cents: number | null;
      }>(
        `SELECT tax_bps, dining_tip_bps, saved_cents, savings_target_cents
         FROM trip_budget_settings
         WHERE trip_id = $1`,
        [tripId],
      );

      const row = res.rows[0];
      const storedTax = (row?.tax_bps && typeof row.tax_bps === 'object' && !Array.isArray(row.tax_bps)
        ? (row.tax_bps as Record<string, unknown>)
        : {}) as Partial<Record<BudgetCategory, number>>;

      const taxBps = {} as Record<BudgetCategory, number>;
      const taxBpsIsDefault = {} as Record<BudgetCategory, boolean>;

      for (const cat of BUDGET_CATEGORIES) {
        if (typeof storedTax[cat] === 'number') {
          taxBps[cat] = storedTax[cat]!;
          taxBpsIsDefault[cat] = false;
        } else {
          taxBps[cat] = BUDGET_DEFAULT_TAX_BPS[cat];
          taxBpsIsDefault[cat] = true;
        }
      }

      const diningTipBps = row?.dining_tip_bps !== null && row?.dining_tip_bps !== undefined
        ? row.dining_tip_bps
        : BUDGET_DEFAULT_DINING_TIP_BPS;
      const diningTipBpsIsDefault = row?.dining_tip_bps === null || row?.dining_tip_bps === undefined;

      return {
        taxBps,
        taxBpsIsDefault,
        diningTipBps,
        diningTipBpsIsDefault,
        savedCents: row?.saved_cents ?? 0,
        savingsTargetCents: row?.savings_target_cents ?? null,
      };
    },

    async patchSettings(tripId, patch) {
      if (patch.taxBps) {
        if (typeof patch.taxBps !== 'object' || Array.isArray(patch.taxBps)) {
          throw new AppError('trip_validation_failed', 'taxBps must be an object');
        }
        for (const [key, val] of Object.entries(patch.taxBps)) {
          if (!BUDGET_CATEGORIES.includes(key as BudgetCategory)) {
            throw new AppError('trip_validation_failed', `Invalid category in taxBps: ${key}`);
          }
          if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 2500) {
            throw new AppError('trip_validation_failed', `Invalid tax rate for ${key}: ${val}`);
          }
        }
      }
      if (patch.diningTipBps !== undefined && patch.diningTipBps !== null) {
        if (!Number.isInteger(patch.diningTipBps) || patch.diningTipBps < 0 || patch.diningTipBps > 5000) {
          throw new AppError('trip_validation_failed', 'Invalid diningTipBps');
        }
      }
      if (patch.savedCents !== undefined) {
        if (!Number.isInteger(patch.savedCents) || patch.savedCents < 0 || patch.savedCents > BUDGET_TOTAL_CAP_CENTS) {
          throw new AppError('trip_validation_failed', 'Invalid savedCents');
        }
      }
      if (patch.savingsTargetCents !== undefined && patch.savingsTargetCents !== null) {
        if (
          !Number.isInteger(patch.savingsTargetCents) ||
          patch.savingsTargetCents < 0 ||
          patch.savingsTargetCents > BUDGET_TOTAL_CAP_CENTS
        ) {
          throw new AppError('trip_validation_failed', 'Invalid savingsTargetCents');
        }
      }

      // Read existing row to merge taxBps (round 4 M5)
      const existingRes = await pool.query<{
        tax_bps: unknown;
        dining_tip_bps: number | null;
        saved_cents: number | null;
        savings_target_cents: number | null;
      }>(
        `SELECT tax_bps, dining_tip_bps, saved_cents, savings_target_cents
         FROM trip_budget_settings
         WHERE trip_id = $1`,
        [tripId],
      );
      const existing = existingRes.rows[0];
      const existingTax = (existing?.tax_bps && typeof existing.tax_bps === 'object' && !Array.isArray(existing.tax_bps)
        ? (existing.tax_bps as Record<string, unknown>)
        : {}) as Record<string, number>;

      const mergedTaxBps = patch.taxBps ? { ...existingTax, ...patch.taxBps } : existingTax;
      const diningTipBps = patch.diningTipBps !== undefined ? patch.diningTipBps : (existing?.dining_tip_bps ?? null);
      const savedCents = patch.savedCents !== undefined ? patch.savedCents : (existing?.saved_cents ?? 0);
      const savingsTargetCents = patch.savingsTargetCents !== undefined
        ? patch.savingsTargetCents
        : (existing?.savings_target_cents ?? null);

      await pool.query(
        `INSERT INTO trip_budget_settings (
           trip_id, tax_bps, dining_tip_bps, saved_cents, savings_target_cents, updated_at
         ) VALUES ($1, $2::jsonb, $3, $4, $5, now())
         ON CONFLICT (trip_id) DO UPDATE SET
           tax_bps = EXCLUDED.tax_bps,
           dining_tip_bps = EXCLUDED.dining_tip_bps,
           saved_cents = EXCLUDED.saved_cents,
           savings_target_cents = EXCLUDED.savings_target_cents,
           updated_at = now()`,
        [tripId, JSON.stringify(mergedTaxBps), diningTipBps, savedCents, savingsTargetCents],
      );

      return this.getSettings(tripId);
    },

    async dismissSuggestion(tripId, suggestionKey) {
      const existing = await pool.query<{ exists: boolean }>(
        `SELECT 1 FROM trip_budget_dismissed_suggestions WHERE trip_id = $1 AND suggestion_key = $2`,
        [tripId, suggestionKey],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        return; // Idempotent
      }

      const countRes = await pool.query<{ count: string | number }>(
        `SELECT COUNT(*) as count FROM trip_budget_dismissed_suggestions WHERE trip_id = $1`,
        [tripId],
      );
      const count = toCents(countRes.rows[0]?.count);
      if (count >= BUDGET_DISMISSED_LIMIT) {
        throw new AppError(
          'trip_validation_failed',
          `Dismissed suggestions limit reached (${BUDGET_DISMISSED_LIMIT})`,
        );
      }

      await pool.query(
        `INSERT INTO trip_budget_dismissed_suggestions (trip_id, suggestion_key, dismissed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (trip_id, suggestion_key) DO NOTHING`,
        [tripId, suggestionKey],
      );
    },

    async listDismissedSuggestions(tripId) {
      const res = await pool.query<{ suggestion_key: string }>(
        `SELECT suggestion_key FROM trip_budget_dismissed_suggestions WHERE trip_id = $1`,
        [tripId],
      );
      return new Set(res.rows.map((r) => r.suggestion_key));
    },

    async createLine(tripId, userId, input, resolved) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Lock trip and check line limit (Requirement 2.4)
        const tripCheck = await client.query<{ id: string }>('SELECT id FROM trips WHERE id = $1 FOR UPDATE', [tripId]);
        if (tripCheck.rows.length === 0) {
          throw new AppError('trip_not_found', 'Trip not found');
        }

        const countRes = await client.query<{ count: string | number }>(
          'SELECT COUNT(*) as count FROM trip_budget_lines WHERE trip_id = $1',
          [tripId],
        );
        const lineCount = toCents(countRes.rows[0]?.count);
        if (lineCount >= BUDGET_LINE_LIMIT) {
          throw new AppError('trip_validation_failed', `Budget line limit reached (${BUDGET_LINE_LIMIT})`);
        }

        // 2. Validate category and applyTip
        if (!BUDGET_CATEGORIES.includes(input.category)) {
          throw new AppError('trip_validation_failed', `Invalid category: ${input.category}`);
        }
        if (input.applyTip && input.category !== 'dining') {
          throw new AppError('trip_validation_failed', 'applyTip is only allowed when category is dining');
        }

        // 3. Allocations existence & duplicate check
        if (!input.allocations || input.allocations.length === 0) {
          throw new AppError('trip_validation_failed', 'Budget line must have at least one allocation');
        }
        if (input.allocations.length > BUDGET_ALLOCATIONS_PER_LINE_MAX) {
          throw new AppError('trip_validation_failed', `Budget line cannot exceed ${BUDGET_ALLOCATIONS_PER_LINE_MAX} allocations`);
        }

        const personKeys = new Set<string>();
        const memberIds: string[] = [];
        const guestIds: string[] = [];

        for (const alloc of input.allocations) {
          if ((!alloc.memberId && !alloc.guestId) || (alloc.memberId && alloc.guestId)) {
            throw new AppError('trip_validation_failed', 'Allocation must specify exactly one of memberId or guestId');
          }
          const key = alloc.memberId ? `m:${alloc.memberId}` : `g:${alloc.guestId}`;
          if (personKeys.has(key)) {
            throw new AppError('trip_validation_failed', 'Duplicate allocation for person');
          }
          personKeys.add(key);
          if (alloc.memberId) memberIds.push(alloc.memberId);
          if (alloc.guestId) guestIds.push(alloc.guestId);
        }

        // 4. Validate deleted parties
        const bad = await findNonVisibleParties(client, tripId, { userIds: memberIds, guestIds });
        if (bad.userIds.length > 0 || bad.guestIds.length > 0) {
          throw new AppError(
            'trip_party_deleted',
            "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.",
          );
        }

        // 5. Validate on-Trip
        if (memberIds.length > 0) {
          const onTrip = await getTripMemberUserIds(client, tripId, memberIds);
          for (const m of memberIds) {
            if (!onTrip.has(m)) {
              throw new AppError('trip_validation_failed', 'Member is not on this trip');
            }
          }
        }
        if (guestIds.length > 0) {
          const gRes = await client.query<{ id: string }>(
            'SELECT id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])',
            [tripId, guestIds],
          );
          const onTripGuests = new Set(gRes.rows.map((r) => r.id));
          for (const g of guestIds) {
            if (!onTripGuests.has(g)) {
              throw new AppError('trip_validation_failed', 'Guest does not belong to this trip');
            }
          }
        }

        // 6. Experience & Linked Expense checks
        if (input.experienceId) {
          const expRes = await client.query<{ id: string }>('SELECT id FROM experiences WHERE id = $1', [input.experienceId]);
          if (expRes.rows.length === 0) {
            throw new AppError('trip_validation_failed', 'Experience not found');
          }
        }
        if (input.linkedExpenseId) {
          const lExpRes = await client.query<{ id: string }>(
            'SELECT id FROM expenses WHERE id = $1 AND trip_id = $2',
            [input.linkedExpenseId, tripId],
          );
          if (lExpRes.rows.length === 0) {
            throw new AppError('trip_validation_failed', 'Linked expense does not belong to this trip');
          }
        }

        // 7. Price resolution & amount validation
        let priceSource: PriceSource = input.priceSource;
        let priceAsOf = new Date();
        const linePriceRef = applyParkDefaultToPriceRef(input.priceRef as PriceRef | null, input.park);
        const allocAmounts: number[] = [];
        const allocRefs: (PriceRef | null)[] = [];

        if (input.priceSource === 'user_entered') {
          for (const alloc of input.allocations) {
            if (alloc.amountCents === undefined || alloc.amountCents === null) {
              throw new AppError('trip_validation_failed', 'amountCents is required for user_entered allocations');
            }
            if (!Number.isInteger(alloc.amountCents) || alloc.amountCents < 0 || alloc.amountCents > EXPENSE_AMOUNT_MAX_CENTS) {
              throw new AppError('trip_validation_failed', 'Invalid amountCents for allocation');
            }
            allocAmounts.push(alloc.amountCents);
            allocRefs.push(alloc.priceRef ?? null);
          }
          priceAsOf = new Date();
        } else if (input.priceSource === 'disney_menu') {
          if (input.category !== 'dining') {
            throw new AppError('trip_validation_failed', 'disney_menu requires category dining');
          }
          if (!input.experienceId) {
            throw new AppError('trip_validation_failed', 'disney_menu requires non-null experienceId');
          }
          const menuRes = await client.query<{ menus: unknown }>(
            'SELECT menus FROM experience_menus WHERE experience_id = $1',
            [input.experienceId],
          );
          if (menuRes.rows.length === 0 || !menuRes.rows[0]?.menus) {
            throw new AppError('trip_validation_failed', 'No cached menu for experience');
          }
          const menus = (typeof menuRes.rows[0].menus === 'string'
            ? JSON.parse(menuRes.rows[0].menus)
            : menuRes.rows[0].menus) as MenuDTO[];

          for (const alloc of input.allocations) {
            if (!alloc.priceRef || alloc.priceRef.kind !== 'menu') {
              throw new AppError('trip_validation_failed', 'disney_menu requires menu priceRef on every allocation');
            }
            let allocComputedCents = 0;
            let storedPriceRef = alloc.priceRef;

            if (alloc.priceRef.items && alloc.priceRef.items.length > 0) {
              for (const item of alloc.priceRef.items) {
                const matched = verifyMenuItem(menus, item.name, item.priceCents);
                if (!matched) {
                  throw new AppError('trip_validation_failed', `Menu item "${item.name}" price not found in cache`);
                }
                allocComputedCents += item.priceCents * item.quantity;
              }
            } else if (alloc.priceRef.tier) {
              const matched = verifyMenuTier(menus, alloc.priceRef.tier.name, alloc.priceRef.tier.priceCents);
              if (!matched) {
                throw new AppError('trip_validation_failed', `Tier "${alloc.priceRef.tier.name}" price not found in cache`);
              }
              allocComputedCents = alloc.priceRef.tier.priceCents;
              storedPriceRef = {
                kind: 'menu',
                tier: {
                  name: normalizeTierName(alloc.priceRef.tier.name),
                  priceCents: alloc.priceRef.tier.priceCents,
                },
              };
            } else {
              throw new AppError('trip_validation_failed', 'Invalid menu priceRef: neither items nor tier');
            }

            if (alloc.amountCents !== undefined && alloc.amountCents !== null && alloc.amountCents !== allocComputedCents) {
              throw new AppError('trip_validation_failed', 'Submitted amountCents does not match computed menu amount');
            }

            allocAmounts.push(allocComputedCents);
            allocRefs.push(storedPriceRef);
          }
          priceAsOf = new Date();
        } else if (input.priceSource === 'disney_ticket_calendar') {
          priceSource = 'disney_ticket_calendar';
          priceAsOf = resolved?.asOf ?? new Date();
          for (let i = 0; i < input.allocations.length; i++) {
            const alloc = input.allocations[i]!;
            const appliedRef = applyParkDefaultToPriceRef(
              (resolved?.allocationPriceRefs?.[i] ?? alloc.priceRef) as PriceRef | null,
              input.park,
            );
            allocRefs.push(appliedRef);
            const resolvedCents = resolved?.amounts?.[i];
            if (resolvedCents !== undefined) {
              allocAmounts.push(resolvedCents);
            } else {
              allocAmounts.push(alloc.amountCents ?? 0);
            }
          }
        } else if (input.priceSource === 'themeparks_ll') {
          priceSource = 'themeparks_ll';
          if (resolved?.newestSampleDate) {
            priceAsOf = dateToInstant(resolved.newestSampleDate);
          } else {
            priceAsOf = resolved?.asOf ?? new Date();
          }
          for (let i = 0; i < input.allocations.length; i++) {
            const alloc = input.allocations[i]!;
            allocRefs.push(alloc.priceRef ?? null);
            const resolvedCents = resolved?.amounts?.[i];
            if (resolvedCents !== undefined) {
              allocAmounts.push(resolvedCents);
            } else {
              allocAmounts.push(alloc.amountCents ?? 0);
            }
          }
        }

        // 8. Insert line
        let lineRow: {
          id: string;
          trip_id: string;
          created_by: string;
          category: BudgetCategory;
          description: string;
          planned_date: string | null;
          park: string | null;
          experience_id: string | null;
          price_source: PriceSource;
          price_as_of: Date;
          price_ref: unknown;
          apply_tip: boolean;
          linked_expense_id: string | null;
          suggestion_key: string | null;
          created_at: Date;
          updated_at: Date;
        };

        try {
          const lineRes = await client.query<{
            id: string;
            trip_id: string;
            created_by: string;
            category: BudgetCategory;
            description: string;
            planned_date: string | null;
            park: string | null;
            experience_id: string | null;
            price_source: PriceSource;
            price_as_of: Date;
            price_ref: unknown;
            apply_tip: boolean;
            linked_expense_id: string | null;
            suggestion_key: string | null;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO trip_budget_lines (
               trip_id, created_by, category, description, planned_date, park,
               experience_id, price_source, price_as_of, price_ref, apply_tip,
               linked_expense_id, suggestion_key, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
             RETURNING id, trip_id, created_by, category, description, planned_date, park,
                       experience_id, price_source, price_as_of, price_ref, apply_tip,
                       linked_expense_id, suggestion_key, created_at, updated_at`,
            [
              tripId,
              userId,
              input.category,
              input.description.trim(),
              input.plannedDate ?? null,
              input.park ?? null,
              input.experienceId ?? null,
              priceSource,
              priceAsOf,
              linePriceRef ? JSON.stringify(linePriceRef) : null,
              Boolean(input.applyTip),
              input.linkedExpenseId ?? null,
              input.suggestionKey ?? null,
            ],
          );
          lineRow = lineRes.rows[0]!;
        } catch (err) {
          if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
            throw new AppError('trip_validation_failed', 'Duplicate suggestion key for this trip');
          }
          throw err;
        }

        // 9. Insert allocations
        const createdAllocs: {
          id: string;
          member_id: string | null;
          guest_id: string | null;
          amount_cents: number;
          price_ref: unknown;
        }[] = [];

        for (let i = 0; i < input.allocations.length; i++) {
          const alloc = input.allocations[i]!;
          const amount = allocAmounts[i]!;
          const ref = allocRefs[i];

          const allocRes = await client.query<{
            id: string;
            member_id: string | null;
            guest_id: string | null;
            amount_cents: number;
            price_ref: unknown;
          }>(
            `INSERT INTO trip_budget_allocations (
               line_id, member_id, guest_id, amount_cents, price_ref
             ) VALUES ($1, $2, $3, $4, $5)
             RETURNING id, member_id, guest_id, amount_cents, price_ref`,
            [lineRow.id, alloc.memberId ?? null, alloc.guestId ?? null, amount, ref ? JSON.stringify(ref) : null],
          );
          createdAllocs.push(allocRes.rows[0]!);
        }

        await client.query('COMMIT');

        // 10. Compute line math
        const settings = await this.getSettings(tripId);
        const lineMath = computeLine(
          {
            category: lineRow.category,
            applyTip: lineRow.apply_tip,
            allocations: createdAllocs.map((a) => ({
              personKey: (a.member_id ? `m:${a.member_id}` : `g:${a.guest_id}`) as PersonKey,
              cents: a.amount_cents,
            })),
          },
          {
            taxBps: settings.taxBps,
            diningTipBps: settings.diningTipBps,
            savedCents: settings.savedCents,
            savingsTargetCents: settings.savingsTargetCents,
          },
        );

        const effectivePriceSource = resolved?.effectivePriceSource ?? priceSource;
        let priceLabelKind: PriceLabelKind = 'current';
        if (priceSource === 'user_entered') {
          priceLabelKind = 'your_price';
        } else if (priceSource === 'disney_menu') {
          priceLabelKind = ticketAgeClass(priceAsOf, wdwToday(), { freshDays: 45, estimateAfterDays: 120 });
        } else if (priceSource === 'disney_ticket_calendar') {
          priceLabelKind = resolved?.labelKind ?? 'current';
        } else if (priceSource === 'themeparks_ll') {
          priceLabelKind = resolved?.labelKind ?? 'current';
        }

        return {
          id: lineRow.id,
          tripId: lineRow.trip_id,
          createdBy: lineRow.created_by,
          category: lineRow.category,
          description: lineRow.description,
          plannedDate: toNullableDateString(lineRow.planned_date),
          park: lineRow.park,
          experienceId: lineRow.experience_id,
          priceSource,
          effectivePriceSource,
          priceLabelKind,
          asOf: priceAsOf.toISOString(),
          attribution: priceSource === 'disney_ticket_calendar' ? 'disney' : priceSource === 'themeparks_ll' ? 'themeparks_wiki' : null,
          applyTip: lineRow.apply_tip,
          linkedExpenseId: lineRow.linked_expense_id,
          suggestionKey: lineRow.suggestion_key,
          subtotalCents: lineMath.subtotalCents,
          taxCents: lineMath.taxCents,
          tipCents: lineMath.tipCents,
          totalCents: lineMath.totalCents,
          allocations: createdAllocs.map((a, idx) => ({
            id: a.id,
            memberId: a.member_id,
            guestId: a.guest_id,
            storedCents: a.amount_cents,
            effectiveCents: a.amount_cents,
            taxCents: lineMath.perPerson[idx]?.taxCents ?? 0,
            tipCents: lineMath.perPerson[idx]?.tipCents ?? 0,
            priceRef: a.price_ref as PriceRef | null,
          })),
        };
      } catch (err) {
        await client.query('ROLLBACK');
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
          throw new AppError('trip_validation_failed', 'Referenced person does not exist');
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async editLine(tripId, lineId, userId, callerRole, input, resolved) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Lock existing line and verify permissions
        const existingLineRes = await client.query<{ id: string; created_by: string; suggestion_key: string | null }>(
          'SELECT id, created_by, suggestion_key FROM trip_budget_lines WHERE id = $1 AND trip_id = $2 FOR UPDATE',
          [lineId, tripId],
        );
        const existingLine = existingLineRes.rows[0];
        if (!existingLine) {
          throw new AppError('trip_not_found', 'Budget line not found');
        }

        if (callerRole !== 'organizer' && existingLine.created_by !== userId) {
          throw new AppError('trip_forbidden', 'Only creator or organizer may edit budget line');
        }

        // 2. Validate category and applyTip
        if (!BUDGET_CATEGORIES.includes(input.category)) {
          throw new AppError('trip_validation_failed', `Invalid category: ${input.category}`);
        }
        if (input.applyTip && input.category !== 'dining') {
          throw new AppError('trip_validation_failed', 'applyTip is only allowed when category is dining');
        }

        // 3. Allocations existence & duplicate check
        if (!input.allocations || input.allocations.length === 0) {
          throw new AppError('trip_validation_failed', 'Budget line must have at least one allocation');
        }
        if (input.allocations.length > BUDGET_ALLOCATIONS_PER_LINE_MAX) {
          throw new AppError('trip_validation_failed', `Budget line cannot exceed ${BUDGET_ALLOCATIONS_PER_LINE_MAX} allocations`);
        }

        const personKeys = new Set<string>();
        for (const alloc of input.allocations) {
          if ((!alloc.memberId && !alloc.guestId) || (alloc.memberId && alloc.guestId)) {
            throw new AppError('trip_validation_failed', 'Allocation must specify exactly one of memberId or guestId');
          }
          const key = alloc.memberId ? `m:${alloc.memberId}` : `g:${alloc.guestId}`;
          if (personKeys.has(key)) {
            throw new AppError('trip_validation_failed', 'Duplicate allocation for person');
          }
          personKeys.add(key);
        }

        // 4. Exemption check (Review F15)
        const oldAllocsRes = await client.query<{ member_id: string | null; guest_id: string | null }>(
          'SELECT member_id, guest_id FROM trip_budget_allocations WHERE line_id = $1',
          [lineId],
        );
        const existingPersonKeys = new Set(
          oldAllocsRes.rows.map((r) => (r.member_id ? `m:${r.member_id}` : `g:${r.guest_id}`)),
        );

        const newAllocations = input.allocations.filter(
          (a) => !existingPersonKeys.has(a.memberId ? `m:${a.memberId}` : `g:${a.guestId}`),
        );

        const newMemberIds = newAllocations.map((a) => a.memberId).filter(Boolean) as string[];
        const newGuestIds = newAllocations.map((a) => a.guestId).filter(Boolean) as string[];

        if (newMemberIds.length > 0 || newGuestIds.length > 0) {
          const bad = await findNonVisibleParties(client, tripId, { userIds: newMemberIds, guestIds: newGuestIds });
          if (bad.userIds.length > 0 || bad.guestIds.length > 0) {
            throw new AppError(
              'trip_party_deleted',
              "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.",
            );
          }

          if (newMemberIds.length > 0) {
            const onTrip = await getTripMemberUserIds(client, tripId, newMemberIds);
            for (const m of newMemberIds) {
              if (!onTrip.has(m)) {
                throw new AppError('trip_validation_failed', 'Member is not on this trip');
              }
            }
          }
          if (newGuestIds.length > 0) {
            const gRes = await client.query<{ id: string }>(
              'SELECT id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])',
              [tripId, newGuestIds],
            );
            const onTripGuests = new Set(gRes.rows.map((r) => r.id));
            for (const g of newGuestIds) {
              if (!onTripGuests.has(g)) {
                throw new AppError('trip_validation_failed', 'Guest does not belong to this trip');
              }
            }
          }
        }

        // 5. Experience & Linked Expense checks
        if (input.experienceId) {
          const expRes = await client.query<{ id: string }>('SELECT id FROM experiences WHERE id = $1', [input.experienceId]);
          if (expRes.rows.length === 0) {
            throw new AppError('trip_validation_failed', 'Experience not found');
          }
        }
        if (input.linkedExpenseId) {
          const lExpRes = await client.query<{ id: string }>(
            'SELECT id FROM expenses WHERE id = $1 AND trip_id = $2',
            [input.linkedExpenseId, tripId],
          );
          if (lExpRes.rows.length === 0) {
            throw new AppError('trip_validation_failed', 'Linked expense does not belong to this trip');
          }
        }

        // 6. Price resolution & amount validation
        let priceSource: PriceSource = input.priceSource;
        let priceAsOf = new Date();
        const linePriceRef = applyParkDefaultToPriceRef(input.priceRef as PriceRef | null, input.park);
        const allocAmounts: number[] = [];
        const allocRefs: (PriceRef | null)[] = [];

        if (input.priceSource === 'user_entered') {
          for (const alloc of input.allocations) {
            if (alloc.amountCents === undefined || alloc.amountCents === null) {
              throw new AppError('trip_validation_failed', 'amountCents is required for user_entered allocations');
            }
            if (!Number.isInteger(alloc.amountCents) || alloc.amountCents < 0 || alloc.amountCents > EXPENSE_AMOUNT_MAX_CENTS) {
              throw new AppError('trip_validation_failed', 'Invalid amountCents for allocation');
            }
            allocAmounts.push(alloc.amountCents);
            allocRefs.push(alloc.priceRef ?? null);
          }
          priceAsOf = new Date();
        } else if (input.priceSource === 'disney_menu') {
          if (input.category !== 'dining') {
            throw new AppError('trip_validation_failed', 'disney_menu requires category dining');
          }
          if (!input.experienceId) {
            throw new AppError('trip_validation_failed', 'disney_menu requires non-null experienceId');
          }
          const menuRes = await client.query<{ menus: unknown }>(
            'SELECT menus FROM experience_menus WHERE experience_id = $1',
            [input.experienceId],
          );
          if (menuRes.rows.length === 0 || !menuRes.rows[0]?.menus) {
            throw new AppError('trip_validation_failed', 'No cached menu for experience');
          }
          const menus = (typeof menuRes.rows[0].menus === 'string'
            ? JSON.parse(menuRes.rows[0].menus)
            : menuRes.rows[0].menus) as MenuDTO[];

          for (const alloc of input.allocations) {
            if (!alloc.priceRef || alloc.priceRef.kind !== 'menu') {
              throw new AppError('trip_validation_failed', 'disney_menu requires menu priceRef on every allocation');
            }
            let allocComputedCents = 0;
            let storedPriceRef = alloc.priceRef;

            if (alloc.priceRef.items && alloc.priceRef.items.length > 0) {
              for (const item of alloc.priceRef.items) {
                const matched = verifyMenuItem(menus, item.name, item.priceCents);
                if (!matched) {
                  throw new AppError('trip_validation_failed', `Menu item "${item.name}" price not found in cache`);
                }
                allocComputedCents += item.priceCents * item.quantity;
              }
            } else if (alloc.priceRef.tier) {
              const matched = verifyMenuTier(menus, alloc.priceRef.tier.name, alloc.priceRef.tier.priceCents);
              if (!matched) {
                throw new AppError('trip_validation_failed', `Tier "${alloc.priceRef.tier.name}" price not found in cache`);
              }
              allocComputedCents = alloc.priceRef.tier.priceCents;
              storedPriceRef = {
                kind: 'menu',
                tier: {
                  name: normalizeTierName(alloc.priceRef.tier.name),
                  priceCents: alloc.priceRef.tier.priceCents,
                },
              };
            } else {
              throw new AppError('trip_validation_failed', 'Invalid menu priceRef: neither items nor tier');
            }

            if (alloc.amountCents !== undefined && alloc.amountCents !== null && alloc.amountCents !== allocComputedCents) {
              throw new AppError('trip_validation_failed', 'Submitted amountCents does not match computed menu amount');
            }

            allocAmounts.push(allocComputedCents);
            allocRefs.push(storedPriceRef);
          }
          priceAsOf = new Date();
        } else if (input.priceSource === 'disney_ticket_calendar') {
          priceSource = 'disney_ticket_calendar';
          priceAsOf = resolved?.asOf ?? new Date();
          for (let i = 0; i < input.allocations.length; i++) {
            const alloc = input.allocations[i]!;
            const appliedRef = applyParkDefaultToPriceRef(
              (resolved?.allocationPriceRefs?.[i] ?? alloc.priceRef) as PriceRef | null,
              input.park,
            );
            allocRefs.push(appliedRef);
            const resolvedCents = resolved?.amounts?.[i];
            if (resolvedCents !== undefined) {
              allocAmounts.push(resolvedCents);
            } else {
              allocAmounts.push(alloc.amountCents ?? 0);
            }
          }
        } else if (input.priceSource === 'themeparks_ll') {
          priceSource = 'themeparks_ll';
          if (resolved?.newestSampleDate) {
            priceAsOf = dateToInstant(resolved.newestSampleDate);
          } else {
            priceAsOf = resolved?.asOf ?? new Date();
          }
          for (let i = 0; i < input.allocations.length; i++) {
            const alloc = input.allocations[i]!;
            allocRefs.push(alloc.priceRef ?? null);
            const resolvedCents = resolved?.amounts?.[i];
            if (resolvedCents !== undefined) {
              allocAmounts.push(resolvedCents);
            } else {
              allocAmounts.push(alloc.amountCents ?? 0);
            }
          }
        }

        // 7. Update line row (keeps original suggestion_key)
        const updateLineRes = await client.query<{
          id: string;
          trip_id: string;
          created_by: string;
          category: BudgetCategory;
          description: string;
          planned_date: string | null;
          park: string | null;
          experience_id: string | null;
          price_source: PriceSource;
          price_as_of: Date;
          price_ref: unknown;
          apply_tip: boolean;
          linked_expense_id: string | null;
          suggestion_key: string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE trip_budget_lines
           SET category = $1,
               description = $2,
               planned_date = $3,
               park = $4,
               experience_id = $5,
               price_source = $6,
               price_as_of = $7,
               price_ref = $8,
               apply_tip = $9,
               linked_expense_id = $10,
               updated_at = now()
           WHERE id = $11
           RETURNING id, trip_id, created_by, category, description, planned_date, park,
                     experience_id, price_source, price_as_of, price_ref, apply_tip,
                     linked_expense_id, suggestion_key, created_at, updated_at`,
          [
            input.category,
            input.description.trim(),
            input.plannedDate ?? null,
            input.park ?? null,
            input.experienceId ?? null,
            priceSource,
            priceAsOf,
            linePriceRef ? JSON.stringify(linePriceRef) : null,
            Boolean(input.applyTip),
            input.linkedExpenseId ?? null,
            lineId,
          ],
        );
        const lineRow = updateLineRes.rows[0]!;

        // 8. Atomically replace allocations
        await client.query('DELETE FROM trip_budget_allocations WHERE line_id = $1', [lineId]);

        const createdAllocs: {
          id: string;
          member_id: string | null;
          guest_id: string | null;
          amount_cents: number;
          price_ref: unknown;
        }[] = [];

        for (let i = 0; i < input.allocations.length; i++) {
          const alloc = input.allocations[i]!;
          const amount = allocAmounts[i]!;
          const ref = allocRefs[i];

          const allocRes = await client.query<{
            id: string;
            member_id: string | null;
            guest_id: string | null;
            amount_cents: number;
            price_ref: unknown;
          }>(
            `INSERT INTO trip_budget_allocations (
               line_id, member_id, guest_id, amount_cents, price_ref
             ) VALUES ($1, $2, $3, $4, $5)
             RETURNING id, member_id, guest_id, amount_cents, price_ref`,
            [lineRow.id, alloc.memberId ?? null, alloc.guestId ?? null, amount, ref ? JSON.stringify(ref) : null],
          );
          createdAllocs.push(allocRes.rows[0]!);
        }

        await client.query('COMMIT');

        // 9. Compute line math
        const settings = await this.getSettings(tripId);
        const lineMath = computeLine(
          {
            category: lineRow.category,
            applyTip: lineRow.apply_tip,
            allocations: createdAllocs.map((a) => ({
              personKey: (a.member_id ? `m:${a.member_id}` : `g:${a.guest_id}`) as PersonKey,
              cents: a.amount_cents,
            })),
          },
          {
            taxBps: settings.taxBps,
            diningTipBps: settings.diningTipBps,
            savedCents: settings.savedCents,
            savingsTargetCents: settings.savingsTargetCents,
          },
        );

        const effectivePriceSource = resolved?.effectivePriceSource ?? priceSource;
        let priceLabelKind: PriceLabelKind = 'current';
        if (priceSource === 'user_entered') {
          priceLabelKind = 'your_price';
        } else if (priceSource === 'disney_menu') {
          priceLabelKind = ticketAgeClass(priceAsOf, wdwToday(), { freshDays: 45, estimateAfterDays: 120 });
        } else if (priceSource === 'disney_ticket_calendar') {
          priceLabelKind = resolved?.labelKind ?? 'current';
        } else if (priceSource === 'themeparks_ll') {
          priceLabelKind = resolved?.labelKind ?? 'current';
        }

        return {
          id: lineRow.id,
          tripId: lineRow.trip_id,
          createdBy: lineRow.created_by,
          category: lineRow.category,
          description: lineRow.description,
          plannedDate: toNullableDateString(lineRow.planned_date),
          park: lineRow.park,
          experienceId: lineRow.experience_id,
          priceSource,
          effectivePriceSource,
          priceLabelKind,
          asOf: priceAsOf.toISOString(),
          attribution: priceSource === 'disney_ticket_calendar' ? 'disney' : priceSource === 'themeparks_ll' ? 'themeparks_wiki' : null,
          applyTip: lineRow.apply_tip,
          linkedExpenseId: lineRow.linked_expense_id,
          suggestionKey: lineRow.suggestion_key,
          subtotalCents: lineMath.subtotalCents,
          taxCents: lineMath.taxCents,
          tipCents: lineMath.tipCents,
          totalCents: lineMath.totalCents,
          allocations: createdAllocs.map((a, idx) => ({
            id: a.id,
            memberId: a.member_id,
            guestId: a.guest_id,
            storedCents: a.amount_cents,
            effectiveCents: a.amount_cents,
            taxCents: lineMath.perPerson[idx]?.taxCents ?? 0,
            tipCents: lineMath.perPerson[idx]?.tipCents ?? 0,
            priceRef: a.price_ref as PriceRef | null,
          })),
        };
      } catch (err) {
        await client.query('ROLLBACK');
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
          throw new AppError('trip_validation_failed', 'Referenced person does not exist');
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async removeLine(tripId, lineId, userId, callerRole) {
      const res = await pool.query<{ id: string; created_by: string }>(
        'SELECT id, created_by FROM trip_budget_lines WHERE id = $1 AND trip_id = $2',
        [lineId, tripId],
      );
      const row = res.rows[0];
      if (!row) {
        throw new AppError('trip_not_found', 'Budget line not found');
      }

      if (callerRole !== 'organizer' && row.created_by !== userId) {
        throw new AppError('trip_forbidden', 'Only creator or organizer may remove budget line');
      }

      await pool.query('DELETE FROM trip_budget_lines WHERE id = $1 AND trip_id = $2', [lineId, tripId]);
    },

    async linkExpense(tripId, lineId, expenseId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Lock the line so two simultaneous links serialize (Requirement 23.7).
        const lineRes = await client.query<{ id: string; linked_expense_id: string | null }>(
          'SELECT id, linked_expense_id FROM trip_budget_lines WHERE id = $1 AND trip_id = $2 FOR UPDATE',
          [lineId, tripId],
        );
        const line = lineRes.rows[0];
        if (!line) {
          throw new AppError('trip_not_found', 'Budget line not found');
        }

        // The Expense must belong to the same Trip (Requirement 17.3 / 23.6). Read-only.
        const expRes = await client.query<{ id: string }>(
          'SELECT id FROM expenses WHERE id = $1 AND trip_id = $2',
          [expenseId, tripId],
        );
        if (expRes.rows.length === 0) {
          throw new AppError('trip_validation_failed', 'Expense does not belong to this trip');
        }

        if (line.linked_expense_id === expenseId) {
          await client.query('COMMIT');
          return;
        }
        if (line.linked_expense_id !== null) {
          throw new AppError('trip_validation_failed', 'Budget line is already linked to an expense');
        }

        await client.query(
          `UPDATE trip_budget_lines
              SET linked_expense_id = $1, updated_at = now()
            WHERE id = $2 AND trip_id = $3 AND linked_expense_id IS NULL`,
          [expenseId, lineId, tripId],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async loadBudget(tripId) {
      // 1. Trip dates and day_touring_hours
      const tripRes = await pool.query<{
        start_date: string | Date;
        end_date: string | Date;
        day_touring_hours: unknown;
      }>(
        'SELECT start_date, end_date, day_touring_hours FROM trips WHERE id = $1',
        [tripId],
      );
      const tripRow = tripRes.rows[0];
      if (!tripRow) {
        throw new AppError('trip_not_found', 'Trip not found');
      }

      // 2. Lines
      const linesRes = await pool.query<{
        id: string;
        category: BudgetCategory;
        description: string;
        planned_date: string | null;
        park: string | null;
        experience_id: string | null;
        price_source: PriceSource;
        price_as_of: Date;
        price_ref: unknown;
        apply_tip: boolean;
        linked_expense_id: string | null;
        suggestion_key: string | null;
      }>(
        `SELECT id, category, description, planned_date, park, experience_id,
                price_source, price_as_of, price_ref, apply_tip, linked_expense_id, suggestion_key
         FROM trip_budget_lines
         WHERE trip_id = $1
         ORDER BY planned_date ASC NULLS LAST, created_at ASC`,
        [tripId],
      );

      const lineIds = linesRes.rows.map((r) => r.id);

      // 3. Allocations by line_id = ANY($1::uuid[])
      const allocsRes = await pool.query<{
        id: string;
        line_id: string;
        member_id: string | null;
        guest_id: string | null;
        guest_name: string | null;
        guest_sponsor_id: string | null;
        amount_cents: string | number;
        price_ref: unknown;
      }>(
        `SELECT a.id, a.line_id, a.member_id, a.guest_id, g.name AS guest_name,
                g.sponsor_member_id AS guest_sponsor_id, a.amount_cents, a.price_ref
         FROM trip_budget_allocations a
         LEFT JOIN trip_guests g ON g.id = a.guest_id
         WHERE a.line_id = ANY($1::uuid[])`,
        [lineIds],
      );

      // 4. Traveler profiles
      const profRes = await pool.query<{
        id: string;
        trip_id: string;
        member_id: string | null;
        guest_id: string | null;
        guest_name: string | null;
        guest_sponsor_id: string | null;
        age_bracket: string;
        ticket_option: string | null;
        ticket_days: number | null;
        ticket_start_date: string | null;
        discount_group: string;
        pass_type: string;
      }>(
        `SELECT p.id, p.trip_id, p.member_id, p.guest_id, g.name AS guest_name,
                g.sponsor_member_id AS guest_sponsor_id, p.age_bracket, p.ticket_option,
                p.ticket_days, p.ticket_start_date, p.discount_group, p.pass_type
         FROM trip_traveler_profiles p
         LEFT JOIN trip_guests g ON g.id = p.guest_id
         WHERE p.trip_id = $1
         ORDER BY p.created_at ASC`,
        [tripId],
      );

      // 5. Settings
      const settingsRes = await pool.query<{
        tax_bps: unknown;
        dining_tip_bps: number | null;
        saved_cents: number | null;
        savings_target_cents: number | null;
      }>(
        `SELECT tax_bps, dining_tip_bps, saved_cents, savings_target_cents
         FROM trip_budget_settings
         WHERE trip_id = $1`,
        [tripId],
      );

      // 6. Vs-Actual SQL (net of refunds)
      const vsActualRes = await pool.query<{
        category: string;
        actual_cents: string | number;
      }>(
        `SELECT category, SUM(actual_cents) AS actual_cents
         FROM (
           SELECT category, amount_cents AS actual_cents
           FROM expenses
           WHERE trip_id = $1
           UNION ALL
           SELECT e.category, -r.amount_cents AS actual_cents
           FROM expense_refunds r
           JOIN expenses e ON e.id = r.expense_id
           WHERE e.trip_id = $1
         ) combined
         GROUP BY category`,
        [tripId],
      );

      // 7. The single label lookup through profile_identity
      const allMemberIds = [
        ...new Set([
          ...allocsRes.rows.map((a) => a.member_id).filter((id): id is string => Boolean(id)),
          ...profRes.rows.map((p) => p.member_id).filter((id): id is string => Boolean(id)),
        ]),
      ];

      const idRes = await pool.query<{
        user_id: string;
        display_name: string;
        is_visible: boolean;
      }>(
        `SELECT user_id, display_name, is_visible
         FROM profile_identity
         WHERE user_id = ANY($1::uuid[])`,
        [allMemberIds],
      );

      // Process vs-actual
      const vsActualByExpenseCategory = {
        hotel: 0,
        tickets: 0,
        lightning_lane: 0,
        dining: 0,
        shopping: 0,
        transportation: 0,
        other: 0,
      };
      for (const row of vsActualRes.rows) {
        if (row.category in vsActualByExpenseCategory) {
          vsActualByExpenseCategory[row.category as keyof typeof vsActualByExpenseCategory] = toCents(row.actual_cents);
        }
      }

      // Process people index
      const people = new Map<PersonKey, PersonInfo>();
      const idMap = new Map(idRes.rows.map((r) => [r.user_id, r]));

      for (const mId of allMemberIds) {
        const idRow = idMap.get(mId);
        people.set(`m:${mId}`, {
          label: idRow?.display_name ?? 'Deleted user',
          sponsorMemberId: null,
          deleted: idRow ? !idRow.is_visible : true,
        });
      }

      for (const a of allocsRes.rows) {
        if (a.guest_id) {
          people.set(`g:${a.guest_id}`, {
            label: a.guest_name ?? 'Deleted user',
            sponsorMemberId: a.guest_sponsor_id,
            deleted: false,
          });
        }
      }
      for (const p of profRes.rows) {
        if (p.guest_id) {
          people.set(`g:${p.guest_id}`, {
            label: p.guest_name ?? 'Deleted user',
            sponsorMemberId: p.guest_sponsor_id,
            deleted: false,
          });
        }
      }

      // Process traveler profiles: omit profiles whose member is not active/visible (review F4, Property 41)
      const visibleProfiles = profRes.rows.filter((p) => {
        if (!p.member_id) return true;
        const idRow = idMap.get(p.member_id);
        return idRow?.is_visible === true;
      });

      const travelers: TravelerProfileDTO[] = visibleProfiles.map((p) => ({
        id: p.id,
        memberId: p.member_id,
        guestId: p.guest_id,
        label: (p.guest_id ? p.guest_name : people.get(`m:${p.member_id}`)?.label) ?? 'Deleted user',
        ageBracket: p.age_bracket as TravelerProfileDTO['ageBracket'],
        ticketOption: p.ticket_option as TicketOption | null,
        ticketDays: p.ticket_days,
        ticketStartDate: toNullableDateString(p.ticket_start_date),
        discountGroup: p.discount_group as TicketDiscountGroup,
        passType: p.pass_type as TravelerPassType,
      }));

      // Process settings
      const settingsRow = settingsRes.rows[0];
      const storedTax = (settingsRow?.tax_bps && typeof settingsRow.tax_bps === 'object' && !Array.isArray(settingsRow.tax_bps)
        ? (settingsRow.tax_bps as Record<string, unknown>)
        : {}) as Partial<Record<BudgetCategory, number>>;

      const taxBps = {} as Record<BudgetCategory, number>;
      const taxBpsIsDefault = {} as Record<BudgetCategory, boolean>;

      for (const cat of BUDGET_CATEGORIES) {
        if (typeof storedTax[cat] === 'number') {
          taxBps[cat] = storedTax[cat]!;
          taxBpsIsDefault[cat] = false;
        } else {
          taxBps[cat] = BUDGET_DEFAULT_TAX_BPS[cat];
          taxBpsIsDefault[cat] = true;
        }
      }

      const diningTipBps = settingsRow?.dining_tip_bps !== null && settingsRow?.dining_tip_bps !== undefined
        ? settingsRow.dining_tip_bps
        : BUDGET_DEFAULT_DINING_TIP_BPS;
      const diningTipBpsIsDefault = settingsRow?.dining_tip_bps === null || settingsRow?.dining_tip_bps === undefined;

      const settings: BudgetSettingsDTO = {
        taxBps,
        taxBpsIsDefault,
        diningTipBps,
        diningTipBpsIsDefault,
        savedCents: toCents(settingsRow?.saved_cents),
        savingsTargetCents: settingsRow?.savings_target_cents !== null && settingsRow?.savings_target_cents !== undefined
          ? toCents(settingsRow.savings_target_cents)
          : null,
      };

      const settingsEffective: BudgetSettingsEffective = {
        taxBps,
        diningTipBps,
        savedCents: settings.savedCents,
        savingsTargetCents: settings.savingsTargetCents,
      };

      // Process stored lines and allocations
      const allocsByLine = new Map<string, StoredAllocation[]>();
      for (const a of allocsRes.rows) {
        let list = allocsByLine.get(a.line_id);
        if (!list) {
          list = [];
          allocsByLine.set(a.line_id, list);
        }
        list.push({
          id: a.id,
          personKey: (a.member_id ? `m:${a.member_id}` : `g:${a.guest_id}`) as PersonKey,
          storedCents: toCents(a.amount_cents),
          priceRef: a.price_ref as PriceRef | null,
        });
      }

      const storedLines: StoredLine[] = linesRes.rows.map((l) => {
        const lineAllocs = allocsByLine.get(l.id) ?? [];
        lineAllocs.sort((a, b) => a.personKey.localeCompare(b.personKey));
        return {
          id: l.id,
          category: l.category,
          description: l.description,
          plannedDate: toNullableDateString(l.planned_date),
          park: l.park,
          experienceId: l.experience_id,
          priceSource: l.price_source,
          priceAsOf: new Date(l.price_as_of),
          priceRef: l.price_ref as TicketPriceRef | LlPriceRef | null,
          applyTip: l.apply_tip,
          // The column was selected above but never mapped, so GET /budget always reported
          // `linkedExpenseId: null` (Requirement 17.3 / 23.10 need the real value).
          linkedExpenseId: l.linked_expense_id,
          // Same omission as `linked_expense_id`: selected but never mapped, so GET /budget reported
          // `suggestionKey: null` for every line.
          suggestionKey: l.suggestion_key,
          allocations: lineAllocs,
        };
      });

      const dayTouringHours = (tripRow.day_touring_hours && typeof tripRow.day_touring_hours === 'object'
        ? tripRow.day_touring_hours
        : {}) as Record<string, { startingPark?: string }>;

      return {
        trip: {
          startDate: toDateString(tripRow.start_date),
          endDate: toDateString(tripRow.end_date),
          dayTouringHours,
        },
        storedLines,
        travelers,
        settings,
        settingsEffective,
        people,
        vsActualByExpenseCategory,
      };
    },

    async listPlannedItemsForSuggestions(tripId) {
      const res = await pool.query<{
        id: string;
        experience_id: string | null;
        planned_date: string | null;
        reservation_kind: string | null;
        party_size: number | null;
        is_lightning_lane: boolean;
      }>(
        `SELECT id, experience_id, planned_date, reservation_kind, party_size, is_lightning_lane
         FROM planned_items
         WHERE trip_id = $1
         ORDER BY planned_date ASC NULLS LAST, created_at ASC`,
        [tripId],
      );
      return res.rows.map((r) => ({
        id: r.id,
        experienceId: r.experience_id,
        plannedDate: toNullableDateString(r.planned_date),
        reservationKind: r.reservation_kind,
        partySize: r.party_size,
        isLightningLane: Boolean(r.is_lightning_lane),
      }));
    },

    async getServiceStylesForExperiences(experienceIds) {
      if (experienceIds.length === 0) return new Map();
      const res = await pool.query<{
        experience_id: string;
        menus: unknown;
      }>(
        `SELECT experience_id, menus
         FROM experience_menus
         WHERE experience_id = ANY($1::uuid[])`,
        [[...new Set(experienceIds)]],
      );
      const out = new Map<string, string[]>();
      for (const row of res.rows) {
        const menus = (typeof row.menus === 'string' ? JSON.parse(row.menus) : row.menus) as MenuDTO[];
        const styles = new Set<string>();
        for (const m of menus) {
          if (m.serviceStyle) styles.add(m.serviceStyle.trim().toLowerCase());
        }
        out.set(row.experience_id, [...styles]);
      }
      return out;
    },
  };
}