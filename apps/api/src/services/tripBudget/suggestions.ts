/**
 * Pure suggestion derivation for Trip Budget (Requirement 16).
 *
 * Proposes budget line drafts from planned items (dining, LL) and traveler profiles (tickets).
 * Suggestions are deterministic, sorted by key, and omit existing/dismissed keys.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 6.7, 9.7
 */

import {
  PARKS,
  TICKET_PARK_BY_CANONICAL_PARK,
  isTipBearingServiceStyle,
  type BudgetSuggestionDTO,
  type Park,
  type TicketOption,
  type TicketPriceRef,
  type LlPriceRef,
  type TravelerProfileDTO,
} from '@dwt/shared';
import type { PlannedItemRow } from './types.js';

/**
 * [A] Assumption: starting tip-bearing service styles for dining suggestions (Task 11 / 12.5).
 * Service style sample was deferred pending owner decision; unknown styles default to false (applyTip: false).
 * startingPark strings in trips.day_touring_hours are freeform strings mapped against canonical PARKS case-insensitively.
 */

export interface DeriveSuggestionsInput {
  plannedItems: readonly PlannedItemRow[];
  dayTouringHours: Record<string, { startingPark?: string }>;
  profiles: readonly TravelerProfileDTO[];
  tripStart: string; // YYYY-MM-DD
  existingKeys: ReadonlySet<string>;
  dismissedKeys: ReadonlySet<string>;
  llSingleAvailable: ReadonlySet<string>; // `${date}:${experienceId}`
  experiencePark: ReadonlyMap<string, string | null>;
  /** lower-cased meal-period serviceStyle values of the cached menu per Experience id; absent key = no cached menu. */
  serviceStyleByExperience: ReadonlyMap<string, readonly string[]>;
}

const TICKET_OPTION_LABELS: Record<TicketOption, string> = {
  base: 'Base',
  park_hopper: 'Park Hopper',
  park_hopper_plus: 'Park Hopper Plus',
  water_parks_sports: 'Water Parks and Sports',
};

function mapCanonicalPark(raw: string | null | undefined): Park | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const canonical = PARKS.find((p) => p.toLowerCase() === trimmed);
  return (canonical as Park) ?? null;
}

export function deriveSuggestions(i: DeriveSuggestionsInput): BudgetSuggestionDTO[] {
  const {
    plannedItems,
    dayTouringHours,
    profiles,
    tripStart,
    existingKeys,
    dismissedKeys,
    llSingleAvailable,
    experiencePark,
    serviceStyleByExperience,
  } = i;

  const suggestionsByKey = new Map<string, BudgetSuggestionDTO>();

  const isEligibleKey = (key: string): boolean => {
    return !existingKeys.has(key) && !dismissedKeys.has(key) && !suggestionsByKey.has(key);
  };

  // 1. Dining Suggestions: planned_items with reservation_kind = 'dining', planned_date != null, experience_id != null
  for (const item of plannedItems) {
    if (item.reservationKind !== 'dining' || !item.plannedDate || !item.experienceId) {
      continue;
    }

    const key = `planned:${item.id}`;
    if (!isEligibleKey(key)) continue;

    // Park precedence: Experience park, then startingPark of the day, then null
    const expParkRaw = experiencePark.get(item.experienceId);
    const expPark = mapCanonicalPark(expParkRaw);
    const startingParkRaw = dayTouringHours[item.plannedDate]?.startingPark;
    const startingPark = mapCanonicalPark(startingParkRaw);
    const park = expPark ?? startingPark ?? null;

    // applyTip: true iff any cached serviceStyle is tip-bearing
    const styles = serviceStyleByExperience.get(item.experienceId);
    const applyTip = styles ? styles.some((s) => isTipBearingServiceStyle(s)) : false;

    suggestionsByKey.set(key, {
      suggestionKey: key,
      kind: 'dining',
      draft: {
        category: 'dining',
        description: 'Dining reservation',
        plannedDate: item.plannedDate,
        park,
        experienceId: item.experienceId,
        priceSource: 'disney_menu',
        priceRef: null,
        applyTip,
        suggestionKey: key,
        partySize: item.partySize,
        allocations: [],
        needsPrice: true,
        needsPeople: true,
      },
    });
  }

  // 2. Lightning Lane Suggestions: planned_items with isLightningLane = true
  // Round 5 L9: omit if plannedDate is null, experienceId is null, or Experience has no canonical park
  for (const item of plannedItems) {
    if (!item.isLightningLane || !item.plannedDate || !item.experienceId) {
      continue;
    }

    const expPark = mapCanonicalPark(experiencePark.get(item.experienceId));
    if (!expPark) {
      continue;
    }

    const isSingle = llSingleAvailable.has(`${item.plannedDate}:${item.experienceId}`);
    if (isSingle) {
      const key = `ll:single:${item.plannedDate}:${item.experienceId}`;
      if (isEligibleKey(key)) {
        const priceRef: LlPriceRef = {
          kind: 'll',
          passType: 'single',
          park: expPark,
          date: item.plannedDate,
          experienceId: item.experienceId,
        };

        suggestionsByKey.set(key, {
          suggestionKey: key,
          kind: 'lightning_lane',
          draft: {
            category: 'lightning_lane',
            description: 'Lightning Lane Single Pass',
            plannedDate: item.plannedDate,
            park: expPark,
            experienceId: item.experienceId,
            priceSource: 'themeparks_ll',
            priceRef,
            applyTip: false,
            suggestionKey: key,
            partySize: null,
            allocations: [],
            needsPrice: false,
            needsPeople: true,
          },
        });
      }
    } else {
      const key = `ll:multi:${item.plannedDate}:${expPark}`;
      if (isEligibleKey(key)) {
        const priceRef: LlPriceRef = {
          kind: 'll',
          passType: 'multi',
          park: expPark,
          date: item.plannedDate,
        };

        suggestionsByKey.set(key, {
          suggestionKey: key,
          kind: 'lightning_lane',
          draft: {
            category: 'lightning_lane',
            description: 'Lightning Lane Multi Pass',
            plannedDate: item.plannedDate,
            park: expPark,
            experienceId: null,
            priceSource: 'themeparks_ll',
            priceRef,
            applyTip: false,
            suggestionKey: key,
            partySize: null,
            allocations: [],
            needsPrice: false,
            needsPeople: true,
          },
        });
      }
    }
  }

  // 3. Ticket Suggestions: grouped by (ticketOption, ticketDays, startDate, discountGroup)
  // Only traveler profiles with ticketOption, ticketDays, ageBracket != under3, passType == none
  const ticketEligibleProfiles = profiles.filter(
    (p) =>
      p.ticketOption !== null &&
      p.ticketDays !== null &&
      p.ageBracket !== 'under3' &&
      p.passType === 'none' &&
      (Boolean(p.memberId) || Boolean(p.guestId)),
  );

  const ticketGroups = new Map<string, TravelerProfileDTO[]>();
  for (const p of ticketEligibleProfiles) {
    const startDate = p.ticketStartDate ?? tripStart;
    const groupKey = `${p.ticketOption!}:${p.ticketDays!}:${startDate}:${p.discountGroup}`;
    const list = ticketGroups.get(groupKey) ?? [];
    list.push(p);
    ticketGroups.set(groupKey, list);
  }

  for (const [, group] of ticketGroups) {
    const first = group[0]!;
    const startDate = first.ticketStartDate ?? tripStart;
    const option = first.ticketOption!;
    const days = first.ticketDays!;
    const groupCode = first.discountGroup;

    const key = `ticket:${option}:${days}:${startDate}:${groupCode}`;
    if (!isEligibleKey(key)) continue;

    // Park rule (Round 4 L3): park only for 1-day base ticket mapping startingPark; null otherwise
    let park: Park | null = null;
    let parkCode: 'mk' | 'ep' | 'hs' | 'ak' | undefined = undefined;
    if (days === 1 && option === 'base') {
      park = mapCanonicalPark(dayTouringHours[startDate]?.startingPark);
      if (park && park in TICKET_PARK_BY_CANONICAL_PARK) {
        parkCode = TICKET_PARK_BY_CANONICAL_PARK[park as keyof typeof TICKET_PARK_BY_CANONICAL_PARK];
      }
    }

    const optionLabel = TICKET_OPTION_LABELS[option] ?? option;
    const description = `${days}-day ${optionLabel} tickets`;

    const linePriceRef: TicketPriceRef = {
      kind: 'ticket',
      discountGroup: groupCode,
      numDays: days,
      ageGroup: 'adult',
      optionCode: option,
      startDate,
      ...(parkCode ? { park: parkCode } : {}),
    };

    const allocations = group.map((p) => {
      const allocRef: TicketPriceRef = {
        kind: 'ticket',
        discountGroup: p.discountGroup,
        numDays: p.ticketDays!,
        ageGroup: p.ageBracket === 'child' ? 'child' : 'adult',
        optionCode: p.ticketOption!,
        startDate,
        ...(parkCode ? { park: parkCode } : {}),
      };

      return {
        ...(p.memberId ? { memberId: p.memberId } : {}),
        ...(p.guestId ? { guestId: p.guestId } : {}),
        priceRef: allocRef,
      };
    });

    suggestionsByKey.set(key, {
      suggestionKey: key,
      kind: 'tickets',
      draft: {
        category: 'tickets',
        description,
        plannedDate: startDate,
        park,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceRef: linePriceRef,
        applyTip: false,
        suggestionKey: key,
        partySize: null,
        allocations,
        needsPrice: false,
        needsPeople: false,
      },
    });
  }

  // Deterministic order: sorted by suggestionKey
  return Array.from(suggestionsByKey.values()).sort((a, b) =>
    a.suggestionKey.localeCompare(b.suggestionKey),
  );
}

