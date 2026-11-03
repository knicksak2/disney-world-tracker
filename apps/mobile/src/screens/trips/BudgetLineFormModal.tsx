import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  BUDGET_DEFAULT_DINING_TIP_BPS,
  BUDGET_DEFAULT_TAX_BPS,
  TICKET_PARK_BY_CANONICAL_PARK,
  addCalendarDays,
  bpsOf,
  computeMenuEstimatePerPerson,
  extractMenuPriceOffers,
  formatCalendarDateAsOf,
  formatMonthDay,
  listCalendarDates,
  normalizeTierName,
  splitCentsEvenly,
  type BudgetCategory,
  type BudgetLineDTO,
  type BudgetLineInput,
  type BudgetLineReplace,
  type BudgetSettingsDTO,
  type CreatablePriceSource,
  type ExperienceDTO,
  type LLPassType,
  type MenuDTO,
  type MenuPriceOffer,
  type Park,
  type PriceLabelKind,
  type PriceQuoteDTO,
  type PriceRef,
  type TicketPriceRef,
  type TravelerProfileDTO,
} from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { MenuItemPicker } from '../../components/MenuItemPicker';
import { PriceBadge } from '../../components/PriceBadge';
import {
  selectionSubtotalCents,
  selectionToBudgetPriceRef,
  type PickerSelection,
} from '../../components/menuItemPicker.pure';
import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { BUDGET_LINE_FORM_MODAL } from './BudgetLineFormModal.palette';
import {
  fetchPriceQuotes,
  useCreateBudgetLine,
  useEditBudgetLine,
} from './budgetApi';
import { ExperiencePicker } from './ExperiencePicker';
import { ResortPickerModal, type ResortItem } from './ResortPickerModal';

export interface TravelerOption {
  readonly id: string;
  readonly name: string;
  readonly isGuest?: boolean;
}

export interface BudgetDraftProp {
  readonly category?: BudgetCategory;
  readonly description?: string;
  readonly plannedDate?: string | null;
  readonly park?: Park | null;
  readonly experienceId?: string | null;
  readonly priceSource?: CreatablePriceSource;
  readonly priceRef?: PriceRef | null;
  readonly applyTip?: boolean;
  readonly allocations?: ReadonlyArray<{
    readonly memberId?: string;
    readonly guestId?: string;
    readonly amountCents?: number;
    readonly priceRef?: PriceRef;
  }>;
  readonly suggestionKey?: string | null;
}

export interface BudgetLineFormModalProps {
  readonly visible: boolean;
  readonly tripId: string;
  readonly tripStart?: string | null | undefined;
  readonly tripEnd?: string | null | undefined;
  readonly members?: readonly TravelerOption[] | undefined;
  readonly guests?: readonly TravelerOption[] | undefined;
  readonly travelers?: readonly TravelerProfileDTO[] | undefined;
  readonly settings?: BudgetSettingsDTO | null | undefined;
  readonly initialLine?: BudgetLineDTO | null | undefined;
  readonly initialDraft?: BudgetDraftProp | null | undefined;
  readonly restaurantMenus?: readonly MenuDTO[] | undefined;
  readonly onSaveSuccess?: ((line: BudgetLineDTO) => void) | undefined;
  readonly onCancel: () => void;
  readonly testID?: string | undefined;
}

export function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const str = `$${dollars}.${remainder < 10 ? '0' : ''}${remainder}`;
  return cents < 0 ? `-${str}` : str;
}

export function parseDollarInputToCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const dollars = parseInt(parts[0] || '0', 10);
  let centsPart = 0;
  if (parts.length === 2) {
    const rawCents = (parts[1] + '00').slice(0, 2);
    centsPart = parseInt(rawCents, 10);
  }
  const total = dollars * 100 + centsPart;
  if (isNaN(total) || total < 0) return null;
  return total;
}

const THEME_PARKS: readonly { label: string; park: Park; ticketPark: 'mk' | 'ep' | 'hs' | 'ak' }[] = [
  { label: 'Magic Kingdom', park: 'Magic Kingdom', ticketPark: 'mk' },
  { label: 'EPCOT', park: 'EPCOT', ticketPark: 'ep' },
  { label: 'Hollywood Studios', park: 'Hollywood Studios', ticketPark: 'hs' },
  { label: 'Animal Kingdom', park: 'Animal Kingdom', ticketPark: 'ak' },
];

const SINGLE_PASS_ATTRACTIONS_BY_PARK: Record<Park, readonly string[]> = {
  'Magic Kingdom': ['Seven Dwarfs Mine Train', 'TRON Lightcycle / Run'],
  EPCOT: ['Guardians of the Galaxy: Cosmic Rewind'],
  'Hollywood Studios': ['Star Wars: Rise of the Resistance'],
  'Animal Kingdom': ['Avatar Flight of Passage'],
  'Typhoon Lagoon': [],
  'Blizzard Beach': [],
  'Disney Springs': [],
};

export const TYPICAL_LL_BASELINES: Record<LLPassType, Record<Park, number>> = {
  multi: {
    'Magic Kingdom': 2900,
    'Hollywood Studios': 2700,
    'EPCOT': 2100,
    'Animal Kingdom': 1900,
    'Blizzard Beach': 1900,
    'Typhoon Lagoon': 1900,
    'Disney Springs': 0,
  },
  premier: {
    'Magic Kingdom': 32900,
    'Hollywood Studios': 26900,
    'EPCOT': 20900,
    'Animal Kingdom': 14900,
    'Blizzard Beach': 14900,
    'Typhoon Lagoon': 14900,
    'Disney Springs': 0,
  },
  single: {
    'Magic Kingdom': 2000,
    'Hollywood Studios': 2200,
    'EPCOT': 1700,
    'Animal Kingdom': 1600,
    'Blizzard Beach': 1500,
    'Typhoon Lagoon': 1500,
    'Disney Springs': 0,
  },
};

export const SINGLE_PASS_TYPICAL_ATTRACTIONS: Record<string, number> = {
  'TRON Lightcycle / Run': 2000,
  'Seven Dwarfs Mine Train': 1200,
  'Guardians of the Galaxy: Cosmic Rewind': 1700,
  'Star Wars: Rise of the Resistance': 2200,
  'Avatar Flight of Passage': 1600,
};

export function getTypicalLlBaselineCents(passType: LLPassType, park: Park, attractionName?: string): number {
  if (passType === 'single' && attractionName && SINGLE_PASS_TYPICAL_ATTRACTIONS[attractionName]) {
    return SINGLE_PASS_TYPICAL_ATTRACTIONS[attractionName]!;
  }
  return TYPICAL_LL_BASELINES[passType]?.[park] ?? 2500;
}

export interface LlEstimateTier {
  tier: string;
  label: string;
  tierName: string;
  cents: number;
  dollars: number;
}

export function getLlEstimateTiers(passType: LLPassType, park: Park, attractionName?: string): readonly LlEstimateTier[] {
  if (passType === 'multi') {
    switch (park) {
      case 'Magic Kingdom':
        return [
          { tier: 'typical', label: 'Typical ($29)', tierName: 'Typical', cents: 2900, dollars: 29 },
          { tier: 'moderate', label: 'Moderate ($35)', tierName: 'Moderate', cents: 3500, dollars: 35 },
          { tier: 'peak', label: 'Peak / Holiday ($39)', tierName: 'Peak', cents: 3900, dollars: 39 },
        ];
      case 'Hollywood Studios':
        return [
          { tier: 'typical', label: 'Typical ($27)', tierName: 'Typical', cents: 2700, dollars: 27 },
          { tier: 'moderate', label: 'Moderate ($32)', tierName: 'Moderate', cents: 3200, dollars: 32 },
          { tier: 'peak', label: 'Peak / Holiday ($37)', tierName: 'Peak', cents: 3700, dollars: 37 },
        ];
      case 'EPCOT':
        return [
          { tier: 'typical', label: 'Typical ($21)', tierName: 'Typical', cents: 2100, dollars: 21 },
          { tier: 'moderate', label: 'Moderate ($26)', tierName: 'Moderate', cents: 2600, dollars: 26 },
          { tier: 'peak', label: 'Peak / Holiday ($31)', tierName: 'Peak', cents: 3100, dollars: 31 },
        ];
      case 'Animal Kingdom':
        return [
          { tier: 'typical', label: 'Typical ($19)', tierName: 'Typical', cents: 1900, dollars: 19 },
          { tier: 'moderate', label: 'Moderate ($23)', tierName: 'Moderate', cents: 2300, dollars: 23 },
          { tier: 'peak', label: 'Peak / Holiday ($27)', tierName: 'Peak', cents: 2700, dollars: 27 },
        ];
      default:
        return [
          { tier: 'typical', label: 'Typical ($25)', tierName: 'Typical', cents: 2500, dollars: 25 },
          { tier: 'moderate', label: 'Moderate ($30)', tierName: 'Moderate', cents: 3000, dollars: 30 },
          { tier: 'peak', label: 'Peak ($35)', tierName: 'Peak', cents: 3500, dollars: 35 },
        ];
    }
  }
  if (passType === 'premier') {
    switch (park) {
      case 'Magic Kingdom':
        return [
          { tier: 'standard', label: 'Standard ($329)', tierName: 'Standard', cents: 32900, dollars: 329 },
          { tier: 'high_demand', label: 'High Demand ($399)', tierName: 'High Demand', cents: 39900, dollars: 399 },
          { tier: 'peak_holiday', label: 'Peak Holiday ($449)', tierName: 'Peak Holiday', cents: 44900, dollars: 449 },
        ];
      case 'Hollywood Studios':
        return [
          { tier: 'standard', label: 'Standard ($269)', tierName: 'Standard', cents: 26900, dollars: 269 },
          { tier: 'high_demand', label: 'High Demand ($329)', tierName: 'High Demand', cents: 32900, dollars: 329 },
          { tier: 'peak_holiday', label: 'Peak Holiday ($379)', tierName: 'Peak Holiday', cents: 37900, dollars: 379 },
        ];
      case 'EPCOT':
        return [
          { tier: 'standard', label: 'Standard ($209)', tierName: 'Standard', cents: 20900, dollars: 209 },
          { tier: 'high_demand', label: 'High Demand ($269)', tierName: 'High Demand', cents: 26900, dollars: 269 },
          { tier: 'peak_holiday', label: 'Peak Holiday ($309)', tierName: 'Peak Holiday', cents: 30900, dollars: 309 },
        ];
      case 'Animal Kingdom':
        return [
          { tier: 'standard', label: 'Standard ($149)', tierName: 'Standard', cents: 14900, dollars: 149 },
          { tier: 'high_demand', label: 'High Demand ($189)', tierName: 'High Demand', cents: 18900, dollars: 189 },
          { tier: 'peak_holiday', label: 'Peak Holiday ($219)', tierName: 'Peak Holiday', cents: 21900, dollars: 219 },
        ];
      default:
        return [
          { tier: 'standard', label: 'Standard ($249)', tierName: 'Standard', cents: 24900, dollars: 249 },
          { tier: 'peak', label: 'Peak ($349)', tierName: 'Peak', cents: 34900, dollars: 349 },
        ];
    }
  }
  const base = getTypicalLlBaselineCents('single', park, attractionName);
  const baseDollars = Math.round(base / 100);
  const peakDollars = baseDollars + 3;
  return [
    { tier: 'typical', label: `Typical ($${baseDollars})`, tierName: 'Typical', cents: base, dollars: baseDollars },
    { tier: 'peak', label: `Peak ($${peakDollars})`, tierName: 'Peak', cents: (peakDollars * 100), dollars: peakDollars },
  ];
}

export const DISPLAY_CATEGORIES: BudgetCategory[] = [
  'tickets',
  'lightning_lane',
  'dining',
  'lodging',
  'transportation',
  'shopping',
];

const CATEGORY_META: Record<
  BudgetCategory,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  tickets: { label: 'Tickets', icon: 'ticket-outline' },
  lightning_lane: { label: 'Lightning Lane', icon: 'flash-outline' },
  dining: { label: 'Dining', icon: 'restaurant-outline' },
  lodging: { label: 'Hotel / Stay', icon: 'bed-outline' },
  transportation: { label: 'Travel / Rides', icon: 'car-outline' },
  shopping: { label: 'Souvenirs', icon: 'bag-handle-outline' },
  other: { label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
};

const TICKET_OPTION_LABELS: Record<'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports', string> = {
  base: '1-Park Base',
  park_hopper: 'Park Hopper',
  park_hopper_plus: 'Park Hopper Plus',
  water_parks_sports: 'Water Parks & Sports',
};

const TICKET_OPTION_ICONS: Record<'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports', string> = {
  base: '✨',
  park_hopper: '🏰',
  park_hopper_plus: '🌊',
  water_parks_sports: '⛳',
};

function estimateTicketDailyRate(days: number, isChild = false): string {
  const baseAdult = 165 - Math.min(days - 1, 9) * 7.5;
  const rate = isChild ? baseAdult * 0.96315789 : baseAdult;
  return rate.toFixed(2);
}

const DISCOUNT_GROUP_LABELS: Record<'std-gst' | 'fl-resident', string> = {
  'std-gst': 'Standard Guest',
  'fl-resident': 'Florida Resident (Discount)',
};

const LL_PASS_TYPE_LABELS: Record<LLPassType, string> = {
  multi: 'Multi Pass',
  single: 'Single Pass',
  premier: 'Premier Pass',
};

function normalizeToYmd(d?: string | null, tripRefDate?: string | null): string | null {
  if (!d) return null;
  const trimmed = String(d).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const yearMatch = tripRefDate ? /^(\d{4})/.exec(tripRefDate) : null;
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const parsed = new Date(`${trimmed} ${year}`);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${month}-${day}`;
  }
  return null;
}

function computeDefaultNights(tripStart?: string | null, tripEnd?: string | null): number {
  if (!tripStart || !tripEnd) return 4;
  const startMs = Date.parse(`${tripStart.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(`${tripEnd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 4;
  return Math.max(1, Math.min(30, Math.round((endMs - startMs) / 86_400_000)));
}

export function BudgetLineFormModal({
  visible,
  tripId,
  tripStart,
  tripEnd,
  members = [{ id: 'user-self', name: 'You' }],
  guests = [],
  travelers = [],
  settings = null,
  initialLine,
  initialDraft,
  restaurantMenus = [],
  onSaveSuccess,
  onCancel,
  testID = 'budget-line-form-modal',
}: BudgetLineFormModalProps): React.JSX.Element {
  const styles = useStyles();
  const palette = usePalette(BUDGET_LINE_FORM_MODAL);

  const createMutation = useCreateBudgetLine(tripId);
  const editMutation = useEditBudgetLine(tripId);

  const isEdit = Boolean(initialLine?.id);

  // Form states
  const [category, setCategory] = useState<BudgetCategory>(() => {
    return initialLine?.category ?? initialDraft?.category ?? 'dining';
  });
  const [description, setDescription] = useState<string>(() => {
    return initialLine?.description ?? initialDraft?.description ?? '';
  });
  const [plannedDate, setPlannedDate] = useState<string | null>(() => {
    const raw = initialLine?.plannedDate ?? initialDraft?.plannedDate ?? tripStart ?? null;
    return normalizeToYmd(raw, tripStart);
  });
  const [park, setPark] = useState<Park | null>(() => {
    return (initialLine?.park as Park | null) ?? (initialDraft?.park as Park | null) ?? null;
  });
  const [applyTip, setApplyTip] = useState<boolean>(() => {
    return initialLine?.applyTip ?? initialDraft?.applyTip ?? false;
  });

  // Dining mode: Disney vs Off-Property
  const [diningMode, setDiningMode] = useState<'disney' | 'off_property'>('disney');

  // Lodging mode & Nightly Calculator
  const [lodgingMode, setLodgingMode] = useState<'disney' | 'off_site'>('disney');
  const [nightlyRateText, setNightlyRateText] = useState<string>('');
  const [lodgingNights, setLodgingNights] = useState<number>(() =>
    computeDefaultNights(tripStart, tripEnd)
  );

  // Venue selection states
  const [experienceId, setExperienceId] = useState<string | null>(() => {
    return initialLine?.experienceId ?? initialDraft?.experienceId ?? null;
  });
  const [experienceName, setExperienceName] = useState<string | null>(null);
  const [showExpPicker, setShowExpPicker] = useState<boolean>(false);

  const [resortId, setResortId] = useState<string | null>(null);
  const [resortName, setResortName] = useState<string | null>(null);
  const [showResortPicker, setShowResortPicker] = useState<boolean>(false);

  // Fetch experience details and menus if experienceId is set
  const expQuery = useQuery<{ experience?: ExperienceDTO; menus?: readonly MenuDTO[] }>({
    queryKey: ['catalog', 'experience', experienceId],
    queryFn: () =>
      apiRequest<{ experience?: ExperienceDTO; menus?: readonly MenuDTO[] }>(
        'GET',
        `/catalog/${experienceId}`
      ),
    enabled: Boolean(experienceId && category === 'dining' && diningMode === 'disney'),
    staleTime: 5 * 60 * 1000,
  });

  const availableMenus = useMemo(() => {
    if (expQuery.data?.menus && expQuery.data.menus.length > 0) {
      return expQuery.data.menus;
    }
    return restaurantMenus;
  }, [expQuery.data?.menus, restaurantMenus]);

  const menuEstimate = useMemo(
    () => computeMenuEstimatePerPerson(availableMenus),
    [availableMenus]
  );

  const menuOffers = useMemo(
    () => extractMenuPriceOffers(availableMenus),
    [availableMenus]
  );

  const tripDays = useMemo(() => {
    if (!tripStart) return [];
    const end = tripEnd && tripEnd >= tripStart ? tripEnd : addCalendarDays(tripStart, 6);
    const dates = listCalendarDates(tripStart, end).slice(0, 14);
    return dates.map((date, idx) => ({
      dayNumber: idx + 1,
      date,
      shortLabel: `Day ${idx + 1} · ${formatMonthDay(date)}`,
    }));
  }, [tripStart, tripEnd]);

  // Inline buffet/prix-fixe tier quantities keyed by offer.label
  const [inlineBuffetQuantities, setInlineBuffetQuantities] = useState<Record<string, number>>({});
  const lastPrefilledOffersKeyRef = useRef<string>('');

  // Price & Provenance states
  const [priceSource, setPriceSource] = useState<CreatablePriceSource>(() => {
    return (
      (initialLine?.priceSource as CreatablePriceSource) ??
      initialDraft?.priceSource ??
      'user_entered'
    );
  });
  const [priceLabelKind, setPriceLabelKind] = useState<PriceLabelKind>(() => {
    return initialLine?.priceLabelKind ?? 'your_price';
  });
  const [priceRef, setPriceRef] = useState<PriceRef | null>(() => {
    return initialLine?.allocations?.[0]?.priceRef ?? initialDraft?.priceRef ?? null;
  });
  const [perTravelerPriceRefs, setPerTravelerPriceRefs] = useState<Record<string, PriceRef>>({});
  const [manualPriceText, setManualPriceText] = useState<string>(() => {
    if (initialLine?.subtotalCents) {
      return (initialLine.subtotalCents / 100).toFixed(2);
    }
    return '';
  });
  const [priceQuote, setPriceQuote] = useState<PriceQuoteDTO | null>(null);
  const [multiQuoteBreakdown, setMultiQuoteBreakdown] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isFetchingTicketQuote, setIsFetchingTicketQuote] = useState<boolean>(false);
  const [isFetchingLlQuote, setIsFetchingLlQuote] = useState<boolean>(false);
  const [selectedLlTierCents, setSelectedLlTierCents] = useState<number | null>(null);
  const [llQuoteStatusMessage, setLlQuoteStatusMessage] = useState<string | null>(null);
  const [ticketQuoteStatusMessage, setTicketQuoteStatusMessage] = useState<string | null>(null);

  // Category: Tickets quote inputs (supports both single Age Group chips and multi-ticket Adult + Child steppers)
  const [ticketAgeGroup, setTicketAgeGroup] = useState<'adult' | 'child'>('adult');
  const [ticketAdultCount, setTicketAdultCount] = useState<number>(1);
  const [ticketChildCount, setTicketChildCount] = useState<number>(0);
  const [ticketOption, setTicketOption] = useState<
    'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports'
  >('base');
  const [ticketNumDays, setTicketNumDays] = useState<number>(1);
  const [ticketDiscountGroup, setTicketDiscountGroup] = useState<'std-gst' | 'fl-resident'>(
    'std-gst'
  );
  const [ticketPark, setTicketPark] = useState<'mk' | 'ep' | 'hs' | 'ak' | undefined>(() => {
    if (park && park in TICKET_PARK_BY_CANONICAL_PARK) {
      return TICKET_PARK_BY_CANONICAL_PARK[park as keyof typeof TICKET_PARK_BY_CANONICAL_PARK];
    }
    return undefined;
  });

  // Category: Lightning Lane inputs
  const [llPassType, setLlPassType] = useState<LLPassType>('multi');
  const [llPark, setLlPark] = useState<Park>('Magic Kingdom');
  const [llAttraction, setLlAttraction] = useState<string>('');
  const [llQuantity, setLlQuantity] = useState<number>(1);

  // Category: Dining Menu Picker Modal
  const [menuPickerVisible, setMenuPickerVisible] = useState<boolean>(false);

  // Category: Quick Dining Estimate states
  const [quickDiningMode, setQuickDiningMode] = useState<
    'none' | 'quick_service' | 'table_service' | 'buffet'
  >('none');
  const [buffetAdults, setBuffetAdults] = useState<number>(1);
  const [buffetKids, setBuffetKids] = useState<number>(0);

  // Local party guests added in-modal
  const [localGuests, setLocalGuests] = useState<
    Array<{ id: string; name: string; isGuest: boolean; ageBracket?: 'adult' | 'child' }>
  >([]);
  const [showAddGuestInput, setShowAddGuestInput] = useState<boolean>(false);
  const [newGuestName, setNewGuestName] = useState<string>('');

  // Allocations state
  const allTravelers = useMemo(() => {
    const list: Array<{ id: string; name: string; isGuest: boolean; ageBracket?: 'adult' | 'child' }> = [];
    for (const m of members) {
      const raw = m as unknown as Record<string, unknown>;
      const id = String(m.id ?? raw.userId ?? raw.user_id ?? `member-${list.length}`);
      const name = String(m.name ?? raw.displayName ?? raw.display_name ?? raw.label ?? 'Member');
      list.push({ id, name, isGuest: false, ageBracket: 'adult' });
    }
    for (const g of guests) {
      const raw = g as unknown as Record<string, unknown>;
      const id = String(g.id ?? raw.guestId ?? raw.guest_id ?? `guest-${list.length}`);
      const name = String(g.name ?? raw.displayName ?? raw.display_name ?? raw.label ?? 'Guest');
      const isKid = name.toLowerCase().includes('kid') || name.toLowerCase().includes('child');
      list.push({ id, name, isGuest: true, ageBracket: isKid ? 'child' : 'adult' });
    }
    for (const lg of localGuests) {
      if (!list.some((existing) => existing.id === lg.id)) {
        list.push(lg);
      }
    }
    return list;
  }, [members, guests, localGuests]);

  const [selectedTravelerIds, setSelectedTravelerIds] = useState<string[]>(() => {
    if (initialLine?.allocations && initialLine.allocations.length > 0) {
      return initialLine.allocations
        .map((a) => a.memberId ?? a.guestId ?? '')
        .filter(Boolean);
    }
    if (initialDraft?.allocations && initialDraft.allocations.length > 0) {
      return initialDraft.allocations
        .map((a) => a.memberId ?? a.guestId ?? '')
        .filter(Boolean);
    }
    return allTravelers.map((t) => t.id);
  });

  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (initialLine?.allocations) {
      for (const a of initialLine.allocations) {
        const key = a.memberId ?? a.guestId ?? '';
        if (key) map[key] = a.effectiveCents ?? a.storedCents;
      }
    } else if (initialDraft?.allocations) {
      for (const a of initialDraft.allocations) {
        const key = a.memberId ?? a.guestId ?? '';
        if (key) map[key] = a.amountCents ?? 0;
      }
    } else if (allTravelers.length > 0) {
      map[allTravelers[0]!.id] = 0;
    }
    return map;
  });



  // Auto-prefill Prix-Fixe / Buffet tier quantities from party size when offers are available
  useEffect(() => {
    if (
      category === 'dining' &&
      diningMode === 'disney' &&
      menuOffers.length > 0 &&
      !initialLine?.subtotalCents
    ) {
      const key = `${experienceId ?? ''}:${menuOffers.map((o) => `${o.label}:${o.priceCents}`).join(',')}`;
      if (key !== lastPrefilledOffersKeyRef.current) {
        lastPrefilledOffersKeyRef.current = key;

        const partyKids = allTravelers.filter(
          (t) =>
            t.ageBracket === 'child' ||
            t.name.toLowerCase().includes('kid') ||
            t.name.toLowerCase().includes('child')
        ).length;
        const partyAdults = Math.max(1, allTravelers.length - partyKids);

        const nextQuantities: Record<string, number> = {};
        const adultOffer = menuOffers.find(
          (o) =>
            o.audience === 'adult' ||
            o.label.toLowerCase().includes('adult') ||
            !o.label.toLowerCase().includes('child')
        );
        const childOffer = menuOffers.find(
          (o) =>
            o.audience === 'child' ||
            o.label.toLowerCase().includes('child') ||
            o.label.toLowerCase().includes('kid')
        );

        if (adultOffer) {
          nextQuantities[adultOffer.label] = partyAdults;
        }
        if (childOffer && partyKids > 0) {
          nextQuantities[childOffer.label] = partyKids;
        } else if (!adultOffer && menuOffers.length === 1) {
          nextQuantities[menuOffers[0]!.label] = allTravelers.length;
        }

        setInlineBuffetQuantities(nextQuantities);

        const expandedSlots: Array<{ name: string; priceCents: number }> = [];
        for (const o of menuOffers) {
          const q = nextQuantities[o.label] ?? 0;
          for (let i = 0; i < q; i++) {
            expandedSlots.push({
              name: normalizeTierName(o.label),
              priceCents: o.priceCents,
            });
          }
        }

        const subtotalCents = expandedSlots.reduce((sum, s) => sum + s.priceCents, 0);
        if (subtotalCents > 0) {
          setManualPriceText((subtotalCents / 100).toFixed(2));
          setPriceSource('disney_menu');
          setPriceLabelKind('current');
          if (expandedSlots.length <= allTravelers.length) {
            const firstSlot = expandedSlots[0]!;
            setPriceRef({
              kind: 'menu',
              tier: { name: firstSlot.name, priceCents: firstSlot.priceCents },
            });
            const nextAmounts: Record<string, number> = {};
            const nextRefs: Record<string, PriceRef> = {};
            expandedSlots.forEach((slot, idx) => {
              const t = allTravelers[idx]!;
              nextAmounts[t.id] = slot.priceCents;
              nextRefs[t.id] = {
                kind: 'menu',
                tier: { name: slot.name, priceCents: slot.priceCents },
              };
            });
            setPerTravelerPriceRefs(nextRefs);
            setAllocationAmounts(nextAmounts);
          } else {
            distributeAcrossSelectedTravelers(subtotalCents);
          }
        }
      }
    }
  }, [category, diningMode, menuOffers, experienceId, allTravelers, initialLine?.subtotalCents]);

  // Helper to distribute a total across active selected travelers
  const distributeAcrossSelectedTravelers = (
    totalCents: number,
    targetIds: readonly string[] = selectedTravelerIds
  ) => {
    const activeIds =
      targetIds.length > 0
        ? targetIds
        : allTravelers.length > 0
          ? [allTravelers[0]!.id]
          : [];
    if (activeIds.length === 0) return;
    const shares = splitCentsEvenly(Math.max(0, totalCents), activeIds.length);
    const nextMap: Record<string, number> = {};
    allTravelers.forEach((t) => {
      nextMap[t.id] = 0;
    });
    activeIds.forEach((id, idx) => {
      nextMap[id] = shares[idx] ?? 0;
    });
    setAllocationAmounts(nextMap);
  };

  // Pre-fill Adult + Child counts from Traveler Profiles
  const handlePrefillTicketsFromProfiles = () => {
    const adults = travelers.filter(
      (p) => p.ageBracket === 'adult' && p.passType === 'none'
    ).length;
    const children = travelers.filter(
      (p) => p.ageBracket === 'child' && p.passType === 'none'
    ).length;
    if (adults > 0 || children > 0) {
      setTicketAdultCount(adults);
      setTicketChildCount(children);
      setTicketAgeGroup(adults > 0 ? 'adult' : 'child');
    } else {
      setTicketAdultCount(Math.max(1, allTravelers.length));
      setTicketChildCount(0);
      setTicketAgeGroup('adult');
    }
  };

  // Fetch ticket quote action (supports single or multi-ticket Adult + Child batch quote)
  const handleFetchTicketQuote = async () => {
    const startDate = plannedDate || tripStart || '2026-11-01';
    const effectivePark =
      ticketNumDays === 1 && ticketOption === 'base' ? ticketPark : undefined;

    const adultQty = Math.max(0, ticketAdultCount);
    const childQty = Math.max(0, ticketChildCount);
    const bothSelected = adultQty > 0 && childQty > 0;

    setIsFetchingTicketQuote(true);
    setTicketQuoteStatusMessage(null);
    try {
      if (bothSelected) {
        const response = await fetchPriceQuotes(tripId, {
          requests: [
            {
              kind: 'ticket',
              discountGroup: ticketDiscountGroup,
              numDays: ticketNumDays,
              ageGroup: 'adult',
              optionCode: ticketOption,
              startDate,
              park: effectivePark,
            },
            {
              kind: 'ticket',
              discountGroup: ticketDiscountGroup,
              numDays: ticketNumDays,
              ageGroup: 'child',
              optionCode: ticketOption,
              startDate,
              park: effectivePark,
            },
          ],
        });

        if (response && response.length >= 2) {
          const adultQuote = response[0]!;
          const childQuote = response[1]!;
          setPriceQuote(adultQuote);

          if (
            adultQuote.priceCents !== null &&
            adultQuote.priceCents > 0 &&
            childQuote.priceCents !== null &&
            childQuote.priceCents > 0
          ) {
            const totalCents =
              adultQty * adultQuote.priceCents + childQty * childQuote.priceCents;
            const totalCount = adultQty + childQty;

            const adultRef: TicketPriceRef = {
              kind: 'ticket',
              discountGroup: ticketDiscountGroup,
              numDays: ticketNumDays,
              ageGroup: 'adult',
              optionCode: ticketOption,
              startDate,
              park: effectivePark,
            };
            const childRef: TicketPriceRef = {
              kind: 'ticket',
              discountGroup: ticketDiscountGroup,
              numDays: ticketNumDays,
              ageGroup: 'child',
              optionCode: ticketOption,
              startDate,
              park: effectivePark,
            };

            setManualPriceText((totalCents / 100).toFixed(2));
            setPriceLabelKind(adultQuote.priceLabelKind);
            setPriceRef(adultRef);
            setMultiQuoteBreakdown(
              `${adultQty} Adult${adultQty > 1 ? 's' : ''} × ${formatDollars(adultQuote.priceCents)} + ${childQty} Child${childQty > 1 ? 'ren' : ''} × ${formatDollars(childQuote.priceCents)} = ${formatDollars(totalCents)}`
            );

            if (allTravelers.length >= totalCount) {
              setPriceSource('disney_ticket_calendar');
              const nextAmounts: Record<string, number> = {};
              const nextRefs: Record<string, PriceRef> = {};
              for (let i = 0; i < totalCount; i++) {
                const t = allTravelers[i]!;
                const isAdultSlot = i < adultQty;
                nextAmounts[t.id] = isAdultSlot
                  ? adultQuote.priceCents
                  : childQuote.priceCents;
                nextRefs[t.id] = isAdultSlot ? adultRef : childRef;
              }
              setPerTravelerPriceRefs(nextRefs);
              setAllocationAmounts(nextAmounts);
            } else {
              // More tickets than trip traveler rows: preserve combined total as user_entered
              setPriceSource('user_entered');
              setPerTravelerPriceRefs({});
              distributeAcrossSelectedTravelers(totalCents);
            }
          } else {
            setTicketQuoteStatusMessage('Ticket price unavailable for this date and option. Please enter your price below.');
          }
        }
        return;
      }

      // Single age group quote (1 request)
      const requestedAge: 'adult' | 'child' =
        childQty > 0 && adultQty === 0 ? 'child' : ticketAgeGroup;
      const requestedQty = Math.max(
        1,
        requestedAge === 'child' ? childQty : adultQty
      );

      const response = await fetchPriceQuotes(tripId, {
        requests: [
          {
            kind: 'ticket',
            discountGroup: ticketDiscountGroup,
            numDays: ticketNumDays,
            ageGroup: requestedAge,
            optionCode: ticketOption,
            startDate,
            park: effectivePark,
          },
        ],
      });
      if (response && response.length > 0) {
        const q = response[0]!;
        setPriceQuote(q);

        if (q.priceCents !== null && q.priceCents > 0) {
          const singleRef: TicketPriceRef = {
            kind: 'ticket',
            discountGroup: ticketDiscountGroup,
            numDays: ticketNumDays,
            ageGroup: requestedAge,
            optionCode: ticketOption,
            startDate,
            park: effectivePark,
          };
          const totalCents = q.priceCents * requestedQty;
          setPriceLabelKind(q.priceLabelKind);
          setManualPriceText((totalCents / 100).toFixed(2));
          setPriceRef(singleRef);

          if (requestedQty > 1) {
            setMultiQuoteBreakdown(
              `${requestedQty} × ${formatDollars(q.priceCents)} = ${formatDollars(totalCents)}`
            );
          } else {
            setMultiQuoteBreakdown(null);
          }

          if (requestedQty === 1) {
            setPriceSource('disney_ticket_calendar');
            setPerTravelerPriceRefs({});
            setAllocationAmounts((prev) => {
              const hasAlloc = Object.values(prev).some((c) => c > 0);
              if (!hasAlloc && allTravelers.length > 0) {
                return { [allTravelers[0]!.id]: q.priceCents! };
              }
              return prev;
            });
          } else if (allTravelers.length >= requestedQty) {
            setPriceSource('disney_ticket_calendar');
            const nextAmounts: Record<string, number> = {};
            const nextRefs: Record<string, PriceRef> = {};
            for (let i = 0; i < requestedQty; i++) {
              const t = allTravelers[i]!;
              nextAmounts[t.id] = q.priceCents;
              nextRefs[t.id] = singleRef;
            }
            setPerTravelerPriceRefs(nextRefs);
            setAllocationAmounts(nextAmounts);
          } else {
            setPriceSource('user_entered');
            setPerTravelerPriceRefs({});
            distributeAcrossSelectedTravelers(totalCents);
          }
        } else {
          setTicketQuoteStatusMessage('Ticket price unavailable for this date and option. Please enter your price below.');
        }
      } else {
        setTicketQuoteStatusMessage('No ticket price quote returned. Please enter your price below.');
      }
    } catch (err: unknown) {
      console.error('[BudgetLineFormModal] Ticket quote failed:', err);
      const msg = err instanceof Error ? err.message : 'Could not fetch ticket quote';
      setTicketQuoteStatusMessage(`Quote unavailable: ${msg}. Please enter your price below.`);
      Alert.alert('Quote Unavailable', msg);
    } finally {
      setIsFetchingTicketQuote(false);
    }
  };

  // Fetch Lightning Lane quote action
  const handleFetchLlQuote = async () => {
    const date = plannedDate || tripStart || '2026-11-01';
    setIsFetchingLlQuote(true);
    setLlQuoteStatusMessage(null);
    try {
      const response = await fetchPriceQuotes(tripId, {
        requests: [
          {
            kind: 'll',
            passType: llPassType,
            park: llPark,
            date,
          },
        ],
      });
      if (response && response.length > 0) {
        const q = response[0]!;
        setPriceQuote(q);

        if (q.priceCents !== null && q.priceCents > 0) {
          const qty = Math.max(1, llQuantity);
          const totalCents = q.priceCents * qty;
          const llRef: PriceRef = {
            kind: 'll',
            passType: llPassType,
            park: llPark,
            date,
          };
          setSelectedLlTierCents(q.priceCents);
          setPriceLabelKind(q.priceLabelKind);
          setManualPriceText((totalCents / 100).toFixed(2));
          setPriceRef(llRef);

          if (qty === 1) {
            setPriceSource('themeparks_ll');
            setPerTravelerPriceRefs({});
            setAllocationAmounts((prev) => {
              const hasAlloc = Object.values(prev).some((c) => c > 0);
              if (!hasAlloc && allTravelers.length > 0) {
                return { [allTravelers[0]!.id]: q.priceCents! };
              }
              return prev;
            });
          } else if (allTravelers.length >= qty) {
            setPriceSource('themeparks_ll');
            const nextAmounts: Record<string, number> = {};
            const nextRefs: Record<string, PriceRef> = {};
            for (let i = 0; i < qty; i++) {
              const t = allTravelers[i]!;
              nextAmounts[t.id] = q.priceCents;
              nextRefs[t.id] = llRef;
            }
            setPerTravelerPriceRefs(nextRefs);
            setAllocationAmounts(nextAmounts);
          } else {
            setPriceSource('user_entered');
            setPerTravelerPriceRefs({});
            distributeAcrossSelectedTravelers(totalCents);
          }
        } else {
          // Future date with no published Disney data yet -> Fall back to typical baseline estimate!
          const baselinePerPassCents = getTypicalLlBaselineCents(llPassType, llPark, llAttraction);
          const qty = Math.max(1, llQuantity);
          const totalCents = baselinePerPassCents * qty;
          setSelectedLlTierCents(baselinePerPassCents);
          setPriceLabelKind('estimate');
          setManualPriceText((totalCents / 100).toFixed(2));
          setPriceSource('user_entered');
          setPriceRef(null);
          setPerTravelerPriceRefs({});
          distributeAcrossSelectedTravelers(totalCents);
          setLlQuoteStatusMessage(
            `Estimated baseline applied: $${(baselinePerPassCents / 100).toFixed(2)}/pass ($${(totalCents / 100).toFixed(2)} total). Disney publishes Lightning Lane prices only a few days in advance; you can tap a quick tier or adjust below.`
          );
        }
      } else {
        setLlQuoteStatusMessage('No quote returned from server. Please enter your price manually below.');
      }
    } catch (err: unknown) {
      console.error('[BudgetLineFormModal] LL quote fetch failed:', err);
      const msg = err instanceof Error ? err.message : 'Could not fetch quote';
      setLlQuoteStatusMessage(`Quote unavailable: ${msg}. Please enter your price manually below.`);
      Alert.alert('Quote Unavailable', msg);
    } finally {
      setIsFetchingLlQuote(false);
    }
  };

  // Select Quick Estimate Tier handler
  const handleSelectLlEstimateTier = (perPassCents: number, tierLabel: string) => {
    setSelectedLlTierCents(perPassCents);
    const qty = Math.max(1, llQuantity);
    const totalCents = perPassCents * qty;
    setManualPriceText((totalCents / 100).toFixed(2));
    setPriceLabelKind('estimate');
    setPriceSource('user_entered');
    setPriceRef(null);
    setPerTravelerPriceRefs({});
    distributeAcrossSelectedTravelers(totalCents);
    setLlQuoteStatusMessage(
      `Estimated ${tierLabel} tier applied: $${(perPassCents / 100).toFixed(2)}/pass ($${(totalCents / 100).toFixed(2)} total).`
    );
  };

  // Update LL Quantity and sync estimated total
  const handleUpdateLlQuantity = (newQty: number) => {
    const qty = Math.max(1, Math.min(20, newQty));
    setLlQuantity(qty);
    if (selectedLlTierCents !== null && selectedLlTierCents > 0) {
      const totalCents = selectedLlTierCents * qty;
      setManualPriceText((totalCents / 100).toFixed(2));
      distributeAcrossSelectedTravelers(totalCents);
    }
  };

  // Helper to generate a UUIDv4-like string for local guests
  const createGuestId = () => {
    return (
      '00000000-0000-4000-8000-' +
      Math.floor(Math.random() * 0xffffffffffff)
        .toString(16)
        .padStart(12, '0')
    );
  };

  // Add guest to party in-modal
  const handleAddGuest = async (name: string, ageBracket: 'adult' | 'child' = 'adult') => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fallbackId = createGuestId();
    let guestId = fallbackId;
    try {
      const res = await apiRequest<{ id: string; name: string }>('POST', `/trips/${tripId}/guests`, {
        name: trimmed,
      });
      if (res?.id) {
        guestId = res.id;
      }
    } catch {
      // Offline fallback to generated UUID
    }
    const newGuest = {
      id: guestId,
      name: trimmed,
      isGuest: true,
      ageBracket,
    };
    setLocalGuests((prev) => [...prev, newGuest]);
    setSelectedTravelerIds((prev) => [...prev, guestId]);
    setAllocationAmounts((prev) => ({ ...prev, [guestId]: 0 }));
    setNewGuestName('');
    setShowAddGuestInput(false);

    // If total price exists, re-distribute across all selected travelers
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (totalCents > 0) {
      const updatedIds = [...selectedTravelerIds, guestId];
      distributeAcrossSelectedTravelers(totalCents, updatedIds);
    }
  };

  // Sync party members to match ticket quantities (e.g. 2 Adults, 2 Kids)
  const handleSyncPartyToTickets = () => {
    const neededAdults = Math.max(0, ticketAdultCount);
    const neededKids = Math.max(0, ticketChildCount);
    const totalNeeded = neededAdults + neededKids;
    if (totalNeeded <= allTravelers.length) return;

    let currentAdults = 0;
    let currentKids = 0;
    allTravelers.forEach((t) => {
      const isChild =
        t.ageBracket === 'child' ||
        t.name.toLowerCase().includes('kid') ||
        t.name.toLowerCase().includes('child');
      if (isChild) currentKids++;
      else currentAdults++;
    });

    const addAdultCount = Math.max(0, neededAdults - currentAdults);
    const addChildCount = Math.max(0, neededKids - currentKids);

    const newGuestsToAdd: Array<{
      id: string;
      name: string;
      isGuest: boolean;
      ageBracket: 'adult' | 'child';
    }> = [];
    for (let i = 1; i <= addAdultCount; i++) {
      const name =
        addAdultCount === 1 && currentAdults === 1
          ? 'Wife / Partner'
          : `Adult Guest ${currentAdults + i}`;
      const guestId = createGuestId();
      newGuestsToAdd.push({ id: guestId, name, isGuest: true, ageBracket: 'adult' });
      void apiRequest('POST', `/trips/${tripId}/guests`, { name }).catch(() => {});
    }
    for (let i = 1; i <= addChildCount; i++) {
      const name = `Kid (Age ${i === 1 ? 7 : 4})`;
      const guestId = createGuestId();
      newGuestsToAdd.push({ id: guestId, name, isGuest: true, ageBracket: 'child' });
      void apiRequest('POST', `/trips/${tripId}/guests`, { name }).catch(() => {});
    }

    if (newGuestsToAdd.length > 0) {
      setLocalGuests((prev) => [...prev, ...newGuestsToAdd]);
      const nextIds = [...selectedTravelerIds, ...newGuestsToAdd.map((g) => g.id)];
      setSelectedTravelerIds(nextIds);
      const totalCents = parseDollarInputToCents(manualPriceText) || 0;
      if (totalCents > 0) {
        distributeAcrossSelectedTravelers(totalCents, nextIds);
      }
    }
  };

  // Select LL Park and sync estimate tier if active
  const handleSelectLlPark = (newPark: Park) => {
    setLlPark(newPark);
    setPark(newPark);
    const newBase = getTypicalLlBaselineCents(llPassType, newPark, llAttraction);
    setSelectedLlTierCents(newBase);
    const qty = Math.max(1, llQuantity);
    const totalCents = newBase * qty;
    setManualPriceText((totalCents / 100).toFixed(2));
    distributeAcrossSelectedTravelers(totalCents);
    setLlQuoteStatusMessage(
      `Estimated baseline applied: $${(newBase / 100).toFixed(2)}/pass ($${(totalCents / 100).toFixed(2)} total).`
    );
  };

  // Select LL Pass Type and sync estimate tier if active
  const handleSelectLlPassType = (pt: LLPassType) => {
    setLlPassType(pt);
    const newBase = getTypicalLlBaselineCents(pt, llPark, llAttraction);
    setSelectedLlTierCents(newBase);
    const qty = Math.max(1, llQuantity);
    const totalCents = newBase * qty;
    setManualPriceText((totalCents / 100).toFixed(2));
    distributeAcrossSelectedTravelers(totalCents);
    setLlQuoteStatusMessage(
      `Estimated baseline applied: $${(newBase / 100).toFixed(2)}/pass ($${(totalCents / 100).toFixed(2)} total).`
    );
  };

  // Category switch handler: clears previous category's calculator state to prevent data leak
  const handleCategoryChange = (newCat: BudgetCategory) => {
    if (newCat === category) return;
    setCategory(newCat);
    if (!initialLine) {
      setPriceQuote(null);
      setMultiQuoteBreakdown(null);
      setPriceSource('user_entered');
      setPriceLabelKind('your_price');
      setPriceRef(null);
      setPerTravelerPriceRefs({});
      setManualPriceText('');
      setDescription('');
      setExperienceId(null);
      setExperienceName(null);
      setTicketQuoteStatusMessage(null);
      setLlQuoteStatusMessage(null);
      setSelectedLlTierCents(null);
      setQuickDiningMode('none');
      setInlineBuffetQuantities({});
      setAllocationAmounts({});
      setApplyTip(newCat === 'dining');
      if (newCat === 'tickets') {
        setPlannedDate(null);
      } else if (!plannedDate) {
        setPlannedDate(tripStart ?? null);
      }
    }
  };

  // Manual price change handler
  const handleManualPriceChange = (text: string) => {
    setManualPriceText(text);
    setPriceSource('user_entered');
    setPriceLabelKind('your_price');
    setPriceQuote(null);
    setMultiQuoteBreakdown(null);
    setPriceRef(null);
    setPerTravelerPriceRefs({});
    if (allTravelers.length === 1) {
      const cents = parseDollarInputToCents(text) || 0;
      setAllocationAmounts({ [allTravelers[0]!.id]: cents });
    }
  };

  // 1-Tap Menu Average per Person handler (Requirement 9.11)
  const handleApplyMenuAverage = () => {
    if (!menuEstimate) return;
    const activeIds =
      selectedTravelerIds.length > 0
        ? selectedTravelerIds
        : allTravelers.map((t) => t.id);
    const dinerCount = Math.max(1, activeIds.length);
    const totalCents = menuEstimate.perPersonCents * dinerCount;

    setManualPriceText((totalCents / 100).toFixed(2));
    setPriceSource('user_entered');
    setPriceLabelKind('estimate');
    setPriceQuote(null);
    setPriceRef(null);
    setPerTravelerPriceRefs({});
    setInlineBuffetQuantities({});

    const nextMap: Record<string, number> = {};
    allTravelers.forEach((t) => {
      nextMap[t.id] = activeIds.includes(t.id) ? menuEstimate.perPersonCents : 0;
    });
    setAllocationAmounts(nextMap);
  };

  // Inline Buffet / Prix-Fixe stepper handler (Requirement 9.12)
  const handleStepInlineBuffet = (offer: MenuPriceOffer, delta: number) => {
    setInlineBuffetQuantities((prev) => {
      const current = prev[offer.label] ?? 0;
      const nextQty = Math.max(0, current + delta);
      const next = { ...prev };
      if (nextQty === 0) {
        delete next[offer.label];
      } else {
        next[offer.label] = nextQty;
      }

      // Compute combined buffet total across all active offers
      const expandedSlots: Array<{ name: string; priceCents: number }> = [];
      for (const o of menuOffers) {
        const q = next[o.label] ?? 0;
        for (let i = 0; i < q; i++) {
          expandedSlots.push({
            name: normalizeTierName(o.label),
            priceCents: o.priceCents,
          });
        }
      }

      const subtotalCents = expandedSlots.reduce((sum, s) => sum + s.priceCents, 0);
      setManualPriceText((subtotalCents / 100).toFixed(2));

      if (expandedSlots.length === 0) {
        setPriceSource('user_entered');
        setPriceLabelKind('your_price');
        setPriceRef(null);
        setPerTravelerPriceRefs({});
      } else if (expandedSlots.length <= allTravelers.length) {
        setPriceSource('disney_menu');
        setPriceLabelKind('current');
        const firstSlot = expandedSlots[0]!;
        setPriceRef({
          kind: 'menu',
          tier: { name: firstSlot.name, priceCents: firstSlot.priceCents },
        });
        const nextAmounts: Record<string, number> = {};
        const nextRefs: Record<string, PriceRef> = {};
        expandedSlots.forEach((slot, idx) => {
          const t = allTravelers[idx]!;
          nextAmounts[t.id] = slot.priceCents;
          nextRefs[t.id] = {
            kind: 'menu',
            tier: { name: slot.name, priceCents: slot.priceCents },
          };
        });
        setPerTravelerPriceRefs(nextRefs);
        setAllocationAmounts(nextAmounts);
      } else {
        // More buffet diners than traveler rows: keep combined total as user_entered
        setPriceSource('user_entered');
        setPriceLabelKind('current');
        setPriceRef(null);
        setPerTravelerPriceRefs({});
        distributeAcrossSelectedTravelers(subtotalCents);
      }

      return next;
    });
  };

  // Lodging Nightly Rate × Nights calculator handler (Requirement 22.9)
  const applyLodgingNightlyCalculation = (rateText: string, nights: number) => {
    const nightlyCents = parseDollarInputToCents(rateText);
    if (nightlyCents !== null && nightlyCents > 0 && nights >= 1) {
      const totalCents = nightlyCents * nights;
      setManualPriceText((totalCents / 100).toFixed(2));
      setPriceSource('user_entered');
      setPriceLabelKind('your_price');
      setPriceRef(null);
      setPerTravelerPriceRefs({});
      distributeAcrossSelectedTravelers(totalCents);
    }
  };

  // Dining menu confirm from MenuItemPicker modal
  const handleMenuConfirm = (selection: PickerSelection) => {
    setMenuPickerVisible(false);
    const subtotal = selectionSubtotalCents(selection);
    setManualPriceText((subtotal / 100).toFixed(2));
    setPriceLabelKind('current');

    // Expand multi-tier selections if more than 1 total diner slot is chosen
    if (selection.tiers && selection.tiers.length > 0) {
      const expandedSlots: Array<{ name: string; priceCents: number }> = [];
      for (const t of selection.tiers) {
        const qty = typeof t.quantity === 'number' ? Math.max(1, t.quantity) : 1;
        for (let i = 0; i < qty; i++) {
          expandedSlots.push({
            name: normalizeTierName(t.name),
            priceCents: t.priceCents,
          });
        }
      }
      if (expandedSlots.length > 1) {
        if (expandedSlots.length <= allTravelers.length) {
          setPriceSource('disney_menu');
          setPriceRef({
            kind: 'menu',
            tier: {
              name: expandedSlots[0]!.name,
              priceCents: expandedSlots[0]!.priceCents,
            },
          });
          const nextAmounts: Record<string, number> = {};
          const nextRefs: Record<string, PriceRef> = {};
          expandedSlots.forEach((slot, idx) => {
            const t = allTravelers[idx]!;
            nextAmounts[t.id] = slot.priceCents;
            nextRefs[t.id] = {
              kind: 'menu',
              tier: { name: slot.name, priceCents: slot.priceCents },
            };
          });
          setPerTravelerPriceRefs(nextRefs);
          setAllocationAmounts(nextAmounts);
        } else {
          setPriceSource('user_entered');
          setPriceRef(null);
          setPerTravelerPriceRefs({});
          distributeAcrossSelectedTravelers(subtotal);
        }
        return;
      }
    }

    const ref = selectionToBudgetPriceRef(selection);
    setPriceSource('disney_menu');
    setPriceRef(ref);
    setPerTravelerPriceRefs({});
  };

  // Everyone split
  const handleSplitEveryone = () => {
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (allTravelers.length === 0 || totalCents <= 0) return;
    setSelectedTravelerIds(allTravelers.map((t) => t.id));
    const shares = splitCentsEvenly(totalCents, allTravelers.length);
    const nextMap: Record<string, number> = {};
    allTravelers.forEach((t, idx) => {
      nextMap[t.id] = shares[idx] ?? 0;
    });
    setAllocationAmounts(nextMap);
    // If splitting a menu line across multiple people, switch to user_entered so server doesn't reject per-person sum mismatch
    if (priceSource === 'disney_menu' && allTravelers.length > 1 && Object.keys(perTravelerPriceRefs).length === 0) {
      setPriceSource('user_entered');
      setPriceRef(null);
    }
  };

  // Exclude organizer/caller from split so other crew members share the cost
  const handleExcludeMe = () => {
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (allTravelers.length <= 1) return;
    const otherTravelers = allTravelers.slice(1);
    const otherIds = otherTravelers.map((t) => t.id);
    setSelectedTravelerIds(otherIds);
    if (totalCents > 0) {
      distributeAcrossSelectedTravelers(totalCents, otherIds);
    } else {
      const nextMap: Record<string, number> = {};
      allTravelers.forEach((t) => {
        nextMap[t.id] = 0;
      });
      setAllocationAmounts(nextMap);
    }
  };

  // Only organizer/user pays (100% to me, others $0)
  const handleOnlyMe = () => {
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (allTravelers.length === 0) return;
    const myId = allTravelers[0]!.id;
    setSelectedTravelerIds([myId]);
    const nextMap: Record<string, number> = {};
    allTravelers.forEach((t) => {
      nextMap[t.id] = t.id === myId ? totalCents : 0;
    });
    setAllocationAmounts(nextMap);
  };

  // Smart profile match: adult quotes to adults, child quotes to children
  const handleSmartProfileMatch = () => {
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (allTravelers.length === 0 || totalCents <= 0) return;

    const profileMap = new Map<string, string>();
    travelers.forEach((p) => {
      const key = p.memberId ?? p.guestId;
      if (key) profileMap.set(key, p.ageBracket);
    });

    const adultIds: string[] = [];
    const childIds: string[] = [];
    allTravelers.forEach((t) => {
      const explicitBracket = t.ageBracket;
      const profileBracket = profileMap.get(t.id);
      const isKidByName =
        t.name.toLowerCase().includes('kid') || t.name.toLowerCase().includes('child');
      if (explicitBracket === 'child' || profileBracket === 'child' || isKidByName) {
        childIds.push(t.id);
      } else {
        adultIds.push(t.id);
      }
    });

    if (category === 'tickets') {
      const totalTickets = ticketAdultCount + ticketChildCount;
      if (totalTickets > 0) {
        const childRatio = 0.96315789;
        let perAdultCents = 0;
        let perChildCents = 0;

        if (ticketAdultCount > 0 && ticketChildCount > 0) {
          const weight = ticketAdultCount * 1.0 + ticketChildCount * childRatio;
          const unit = totalCents / weight;
          perAdultCents = Math.round(unit);
          perChildCents = Math.round(unit * childRatio);
        } else if (ticketAdultCount > 0) {
          perAdultCents = Math.round(totalCents / ticketAdultCount);
        } else if (ticketChildCount > 0) {
          perChildCents = Math.round(totalCents / ticketChildCount);
        }

        const nextMap: Record<string, number> = {};
        allTravelers.forEach((t) => {
          nextMap[t.id] = 0;
        });

        let remainingAdults = ticketAdultCount;
        let remainingKids = ticketChildCount;
        const activeIds: string[] = [];

        // 1. Assign adult tickets to adult travelers
        for (const t of allTravelers) {
          const isKid =
            t.ageBracket === 'child' ||
            profileMap.get(t.id) === 'child' ||
            t.name.toLowerCase().includes('kid') ||
            t.name.toLowerCase().includes('child');
          if (!isKid && remainingAdults > 0) {
            nextMap[t.id] = perAdultCents;
            activeIds.push(t.id);
            remainingAdults--;
          }
        }

        // 2. Assign child tickets to child travelers
        for (const t of allTravelers) {
          const isKid =
            t.ageBracket === 'child' ||
            profileMap.get(t.id) === 'child' ||
            t.name.toLowerCase().includes('kid') ||
            t.name.toLowerCase().includes('child');
          if (isKid && remainingKids > 0) {
            nextMap[t.id] = perChildCents;
            activeIds.push(t.id);
            remainingKids--;
          }
        }

        // 3. Overflow adult tickets to any remaining traveler
        if (remainingAdults > 0) {
          for (const t of allTravelers) {
            if (nextMap[t.id] === 0 && remainingAdults > 0) {
              nextMap[t.id] = perAdultCents;
              activeIds.push(t.id);
              remainingAdults--;
            }
          }
        }

        // 4. Overflow child tickets to any remaining traveler
        if (remainingKids > 0) {
          for (const t of allTravelers) {
            if (nextMap[t.id] === 0 && remainingKids > 0) {
              nextMap[t.id] = perChildCents;
              activeIds.push(t.id);
              remainingKids--;
            }
          }
        }

        // Reconcile rounding to match totalCents exactly
        const sumAlloc = Object.values(nextMap).reduce((a, b) => a + b, 0);
        const diff = totalCents - sumAlloc;
        if (diff !== 0 && activeIds.length > 0) {
          nextMap[activeIds[0]!] = Math.max(0, (nextMap[activeIds[0]!] ?? 0) + diff);
        }

        setSelectedTravelerIds(activeIds.length > 0 ? activeIds : allTravelers.map((t) => t.id));
        setAllocationAmounts(nextMap);
        return;
      }
    }

    if (
      category === 'dining' &&
      quickDiningMode === 'buffet' &&
      buffetAdults > 0 &&
      buffetKids > 0
    ) {
      const adultRate = 6500;
      const childRate = 4200;
      const nextMap: Record<string, number> = {};
      allTravelers.forEach((t) => {
        nextMap[t.id] = 0;
      });
      adultIds.forEach((id) => {
        nextMap[id] = adultRate;
      });
      childIds.forEach((id) => {
        nextMap[id] = childRate;
      });
      setSelectedTravelerIds(allTravelers.map((t) => t.id));
      setAllocationAmounts(nextMap);
      return;
    }

    distributeAcrossSelectedTravelers(totalCents, selectedTravelerIds);
  };

  // Toggle a traveler chip in Party Allocations
  const handleToggleTravelerChip = (travelerId: string) => {
    const isCurrentlySelected = selectedTravelerIds.includes(travelerId);
    const nextSelected = isCurrentlySelected
      ? selectedTravelerIds.filter((id) => id !== travelerId)
      : [...selectedTravelerIds, travelerId];
    if (nextSelected.length === 0) return;
    setSelectedTravelerIds(nextSelected);
    const totalCents = parseDollarInputToCents(manualPriceText) || 0;
    if (totalCents > 0) {
      distributeAcrossSelectedTravelers(totalCents, nextSelected);
    }
  };

  // Smart default description generator
  const smartTicketDescription = useMemo(() => {
    const partyParts: string[] = [];
    if (ticketAdultCount > 0) partyParts.push(`${ticketAdultCount} Adult${ticketAdultCount > 1 ? 's' : ''}`);
    if (ticketChildCount > 0) partyParts.push(`${ticketChildCount} Kid${ticketChildCount > 1 ? 's' : ''}`);
    const partyStr = partyParts.length > 0 ? ` (${partyParts.join(', ')})` : '';
    return `${ticketNumDays}-Day ${TICKET_OPTION_LABELS[ticketOption]}${partyStr}`;
  }, [ticketNumDays, ticketOption, ticketAdultCount, ticketChildCount]);

  const resolveSmartDescription = (): string => {
    const trimmed = description.trim();
    if (trimmed.length > 0) return trimmed;
    if (category === 'tickets') {
      return `${ticketNumDays}-Day ${TICKET_OPTION_LABELS[ticketOption]} Tickets`;
    }
    if (category === 'lightning_lane') {
      const suffix =
        llPassType === 'single' && llAttraction.trim()
          ? ` (${llAttraction.trim()})`
          : '';
      return `LL ${LL_PASS_TYPE_LABELS[llPassType]} · ${llPark}${suffix}`;
    }
    if (category === 'dining') {
      const restName = experienceName || expQuery.data?.experience?.name;
      if (restName) return restName;
      return diningMode === 'off_property' ? 'Off-Property Dining' : 'Disney Dining';
    }
    if (category === 'lodging') {
      if (resortName) return resortName;
      return lodgingMode === 'off_site' ? 'Off-Site Lodging' : 'Disney Resort Stay';
    }
    return CATEGORY_META[category].label;
  };

  // Live Subtotal + Tax + Tip = Total calculation
  const liveBreakdown = useMemo(() => {
    const subtotalCents = parseDollarInputToCents(manualPriceText) || 0;
    const taxBps = settings?.taxBps?.[category] ?? BUDGET_DEFAULT_TAX_BPS[category] ?? 0;
    const tipBps =
      category === 'dining' && applyTip
        ? (settings?.diningTipBps ?? BUDGET_DEFAULT_DINING_TIP_BPS)
        : 0;
    const taxCents = bpsOf(subtotalCents, taxBps);
    const tipCents = bpsOf(subtotalCents, tipBps);
    const totalCents = subtotalCents + taxCents + tipCents;
    return { subtotalCents, taxCents, tipCents, totalCents, taxBps, tipBps };
  }, [manualPriceText, category, applyTip, settings]);

  // Save handler
  const handleSave = async () => {
    setSaveError(null);
    const subtotal = parseDollarInputToCents(manualPriceText) || 0;
    const itemPriceRef = priceRef ?? undefined;

    const enteredAllocations = Object.entries(allocationAmounts)
      .filter(([_, cents]) => cents > 0)
      .map(([id, cents]) => {
        const traveler = allTravelers.find((t) => t.id === id);
        const specificRef = perTravelerPriceRefs[id] ?? itemPriceRef;
        if (traveler?.isGuest) {
          return {
            guestId: id,
            amountCents: cents,
            ...(specificRef ? { priceRef: specificRef } : {}),
          };
        }
        return {
          memberId: id,
          amountCents: cents,
          ...(specificRef ? { priceRef: specificRef } : {}),
        };
      });

    let finalAllocations: BudgetLineInput['allocations'];
    if (enteredAllocations.length > 0) {
      finalAllocations = enteredAllocations;
    } else {
      const primary = allTravelers[0];
      if (primary) {
        const specificRef = perTravelerPriceRefs[primary.id] ?? itemPriceRef;
        finalAllocations = [
          {
            ...(primary.isGuest ? { guestId: primary.id } : { memberId: primary.id }),
            amountCents: subtotal,
            ...(specificRef ? { priceRef: specificRef } : {}),
          },
        ];
      } else {
        finalAllocations = [
          {
            memberId: '00000000-0000-0000-0000-000000000000',
            amountCents: subtotal,
            ...(itemPriceRef ? { priceRef: itemPriceRef } : {}),
          },
        ];
      }
    }

    const lineLevelPriceRef =
      priceSource !== 'user_entered' &&
      priceRef &&
      (priceRef.kind === 'ticket' || priceRef.kind === 'll')
        ? priceRef
        : null;

    const effectivePark: Park | null =
      category === 'lightning_lane'
        ? llPark
        : category === 'dining' && diningMode === 'off_property'
          ? null
          : park || null;

    const payload: BudgetLineInput = {
      category,
      description: resolveSmartDescription(),
      plannedDate: plannedDate || null,
      park: effectivePark,
      experienceId:
        category === 'dining' && diningMode === 'disney' ? (experienceId || null) : null,
      priceSource,
      priceRef: lineLevelPriceRef,
      applyTip: category === 'dining' ? applyTip : false,
      linkedExpenseId: initialLine?.linkedExpenseId ?? null,
      allocations: finalAllocations,
      ...(initialDraft?.suggestionKey ? { suggestionKey: initialDraft.suggestionKey } : {}),
    };

    try {
      if (isEdit && initialLine?.id) {
        const res = await editMutation.mutateAsync({
          lineId: initialLine.id,
          input: payload as BudgetLineReplace,
        });
        onSaveSuccess?.(res);
      } else {
        const res = await createMutation.mutateAsync(payload);
        onSaveSuccess?.(res);
      }
      onCancel();
    } catch (err: unknown) {
      console.error('[BudgetLineFormModal] Save failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save budget line';
      setSaveError(msg);
      Alert.alert('Save Failed', msg);
    }
  };

  const isSaving = createMutation.isPending || editMutation.isPending;
  const activeDinerCount = Math.max(1, selectedTravelerIds.length || allTravelers.length);
  const showStandaloneParkPicker =
    category === 'shopping' ||
    category === 'other' ||
    (category === 'dining' && diningMode === 'disney' && !experienceId);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} testID={testID}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={18} color={palette.chipActiveBg} />
            <Text style={styles.title}>{isEdit ? 'Edit Budget Line' : 'Add Budget Line'}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={15} color={palette.hintText} />
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {/* Save Error Banner */}
        {saveError && (
          <View
            style={[
              styles.statusCallout,
              { backgroundColor: palette.errorBg, marginHorizontal: 16, marginTop: 12 },
            ]}
          >
            <Ionicons name="alert-circle" size={18} color={palette.errorText} />
            <Text style={[styles.quoteMessage, { color: palette.errorText }]}>{saveError}</Text>
          </View>
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* 1. CHOOSE CATEGORY — 3x2 Grid */}
          <View style={styles.section}>
            <View style={styles.categoryHeaderRow}>
              <Text style={styles.stepTitle}>1. CHOOSE CATEGORY</Text>
              <View testID="active-category-pill" style={[styles.activeCategoryPill, { backgroundColor: palette.badgeBg }]}>
                <Ionicons
                  name={CATEGORY_META[category].icon}
                  size={13}
                  color={palette.tagText}
                />
                <Text style={[styles.activeCategoryPillText, { color: palette.tagText }]}>
                  {CATEGORY_META[category].label}
                </Text>
              </View>
            </View>
            <View style={styles.categoryGrid}>
              {DISPLAY_CATEGORIES.map((cat) => {
                const isSelected = category === cat;
                const meta = CATEGORY_META[cat];
                return (
                  <Pressable
                    key={cat}
                    accessibilityRole="button"
                    accessibilityLabel={cat}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleCategoryChange(cat)}
                    style={[
                      styles.categoryCard,
                      {
                        backgroundColor: isSelected ? palette.chipActiveBg : palette.chipInactiveBg,
                        borderColor: isSelected ? palette.chipActiveBg : palette.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={meta.icon}
                      size={18}
                      color={isSelected ? palette.chipActiveText : palette.hintText}
                    />
                    <Text
                      style={[
                        styles.categoryCardText,
                        {
                          color: isSelected ? palette.chipActiveText : palette.chipInactiveText,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {meta.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Hotel Selection & Nightly Calculator Card when category is lodging */}
          {category === 'lodging' && (
            <View style={styles.cardSection}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLeft}>
                  <Ionicons name="bed-outline" size={18} color={palette.chipActiveBg} />
                  <Text style={styles.cardTitle}>HOTEL & LODGING</Text>
                </View>
              </View>

              {/* Disney Resort vs Off-Site Toggle */}
              <View style={styles.modeToggleRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Disney Resort"
                  accessibilityState={{ selected: lodgingMode === 'disney' }}
                  onPress={() => setLodgingMode('disney')}
                  style={[
                    styles.modeToggleBtn,
                    {
                      backgroundColor:
                        lodgingMode === 'disney' ? palette.chipActiveBg : palette.chipInactiveBg,
                      borderColor:
                        lodgingMode === 'disney' ? palette.chipActiveBg : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={14}
                    color={
                      lodgingMode === 'disney' ? palette.chipActiveText : palette.chipInactiveText
                    }
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      {
                        color:
                          lodgingMode === 'disney'
                            ? palette.chipActiveText
                            : palette.chipInactiveText,
                      },
                    ]}
                  >
                    Disney Resort
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Off-Site Lodging"
                  accessibilityState={{ selected: lodgingMode === 'off_site' }}
                  onPress={() => {
                    setLodgingMode('off_site');
                    setResortId(null);
                    setResortName(null);
                  }}
                  style={[
                    styles.modeToggleBtn,
                    {
                      backgroundColor:
                        lodgingMode === 'off_site' ? palette.chipActiveBg : palette.chipInactiveBg,
                      borderColor:
                        lodgingMode === 'off_site' ? palette.chipActiveBg : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="business-outline"
                    size={14}
                    color={
                      lodgingMode === 'off_site'
                        ? palette.chipActiveText
                        : palette.chipInactiveText
                    }
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      {
                        color:
                          lodgingMode === 'off_site'
                            ? palette.chipActiveText
                            : palette.chipInactiveText,
                      },
                    ]}
                  >
                    Off-Site / Rental
                  </Text>
                </Pressable>
              </View>

              {lodgingMode === 'disney' && (
                <View style={{ marginBottom: 12 }}>
                  {resortName ? (
                    <View style={styles.linkedVenueBox}>
                      <View style={styles.linkedVenueInfo}>
                        <Text style={styles.linkedVenueName}>{resortName}</Text>
                        <Text style={styles.linkedVenueSubtitle}>Selected Disney Resort</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Change resort"
                        onPress={() => setShowResortPicker(true)}
                        style={styles.changeVenueBtn}
                      >
                        <Text style={styles.changeVenueBtnText}>Change</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Link Disney Resort"
                      onPress={() => setShowResortPicker(true)}
                      style={styles.linkVenueBtn}
                    >
                      <Ionicons name="bed-outline" size={18} color={palette.chipActiveBg} />
                      <Text style={styles.linkVenueBtnText}>Select Disney Resort Hotel</Text>
                      <Ionicons name="chevron-forward" size={16} color={palette.hintText} />
                    </Pressable>
                  )}
                </View>
              )}

              {/* Nightly Rate × Nights Calculator */}
              <View style={styles.nightlyCalcRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Nightly Rate ($)</Text>
                  <TextInput
                    accessibilityLabel="Nightly rate"
                    keyboardType="decimal-pad"
                    placeholder="e.g. 285.00"
                    placeholderTextColor={palette.hintText}
                    value={nightlyRateText}
                    onChangeText={(text) => {
                      setNightlyRateText(text);
                      applyLodgingNightlyCalculation(text, lodgingNights);
                    }}
                    style={styles.input}
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Nights</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Decrease nights"
                      onPress={() => {
                        const next = Math.max(1, lodgingNights - 1);
                        setLodgingNights(next);
                        applyLodgingNightlyCalculation(nightlyRateText, next);
                      }}
                      style={styles.stepBtn}
                    >
                      <Ionicons name="remove" size={18} color={palette.stepperBtnText} />
                    </Pressable>
                    <Text style={styles.stepValue}>
                      {lodgingNights} {lodgingNights === 1 ? 'night' : 'nights'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Increase nights"
                      onPress={() => {
                        const next = Math.min(30, lodgingNights + 1);
                        setLodgingNights(next);
                        applyLodgingNightlyCalculation(nightlyRateText, next);
                      }}
                      style={styles.stepBtn}
                    >
                      <Ionicons name="add" size={18} color={palette.stepperBtnText} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Restaurant Selection Card when category is dining */}
          {category === 'dining' && (
            <View style={styles.cardSection}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLeft}>
                  <Ionicons name="restaurant-outline" size={18} color={palette.chipActiveBg} />
                  <Text style={[styles.cardTitle, { color: palette.goldText }]}>
                    Disney Dining & Menu Calculator
                  </Text>
                </View>
                <View style={[styles.apiBadge, { backgroundColor: palette.apiBadgeBg }]}>
                  <Text style={[styles.apiBadgeText, { color: palette.apiBadgeText }]}>Disney API</Text>
                </View>
              </View>

              {/* Disney Dining vs Off-Property Toggle */}
              <View style={styles.modeToggleRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Disney Dining"
                  accessibilityState={{ selected: diningMode === 'disney' }}
                  onPress={() => setDiningMode('disney')}
                  style={[
                    styles.modeToggleBtn,
                    {
                      backgroundColor:
                        diningMode === 'disney' ? palette.chipActiveBg : palette.chipInactiveBg,
                      borderColor:
                        diningMode === 'disney' ? palette.chipActiveBg : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={14}
                    color={
                      diningMode === 'disney' ? palette.chipActiveText : palette.chipInactiveText
                    }
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      {
                        color:
                          diningMode === 'disney'
                            ? palette.chipActiveText
                            : palette.chipInactiveText,
                      },
                    ]}
                  >
                    Disney Restaurant
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Off-Property Dining"
                  accessibilityState={{ selected: diningMode === 'off_property' }}
                  onPress={() => {
                    setDiningMode('off_property');
                    setExperienceId(null);
                    setExperienceName(null);
                    setPriceSource('user_entered');
                    setPriceLabelKind('your_price');
                    setPriceRef(null);
                    setPerTravelerPriceRefs({});
                  }}
                  style={[
                    styles.modeToggleBtn,
                    {
                      backgroundColor:
                        diningMode === 'off_property'
                          ? palette.chipActiveBg
                          : palette.chipInactiveBg,
                      borderColor:
                        diningMode === 'off_property' ? palette.chipActiveBg : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="fast-food-outline"
                    size={14}
                    color={
                      diningMode === 'off_property'
                        ? palette.chipActiveText
                        : palette.chipInactiveText
                    }
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      {
                        color:
                          diningMode === 'off_property'
                            ? palette.chipActiveText
                            : palette.chipInactiveText,
                      },
                    ]}
                  >
                    Off-Property / Custom
                  </Text>
                </Pressable>
              </View>

              {diningMode === 'disney' ? (
                <>
                  {/* SEARCH DISNEY RESTAURANT */}
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>SEARCH DISNEY RESTAURANT</Text>
                    {experienceName || (experienceId && expQuery.data?.experience?.name) ? (
                      <View style={styles.linkedVenueBox}>
                        <View style={styles.linkedVenueInfo}>
                          <Text style={styles.linkedVenueName}>
                            {experienceName || expQuery.data?.experience?.name}
                          </Text>
                          <Text style={styles.linkedVenueSubtitle}>
                            {park ? `${park} · Linked Restaurant` : 'Linked Restaurant'}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Change restaurant"
                          onPress={() => setShowExpPicker(true)}
                          style={styles.changeVenueBtn}
                        >
                          <Text style={styles.changeVenueBtnText}>Change</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Link Disney Restaurant"
                        onPress={() => setShowExpPicker(true)}
                        style={styles.linkVenueBtn}
                      >
                        <Ionicons name="search-outline" size={18} color={palette.chipActiveBg} />
                        <Text style={styles.linkVenueBtnText}>Select Disney Restaurant</Text>
                        <Ionicons name="chevron-forward" size={16} color={palette.hintText} />
                      </Pressable>
                    )}
                  </View>

                  {/* ESTIMATION METHOD Tabs */}
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>ESTIMATION METHOD</Text>
                    <View style={styles.estimationTabsRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Buffet / Character"
                        accessibilityState={{ selected: quickDiningMode === 'buffet' || quickDiningMode === 'none' }}
                        onPress={() => {
                          setQuickDiningMode('buffet');
                          const total = buffetAdults * 6500 + buffetKids * 4200;
                          setManualPriceText((total / 100).toFixed(2));
                          distributeAcrossSelectedTravelers(total);
                        }}
                        style={[
                          styles.estTabBtn,
                          (quickDiningMode === 'buffet' || quickDiningMode === 'none') && styles.estTabBtnActive,
                          {
                            backgroundColor:
                              quickDiningMode === 'buffet' || quickDiningMode === 'none'
                                ? palette.chipActiveBg
                                : palette.chipInactiveBg,
                            borderColor:
                              quickDiningMode === 'buffet' || quickDiningMode === 'none'
                                ? palette.chipActiveBg
                                : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.estTabText,
                            {
                              color:
                                quickDiningMode === 'buffet' || quickDiningMode === 'none'
                                  ? palette.chipActiveText
                                  : palette.chipInactiveText,
                            },
                          ]}
                        >
                          Buffet / Fixed
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Table-Service ~$45/person"
                        accessibilityState={{ selected: quickDiningMode === 'table_service' }}
                        onPress={() => {
                          setQuickDiningMode('table_service');
                          const rate = 4500;
                          const total = rate * activeDinerCount;
                          setManualPriceText((total / 100).toFixed(2));
                          distributeAcrossSelectedTravelers(total);
                        }}
                        style={[
                          styles.estTabBtn,
                          quickDiningMode === 'table_service' && styles.estTabBtnActive,
                          {
                            backgroundColor:
                              quickDiningMode === 'table_service'
                                ? palette.chipActiveBg
                                : palette.chipInactiveBg,
                            borderColor:
                              quickDiningMode === 'table_service'
                                ? palette.chipActiveBg
                                : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.estTabText,
                            {
                              color:
                                quickDiningMode === 'table_service'
                                  ? palette.chipActiveText
                                  : palette.chipInactiveText,
                            },
                          ]}
                        >
                          Menu Average
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Pick from menu"
                        onPress={() => setMenuPickerVisible(true)}
                        style={[
                          styles.estTabBtn,
                          {
                            backgroundColor: palette.chipInactiveBg,
                            borderColor: palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.estTabText,
                            { color: palette.chipInactiveText },
                          ]}
                        >
                          Pick Menu Items
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Buffet / Prix-Fixe Steppers Container */}
                  {(quickDiningMode === 'buffet' || quickDiningMode === 'none') && (
                    <View style={styles.buffetSteppersContainer}>
                      {menuOffers.length > 0 ? (
                        <View style={styles.buffetSteppersRow}>
                          {menuOffers.map((offer) => {
                            const qty = inlineBuffetQuantities[offer.label] ?? 0;
                            return (
                              <View
                                key={offer.label}
                                style={[
                                  styles.buffetStepperCard,
                                  { backgroundColor: palette.subtleBg, borderColor: palette.border },
                                ]}
                              >
                                <View style={styles.buffetStepperInfo}>
                                  <Text style={styles.buffetStepperTitle}>
                                    {qty} {offer.label}
                                  </Text>
                                  <Text style={[styles.buffetStepperRate, { color: palette.hintText }]}>
                                    {formatDollars(offer.priceCents)}/ea
                                  </Text>
                                </View>
                                <View style={styles.stepperInline}>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Decrease buffet ${offer.label}`}
                                    onPress={() => handleStepInlineBuffet(offer, -1)}
                                    style={styles.stepBtnSmall}
                                  >
                                    <Ionicons name="remove" size={15} color={palette.stepperBtnText} />
                                  </Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Increase buffet ${offer.label}`}
                                    onPress={() => handleStepInlineBuffet(offer, 1)}
                                    style={styles.stepBtnSmall}
                                  >
                                    <Ionicons name="add" size={15} color={palette.stepperBtnText} />
                                  </Pressable>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={styles.buffetSteppersRow}>
                          {/* Adults */}
                          <View style={[styles.buffetStepperCard, { backgroundColor: palette.subtleBg, borderColor: palette.border }]}>
                            <View style={styles.buffetStepperInfo}>
                              <Text style={styles.buffetStepperTitle}>{buffetAdults} Adults</Text>
                              <Text style={[styles.buffetStepperRate, { color: palette.hintText }]}>$65.00/ea</Text>
                            </View>
                            <View style={styles.stepperInline}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Decrease buffet adults"
                                onPress={() => {
                                  const next = Math.max(0, buffetAdults - 1);
                                  setBuffetAdults(next);
                                  const total = next * 6500 + buffetKids * 4200;
                                  setManualPriceText((total / 100).toFixed(2));
                                  distributeAcrossSelectedTravelers(total);
                                }}
                                style={styles.stepBtnSmall}
                              >
                                <Ionicons name="remove" size={15} color={palette.stepperBtnText} />
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Increase buffet adults"
                                onPress={() => {
                                  const next = buffetAdults + 1;
                                  setBuffetAdults(next);
                                  const total = next * 6500 + buffetKids * 4200;
                                  setManualPriceText((total / 100).toFixed(2));
                                  distributeAcrossSelectedTravelers(total);
                                }}
                                style={styles.stepBtnSmall}
                              >
                                <Ionicons name="add" size={15} color={palette.stepperBtnText} />
                              </Pressable>
                            </View>
                          </View>

                          {/* Kids */}
                          <View style={[styles.buffetStepperCard, { backgroundColor: palette.subtleBg, borderColor: palette.border }]}>
                            <View style={styles.buffetStepperInfo}>
                              <Text style={styles.buffetStepperTitle}>{buffetKids} Kids (3-9)</Text>
                              <Text style={[styles.buffetStepperRate, { color: palette.hintText }]}>$42.00/ea</Text>
                            </View>
                            <View style={styles.stepperInline}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Decrease buffet kids"
                                onPress={() => {
                                  const next = Math.max(0, buffetKids - 1);
                                  setBuffetKids(next);
                                  const total = buffetAdults * 6500 + next * 4200;
                                  setManualPriceText((total / 100).toFixed(2));
                                  distributeAcrossSelectedTravelers(total);
                                }}
                                style={styles.stepBtnSmall}
                              >
                                <Ionicons name="remove" size={15} color={palette.stepperBtnText} />
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Increase buffet kids"
                                onPress={() => {
                                  const next = buffetKids + 1;
                                  setBuffetKids(next);
                                  const total = buffetAdults * 6500 + next * 4200;
                                  setManualPriceText((total / 100).toFixed(2));
                                  distributeAcrossSelectedTravelers(total);
                                }}
                                style={styles.stepBtnSmall}
                              >
                                <Ionicons name="add" size={15} color={palette.stepperBtnText} />
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Menu Average options row when in table service mode */}
                  {(quickDiningMode === 'table_service' || quickDiningMode === 'quick_service') && (
                    <View style={styles.menuAvgOptionsRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Quick-Service ~$20/person"
                        accessibilityState={{ selected: quickDiningMode === 'quick_service' }}
                        onPress={() => {
                          setQuickDiningMode('quick_service');
                          const rate = 2000;
                          const total = rate * activeDinerCount;
                          setManualPriceText((total / 100).toFixed(2));
                          distributeAcrossSelectedTravelers(total);
                        }}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: palette.chipInactiveBg,
                            borderColor: palette.border,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: palette.chipInactiveText }]}>
                          Quick-Service (~$20)
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/* 1-Tap Menu Average per Person (Requirement 9.11) */}
                  {menuEstimate &&
                    (quickDiningMode === 'table_service' ||
                      menuEstimate.basis === 'entrees' ||
                      menuOffers.length === 0) && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Apply menu average"
                        onPress={handleApplyMenuAverage}
                        style={[
                          styles.menuEstimateBtn,
                          {
                            backgroundColor: palette.selectedCardBg,
                            borderColor: palette.selectedCardBorder,
                          },
                        ]}
                      >
                        <Ionicons name="sparkles" size={16} color={palette.chipActiveBg} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.menuEstimateTitle}>
                            Use Menu Average (~{formatDollars(menuEstimate.perPersonCents)}/person)
                          </Text>
                          <Text style={[styles.menuEstimateSub, { color: palette.hintText }]}>
                            Based on {menuEstimate.sampleCount}{' '}
                            {menuEstimate.basis === 'entrees' ? 'entrées' : 'menu items'} ·{' '}
                            {activeDinerCount} {activeDinerCount === 1 ? 'diner' : 'diners'} ={' '}
                            {formatDollars(menuEstimate.perPersonCents * activeDinerCount)}
                          </Text>
                        </View>
                        <Text style={[styles.menuEstimateApply, { color: palette.stepperBtnText }]}>
                          Apply
                        </Text>
                      </Pressable>
                    )}

                  {/* Tip Checkbox Row with Calculated Tip Amount on the right */}
                  <View style={styles.diningTipRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Apply tip"
                      onPress={() => setApplyTip(!applyTip)}
                      style={styles.checkboxRow}
                    >
                      <Ionicons
                        name={applyTip ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={applyTip ? palette.chipActiveBg : palette.hintText}
                      />
                      <Text style={styles.checkboxLabel}>Apply Standard Tip (18%)</Text>
                    </Pressable>
                    {liveBreakdown.tipCents > 0 && (
                      <Text style={[styles.tipCentsDisplay, { color: palette.hintText }]}>
                        +{formatDollars(liveBreakdown.tipCents)}
                      </Text>
                    )}
                  </View>
                </>
              ) : (
                <Text style={[styles.offPropertyHint, { color: palette.hintText }]}>
                  Budget for off-property restaurants, airport meals, grocery delivery, or coffee
                  stops. Enter the description and total below.
                </Text>
              )}
            </View>
          )}

          {/* Canonical Park (hidden when calculator already has its own park picker or off-property) */}
          {showStandaloneParkPicker && (
            <View style={styles.cardSection}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="map-outline" size={18} color={palette.chipActiveBg} />
                <Text style={styles.cardTitle}>TARGET PARK (OPTIONAL)</Text>
              </View>
              <View style={styles.parkRow}>
                {THEME_PARKS.map((p) => {
                  const isSelected = park === p.park;
                  return (
                    <Pressable
                      key={p.park}
                      accessibilityRole="button"
                      accessibilityLabel={p.label}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setPark(isSelected ? null : p.park)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isSelected
                            ? palette.chipActiveBg
                            : palette.chipInactiveBg,
                          borderColor: isSelected ? palette.chipActiveBg : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: isSelected ? palette.chipActiveText : palette.chipInactiveText,
                          },
                        ]}
                      >
                        {p.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Category: Tickets Quote Picker */}
          {category === 'tickets' && (
            <View style={styles.cardSection}>
              <View style={styles.allocHeader}>
                <View style={styles.cardHeaderRow}>
                  <Ionicons name="ticket" size={18} color={palette.accentPink} />
                  <Text style={[styles.cardTitleGold, { color: palette.goldText }]}>
                    Disney Ticket Quote Calculator
                  </Text>
                </View>
                <View style={styles.cardHeaderRightRow}>
                  <View style={[styles.officialPricingBadge, { backgroundColor: palette.apiBadgeBg }]}>
                    <Text style={[styles.officialPricingBadgeText, { color: palette.apiBadgeText }]}>
                      Official Disney Pricing
                    </Text>
                  </View>
                  {travelers.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Use traveler profiles"
                      onPress={handlePrefillTicketsFromProfiles}
                      style={styles.changeVenueBtn}
                    >
                      <Text style={styles.changeVenueBtnText}>Use Profiles</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Number of days - Horizontal Row Stepper Container */}
              <View style={[styles.ticketDurationRow, { backgroundColor: palette.subtleBg }]}>
                <Text style={styles.ticketDurationLabel}>Ticket Duration:</Text>
                <View style={styles.stepperPill}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease days"
                    onPress={() => setTicketNumDays((d) => Math.max(1, d - 1))}
                    style={[styles.stepperPillBtn, { backgroundColor: palette.chipActiveBg }]}
                  >
                    <Ionicons name="remove" size={16} color={palette.chipActiveText} />
                  </Pressable>
                  <Text style={styles.stepperPillValue}>
                    {ticketNumDays} {ticketNumDays === 1 ? 'day' : 'days'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase days"
                    onPress={() => setTicketNumDays((d) => Math.min(10, d + 1))}
                    style={[styles.stepperPillBtn, { backgroundColor: palette.chipActiveBg }]}
                  >
                    <Ionicons name="add" size={16} color={palette.chipActiveText} />
                  </Pressable>
                </View>
              </View>

              {/* Multi-Ticket Party Counts: Adults (10+) & Children (3-9) */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldSubheader}>PARTY TICKET QUANTITIES</Text>
                <View style={styles.ticketQtyGrid}>
                  <View
                    style={[
                      styles.ticketQtyCardMockup,
                      {
                        backgroundColor: palette.subtleBg,
                        borderColor:
                          ticketAdultCount > 0 ? palette.chipActiveBg : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.ticketQtyInfo}>
                      <Text style={styles.ticketQtyTitle} numberOfLines={1}>
                        Adults (10+)
                      </Text>
                      <Text
                        style={[styles.ticketDailyRate, { color: palette.hintText }]}
                        numberOfLines={1}
                      >
                        ${estimateTicketDailyRate(ticketNumDays, false)}/day
                      </Text>
                    </View>
                    <View style={styles.stepperInline}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease adult tickets"
                        onPress={() =>
                          setTicketAdultCount((c) => {
                            const next = Math.max(0, c - 1);
                            if (next === 0 && ticketChildCount > 0) setTicketAgeGroup('child');
                            return next;
                          })
                        }
                        style={styles.stepBtnSmall}
                      >
                        <Ionicons name="remove" size={14} color={palette.stepperBtnText} />
                      </Pressable>
                      <Text style={styles.stepValueSmall}>{ticketAdultCount}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase adult tickets"
                        onPress={() => {
                          setTicketAdultCount((c) => Math.min(20, c + 1));
                          setTicketAgeGroup('adult');
                        }}
                        style={styles.stepBtnSmall}
                      >
                        <Ionicons name="add" size={14} color={palette.stepperBtnText} />
                      </Pressable>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.ticketQtyCardMockup,
                      {
                        backgroundColor: palette.subtleBg,
                        borderColor:
                          ticketChildCount > 0 ? palette.chipActiveBg : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.ticketQtyInfo}>
                      <Text style={styles.ticketQtyTitle} numberOfLines={1}>
                        Children (3–9)
                      </Text>
                      <Text
                        style={[styles.ticketDailyRate, { color: palette.hintText }]}
                        numberOfLines={1}
                      >
                        ${estimateTicketDailyRate(ticketNumDays, true)}/day
                      </Text>
                    </View>
                    <View style={styles.stepperInline}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease child tickets"
                        onPress={() =>
                          setTicketChildCount((c) => {
                            const next = Math.max(0, c - 1);
                            if (next === 0 && ticketAdultCount > 0) setTicketAgeGroup('adult');
                            return next;
                          })
                        }
                        style={styles.stepBtnSmall}
                      >
                        <Ionicons name="remove" size={14} color={palette.stepperBtnText} />
                      </Pressable>
                      <Text style={styles.stepValueSmall}>{ticketChildCount}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase child tickets"
                        onPress={() => {
                          setTicketChildCount((c) => Math.min(20, c + 1));
                          if (ticketAdultCount === 0) setTicketAgeGroup('child');
                        }}
                        style={styles.stepBtnSmall}
                      >
                        <Ionicons name="add" size={14} color={palette.stepperBtnText} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>

              {/* Ticket Type - 2x2 Grid */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldSubheader}>TICKET TYPE</Text>
                <View style={styles.ticketTypeGrid2x2}>
                  {(['base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports'] as const).map(
                    (opt) => {
                      const isSelected = ticketOption === opt;
                      return (
                        <Pressable
                          key={opt}
                          accessibilityRole="button"
                          accessibilityLabel={opt}
                          onPress={() => setTicketOption(opt)}
                          style={[
                            styles.ticketTypeGridBtn,
                            {
                              backgroundColor:
                                isSelected ? palette.chipActiveBg : palette.chipInactiveBg,
                              borderColor: isSelected ? palette.chipActiveBg : palette.border,
                            },
                          ]}
                        >
                          <Text style={styles.ticketTypeGridIcon}>{TICKET_OPTION_ICONS[opt]}</Text>
                          <Text
                            style={[
                              styles.ticketTypeGridText,
                              {
                                color:
                                  isSelected
                                    ? palette.chipActiveText
                                    : palette.chipInactiveText,
                                fontWeight: isSelected ? '700' : '600',
                              },
                            ]}
                          >
                            {TICKET_OPTION_LABELS[opt]}
                          </Text>
                        </Pressable>
                      );
                    }
                  )}
                </View>
              </View>

              {/* Pricing Tier */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldSubheader}>PRICING TIER</Text>
                <View style={styles.pricingTierRow}>
                  {(['std-gst', 'fl-resident'] as const).map((grp) => {
                    const isSelected = ticketDiscountGroup === grp;
                    return (
                      <Pressable
                        key={grp}
                        accessibilityRole="button"
                        accessibilityLabel={grp}
                        onPress={() => setTicketDiscountGroup(grp)}
                        style={[
                          styles.pricingTierBtn,
                          {
                            backgroundColor:
                              isSelected
                                ? palette.chipActiveBg
                                : palette.chipInactiveBg,
                            borderColor:
                              isSelected ? palette.chipActiveBg : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pricingTierBtnText,
                            {
                              color:
                                isSelected
                                  ? palette.chipActiveText
                                  : palette.chipInactiveText,
                              fontWeight: isSelected ? '700' : '600',
                            },
                          ]}
                        >
                          {DISCOUNT_GROUP_LABELS[grp]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Park Picker: shown ONLY when numDays === 1 and optionCode === 'base' */}
              {ticketNumDays === 1 && ticketOption === 'base' && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldSubheader}>Starting Park</Text>
                  <View style={styles.chipRow}>
                    {THEME_PARKS.map((tp) => {
                      const isSelected = ticketPark === tp.ticketPark;
                      return (
                        <Pressable
                          key={tp.ticketPark}
                          accessibilityRole="button"
                          accessibilityLabel={`Ticket park ${tp.label}`}
                          onPress={() => {
                            setTicketPark(isSelected ? undefined : tp.ticketPark);
                            setPark(isSelected ? null : tp.park);
                          }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: isSelected
                                ? palette.chipActiveBg
                                : palette.chipInactiveBg,
                              borderColor: isSelected ? palette.chipActiveBg : palette.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              {
                                color: isSelected
                                  ? palette.chipActiveText
                                  : palette.chipInactiveText,
                              },
                            ]}
                          >
                            {tp.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Fetch Quote button */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get ticket quote"
                onPress={handleFetchTicketQuote}
                disabled={isFetchingTicketQuote}
                style={[styles.actionBtn, isFetchingTicketQuote ? styles.actionBtnDisabled : null]}
              >
                {isFetchingTicketQuote ? (
                  <ActivityIndicator size="small" color={palette.chipActiveText} />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color={palette.chipActiveText} />
                )}
                <Text style={styles.actionBtnText}>
                  {isFetchingTicketQuote ? 'Fetching Quote...' : 'Get Ticket Quote'}
                </Text>
              </Pressable>

              {ticketQuoteStatusMessage && (
                <View style={styles.quoteResult}>
                  <View style={[styles.statusCallout, { backgroundColor: palette.subtleBg }]}>
                    <Ionicons name="information-circle-outline" size={18} color={palette.hintText} />
                    <Text style={[styles.quoteMessage, { color: palette.hintText }]}>
                      {ticketQuoteStatusMessage}
                    </Text>
                  </View>
                </View>
              )}

              {/* Quote Result Banner / Warnings */}
              {priceQuote && (
                <View style={styles.quoteResult}>
                  {priceQuote.flUnavailable ? (
                    <View style={[styles.statusCallout, { backgroundColor: palette.warningBg }]}>
                      <Ionicons
                        name="information-circle-outline"
                        size={18}
                        color={palette.warningText}
                      />
                      <Text
                        style={[styles.quoteMessage, { color: palette.warningText }]}
                        accessibilityLabel={`Florida resident price unavailable for ${ticketNumDays} days; enter your price`}
                      >
                        {`Florida resident price unavailable for ${ticketNumDays} days; enter your price`}
                      </Text>
                    </View>
                  ) : priceQuote.priceCents === null ? (
                    priceQuote.cacheState === 'warming' ? (
                      <View style={[styles.statusCallout, { backgroundColor: palette.subtleBg }]}>
                        <Ionicons name="time-outline" size={18} color={palette.hintText} />
                        <Text
                          style={[styles.quoteMessage, { color: palette.hintText }]}
                          accessibilityLabel="Prices are being fetched, try again in a minute"
                        >
                          Prices are being fetched, try again in a minute
                        </Text>
                      </View>
                    ) : priceQuote.cacheState === 'disabled' ? (
                      <View style={[styles.statusCallout, { backgroundColor: palette.warningBg }]}>
                        <Ionicons
                          name="alert-circle-outline"
                          size={18}
                          color={palette.errorText}
                        />
                        <Text
                          style={[styles.quoteMessage, { color: palette.errorText }]}
                          accessibilityLabel="Automatic ticket prices are unavailable right now; enter your price"
                        >
                          Automatic ticket prices are unavailable right now; enter your price
                        </Text>
                      </View>
                    ) : priceQuote.cacheState === 'failed' ? (
                      <View style={[styles.statusCallout, { backgroundColor: palette.warningBg }]}>
                        <Ionicons
                          name="alert-circle-outline"
                          size={18}
                          color={palette.errorText}
                        />
                        <Text
                          style={[styles.quoteMessage, { color: palette.errorText }]}
                          accessibilityLabel="Automatic ticket prices could not be fetched; enter your price"
                        >
                          Automatic ticket prices could not be fetched; enter your price
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.statusCallout, { backgroundColor: palette.subtleBg }]}>
                        <Text
                          style={[styles.quoteMessage, { color: palette.hintText }]}
                          accessibilityLabel="Add your price"
                        >
                          Add your price
                        </Text>
                      </View>
                    )
                  ) : (
                    <View style={styles.quoteSuccessCard}>
                      {priceQuote.parkAssumed && (
                        <View style={[styles.statusCallout, { backgroundColor: palette.warningBg }]}>
                          <Ionicons
                            name="information-circle-outline"
                            size={16}
                            color={palette.warningText}
                          />
                          <Text
                            style={[styles.quoteMessage, { color: palette.warningText }]}
                            accessibilityLabel="Estimate (highest park price)"
                          >
                            Estimate (highest park price)
                          </Text>
                        </View>
                      )}
                      <View style={styles.disneyQuoteCard}>
                        <View style={styles.disneyQuoteHeaderRow}>
                          <Text style={[styles.disneyQuoteTitle, { color: palette.hintText }]}>
                            Calculated Disney Quote:
                          </Text>
                          <View style={[styles.taxIncludedBadge, { backgroundColor: palette.quoteAppliedBg }]}>
                            <Ionicons name="checkmark-circle" size={13} color={palette.quoteAppliedText} />
                            <Text style={[styles.taxIncludedBadgeText, { color: palette.quoteAppliedText }]}>
                              Includes 6.5% FL Tax
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.disneyQuoteTotal}>
                          ${(((priceQuote.priceCents ?? 0) + (priceQuote.taxCents ?? Math.round((priceQuote.priceCents ?? 0) * 0.065))) / 100).toFixed(2)}
                        </Text>
                        <Text style={[styles.quoteSuccessText, { color: palette.quoteAppliedText }]}>
                          {multiQuoteBreakdown
                            ? `Official Disney quote applied: ${multiQuoteBreakdown}`
                            : `Official Disney quote applied: $${(priceQuote.priceCents / 100).toFixed(2)}`}
                        </Text>
                        <Text style={[styles.disneyDisclaimerText, { color: palette.hintText }]}>
                          Prices from Disney's website{priceQuote.asOf ? `, as of ${formatCalendarDateAsOf(priceQuote.asOf)}` : ''}; final price at checkout may differ.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Category: Lightning Lane Quote Picker */}
          {category === 'lightning_lane' && (
            <View style={styles.cardSection}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="flash-outline" size={18} color={palette.chipActiveBg} />
                <Text style={styles.cardTitle}>LIGHTNING LANE QUOTE CALCULATOR</Text>
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Pass Type</Text>
                <View style={styles.chipRow}>
                  {(['multi', 'single', 'premier'] as const).map((pt) => (
                    <Pressable
                      key={pt}
                      accessibilityRole="button"
                      accessibilityLabel={pt}
                      onPress={() => handleSelectLlPassType(pt)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            llPassType === pt ? palette.chipActiveBg : palette.chipInactiveBg,
                          borderColor: llPassType === pt ? palette.chipActiveBg : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              llPassType === pt
                                ? palette.chipActiveText
                                : palette.chipInactiveText,
                          },
                        ]}
                      >
                        {LL_PASS_TYPE_LABELS[pt]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Park</Text>
                <View style={styles.chipRow}>
                  {THEME_PARKS.map((tp) => (
                    <Pressable
                      key={tp.park}
                      accessibilityRole="button"
                      accessibilityLabel={`LL park ${tp.label}`}
                      onPress={() => handleSelectLlPark(tp.park)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            llPark === tp.park ? palette.chipActiveBg : palette.chipInactiveBg,
                          borderColor: llPark === tp.park ? palette.chipActiveBg : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              llPark === tp.park
                                ? palette.chipActiveText
                                : palette.chipInactiveText,
                          },
                        ]}
                      >
                        {tp.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Travelers / Quantity Stepper */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Quantity / Travelers</Text>
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease LL quantity"
                    onPress={() => handleUpdateLlQuantity(llQuantity - 1)}
                    style={styles.stepBtn}
                  >
                    <Ionicons name="remove" size={18} color={palette.stepperBtnText} />
                  </Pressable>
                  <Text style={styles.stepValue}>
                    {llQuantity} {llQuantity === 1 ? 'pass' : 'passes'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase LL quantity"
                    onPress={() => handleUpdateLlQuantity(llQuantity + 1)}
                    style={styles.stepBtn}
                  >
                    <Ionicons name="add" size={18} color={palette.stepperBtnText} />
                  </Pressable>
                </View>
              </View>

              {llPassType === 'single' && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Single Pass Attraction</Text>
                  <View style={[styles.chipRow, { marginBottom: 8 }]}>
                    {(SINGLE_PASS_ATTRACTIONS_BY_PARK[llPark] ?? []).map((attrName) => {
                      const isPicked = llAttraction === attrName;
                      return (
                        <Pressable
                          key={attrName}
                          accessibilityRole="button"
                          accessibilityLabel={`Single Pass ${attrName}`}
                          onPress={() => setLlAttraction(attrName)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: isPicked
                                ? palette.chipActiveBg
                                : palette.chipInactiveBg,
                              borderColor: isPicked ? palette.chipActiveBg : palette.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              {
                                color: isPicked
                                  ? palette.chipActiveText
                                  : palette.chipInactiveText,
                              },
                            ]}
                          >
                            {attrName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <TextInput
                    accessibilityLabel="Attraction name"
                    placeholder="e.g. TRON / Seven Dwarfs Mine Train"
                    placeholderTextColor={palette.hintText}
                    value={llAttraction}
                    onChangeText={setLlAttraction}
                    style={styles.input}
                  />
                </View>
              )}

              {/* Quick Estimate Tiers (Typical / Moderate / Peak or Standard / High Demand / Peak Holiday) */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Quick Price Estimate (per pass)</Text>
                <View style={styles.chipRow}>
                  {getLlEstimateTiers(llPassType, llPark, llAttraction).map((tier) => {
                    const isSelected = selectedLlTierCents === tier.cents;
                    return (
                      <Pressable
                        key={tier.tier}
                        accessibilityRole="button"
                        accessibilityLabel={`Estimate ${tier.tierName} $${tier.dollars}`}
                        onPress={() => handleSelectLlEstimateTier(tier.cents, tier.tierName)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected
                              ? palette.chipActiveBg
                              : palette.chipInactiveBg,
                            borderColor: isSelected ? palette.chipActiveBg : palette.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color: isSelected
                                ? palette.chipActiveText
                                : palette.chipInactiveText,
                            },
                          ]}
                        >
                          {tier.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get Lightning Lane quote"
                onPress={handleFetchLlQuote}
                disabled={isFetchingLlQuote}
                style={[styles.actionBtn, isFetchingLlQuote ? styles.actionBtnDisabled : null]}
              >
                {isFetchingLlQuote ? (
                  <ActivityIndicator size="small" color={palette.chipActiveText} />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color={palette.chipActiveText} />
                )}
                <Text style={styles.actionBtnText}>
                  {isFetchingLlQuote ? 'Fetching Quote...' : 'Get LL Quote'}
                </Text>
              </Pressable>

              {llQuoteStatusMessage && (
                <View style={styles.quoteResult}>
                  <View style={[styles.statusCallout, { backgroundColor: palette.subtleBg }]}>
                    <Ionicons name="information-circle-outline" size={18} color={palette.hintText} />
                    <Text style={[styles.quoteMessage, { color: palette.hintText }]}>
                      {llQuoteStatusMessage}
                    </Text>
                  </View>
                </View>
              )}

              {priceQuote && priceQuote.priceCents !== null && (
                <View style={styles.quoteResult}>
                  <View style={[styles.statusCallout, { backgroundColor: palette.quoteAppliedBg }]}>
                    <Ionicons name="checkmark-circle" size={18} color={palette.quoteAppliedText} />
                    <Text style={[styles.quoteSuccessText, { color: palette.quoteAppliedText }]}>
                      {llQuantity > 1
                        ? `Quote applied: ${llQuantity} × $${(priceQuote.priceCents / 100).toFixed(2)} = $${((priceQuote.priceCents * llQuantity) / 100).toFixed(2)}`
                        : `Quote applied: $${(priceQuote.priceCents / 100).toFixed(2)}`}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 2. LINE DESCRIPTION & DETAILS */}
          <View style={styles.cardSection}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <Ionicons name="create-outline" size={18} color={palette.chipActiveBg} />
                <Text style={styles.stepTitle}>2. LINE DESCRIPTION & DETAILS</Text>
              </View>
            </View>

            <TextInput
              accessibilityLabel="Description"
              placeholder={
                category === 'tickets'
                  ? smartTicketDescription
                  : "e.g. 4-day Disney Tickets, Dinner at 'Ohana"
              }
              placeholderTextColor={palette.hintText}
              value={description}
              onChangeText={setDescription}
              style={styles.input}
            />

            {/* Paired 2-Column: Subtotal ($) and Planned Day */}
            <View style={styles.pairedTwoColRow}>
              {/* Left Column: Subtotal */}
              <View style={styles.pairedColLeft}>
                <Text style={styles.fieldLabel}>SUBTOTAL ($)</Text>
                <View style={styles.subtotalInputBox}>
                  <Text style={styles.currencyPrefix}>$</Text>
                  <TextInput
                    accessibilityLabel="Manual price"
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={palette.hintText}
                    value={manualPriceText}
                    onChangeText={handleManualPriceChange}
                    style={styles.subtotalInput}
                  />
                </View>
                {/* Price badge reflecting current source */}
                <View style={styles.badgeWrapInline}>
                  <PriceBadge
                    priceLabelKind={priceLabelKind}
                    effectivePriceSource={priceSource}
                    asOfDate={priceQuote?.asOf ?? (initialLine?.asOf || null)}
                    attribution={category === 'lightning_lane' ? 'themeparks_wiki' : 'none'}
                    showAttribution={category === 'lightning_lane'}
                  />
                </View>
              </View>

              {/* Right Column: Planned Day */}
              <View style={styles.pairedColRight}>
                <Text style={styles.fieldLabel}>PLANNED DAY</Text>
                <DatePickerField
                  value={plannedDate ?? ''}
                  onChange={(val) => setPlannedDate(val)}
                  initialMonth={tripStart ?? undefined}
                  placeholder={
                    category === 'tickets'
                      ? 'Whole Trip ⌄'
                      : tripStart
                        ? `Trip starts ${formatMonthDay(tripStart)}`
                        : 'Select day'
                  }
                  accessibilityLabel="Select Date"
                  testID="budget-line-date-picker"
                />
              </View>
            </View>

            {/* Trip Day Quick Chips */}
            {(tripDays.length > 0 || category === 'tickets') && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.dayChipsScroll}
                contentContainerStyle={styles.dayChipsContainer}
              >
                {category === 'tickets' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select Whole Trip"
                    onPress={() => setPlannedDate(null)}
                    style={[
                      styles.dayChip,
                      {
                        backgroundColor: !plannedDate
                          ? palette.chipActiveBg
                          : palette.chipInactiveBg,
                        borderColor: !plannedDate ? palette.chipActiveBg : palette.border,
                      },
                    ]}
                    accessibilityState={{ selected: !plannedDate }}
                    testID="trip-day-chip-whole-trip"
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={12}
                      color={!plannedDate ? palette.chipActiveText : palette.chipInactiveText}
                    />
                    <Text
                      style={[
                        styles.dayChipText,
                        {
                          color: !plannedDate ? palette.chipActiveText : palette.chipInactiveText,
                          fontWeight: !plannedDate ? '700' : '600',
                        },
                      ]}
                    >
                      Whole Trip
                    </Text>
                  </Pressable>
                )}
                {tripDays.map((d) => {
                  const isSelected = plannedDate === d.date;
                  return (
                    <Pressable
                      key={d.date}
                      onPress={() => setPlannedDate(d.date)}
                      style={[
                        styles.dayChip,
                        {
                          backgroundColor: isSelected
                            ? palette.chipActiveBg
                            : palette.chipInactiveBg,
                          borderColor: isSelected ? palette.chipActiveBg : palette.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${d.shortLabel}`}
                      accessibilityState={{ selected: isSelected }}
                      testID={`trip-day-chip-${d.date}`}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={12}
                        color={isSelected ? palette.chipActiveText : palette.chipInactiveText}
                      />
                      <Text
                        style={[
                          styles.dayChipText,
                          {
                            color: isSelected ? palette.chipActiveText : palette.chipInactiveText,
                          },
                        ]}
                      >
                        {d.shortLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}



            {/* Live Subtotal + Tax + Tip = Total Preview */}
            {liveBreakdown.subtotalCents > 0 && (
              <View
                style={[
                  styles.liveBreakdownBanner,
                  {
                    backgroundColor: palette.subtleBg,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text style={[styles.liveBreakdownText, { color: palette.hintText }]}>
                  Subtotal {formatDollars(liveBreakdown.subtotalCents)} + Tax{' '}
                  {formatDollars(liveBreakdown.taxCents)}
                  {liveBreakdown.tipCents > 0
                    ? ` + Tip ${formatDollars(liveBreakdown.tipCents)}`
                    : ''}{' '}
                  ={' '}
                </Text>
                <Text style={styles.liveBreakdownTotal}>
                  Est. Total {formatDollars(liveBreakdown.totalCents)}
                </Text>
              </View>
            )}
          </View>

          {/* 3. SPLIT COSTS AMONG */}
          <View style={styles.cardSection}>
            <View style={styles.splitSectionHeaderRow}>
              <View>
                <Text style={styles.stepTitle}>3. SPLIT COSTS AMONG</Text>
                <Text style={[styles.stepSubtitle, { color: palette.hintText }]}>
                  Tap any traveler to include/exclude
                </Text>
              </View>

              {/* Split Presets Row */}
              <View style={styles.splitPresetsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Smart rate match for adults and kids"
                  onPress={handleSmartProfileMatch}
                  style={[styles.splitBtn, { backgroundColor: palette.accentPink }]}
                >
                  <Ionicons name="sparkles" size={12} color={palette.chipActiveText} />
                  <Text style={styles.splitBtnText}>Smart Rates</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Split among everyone"
                  onPress={handleSplitEveryone}
                  style={styles.splitBtn}
                >
                  <Ionicons name="swap-horizontal" size={12} color={palette.chipActiveText} />
                  <Text style={styles.splitBtnText}>Split Evenly</Text>
                </Pressable>
                {allTravelers.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Exclude me so others split"
                    onPress={handleExcludeMe}
                    style={[styles.splitBtn, { backgroundColor: palette.accentPink }]}
                  >
                    <Ionicons name="people" size={12} color={palette.chipActiveText} />
                    <Text style={styles.splitBtnText}>Exclude Me</Text>
                  </Pressable>
                )}
                {allTravelers.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="I pay all 100%"
                    onPress={handleOnlyMe}
                    style={styles.splitBtn}
                  >
                    <Ionicons name="person-outline" size={12} color={palette.chipActiveText} />
                    <Text style={styles.splitBtnText}>Only Me</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Sync party to ticket counts helper */}
            {category === 'tickets' &&
              ticketAdultCount + ticketChildCount > allTravelers.length && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sync party to ticket quantities"
                  onPress={handleSyncPartyToTickets}
                  style={styles.syncPartyTicketsBanner}
                >
                  <Ionicons name="sparkles" size={15} color={palette.accentPink} />
                  <Text style={[styles.syncPartyTicketsText, { color: palette.accentPink }]}>
                    {`Add missing party members to match ${ticketAdultCount} Adults & ${ticketChildCount} Children`}
                  </Text>
                </Pressable>
              )}

            {/* 2-Column Grid for Traveler Cards */}
            <View style={styles.travelerGrid}>
              {allTravelers.map((traveler, idx) => {
                const itemKey = traveler.id
                  ? `${traveler.isGuest ? 'guest' : 'member'}-${traveler.id}`
                  : `traveler-${idx}`;
                const isSelected = selectedTravelerIds.includes(traveler.id);
                const currentCents = allocationAmounts[traveler.id] ?? 0;
                const totalCents = parseDollarInputToCents(manualPriceText) || 0;
                const pct = totalCents > 0 ? Math.round((currentCents / totalCents) * 100) : 0;
                const isChild =
                  traveler.ageBracket === 'child' ||
                  traveler.name.toLowerCase().includes('kid') ||
                  traveler.name.toLowerCase().includes('child');
                const ageLabel = isChild ? 'Child (3–9)' : 'Adult (10+)';

                return (
                  <Pressable
                    key={itemKey}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={`Include ${traveler.name} in split`}
                    onPress={() => handleToggleTravelerChip(traveler.id)}
                    style={[
                      styles.travelerCard,
                      {
                        backgroundColor: palette.cardBg,
                        borderColor: isSelected
                          ? palette.rowCardActiveBorder
                          : palette.rowCardBorder,
                      },
                    ]}
                  >
                    {/* Row 1: Left has Checkbox + Name + Badges; Right has Dollar Input / Amount */}
                    <View style={styles.travelerCardRow1}>
                      <View style={styles.travelerCardNameWrap}>
                        <Ionicons
                          name={isSelected ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={isSelected ? palette.chipActiveBg : palette.hintText}
                        />
                        <Text
                          style={[
                            styles.travelerCardName,
                            !isSelected && { color: palette.hintText },
                          ]}
                          numberOfLines={1}
                        >
                          {traveler.name}
                        </Text>
                        {idx === 0 && (
                          <View style={styles.youBadge}>
                            <Text style={styles.youBadgeText}>You</Text>
                          </View>
                        )}
                        {traveler.isGuest && (
                          <View style={styles.guestBadge}>
                            <Text style={styles.guestBadgeText}>Guest</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.allocInputWrap}>
                        <Text style={styles.allocCurrencyPrefix}>$</Text>
                        <TextInput
                          accessibilityLabel={`Allocation for ${traveler.name}`}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={palette.hintText}
                          value={currentCents > 0 ? (currentCents / 100).toFixed(2) : '0.00'}
                          editable={isSelected}
                          onChangeText={(t) => {
                            const cents = parseDollarInputToCents(t) ?? 0;
                            setAllocationAmounts((prev) => ({ ...prev, [traveler.id]: cents }));
                          }}
                          style={[
                            styles.allocInput,
                            !isSelected && { opacity: 0.5, backgroundColor: 'transparent' },
                          ]}
                        />
                      </View>
                    </View>

                    {/* Row 2: Left has Subtitle (Adult/Child); Right has Active Split / Excluded status badge */}
                    <View style={styles.travelerCardRow2}>
                      <Text style={[styles.travelerCardSub, { color: palette.hintText }]}>
                        {ageLabel}
                      </Text>
                      <View
                        style={[
                          styles.splitStatusBadge,
                          {
                            backgroundColor: isSelected
                              ? palette.activePillBg
                              : palette.excludedPillBg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.splitStatusBadgeText,
                            {
                              color: isSelected
                                ? palette.activePillText
                                : palette.excludedPillText,
                            },
                          ]}
                        >
                          {isSelected ? `Active Split (${pct}%)` : 'Excluded from Split'}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Add Party Member / Guest Action Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add party member"
              onPress={() => setShowAddGuestInput(!showAddGuestInput)}
              style={[
                styles.addPartyMemberBtn,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.subtleBg,
                },
              ]}
            >
              <Ionicons name="person-add-outline" size={15} color={palette.tagText} />
              <Text style={[styles.addPartyMemberText, { color: palette.tagText }]}>
                + Add Party Member / Guest
              </Text>
            </Pressable>

            {/* Inline Add Guest Form */}
            {showAddGuestInput && (
              <View style={styles.addGuestFormBox}>
                <TextInput
                  accessibilityLabel="Guest name"
                  placeholder="e.g. Wife, Kid (Age 7), Alex"
                  placeholderTextColor={palette.hintText}
                  value={newGuestName}
                  onChangeText={setNewGuestName}
                  style={styles.input}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add as Adult"
                    onPress={() => handleAddGuest(newGuestName || 'Adult Guest', 'adult')}
                    style={styles.addGuestConfirmBtn}
                  >
                    <Text style={styles.addGuestConfirmBtnText}>+ Adult</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add as Child"
                    onPress={() => handleAddGuest(newGuestName || 'Kid (Age 7)', 'child')}
                    style={styles.addGuestConfirmBtn}
                  >
                    <Text style={styles.addGuestConfirmBtnText}>+ Child</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel add guest"
                    onPress={() => {
                      setNewGuestName('');
                      setShowAddGuestInput(false);
                    }}
                    style={styles.addGuestCancelBtn}
                  >
                    <Text style={styles.addGuestCancelBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Allocation Coverage Verification */}
            {liveBreakdown.subtotalCents > 0 && (
              <View
                style={[
                  styles.allocCoverageBanner,
                  {
                    backgroundColor: palette.subtleBg,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text style={[styles.allocCoverageText, { color: palette.hintText }]}>
                  {(() => {
                    const allocatedSum = Object.values(allocationAmounts).reduce(
                      (sum, c) => sum + c,
                      0
                    );
                    const diff = liveBreakdown.subtotalCents - allocatedSum;
                    if (Math.abs(diff) <= 1) {
                      return `✓ 100% Covered (${formatDollars(allocatedSum)})`;
                    }
                    if (diff > 0) {
                      return `Unallocated: ${formatDollars(diff)}`;
                    }
                    return `Overallocated: ${formatDollars(Math.abs(diff))}`;
                  })()}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Sticky Bottom Action Button */}
        <View style={styles.bottomFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save line"
            disabled={isSaving}
            onPress={handleSave}
            style={[
              styles.saveStickyBtn,
              { backgroundColor: palette.stickyBtnBg },
              isSaving && { opacity: 0.6 },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={palette.stickyBtnText} />
            ) : (
              <View style={styles.saveStickyContent}>
                <Ionicons name="sparkles" size={17} color={palette.stickyBtnText} />
                <Text style={[styles.saveStickyBtnText, { color: palette.stickyBtnText }]}>
                  Save Line to Trip Budget
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Nested Menu Item Picker Modal for dining */}
        {menuPickerVisible && (
          <MenuItemPicker
            visible={menuPickerVisible}
            menus={availableMenus}
            onConfirm={handleMenuConfirm}
            onCancel={() => setMenuPickerVisible(false)}
          />
        )}

        {/* Resort Picker Modal for lodging */}
        <ResortPickerModal
          visible={showResortPicker}
          nested
          selectedResortId={resortId}
          onSelect={(resort: ResortItem) => {
            setResortId(resort.id);
            setResortName(resort.name);
            if (!description.trim() || description === 'New Item') {
              setDescription(resort.name);
            }
            setShowResortPicker(false);
          }}
          onClose={() => setShowResortPicker(false)}
        />

        {/* Experience Picker Overlay for dining */}
        {showExpPicker ? (
          <View style={styles.pickerOverlayWrapper}>
            <View style={[styles.container, { backgroundColor: palette.pickerModalBg }]}>
              <View style={styles.modalSubHeader}>
                <Text style={styles.title}>Select Restaurant</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close restaurant picker"
                  onPress={() => setShowExpPicker(false)}
                  style={styles.cancelBtn}
                >
                  <Ionicons name="close" size={24} color={palette.hintText} />
                </Pressable>
              </View>
              <ExperiencePicker
                enabled={showExpPicker}
                defaultTab="dining"
                showTabs={false}
                fillContainer={true}
                testIDPrefix="budget-dining"
                onSelect={(exp: ExperienceDTO) => {
                  setExperienceId(exp.id);
                  setExperienceName(exp.name);
                  setInlineBuffetQuantities({});
                  if (!description.trim() || description === 'New Item') {
                    setDescription(exp.name);
                  }
                  if (exp.park && THEME_PARKS.some((p) => p.park === exp.park)) {
                    setPark(exp.park as Park);
                  }
                  setShowExpPicker(false);
                }}
              />
            </View>
          </View>
        ) : null}

      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  pickerOverlayWrapper: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
  },
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  closeText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stepSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  categoryCard: {
    width: '31.3%',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  categoryCardText: {
    fontSize: 12,
    textAlign: 'center',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  apiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.pill,
  },
  apiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  estimationTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  estTabBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  estTabBtnActive: {
    borderWidth: 1.5,
  },
  estTabText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  buffetSteppersContainer: {
    marginTop: 8,
  },
  buffetSteppersRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buffetStepperCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  buffetStepperInfo: {
    flex: 1,
    marginRight: 4,
  },
  buffetStepperTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  buffetStepperRate: {
    fontSize: 11,
    marginTop: 2,
  },
  stepperInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  diningTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 6,
  },
  tipCentsDisplay: {
    fontSize: 14,
    fontWeight: '700',
  },
  menuAvgOptionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  pairedTwoColRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  pairedColLeft: {
    flex: 1,
  },
  pairedColRight: {
    flex: 1,
  },
  subtotalInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  subtotalInput: {
    fontSize: 20,
    fontWeight: '700',
    color: t.color.textPrimary,
    flex: 1,
    paddingVertical: 2,
  },

  splitSectionHeaderRow: {
    flexDirection: 'column',
    gap: 8,
    marginBottom: 10,
  },
  travelerGrid: {
    flexDirection: 'column',
    gap: 8,
  },
  travelerCard: {
    width: '100%',
    padding: 10,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    justifyContent: 'space-between',
    gap: 6,
  },
  travelerCardRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  travelerCardNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  travelerCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  travelerCardRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  travelerCardSub: {
    fontSize: 12,
    fontWeight: '500',
  },
  youBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: t.color.surfaceAlt,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.color.primary,
  },
  splitStatusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: t.radius.pill,
  },
  splitStatusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  bottomFooter: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: 10,
    paddingBottom: 24,
    backgroundColor: t.color.surface,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  saveStickyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: t.radius.pill,
    ...t.shadow.floating,
  },
  saveStickyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveStickyBtnText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  modalSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 15,
    color: t.color.textSecondary,
  },
  saveBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    backgroundColor: t.color.primary,
    borderRadius: t.radius.md,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.xl,
  },
  section: {
    marginTop: t.spacing.lg,
  },
  cardSection: {
    marginTop: t.spacing.lg,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: t.spacing.sm,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textSecondary,
    marginBottom: t.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleNoMargin: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.spacing.sm,
  },
  activeCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: t.radius.pill,
  },
  activeCategoryPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  categoryScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  dayChipsScroll: {
    marginBottom: t.spacing.sm,
  },
  dayChipsContainer: {
    gap: 8,
    paddingVertical: 2,
    paddingRight: 16,
  },
  dayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  modeToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  nightlyCalcRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  offPropertyHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  menuEstimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  menuEstimateTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  menuEstimateSub: {
    fontSize: 12,
    marginTop: 2,
  },
  menuEstimateApply: {
    fontSize: 13,
    fontWeight: '700',
  },
  inlineBuffetBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    gap: 8,
  },
  inlineBuffetHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  inlineBuffetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  inlineBuffetLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  inlineBuffetPrice: {
    fontSize: 12,
  },
  cardTitleGold: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardHeaderRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  officialPricingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.pill,
  },
  officialPricingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  ticketDurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: t.radius.md,
    marginTop: 6,
    marginBottom: 10,
  },
  ticketDurationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperPillBtn: {
    width: 28,
    height: 28,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperPillValue: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
    minWidth: 50,
    textAlign: 'center',
  },
  fieldSubheader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    color: t.color.textSecondary,
  },
  ticketQtyGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  ticketQtyCard: {
    flex: 1,
    padding: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  ticketQtyCardMockup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
  },
  ticketQtyInfo: {
    flex: 1,
    minWidth: 0,
    marginRight: 4,
  },
  ticketDailyRate: {
    fontSize: 11,
    marginTop: 2,
  },
  ticketQtyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  ticketTypeGrid2x2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ticketTypeGridBtn: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
  },
  ticketTypeGridIcon: {
    fontSize: 14,
  },
  ticketTypeGridText: {
    fontSize: 12,
  },
  pricingTierRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pricingTierBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pricingTierBtnText: {
    fontSize: 12,
    textAlign: 'center',
  },
  disneyQuoteCard: {
    padding: 12,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
    marginTop: 10,
    gap: 4,
  },
  disneyQuoteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disneyQuoteTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  taxIncludedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.pill,
  },
  taxIncludedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  disneyQuoteTotal: {
    fontSize: 24,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  disneyDisclaimerText: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  stepBtnSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
  },
  stepValueSmall: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
    minWidth: 18,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  parkRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: t.color.surface,
    color: t.color.textPrimary,
  },
  linkVenueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  linkVenueBtnText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  linkedVenueBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  linkedVenueInfo: {
    flex: 1,
    marginRight: 8,
  },
  linkedVenueName: {
    fontSize: 15,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  linkedVenueSubtitle: {
    fontSize: 12,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  changeVenueBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  changeVenueBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primary,
  },
  diningOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: t.spacing.md,
    paddingTop: t.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.color.border,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  checkboxLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  menuPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  menuPickerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.primary,
  },
  fieldRow: {
    marginBottom: t.spacing.md,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textSecondary,
    marginBottom: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
  },
  stepValue: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
    minWidth: 60,
    textAlign: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.color.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: t.radius.md,
    marginTop: 4,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  quoteResult: {
    marginTop: 12,
    gap: 8,
  },
  statusCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: t.radius.sm,
  },
  quoteMessage: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    flex: 1,
  },
  quoteSuccessCard: {
    gap: 6,
  },
  quoteSuccessText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  priceInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flex: 1,
    maxWidth: 220,
  },
  currencyPrefix: {
    fontSize: 22,
    fontWeight: '700',
    color: t.color.textSecondary,
    marginRight: 6,
  },
  priceInput: {
    fontSize: 22,
    fontWeight: '700',
    color: t.color.textPrimary,
    flex: 1,
    paddingVertical: 4,
  },
  badgeWrapInline: {
    alignItems: 'flex-start',
    marginTop: 6,
  },
  liveBreakdownBanner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  liveBreakdownText: {
    fontSize: 12,
    fontWeight: '500',
  },
  liveBreakdownTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  badgeWrap: {
    marginTop: 8,
  },
  allocHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.spacing.sm,
  },
  allocHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  allocCoverageSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  splitPresetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
    marginBottom: 12,
  },
  splitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: t.color.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.pill,
  },
  splitBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  addPartyMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addPartyMemberText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addGuestFormBox: {
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.sm,
    padding: t.spacing.sm,
    marginBottom: 10,
  },
  addGuestConfirmBtn: {
    backgroundColor: t.color.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.sm,
  },
  addGuestConfirmBtnText: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  addGuestCancelBtn: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.sm,
  },
  addGuestCancelBtnText: {
    color: t.color.textSecondary,
    fontWeight: '600',
    fontSize: 12,
  },
  syncPartyTicketsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    marginBottom: 10,
  },
  syncPartyTicketsText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  allocCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  allocSubText: {
    fontSize: 11,
    marginTop: 2,
  },
  allocCoverageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  allocCoverageText: {
    fontSize: 12,
    fontWeight: '600',
  },
  allocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.color.border,
  },
  travelerNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allocName: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  guestBadge: {
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  guestBadgeText: {
    fontSize: 10,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  allocInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  allocCurrencyPrefix: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  allocInput: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 14,
    fontWeight: '600',
    width: 76,
    textAlign: 'right',
    backgroundColor: t.color.surfaceAlt,
    color: t.color.textPrimary,
  },
}));
