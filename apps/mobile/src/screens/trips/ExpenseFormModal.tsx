/**
 * Add / Edit Expense Modal (Tasks 10.3, 10.4, 10.5, 10.6, 11.1, 15.1).
 *
 * Implements all four Split_Modes: exact, even, tiered, and itemized.
 * Handles Split_Mode change reset (Req 8.3), catalog restaurant/resort linking (Req 11.1–11.3),
 * live share previews, and itemized derived totals (Req 5.14).
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.6, 4.1, 4.2, 4.3, 4.6,
 * 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.13, 5.14, 8.1, 8.2, 8.3,
 * 11.1, 11.2, 11.3, 11.8, 14.1, 14.2, 14.4
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SPLIT_MODES,
  CHARGE_LINE_KINDS,
  uuidSchema,
  type ExpenseCategory,
  type ExpenseSplitMode,
  type ChargeLineKind,
  type ExpenseDTO,
  type ExpenseCreateInput,
  type TripGuestDTO,
  type TripMemberDTO,
  type ExperienceDTO,
  type MenuDTO,
} from '@dwt/shared';

import { withAlpha, type AppTheme } from '../../theme/theme';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { themedSwitchProps } from '../../theme/switchColors';
import { AVATAR_FILL, FORM, FORM_SWITCH } from './ExpenseFormModal.palette';
import { DatePickerField } from '../../components/DatePickerField';
import { apiRequest } from '../../api/client';
import {
  createExpense,
  editExpense,
  fetchTripGuests,
  tripExpenseKeys,
} from './tripExpenseApi';
import { TripGuestManagementModal } from './TripGuestManagementModal';
import { ledgerSaveErrorMessage } from './tripPartyDeleted';
import { ExperiencePicker } from './ExperiencePicker';
import { ResortPickerModal, type ResortItem } from './ResortPickerModal';
import { ReceiptReviewModal } from './ReceiptReviewModal';
import { extractTierPriceSuggestions, SAMPLE_DISNEY_RECEIPT } from './receiptScan.pure';
import { scanReceiptPhoto, type ReceiptImageSource } from './receiptScan.native';

interface Props {
  readonly visible: boolean;
  readonly tripId: string;
  readonly initialExpense?: ExpenseDTO | null | undefined;
  readonly members: readonly TripMemberDTO[];
  readonly guests: readonly TripGuestDTO[];
  readonly callerId: string;
  readonly onClose: () => void;
  readonly onOpenManageGuests?: (() => void) | undefined;
  readonly onOpenReceiptScan?: ((onParsed: (items: any[], chargeLines: any[]) => void) => void) | undefined;
}

interface DraftTier {
  id?: string | undefined;
  name: string;
  priceCents: number;
}

interface DraftItem {
  id?: string | undefined;
  name: string;
  priceCents: number;
  isAlcohol: boolean;
  assigneeIds: string[];
}

interface DraftChargeLine {
  id?: string | undefined;
  kind: ChargeLineKind;
  amountCents: number;
  excludeAlcohol?: boolean | undefined;
  scopeItemIds?: string[] | undefined;
}

function isValidUuid(val: string | undefined | null): val is string {
  return typeof val === 'string' && uuidSchema.safeParse(val).success;
}

function getAvatarColor(name: string, t: Pick<AppTheme, 'scheme'>): string {
  const avatarPal = AVATAR_FILL[t.scheme];
  const AVATAR_PALETTE = [avatarPal.violet, avatarPal.blue, avatarPal.green, avatarPal.orange, avatarPal.red, avatarPal.pink, avatarPal.teal, avatarPal.indigo];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

export function ExpenseFormModal({
  visible,
  tripId,
  initialExpense,
  members,
  guests: initialGuestsProp,
  callerId,
  onClose,
  onOpenManageGuests,
  onOpenReceiptScan,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(FORM);
  const switchPal = usePalette(FORM_SWITCH);
  const queryClient = useQueryClient();

  const guestsQuery = useQuery<readonly TripGuestDTO[]>({
    queryKey: tripExpenseKeys.guests(tripId),
    queryFn: () => fetchTripGuests(tripId),
    initialData: initialGuestsProp,
  });
  const guests = guestsQuery.data ?? initialGuestsProp ?? [];

  const [showManageGuestsModal, setShowManageGuestsModal] = useState(false);

  const isEditing = Boolean(initialExpense);

  // Form Fields
  const [payerId, setPayerId] = useState(initialExpense?.payerId ?? callerId);
  const [description, setDescription] = useState(initialExpense?.description ?? '');
  const [date, setDate] = useState(initialExpense?.date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory>(initialExpense?.category ?? 'dining');
  const [splitMode, setSplitMode] = useState<ExpenseSplitMode>(initialExpense?.splitMode ?? 'even');
  const [experienceId, setExperienceId] = useState<string | null>(initialExpense?.experienceId ?? null);
  const [experienceName, setExperienceName] = useState<string | null>(null);
  const [resortId, setResortId] = useState<string | null>(initialExpense?.resortId ?? null);
  const [resortName, setResortName] = useState<string | null>(null);

  // Picker Modals
  const [showExpPicker, setShowExpPicker] = useState(false);
  const [showResortPicker, setShowResortPicker] = useState(false);

  // Split Mode: exact
  const [manualAmountDollars, setManualAmountDollars] = useState(
    initialExpense?.amountCents ? (initialExpense.amountCents / 100).toFixed(2) : '',
  );
  const [exactShares, setExactShares] = useState<Record<string, string>>({}); // recipientId -> dollars

  // Split Mode: even
  const [evenParticipants, setEvenParticipants] = useState<string[]>([]);

  // Split Mode: tiered
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [tierCounts, setTierCounts] = useState<Record<string, Record<string, number>>>({}); // tierIdx -> recipientId -> count
  const [tierViewMode, setTierViewMode] = useState<'matrix' | 'cards'>('matrix');
  const [userOverrodeTierAmount, setUserOverrodeTierAmount] = useState(false);

  // Tiered split Tax & Tip helper state (Req 4 / Mockup spec)
  const [showTierTaxTipHelper, setShowTierTaxTipHelper] = useState(false);
  const [tierTaxMode, setTierTaxMode] = useState<'dollar' | 'total' | 'pct'>('dollar');
  const [tierTaxDollar, setTierTaxDollar] = useState('');
  const [tierTaxTotal, setTierTaxTotal] = useState('');
  const [tierTaxPct, setTierTaxPct] = useState('6.5');
  const [tierTipMode, setTierTipMode] = useState<'pct' | 'dollar'>('pct');
  const [tierTipPct, setTierTipPct] = useState('18');
  const [tierTipDollar, setTierTipDollar] = useState('');
  const [tierTaxAppliedNotice, setTierTaxAppliedNotice] = useState(false);

  // Split Mode: itemized
  const [items, setItems] = useState<DraftItem[]>([]);
  const [chargeLines, setChargeLines] = useState<DraftChargeLine[]>([]);

  // Receipt Scan review state (Req 9.3, 9.4)
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [scannedRawText, setScannedRawText] = useState<string>('');
  const [showTierSuggestions, setShowTierSuggestions] = useState(true);

  // Restaurant Menu Query for linked dining experience (Req 9.9, 11.4)
  const { data: expDetail } = useQuery<{ menus?: readonly MenuDTO[] }>({
    queryKey: ['experience', experienceId] as const,
    queryFn: () => apiRequest<any>('GET', `/catalog/${experienceId}`),
    enabled: Boolean(experienceId && category === 'dining'),
    staleTime: 5 * 60 * 1000,
  });

  const restaurantMenuNames = useMemo(() => {
    if (!expDetail?.menus) return [];
    const names: string[] = [];
    for (const m of expDetail.menus) {
      for (const g of m.groups ?? []) {
        for (const it of g.items ?? []) {
          if (it.name) names.push(it.name);
        }
      }
    }
    return names;
  }, [expDetail?.menus]);

  const suggestedTiers = useMemo(() => {
    return extractTierPriceSuggestions(expDetail?.menus);
  }, [expDetail?.menus]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Participant list combining members and guests
  const allParticipants = useMemo(() => {
    const list: { id: string; name: string; isGuest: boolean; sponsorName?: string }[] = [];
    const memberNameMap = new Map(members.map((m) => [m.userId, m.displayName]));

    for (const m of members) {
      list.push({ id: m.userId, name: m.displayName, isGuest: false });
    }
    for (const g of guests) {
      const sponsor = memberNameMap.get(g.sponsorMemberId) ?? 'Member';
      list.push({
        id: g.id,
        name: `${sponsor} — ${g.name}`,
        isGuest: true,
        sponsorName: sponsor,
      });
    }
    return list;
  }, [members, guests]);

  // Track whether initial form values have been seeded for the active modal session
  const initializedExpenseKeyRef = React.useRef<string | null>(null);

  // Seed form when initialExpense changes or on open
  useEffect(() => {
    if (!visible) {
      initializedExpenseKeyRef.current = null;
      return;
    }

    const currentKey = initialExpense ? initialExpense.id : '__new__';
    if (initializedExpenseKeyRef.current === currentKey) {
      return;
    }
    initializedExpenseKeyRef.current = currentKey;

    if (initialExpense) {
      setPayerId(initialExpense.payerId);
      setDescription(initialExpense.description);
      setDate(initialExpense.date);
      setCategory(initialExpense.category ?? 'dining');
      setSplitMode(initialExpense.splitMode);
      setExperienceId(initialExpense.experienceId);
      setResortId(initialExpense.resortId);
      setManualAmountDollars(
        initialExpense.splitMode !== 'itemized'
          ? (initialExpense.amountCents / 100).toFixed(2)
          : '',
      );

      if (initialExpense.splitMode === 'exact') {
        const sharesMap: Record<string, string> = {};
        for (const s of initialExpense.shares) {
          const recId = s.memberId ?? s.guestId;
          if (recId) sharesMap[recId] = (s.amountCents / 100).toFixed(2);
        }
        setExactShares(sharesMap);
      } else if (initialExpense.splitMode === 'even') {
        const participantIds = [
          initialExpense.payerId,
          ...initialExpense.shares.map((s) => (s.memberId ?? s.guestId)!),
        ].filter(Boolean);
        setEvenParticipants(Array.from(new Set(participantIds)));
      } else if (initialExpense.splitMode === 'tiered') {
        const loadedTiers = initialExpense.tiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceCents: t.priceCents,
        }));
        setTiers(loadedTiers);
        if (initialExpense.tierCounts && initialExpense.tierCounts.length > 0) {
          const countsMap: Record<string, Record<string, number>> = {};
          for (const tc of initialExpense.tierCounts) {
            const tIdx = loadedTiers.findIndex((t) => t.id === tc.tierId || t.name === tc.tierId);
            if (tIdx >= 0) {
              const recId = tc.memberId ?? tc.guestId;
              if (recId) {
                if (!countsMap[String(tIdx)]) countsMap[String(tIdx)] = {};
                countsMap[String(tIdx)]![recId] = tc.count;
              }
            }
          }
          setTierCounts(countsMap);
        }
      } else if (initialExpense.splitMode === 'itemized') {
        setItems(
          initialExpense.items.map((it) => ({
            id: it.id,
            name: it.name,
            priceCents: it.priceCents,
            isAlcohol: it.isAlcohol,
            assigneeIds: [...it.assigneeIds],
          })),
        );
        setChargeLines(
          initialExpense.chargeLines.map((cl) => ({
            id: cl.id,
            kind: cl.kind,
            amountCents: cl.amountCents,
            excludeAlcohol: cl.excludeAlcohol,
            scopeItemIds: cl.scopeItemIds ? [...cl.scopeItemIds] : undefined,
          })),
        );
      }
    } else {
      // Defaults for new expense
      setPayerId(callerId);
      setDescription('');
      setDate(new Date().toISOString().slice(0, 10));
      setCategory('dining');
      setSplitMode('even');
      setExperienceId(null);
      setExperienceName(null);
      setResortId(null);
      setResortName(null);
      setManualAmountDollars('');
      setExactShares({});
      setEvenParticipants(allParticipants.map((p) => p.id));
      setTiers([
        { name: 'Adult', priceCents: 5000 },
        { name: 'Child', priceCents: 3000 },
      ]);
      setTierCounts({});
      setItems([]);
      setChargeLines([]);
      setErrorMessage(null);
    }
  }, [visible, initialExpense, callerId]);

  // Keep track of participant IDs so new guests can be automatically included in even split
  const prevParticipantIdsRef = React.useRef<string[]>([]);
  useEffect(() => {
    if (!visible) {
      prevParticipantIdsRef.current = [];
      return;
    }
    const currentIds = allParticipants.map((p) => p.id);
    const prevIds = prevParticipantIdsRef.current;
    if (prevIds.length > 0) {
      const addedIds = currentIds.filter((id) => !prevIds.includes(id));
      if (addedIds.length > 0) {
        setEvenParticipants((prev) => [...prev, ...addedIds]);
      }
    }
    prevParticipantIdsRef.current = currentIds;
  }, [visible, allParticipants]);

  // Handle Split_Mode Change UX (Req 8.3 / Task 10.6):
  // When switching splitMode in edit mode, clear previously-entered fields
  const handleSplitModeChange = (newMode: ExpenseSplitMode) => {
    if (newMode === splitMode) return;
    setSplitMode(newMode);
    setUserOverrodeTierAmount(false);
    setErrorMessage(null);
    // Clear mode-specific fields
    setExactShares({});
    setEvenParticipants(allParticipants.map((p) => p.id));
    setTiers(
      newMode === 'tiered'
        ? [
            { name: 'Adult', priceCents: 5000 },
            { name: 'Child', priceCents: 3000 },
          ]
        : [],
    );
    setTierCounts({});
    setItems([]);
    setChargeLines([]);
  };

  // Launch receipt scan (Req 9.1, 9.3)
  const handleStartReceiptScan = async (source: ReceiptImageSource = 'camera') => {
    setErrorMessage(null);
    if (onOpenReceiptScan) {
      onOpenReceiptScan((scannedItems, scannedChargeLines) => {
        setSplitMode('itemized');
        setItems(scannedItems);
        setChargeLines(scannedChargeLines);
      });
      return;
    }

    try {
      const text = await scanReceiptPhoto(source);
      if (text !== null) {
        setErrorMessage(null);
        setSplitMode('itemized');
        setScannedRawText(text);
        setShowReceiptReview(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to scan receipt');
    }
  };

  const handleLoadDemoReceipt = () => {
    setErrorMessage(null);
    setSplitMode('itemized');
    setScannedRawText(SAMPLE_DISNEY_RECEIPT);
    setShowReceiptReview(true);
  };

  // Live itemized amount calculation (Req 5.14)
  const itemizedDerivedAmountCents = useMemo(() => {
    const itemsTotal = items.reduce((s, it) => s + (it.priceCents || 0), 0);
    const chargeTotal = chargeLines.reduce((s, cl) => s + (cl.amountCents || 0), 0);
    return Math.max(0, itemsTotal + chargeTotal);
  }, [items, chargeLines]);

  // Live tiered amount calculation (Req 4.7)
  const {
    derivedTiersTotalCents,
    tierSubtotals,
    participantSubtotals,
    totalTierUnits,
  } = useMemo(() => {
    let totalCents = 0;
    let totalUnits = 0;
    const tSubtotals: { count: number; subtotalCents: number }[] = tiers.map(() => ({ count: 0, subtotalCents: 0 }));
    const pSubtotals: Record<string, number> = {};

    for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
      const t = tiers[tIdx]!;
      const countsForTier = tierCounts[String(tIdx)] ?? {};
      for (const [pId, cnt] of Object.entries(countsForTier)) {
        if (cnt > 0) {
          const cents = cnt * (t.priceCents || 0);
          totalCents += cents;
          totalUnits += cnt;
          if (tSubtotals[tIdx]) {
            tSubtotals[tIdx]!.count += cnt;
            tSubtotals[tIdx]!.subtotalCents += cents;
          }
          pSubtotals[pId] = (pSubtotals[pId] ?? 0) + cents;
        }
      }
    }

    return {
      derivedTiersTotalCents: totalCents,
      tierSubtotals: tSubtotals,
      participantSubtotals: pSubtotals,
      totalTierUnits: totalUnits,
    };
  }, [tiers, tierCounts]);

  // Tax & Tip calculation helper for tiered mode (Mockup specification)
  const calculatedTierTaxTip = useMemo(() => {
    const baseCents = derivedTiersTotalCents > 0
      ? derivedTiersTotalCents
      : tiers.reduce((s, t) => s + (t.priceCents || 0), 0);

    let taxCents = 0;
    if (tierTaxMode === 'dollar') {
      taxCents = Math.round((parseFloat(tierTaxDollar) || 0) * 100);
    } else if (tierTaxMode === 'total') {
      const totalValCents = Math.round((parseFloat(tierTaxTotal) || 0) * 100);
      taxCents = Math.max(0, totalValCents - baseCents);
    } else if (tierTaxMode === 'pct') {
      const pct = parseFloat(tierTaxPct) || 0;
      taxCents = Math.round(baseCents * (pct / 100));
    }

    let tipCents = 0;
    if (tierTipMode === 'pct') {
      const pct = parseFloat(tierTipPct) || 0;
      tipCents = Math.round(baseCents * (pct / 100));
    } else if (tierTipMode === 'dollar') {
      tipCents = Math.round((parseFloat(tierTipDollar) || 0) * 100);
    }

    const totalAddOnCents = taxCents + tipCents;
    const effectiveMultiplier = baseCents > 0 ? (totalAddOnCents / baseCents) : 0;

    return {
      baseCents,
      taxCents,
      tipCents,
      totalAddOnCents,
      effectiveMultiplier,
    };
  }, [derivedTiersTotalCents, tiers, tierTaxMode, tierTaxDollar, tierTaxTotal, tierTaxPct, tierTipMode, tierTipPct, tierTipDollar]);

  const handleApplyTierTaxTip = () => {
    if (calculatedTierTaxTip.effectiveMultiplier <= 0 && calculatedTierTaxTip.totalAddOnCents <= 0) return;
    const multiplier = 1 + calculatedTierTaxTip.effectiveMultiplier;
    setTiers((prev) =>
      prev.map((t) => ({
        ...t,
        priceCents: Math.round(t.priceCents * multiplier),
      })),
    );
    setTierTaxAppliedNotice(true);
    setTimeout(() => setTierTaxAppliedNotice(false), 3000);
  };

  const parsedAmountCents = useMemo(() => {
    if (splitMode === 'itemized') {
      return itemizedDerivedAmountCents;
    }
    if (splitMode === 'tiered') {
      const val = parseFloat(manualAmountDollars);
      const manualCents = isNaN(val) ? 0 : Math.round(val * 100);
      if (manualCents > 0 && manualCents >= derivedTiersTotalCents) {
        return manualCents;
      }
      return derivedTiersTotalCents;
    }
    const val = parseFloat(manualAmountDollars);
    return isNaN(val) ? 0 : Math.round(val * 100);
  }, [splitMode, manualAmountDollars, itemizedDerivedAmountCents, derivedTiersTotalCents]);

  // Auto-sync manualAmountDollars to derivedTiersTotalCents when in tiered mode
  useEffect(() => {
    if (splitMode === 'tiered' && !userOverrodeTierAmount) {
      if (derivedTiersTotalCents > 0) {
        setManualAmountDollars((derivedTiersTotalCents / 100).toFixed(2));
      } else if (!isEditing) {
        setManualAmountDollars('');
      }
    }
  }, [splitMode, derivedTiersTotalCents, userOverrodeTierAmount, isEditing]);

  // Live calculation of even split shares
  const evenSharesPreview = useMemo(() => {
    if (splitMode !== 'even' || parsedAmountCents <= 0 || evenParticipants.length < 2) {
      return [];
    }
    const payerIncluded = evenParticipants.includes(payerId);
    const nonPayers = evenParticipants.filter((id) => id !== payerId);
    if (nonPayers.length === 0) return [];

    if (payerIncluded) {
      const count = evenParticipants.length;
      const baseShare = Math.floor(parsedAmountCents / count);
      const payerShare = parsedAmountCents - baseShare * nonPayers.length;
      return [
        { id: payerId, amountCents: payerShare, isPayer: true },
        ...nonPayers.map((id) => ({ id, amountCents: baseShare, isPayer: false })),
      ];
    } else {
      const count = nonPayers.length;
      if (count === 0) return [];
      const baseShare = Math.floor(parsedAmountCents / count);
      return nonPayers.map((id) => ({ id, amountCents: baseShare, isPayer: false }));
    }
  }, [splitMode, parsedAmountCents, evenParticipants, payerId]);

  // Live calculation of exact shares remainder
  const exactSharesSumCents = useMemo(() => {
    if (splitMode !== 'exact') return 0;
    let sum = 0;
    for (const [recId, val] of Object.entries(exactShares)) {
      if (recId === payerId) continue;
      const c = Math.round((parseFloat(val) || 0) * 100);
      sum += c;
    }
    return sum;
  }, [splitMode, exactShares, payerId]);

  const exactPayerImplicitCents = Math.max(0, parsedAmountCents - exactSharesSumCents);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!description.trim()) {
        throw new Error('Description is required');
      }
      if (parsedAmountCents <= 0 && splitMode !== 'itemized') {
        throw new Error('Amount must be greater than zero');
      }

      if (splitMode === 'exact') {
        if (exactSharesSumCents > parsedAmountCents) {
          throw new Error('Sum of shares exceeds total expense amount');
        }
        const sharesPayload: { memberId?: string; guestId?: string; amountCents: number }[] = [];
        for (const [recId, valStr] of Object.entries(exactShares)) {
          if (recId === payerId) continue;
          const amt = Math.round((parseFloat(valStr) || 0) * 100);
          if (amt > 0) {
            const isGuest = guests.some((g) => g.id === recId);
            sharesPayload.push(
              isGuest
                ? { guestId: recId, amountCents: amt }
                : { memberId: recId, amountCents: amt },
            );
          }
        }

        const payload: ExpenseCreateInput = {
          payerId,
          description: description.trim(),
          date,
          category,
          splitMode: 'exact',
          amountCents: parsedAmountCents,
          experienceId: category === 'dining' ? (experienceId ?? undefined) : undefined,
          resortId: category === 'hotel' ? (resortId ?? undefined) : undefined,
          shares: sharesPayload,
        };

        return isEditing
          ? editExpense(tripId, initialExpense!.id, payload)
          : createExpense(tripId, payload);
      } else if (splitMode === 'even') {
        if (evenParticipants.length < 2) {
          throw new Error('At least two participants are required for an even split');
        }

        const payload: ExpenseCreateInput = {
          payerId,
          description: description.trim(),
          date,
          category,
          splitMode: 'even',
          amountCents: parsedAmountCents,
          experienceId: category === 'dining' ? (experienceId ?? undefined) : undefined,
          resortId: category === 'hotel' ? (resortId ?? undefined) : undefined,
          participantIds: evenParticipants,
        };

        return isEditing
          ? editExpense(tripId, initialExpense!.id, payload)
          : createExpense(tripId, payload);
      } else if (splitMode === 'tiered') {
        if (tiers.length === 0) {
          throw new Error('At least one tier is required');
        }
        const tiersPayload = tiers.map((t) => ({
          ...(isEditing && isValidUuid(t.id) ? { id: t.id } : {}),
          name: t.name.trim(),
          priceCents: t.priceCents,
        }));
        const countsPayload: { tierId: string; memberId?: string; guestId?: string; count: number }[] = [];
        for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
          const tObj = tiers[tIdx]!;
          const tierIdentifier = isEditing && isValidUuid(tObj.id) ? tObj.id : tObj.name;
          const countsForTier = tierCounts[String(tIdx)] ?? {};
          for (const [recId, cnt] of Object.entries(countsForTier)) {
            if (cnt > 0) {
              const isGuest = guests.some((g) => g.id === recId);
              countsPayload.push(
                isGuest
                  ? { tierId: tierIdentifier, guestId: recId, count: cnt }
                  : { tierId: tierIdentifier, memberId: recId, count: cnt },
              );
            }
          }
        }

        const payload: ExpenseCreateInput = {
          payerId,
          description: description.trim(),
          date,
          category,
          splitMode: 'tiered',
          amountCents: parsedAmountCents,
          experienceId: category === 'dining' ? (experienceId ?? undefined) : undefined,
          resortId: category === 'hotel' ? (resortId ?? undefined) : undefined,
          tiers: tiersPayload,
          tierCounts: countsPayload,
        };

        return isEditing
          ? editExpense(tripId, initialExpense!.id, payload)
          : createExpense(tripId, payload);
      } else if (splitMode === 'itemized') {
        if (items.length === 0) {
          throw new Error('At least one item is required for itemized split');
        }
        for (const item of items) {
          if (item.assigneeIds.length === 0) {
            throw new Error(`Item "${item.name}" must have at least one assignee`);
          }
        }

        const itemsPayload = items.map((it) => ({
          ...(isEditing && isValidUuid(it.id) ? { id: it.id } : {}),
          name: it.name.trim(),
          priceCents: it.priceCents,
          isAlcohol: it.isAlcohol,
          assigneeIds: it.assigneeIds,
        }));
        const chargePayload = chargeLines.map((cl) => {
          const validScopeIds = cl.scopeItemIds?.filter((id) => isValidUuid(id));
          return {
            kind: cl.kind,
            amountCents: cl.amountCents,
            ...(cl.excludeAlcohol !== undefined ? { excludeAlcohol: cl.excludeAlcohol } : {}),
            ...(validScopeIds && validScopeIds.length > 0 ? { scopeItemIds: validScopeIds } : {}),
          };
        });

        const payload: ExpenseCreateInput = {
          payerId,
          description: description.trim(),
          date,
          category,
          splitMode: 'itemized',
          experienceId: category === 'dining' ? (experienceId ?? undefined) : undefined,
          resortId: category === 'hotel' ? (resortId ?? undefined) : undefined,
          items: itemsPayload,
          chargeLines: chargePayload,
        };

        return isEditing
          ? editExpense(tripId, initialExpense!.id, payload)
          : createExpense(tripId, payload);
      }
      throw new Error(`Unknown split mode: ${splitMode}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.list(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
      onClose();
    },
    onError: (err: unknown) => {
      setErrorMessage(ledgerSaveErrorMessage(err, 'Failed to save expense'));
    },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent} testID="expense-form-modal">
          {/* Sheet Handle */}
          <View style={styles.sheetHandle} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>
                {isEditing ? 'Edit Expense' : 'Add Expense'}
              </Text>
              <Text style={styles.headerSubtitle}>
                Record shared costs across your group ledger
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-expense-modal"
              style={styles.closeBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={20} color={t.color.textPrimary} />
            </Pressable>
          </View>

          {errorMessage ? (
            <View style={styles.errorBox} testID="expense-form-error">
              <Ionicons name="alert-circle-outline" size={16} color={t.color.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            testID="expense-form-scroll"
          >
            {/* 1. HERO EXPENSE CARD (Amount + Description + Date & Venue) */}
            <View style={styles.heroExpenseCard}>
              {/* Amount Row */}
              {splitMode === 'itemized' ? (
                <View style={styles.heroAmountRow} testID="derived-amount-box">
                  <View style={styles.heroAmountInputWrap}>
                    <Text style={styles.heroAmountDisplay} testID="derived-amount-value">
                      ${(itemizedDerivedAmountCents / 100).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.derivedBadgeLock}>
                    <Ionicons name="lock-closed" size={12} color={pal.greenText} />
                    <Text style={styles.derivedBadgeLockText}>Locked: Items</Text>
                  </View>
                </View>
              ) : splitMode === 'tiered' ? (
                <View style={styles.heroAmountRow} testID="derived-tier-amount-box">
                  <View style={styles.heroAmountInputWrap}>
                    <Text style={styles.heroCurrencyPrefix}>$</Text>
                    <TextInput
                      style={styles.heroAmountInput}
                      placeholder={(derivedTiersTotalCents / 100).toFixed(2)}
                      placeholderTextColor={t.color.textSecondary}
                      keyboardAppearance={t.scheme}
                      keyboardType="decimal-pad"
                      value={manualAmountDollars}
                      onChangeText={(v) => {
                        setManualAmountDollars(v);
                        const parsed = Math.round((parseFloat(v) || 0) * 100);
                        if (v === '' || parsed === derivedTiersTotalCents) {
                          setUserOverrodeTierAmount(false);
                        } else {
                          setUserOverrodeTierAmount(true);
                        }
                      }}
                      testID="expense-amount-input"
                    />
                  </View>
                  <View style={styles.tierHeroSummaryBadge}>
                    <Text style={styles.tierHeroSummaryText} testID="derived-tier-amount-value">
                      ${(parsedAmountCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.tierHeroCountText}>
                      {totalTierUnits} ticket{totalTierUnits === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.heroAmountRow}>
                  <View style={styles.heroAmountInputWrap}>
                    <Text style={styles.heroCurrencyPrefix}>$</Text>
                    <TextInput
                      style={styles.heroAmountInput}
                      placeholder="0.00"
                      placeholderTextColor={pal.placeholder}
                      keyboardAppearance={t.scheme}
                      keyboardType="decimal-pad"
                      value={manualAmountDollars}
                      onChangeText={setManualAmountDollars}
                      testID="expense-amount-input"
                    />
                  </View>
                  {manualAmountDollars ? (
                    <View style={styles.manualBadge}>
                      <Text style={styles.manualBadgeText}>Manual Entry</Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* Description Input */}
              <View style={styles.heroDescRow}>
                <Ionicons name="create-outline" size={18} color={t.color.primaryFg} />
                <TextInput
                  style={styles.heroDescInput}
                  placeholder="What was this for? (e.g. Be Our Guest Dinner)"
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
                  value={description}
                  onChangeText={setDescription}
                  testID="expense-description-input"
                />
              </View>

              {/* Sub-row: Date Picker & Disney Venue Link */}
              <View style={styles.heroSubRow}>
                <View style={styles.heroDateWrap}>
                  <DatePickerField
                    value={date}
                    onChange={setDate}
                    placeholder="Select date"
                    accessibilityLabel="Expense date"
                    testID="expense-date-input"
                  />
                </View>

                {category === 'dining' ? (
                  <Pressable
                    style={[styles.heroVenueBtn, (experienceName || experienceId) ? styles.heroVenueBtnActive : null]}
                    onPress={() => setShowExpPicker(true)}
                    testID="link-restaurant-button"
                  >
                    <Ionicons name="restaurant" size={13} color={t.color.primaryFg} />
                    <Text style={styles.heroVenueBtnText} numberOfLines={1}>
                      {experienceName || (experienceId ? 'Restaurant Linked' : 'Link Disney Dining')}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={t.color.primaryFg} />
                  </Pressable>
                ) : null}

                {category === 'hotel' ? (
                  <Pressable
                    style={[styles.heroVenueBtn, (resortName || resortId) ? styles.heroVenueBtnActive : null]}
                    onPress={() => setShowResortPicker(true)}
                    testID="link-resort-button"
                  >
                    <Ionicons name="bed" size={13} color={t.color.primaryFg} />
                    <Text style={styles.heroVenueBtnText} numberOfLines={1}>
                      {resortName || (resortId ? 'Resort Linked' : 'Link Disney Resort')}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={t.color.primaryFg} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* 2. CATEGORY SELECTOR */}
            <SectionLabel style={styles.fieldLabel}>CATEGORY</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {EXPENSE_CATEGORIES.map((cat) => {
                const isSelected = cat === category;
                const catIcons: Record<ExpenseCategory, string> = {
                  dining: '🍽️',
                  hotel: '🏨',
                  tickets: '🎟️',
                  shopping: '🛍️',
                  transportation: '🚗',
                  other: '✨',
                };
                return (
                  <Pressable
                    key={cat}
                    style={[styles.catChip, isSelected && styles.catChipSelected]}
                    onPress={() => {
                      setCategory(cat);
                      if (cat !== 'dining') setExperienceId(null);
                      if (cat !== 'hotel') setResortId(null);
                    }}
                    testID={`category-chip-${cat}`}
                  >
                    <Text style={[styles.catChipText, isSelected && styles.catChipTextSelected]}>
                      {catIcons[cat]} {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* 3. RECEIPT SCANNER TOOLBAR (Compact & Sleek) */}
            <Card style={styles.receiptScannerQuickBar} testID="receipt-scanner-hero-card">
              <View style={styles.quickBarLeft}>
                <View style={styles.quickBarIconBubble}>
                  <Ionicons name="receipt" size={14} color={t.color.textOnPrimary} />
                </View>
                <Text style={styles.quickBarTitle}>Scan Receipt</Text>
              </View>
              <View style={styles.quickBarActions}>
                <Pressable
                  style={styles.quickBarBtnCamera}
                  onPress={() => handleStartReceiptScan('camera')}
                  testID="scan-receipt-camera-button"
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo of a receipt"
                >
                  <Ionicons name="camera" size={13} color={t.color.textOnPrimary} />
                  <Text style={styles.quickBarBtnCameraText}>Camera</Text>
                </Pressable>
                <Pressable
                  style={styles.quickBarBtnPhoto}
                  onPress={() => handleStartReceiptScan('library')}
                  testID="scan-receipt-library-button"
                  accessibilityRole="button"
                  accessibilityLabel="Choose receipt photo from library"
                >
                  <Ionicons name="images-outline" size={13} color={t.color.primaryFg} />
                  <Text style={styles.quickBarBtnPhotoText}>Photo</Text>
                </Pressable>
                <Pressable
                  style={styles.quickBarBtnSample}
                  onPress={handleLoadDemoReceipt}
                  testID="scan-receipt-demo-button"
                  accessibilityRole="button"
                  accessibilityLabel="Load sample Disney receipt"
                >
                  <Ionicons name="sparkles" size={12} color={t.color.primaryFg} />
                  <Text style={styles.quickBarBtnSampleText}>Sample</Text>
                </Pressable>
              </View>
            </Card>

            {/* 4. WHO PAID? */}
            <SectionLabel style={styles.fieldLabel}>WHO PAID?</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {members.map((m) => {
                const isSelected = m.userId === payerId;
                const avatarColor = getAvatarColor(m.displayName, t);
                return (
                  <Pressable
                    key={m.userId}
                    style={[styles.payerChip, isSelected && styles.payerChipSelected]}
                    onPress={() => setPayerId(m.userId)}
                    testID={`payer-chip-${m.userId}`}
                  >
                    <View style={[
                      styles.payerAvatarMini,
                      { backgroundColor: isSelected ? 'rgba(255,255,255,0.28)' : avatarColor },
                    ]}>
                      <Text style={[styles.payerAvatarMiniText, isSelected && { color: t.color.textOnPrimary }]}>
                        {m.displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.payerChipText, isSelected && styles.payerChipTextSelected]}>
                      {m.displayName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* 5. SPLIT MODE */}
            <SectionLabel style={styles.fieldLabel}>SPLIT MODE</SectionLabel>
            <View style={styles.modeRow} testID="split-mode-selector">
              {EXPENSE_SPLIT_MODES.map((mode) => {
                const isSelected = mode === splitMode;
                const modeIcons: Record<ExpenseSplitMode, string> = {
                  exact: '🔢',
                  even: '⚖️',
                  tiered: '🎟️',
                  itemized: '🧾',
                };
                return (
                  <Pressable
                    key={mode}
                    style={[styles.modeChip, isSelected && styles.modeChipSelected]}
                    onPress={() => handleSplitModeChange(mode)}
                    accessibilityRole="button"
                    testID={`split-mode-chip-${mode}`}
                  >
                    <Text style={[styles.modeChipText, isSelected && styles.modeChipTextSelected]}>
                      {modeIcons[mode]} {mode.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Mode-Specific Allocation Builders */}

            {/* EXACT MODE */}
            {splitMode === 'exact' ? (
              <View style={styles.modeSection}>
                <SectionLabel style={styles.fieldLabel}>PER-PERSON SHARES</SectionLabel>
                <Text style={styles.helperText}>
                  Enter what each person owes. The remaining amount will be assigned to the payer.
                </Text>
                <View style={styles.exactBalanceMeter}>
                  <Text style={styles.exactBalanceMeterLabel}>
                    Allocated: <Text style={styles.exactBalanceMeterBold}>${(exactSharesSumCents / 100).toFixed(2)}</Text> / ${(parsedAmountCents / 100).toFixed(2)}
                  </Text>
                  <View style={[
                    styles.meterStatusBadge,
                    exactSharesSumCents <= parsedAmountCents && parsedAmountCents > 0
                      ? styles.meterStatusBalanced
                      : parsedAmountCents === 0
                        ? styles.meterStatusNeutral
                        : styles.meterStatusOver,
                  ]}>
                    <Text style={[
                      styles.meterStatusText,
                      exactSharesSumCents <= parsedAmountCents && parsedAmountCents > 0
                        ? styles.meterStatusTextBalanced
                        : parsedAmountCents === 0
                          ? styles.meterStatusTextNeutral
                          : styles.meterStatusTextOver,
                    ]}>
                      {exactSharesSumCents === parsedAmountCents && parsedAmountCents > 0
                        ? '✓ Balanced ($0.00)'
                        : parsedAmountCents === 0
                          ? 'Enter total amount'
                          : exactSharesSumCents < parsedAmountCents
                            ? `$${((parsedAmountCents - exactSharesSumCents) / 100).toFixed(2)} for payer`
                            : `Exceeds by $${((exactSharesSumCents - parsedAmountCents) / 100).toFixed(2)}`}
                    </Text>
                  </View>
                </View>
                {parsedAmountCents > 0 ? (
                  <View style={styles.exactProgressBarTrack}>
                    <View
                      style={[
                        styles.exactProgressBarFill,
                        {
                          width: `${Math.min(100, Math.round((exactSharesSumCents / parsedAmountCents) * 100))}%`,
                          backgroundColor:
                            exactSharesSumCents > parsedAmountCents
                              ? t.color.danger
                              : exactSharesSumCents === parsedAmountCents
                                ? pal.greenText
                                : t.color.primaryFg,
                        },
                      ]}
                    />
                  </View>
                ) : null}
                {allParticipants.map((p) => {
                  if (p.id === payerId) return null;
                  const avatarColor = getAvatarColor(p.name, t);
                  return (
                    <View key={p.id} style={styles.shareRow} testID={`exact-share-row-${p.id}`}>
                      <View style={styles.participantLeftGroup}>
                        <View style={[styles.avatarBubble, { backgroundColor: avatarColor }]}>
                          <Text style={styles.avatarBubbleText}>{p.name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={styles.participantNameWrap}>
                          <Text style={styles.participantName}>{p.name}</Text>
                          {p.isGuest ? (
                            <View style={styles.guestPill}>
                              <Text style={styles.guestPillText}>Guest</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.shareInputWrap}>
                        <Text style={styles.currencyPrefix}>$</Text>
                        <TextInput
                          style={styles.shareInput}
                          placeholder="0.00"
                          placeholderTextColor={t.color.textSecondary}
                          keyboardAppearance={t.scheme}
                          keyboardType="decimal-pad"
                          value={exactShares[p.id] ?? ''}
                          onChangeText={(v) =>
                            setExactShares((prev) => ({ ...prev, [p.id]: v }))
                          }
                          testID={`exact-share-input-${p.id}`}
                        />
                      </View>
                    </View>
                  );
                })}
                <View style={styles.payerImplicitCard}>
                  <View style={styles.payerImplicitIconWrap}>
                    <Ionicons name="wallet-outline" size={18} color={t.color.primaryFg} />
                  </View>
                  <View style={styles.payerImplicitTextWrap}>
                    <Text style={styles.previewText}>
                      Payer's Implicit Share: ${(exactPayerImplicitCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.payerImplicitSubtext}>
                      Remaining unallocated balance covered by payer
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* EVEN MODE */}
            {splitMode === 'even' ? (
              <View style={styles.modeSection}>
                <View style={styles.participantsHeaderRow}>
                  <SectionLabel style={styles.fieldLabel}>PARTICIPANTS</SectionLabel>
                  <View style={styles.quickToggleRow}>
                    <Pressable
                      style={styles.quickToggleBtn}
                      onPress={() => setEvenParticipants(allParticipants.map((p) => p.id))}
                      accessibilityRole="button"
                      accessibilityLabel="Select all participants"
                    >
                      <Text style={styles.quickToggleBtnText}>All</Text>
                    </Pressable>
                    <Pressable
                      style={styles.quickToggleBtn}
                      onPress={() => setEvenParticipants([payerId])}
                      accessibilityRole="button"
                      accessibilityLabel="Clear other participants"
                    >
                      <Text style={styles.quickToggleBtnText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.helperText}>
                  Check everyone included in the split. Uncheck the payer to split among others only.
                </Text>
                {allParticipants.map((p) => {
                  const isChecked = evenParticipants.includes(p.id);
                  const isPayer = p.id === payerId;
                  const avatarColor = getAvatarColor(p.name, t);
                  const computedShare = evenSharesPreview.find((s) => s.id === p.id);
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.checkRow, isChecked && styles.checkRowChecked]}
                      onPress={() => {
                        setEvenParticipants((prev) =>
                          isChecked ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                        );
                      }}
                      testID={`even-participant-${p.id}`}
                    >
                      <View style={styles.participantLeftGroup}>
                        <Ionicons
                          name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={isChecked ? t.color.primaryFg : pal.checkIdleIcon}
                        />
                        <View style={[styles.avatarBubble, { backgroundColor: avatarColor }]}>
                          <Text style={styles.avatarBubbleText}>{p.name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={styles.participantNameWrap}>
                          <Text style={[styles.participantName, !isChecked && styles.participantNameDimmed]}>
                            {p.name}
                          </Text>
                          {isPayer ? (
                            <View style={styles.payerPill}>
                              <Text style={styles.payerPillText}>Payer</Text>
                            </View>
                          ) : p.isGuest ? (
                            <View style={styles.guestPill}>
                              <Text style={styles.guestPillText}>Guest</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {isChecked && computedShare ? (
                        <Text style={styles.participantShareVal}>
                          ${(computedShare.amountCents / 100).toFixed(2)}
                        </Text>
                      ) : !isChecked ? (
                        <Text style={styles.participantExcludedText}>Excluded</Text>
                      ) : null}
                    </Pressable>
                  );
                })}

                {evenSharesPreview.length > 0 ? (
                  <View style={styles.previewBox} testID="even-shares-preview">
                    <Text style={styles.previewTitle}>Live Preview:</Text>
                    {evenSharesPreview.map((s: { id: string; amountCents: number; isPayer: boolean }) => {
                      const pObj = allParticipants.find((p) => p.id === s.id);
                      return (
                        <Text key={s.id} style={styles.previewLine}>
                          {pObj?.name ?? 'User'}: ${(s.amountCents / 100).toFixed(2)}{' '}
                          {s.isPayer ? '(Payer)' : ''}
                        </Text>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* TIERED MODE */}
            {splitMode === 'tiered' ? (
              <View style={styles.modeSection}>
                {suggestedTiers.length > 0 && showTierSuggestions ? (
                  <Card style={styles.tierSuggestionCard} testID="tier-suggestions-banner">
                    <View style={styles.tierSuggestionHeader}>
                      <Ionicons name="sparkles" size={16} color={t.color.primaryFg} />
                      <Text style={styles.tierSuggestionTitle}>Menu Pricing Suggestions</Text>
                    </View>
                    <Text style={styles.tierSuggestionBody}>
                      {suggestedTiers.map((t) => `${t.name}: $${(t.priceCents / 100).toFixed(2)}`).join(' • ')}
                    </Text>
                    <View style={styles.tierSuggestionActions}>
                      <SecondaryButton
                        label="Discard"
                        onPress={() => setShowTierSuggestions(false)}
                        testID="discard-tier-suggestions-btn"
                      />
                      <PrimaryButton
                        label="Apply Suggestions"
                        onPress={() => {
                          setTiers(suggestedTiers);
                          setShowTierSuggestions(false);
                        }}
                        testID="apply-tier-suggestions-btn"
                      />
                    </View>
                  </Card>
                ) : null}

                <View style={styles.tierHeaderRow}>
                  <SectionLabel style={styles.fieldLabel}>EXPENSE TIERS</SectionLabel>
                  <Pressable
                    style={styles.addTierHeaderBtn}
                    onPress={() =>
                      setTiers((prev) => [...prev, { name: 'Child', priceCents: 2000 }])
                    }
                    testID="add-tier-btn"
                  >
                    <Ionicons name="add" size={13} color={t.color.primaryFg} />
                    <Text style={styles.addTierHeaderBtnText}>Add Tier</Text>
                  </Pressable>
                </View>

                {tiers.map((tier, idx) => (
                  <View key={idx} style={styles.tierCard}>
                    <View style={styles.tierCardRow}>
                      <View style={styles.tierNameCol}>
                        <TextInput
                          style={styles.tierNameInput}
                          placeholder={`Tier ${idx + 1} Name`}
                          placeholderTextColor={t.color.textSecondary}
                          keyboardAppearance={t.scheme}
                          value={tier.name}
                          onChangeText={(v) => {
                            const copy = [...tiers];
                            copy[idx]!.name = v;
                            setTiers(copy);
                          }}
                          testID={`tier-name-${idx}`}
                        />
                      </View>
                      <View style={styles.tierPriceCol}>
                        <View style={styles.tierPriceBox}>
                          <Text style={styles.tierPriceDollarSign}>$</Text>
                          <TextInput
                            style={styles.tierPriceInput}
                            placeholder="0.00"
                            placeholderTextColor={t.color.textSecondary}
                            keyboardAppearance={t.scheme}
                            keyboardType="decimal-pad"
                            value={(tier.priceCents / 100).toFixed(2)}
                            onChangeText={(v) => {
                              const copy = [...tiers];
                              copy[idx]!.priceCents = Math.round((parseFloat(v) || 0) * 100);
                              setTiers(copy);
                            }}
                            testID={`tier-price-${idx}`}
                          />
                          <Text style={styles.tierPriceUnitSuffix}>/ ea</Text>
                        </View>
                      </View>
                      {tiers.length > 1 ? (
                        <Pressable
                          style={styles.tierDeleteBtn}
                          onPress={() => setTiers((prev) => prev.filter((_, i) => i !== idx))}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove tier ${idx + 1}`}
                        >
                          <Ionicons name="trash-outline" size={16} color={t.color.danger} />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.tierCardFooter}>
                      <Text style={styles.tierSummaryBadgeText} testID={`tier-summary-${idx}`}>
                        {tierSubtotals[idx]?.count ?? 0} ticket{(tierSubtotals[idx]?.count ?? 0) === 1 ? '' : 's'} selected · ${(((tierSubtotals[idx]?.subtotalCents ?? 0)) / 100).toFixed(2)} total
                      </Text>
                    </View>
                  </View>
                ))}

                {/* Tax & Tip Helper Tool (Mockup Spec) */}
                <View style={styles.taxTipHelperCard} testID="tier-tax-tip-helper">
                  <Pressable
                    style={styles.taxTipHelperHeader}
                    onPress={() => setShowTierTaxTipHelper((prev) => !prev)}
                    testID="toggle-tax-tip-helper-btn"
                    accessibilityRole="button"
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="calculator-outline" size={16} color={t.color.primaryFg} />
                      <Text style={styles.taxTipHelperTitle}>Tax & Tip Distribution Helper</Text>
                    </View>
                    <Ionicons
                      name={showTierTaxTipHelper ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={t.color.primaryFg}
                    />
                  </Pressable>

                  {showTierTaxTipHelper ? (
                    <View style={styles.taxTipHelperBody}>
                      <Text style={styles.taxTipHelperSub}>
                        Proportionally fold tax & tip into each tier's unit price so every member pays their fair share.
                      </Text>

                      {/* Tax Mode Switcher */}
                      <Text style={styles.helperMiniLabel}>TAX INPUT METHOD</Text>
                      <View style={styles.helperSegmentRow}>
                        <Pressable
                          style={[styles.helperSegmentBtn, tierTaxMode === 'dollar' && styles.helperSegmentBtnActive]}
                          onPress={() => setTierTaxMode('dollar')}
                          testID="tax-mode-dollar-btn"
                        >
                          <Text style={[styles.helperSegmentText, tierTaxMode === 'dollar' && styles.helperSegmentTextActive]}>
                            Exact Tax ($)
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.helperSegmentBtn, tierTaxMode === 'total' && styles.helperSegmentBtnActive]}
                          onPress={() => setTierTaxMode('total')}
                          testID="tax-mode-total-btn"
                        >
                          <Text style={[styles.helperSegmentText, tierTaxMode === 'total' && styles.helperSegmentTextActive]}>
                            Final Bill ($)
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.helperSegmentBtn, tierTaxMode === 'pct' && styles.helperSegmentBtnActive]}
                          onPress={() => setTierTaxMode('pct')}
                          testID="tax-mode-pct-btn"
                        >
                          <Text style={[styles.helperSegmentText, tierTaxMode === 'pct' && styles.helperSegmentTextActive]}>
                            Disney %
                          </Text>
                        </Pressable>
                      </View>

                      {/* Tax Input Field */}
                      {tierTaxMode === 'dollar' ? (
                        <View style={styles.helperInputRow}>
                          <Text style={styles.currencyPrefix}>$</Text>
                          <TextInput
                            style={styles.shareInput}
                            placeholder="e.g. 14.56"
                            placeholderTextColor={t.color.textSecondary}
                            keyboardAppearance={t.scheme}
                            keyboardType="decimal-pad"
                            value={tierTaxDollar}
                            onChangeText={setTierTaxDollar}
                            testID="tax-dollar-input"
                          />
                        </View>
                      ) : tierTaxMode === 'total' ? (
                        <View style={styles.helperInputRow}>
                          <Text style={styles.currencyPrefix}>$</Text>
                          <TextInput
                            style={styles.shareInput}
                            placeholder="Final total on receipt"
                            placeholderTextColor={t.color.textSecondary}
                            keyboardAppearance={t.scheme}
                            keyboardType="decimal-pad"
                            value={tierTaxTotal}
                            onChangeText={setTierTaxTotal}
                            testID="tax-total-input"
                          />
                        </View>
                      ) : (
                        <View>
                          <View style={{ flexDirection: 'row', gap: 6, marginVertical: 4 }}>
                            <Pressable
                              style={[styles.miniPresetChip, tierTaxPct === '6.5' && styles.miniPresetChipActive]}
                              onPress={() => setTierTaxPct('6.5')}
                            >
                              <Text style={[styles.miniPresetText, tierTaxPct === '6.5' && styles.miniPresetTextActive]}>EPCOT / MK (6.5%)</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.miniPresetChip, tierTaxPct === '12.5' && styles.miniPresetChipActive]}
                              onPress={() => setTierTaxPct('12.5')}
                            >
                              <Text style={[styles.miniPresetText, tierTaxPct === '12.5' && styles.miniPresetTextActive]}>Resorts (12.5%)</Text>
                            </Pressable>
                          </View>
                          <View style={styles.helperInputRow}>
                            <TextInput
                              style={styles.shareInput}
                              placeholder="Custom %"
                              placeholderTextColor={t.color.textSecondary}
                              keyboardAppearance={t.scheme}
                              keyboardType="decimal-pad"
                              value={tierTaxPct}
                              onChangeText={setTierTaxPct}
                              testID="tax-pct-input"
                            />
                            <Text style={styles.currencyPrefix}>%</Text>
                          </View>
                        </View>
                      )}

                      {/* Tip Mode Switcher */}
                      <Text style={[styles.helperMiniLabel, { marginTop: 10 }]}>TIP / GRATUITY</Text>
                      <View style={styles.helperSegmentRow}>
                        <Pressable
                          style={[styles.helperSegmentBtn, tierTipMode === 'pct' && styles.helperSegmentBtnActive]}
                          onPress={() => setTierTipMode('pct')}
                          testID="tip-mode-pct-btn"
                        >
                          <Text style={[styles.helperSegmentText, tierTipMode === 'pct' && styles.helperSegmentTextActive]}>
                            Tip %
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.helperSegmentBtn, tierTipMode === 'dollar' && styles.helperSegmentBtnActive]}
                          onPress={() => setTierTipMode('dollar')}
                          testID="tip-mode-dollar-btn"
                        >
                          <Text style={[styles.helperSegmentText, tierTipMode === 'dollar' && styles.helperSegmentTextActive]}>
                            Tip ($)
                          </Text>
                        </Pressable>
                      </View>

                      {tierTipMode === 'pct' ? (
                        <View>
                          <View style={{ flexDirection: 'row', gap: 6, marginVertical: 4 }}>
                            {['0', '15', '18', '20'].map((p) => (
                              <Pressable
                                key={p}
                                style={[styles.miniPresetChip, tierTipPct === p && styles.miniPresetChipActive]}
                                onPress={() => setTierTipPct(p)}
                              >
                                <Text style={[styles.miniPresetText, tierTipPct === p && styles.miniPresetTextActive]}>{p}%</Text>
                              </Pressable>
                            ))}
                          </View>
                          <View style={styles.helperInputRow}>
                            <TextInput
                              style={styles.shareInput}
                              placeholder="Tip %"
                              placeholderTextColor={t.color.textSecondary}
                              keyboardAppearance={t.scheme}
                              keyboardType="decimal-pad"
                              value={tierTipPct}
                              onChangeText={setTierTipPct}
                              testID="tip-pct-input"
                            />
                            <Text style={styles.currencyPrefix}>%</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.helperInputRow}>
                          <Text style={styles.currencyPrefix}>$</Text>
                          <TextInput
                            style={styles.shareInput}
                            placeholder="Exact tip dollars"
                            placeholderTextColor={t.color.textSecondary}
                            keyboardAppearance={t.scheme}
                            keyboardType="decimal-pad"
                            value={tierTipDollar}
                            onChangeText={setTierTipDollar}
                            testID="tip-dollar-input"
                          />
                        </View>
                      )}

                      {/* Calculation Preview & Apply Button */}
                      <View style={styles.helperPreviewRow}>
                        <Text style={styles.helperPreviewText} testID="tier-tax-preview-text">
                          +${(calculatedTierTaxTip.totalAddOnCents / 100).toFixed(2)} tax/tip ({((calculatedTierTaxTip.effectiveMultiplier * 100)).toFixed(1)}%)
                        </Text>
                        <Pressable
                          style={styles.helperApplyBtn}
                          onPress={handleApplyTierTaxTip}
                          testID="apply-tier-tax-tip-btn"
                          accessibilityRole="button"
                        >
                          <Text style={styles.helperApplyBtnText}>⚡ Apply to Tiers</Text>
                        </Pressable>
                      </View>

                      {tierTaxAppliedNotice ? (
                        <Text style={styles.helperSuccessNotice}>✓ Applied taxes and tips into tier prices!</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                <View style={styles.tierCountsHeaderRow}>
                  <View>
                    <SectionLabel style={styles.fieldLabel}>PARTICIPANT TIER COUNTS</SectionLabel>
                    <Text style={styles.tierCountsSubheader}>
                      {totalTierUnits} ticket{totalTierUnits === 1 ? '' : 's'} assigned
                    </Text>
                  </View>
                  <View style={styles.tierViewToggleContainer}>
                    <Pressable
                      style={[styles.tierViewToggleBtn, tierViewMode === 'matrix' && styles.tierViewToggleBtnActive]}
                      onPress={() => setTierViewMode('matrix')}
                      testID="tier-view-toggle-matrix"
                      accessibilityRole="button"
                      accessibilityLabel="Switch to table matrix view"
                    >
                      <Text style={[styles.tierViewToggleText, tierViewMode === 'matrix' && styles.tierViewToggleTextActive]}>
                        📊 Matrix
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.tierViewToggleBtn, tierViewMode === 'cards' && styles.tierViewToggleBtnActive]}
                      onPress={() => setTierViewMode('cards')}
                      testID="tier-view-toggle-cards"
                      accessibilityRole="button"
                      accessibilityLabel="Switch to cards view"
                    >
                      <Text style={[styles.tierViewToggleText, tierViewMode === 'cards' && styles.tierViewToggleTextActive]}>
                        🗂️ Cards
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Quick actions presets toolbar */}
                <View style={styles.tierQuickActionsRow}>
                  {tiers.length > 0 ? (
                    <Pressable
                      style={styles.tierQuickActionBtn}
                      onPress={() => {
                        setTierCounts((prev) => {
                          const next = { ...prev };
                          const t0 = { ...(next['0'] ?? {}) };
                          allParticipants.forEach((p) => {
                            t0[p.id] = (t0[p.id] ?? 0) + 1;
                          });
                          next['0'] = t0;
                          return next;
                        });
                      }}
                      testID="tier-quick-action-all"
                      accessibilityRole="button"
                      accessibilityLabel={`Add 1 ${tiers[0]?.name || 'Tier 1'} to all participants`}
                    >
                      <Text style={styles.tierQuickActionBtnText}>+1 {tiers[0]?.name || 'Tier 1'} to All</Text>
                    </Pressable>
                  ) : null}
                  {totalTierUnits > 0 ? (
                    <Pressable
                      style={styles.tierQuickActionBtnReset}
                      onPress={() => setTierCounts({})}
                      testID="tier-quick-action-clear"
                      accessibilityRole="button"
                      accessibilityLabel="Clear all participant tickets"
                    >
                      <Text style={styles.tierQuickActionResetText}>Clear All</Text>
                    </Pressable>
                  ) : null}
                </View>

                {tierViewMode === 'matrix' ? (
                  /* SPREADSHEET MATRIX VIEW: Compact ~220px high table fitting everyone without scrolling */
                  <View style={styles.tierMatrixCard}>
                    {tiers.length > 3 ? (
                      <View style={styles.matrixScrollHintRow}>
                        <Ionicons name="swap-horizontal" size={12} color={t.color.primaryFg} />
                        <Text style={styles.matrixScrollHintText}>
                          Swipe table horizontally to see all {tiers.length} tiers & totals
                        </Text>
                      </View>
                    ) : null}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={tiers.length > 3}
                      contentContainerStyle={styles.tierMatrixScrollContent}
                    >
                      <View style={styles.tierMatrixTable}>
                        {/* Table Header */}
                        <View style={styles.tierMatrixHeaderRow}>
                          <View style={styles.tierMatrixParticipantCol}>
                            <Text style={styles.tierMatrixColHeaderText}>MEMBER</Text>
                          </View>
                          {tiers.map((t, tIdx) => (
                            <View
                              key={tIdx}
                              style={[
                                styles.tierMatrixTierCol,
                                tiers.length === 3 && styles.tierMatrixTierColThree,
                                tiers.length > 3 && styles.tierMatrixTierColMany,
                              ]}
                            >
                              <Text style={styles.tierMatrixColHeaderText} numberOfLines={1}>
                                {t.name || `Tier ${tIdx + 1}`}
                              </Text>
                              <Text style={styles.tierMatrixColHeaderPrice}>
                                ${(t.priceCents / 100).toFixed(0)}
                              </Text>
                            </View>
                          ))}
                          <View style={styles.tierMatrixSubtotalCol}>
                            <Text style={styles.tierMatrixColHeaderText}>TOTAL</Text>
                          </View>
                        </View>

                        {/* Table Participant Rows */}
                        {allParticipants.map((p, pIdx) => {
                          const avatarColor = getAvatarColor(p.name, t);
                          const pSubtotal = participantSubtotals[p.id] ?? 0;
                          const hasAssignedTiers = pSubtotal > 0;
                          return (
                            <View
                              key={p.id}
                              style={[
                                styles.tierMatrixRow,
                                pIdx === allParticipants.length - 1 && styles.tierMatrixRowLast,
                                hasAssignedTiers && styles.tierMatrixRowActive,
                              ]}
                              testID={`participant-tier-card-${p.id}`}
                            >
                              <View style={styles.tierMatrixParticipantCol}>
                                <View style={styles.tierMatrixParticipantInfo}>
                                  <View style={[styles.avatarBubbleMini, { backgroundColor: avatarColor }]}>
                                    <Text style={styles.avatarBubbleMiniText}>{p.name.charAt(0).toUpperCase()}</Text>
                                  </View>
                                  <View style={styles.tierMatrixNameGroup}>
                                    <Text style={styles.tierMatrixParticipantName} numberOfLines={1}>
                                      {p.name}
                                    </Text>
                                    {p.id === payerId ? (
                                      <Text style={styles.payerSubtext}>Payer</Text>
                                    ) : p.isGuest ? (
                                      <Text style={styles.guestSubtext}>Guest</Text>
                                    ) : null}
                                  </View>
                                </View>
                              </View>

                              {tiers.map((tier, tIdx) => {
                                const count = tierCounts[String(tIdx)]?.[p.id] ?? 0;
                                const isCellActive = count > 0;
                                return (
                                  <View
                                    key={tIdx}
                                    style={[
                                      styles.tierMatrixTierCol,
                                      tiers.length === 3 && styles.tierMatrixTierColThree,
                                      tiers.length > 3 && styles.tierMatrixTierColMany,
                                    ]}
                                  >
                                    <View
                                      style={[styles.matrixStepperPill, isCellActive && styles.matrixStepperPillActive]}
                                      testID={`tier-matrix-pill-${tIdx}-${p.id}`}
                                    >
                                      <Pressable
                                        style={styles.matrixStepperBtn}
                                        onPress={() => {
                                          const next = Math.max(0, count - 1);
                                          setTierCounts((prev) => ({
                                            ...prev,
                                            [String(tIdx)]: {
                                              ...(prev[String(tIdx)] ?? {}),
                                              [p.id]: next,
                                            },
                                          }));
                                        }}
                                        testID={`tier-count-dec-${tIdx}-${p.id}`}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Decrement ${tier.name} for ${p.name}`}
                                      >
                                        <Text style={styles.matrixStepperBtnText}>−</Text>
                                      </Pressable>
                                      <TextInput
                                        style={[styles.matrixCountInput, isCellActive && styles.matrixCountInputActive]}
                                        keyboardType="number-pad"
                                        keyboardAppearance={t.scheme}
                                        value={String(count)}
                                        onChangeText={(v) => {
                                          const num = parseInt(v, 10) || 0;
                                          setTierCounts((prev) => ({
                                            ...prev,
                                            [String(tIdx)]: {
                                              ...(prev[String(tIdx)] ?? {}),
                                              [p.id]: num,
                                            },
                                          }));
                                        }}
                                        testID={`tier-count-${tIdx}-${p.id}`}
                                      />
                                      <Pressable
                                        style={styles.matrixStepperBtn}
                                        onPress={() => {
                                          const next = count + 1;
                                          setTierCounts((prev) => ({
                                            ...prev,
                                            [String(tIdx)]: {
                                              ...(prev[String(tIdx)] ?? {}),
                                              [p.id]: next,
                                            },
                                          }));
                                        }}
                                        testID={`tier-count-inc-${tIdx}-${p.id}`}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Increment ${tier.name} for ${p.name}`}
                                      >
                                        <Text style={styles.matrixStepperBtnText}>+</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                );
                              })}

                              <View style={styles.tierMatrixSubtotalCol}>
                                <Text
                                  style={[styles.matrixSubtotalText, hasAssignedTiers && styles.matrixSubtotalTextActive]}
                                  testID={`participant-tier-subtotal-${p.id}`}
                                  numberOfLines={2}
                                >
                                  Subtotal:{'\n'}${(pSubtotal / 100).toFixed(2)}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                ) : (
                  /* BALANCED CARDS VIEW: Fixed 2-column layout (no awkward stretching for odd tiers) */
                  allParticipants.map((p) => {
                    const avatarColor = getAvatarColor(p.name, t);
                    const pSubtotal = participantSubtotals[p.id] ?? 0;
                    const hasAssignedTiers = pSubtotal > 0;
                    return (
                      <View
                        key={p.id}
                        style={[styles.participantTierCard, hasAssignedTiers && styles.participantTierCardActive]}
                        testID={`participant-tier-card-${p.id}`}
                      >
                        <View style={styles.participantHeaderRow}>
                          <View style={styles.participantLeftGroup}>
                            <View style={[styles.avatarBubbleMini, { backgroundColor: avatarColor }]}>
                              <Text style={styles.avatarBubbleMiniText}>{p.name.charAt(0).toUpperCase()}</Text>
                            </View>
                            <Text style={styles.participantName}>
                              {p.name} {p.id === payerId ? '(Payer)' : ''}
                            </Text>
                            {p.isGuest ? (
                              <View style={styles.guestPill}>
                                <Text style={styles.guestPillText}>Guest</Text>
                              </View>
                            ) : null}
                          </View>
                          <View style={[styles.participantSubtotalPill, hasAssignedTiers && styles.participantSubtotalPillActive]}>
                            <Text
                              style={[styles.participantSubtotalText, hasAssignedTiers && styles.participantSubtotalTextActive]}
                              testID={`participant-tier-subtotal-${p.id}`}
                            >
                              Subtotal: ${(pSubtotal / 100).toFixed(2)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.tierCountGrid}>
                          {tiers.map((tier, tIdx) => {
                            const count = tierCounts[String(tIdx)]?.[p.id] ?? 0;
                            const isTierActive = count > 0;
                            return (
                              <View
                                key={tIdx}
                                style={[styles.tierCountPillCard, isTierActive && styles.tierCountPillCardActive]}
                                testID={`tier-count-pill-${tIdx}-${p.id}`}
                              >
                                <Text style={styles.tierCountPillName} numberOfLines={1}>
                                  {tier.name} <Text style={styles.tierCountPillPrice}>(${Math.round(tier.priceCents / 100)})</Text>
                                </Text>
                                <View style={styles.stepperPill}>
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = Math.max(0, count - 1);
                                      setTierCounts((prev) => ({
                                        ...prev,
                                        [String(tIdx)]: {
                                          ...(prev[String(tIdx)] ?? {}),
                                          [p.id]: next,
                                        },
                                      }));
                                    }}
                                    testID={`tier-count-dec-${tIdx}-${p.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Decrement ${tier.name} for ${p.name}`}
                                  >
                                    <Text style={styles.stepperBtnText}>-</Text>
                                  </Pressable>
                                  <TextInput
                                    style={styles.tierCountInput}
                                    keyboardType="number-pad"
                                    keyboardAppearance={t.scheme}
                                    value={String(count)}
                                    onChangeText={(v) => {
                                      const num = parseInt(v, 10) || 0;
                                      setTierCounts((prev) => ({
                                        ...prev,
                                        [String(tIdx)]: {
                                          ...(prev[String(tIdx)] ?? {}),
                                          [p.id]: num,
                                        },
                                      }));
                                    }}
                                    testID={`tier-count-${tIdx}-${p.id}`}
                                  />
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = count + 1;
                                      setTierCounts((prev) => ({
                                        ...prev,
                                        [String(tIdx)]: {
                                          ...(prev[String(tIdx)] ?? {}),
                                          [p.id]: next,
                                        },
                                      }));
                                    }}
                                    testID={`tier-count-inc-${tIdx}-${p.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Increment ${tier.name} for ${p.name}`}
                                  >
                                    <Text style={styles.stepperBtnText}>+</Text>
                                  </Pressable>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            ) : null}

            {/* ITEMIZED MODE */}
            {splitMode === 'itemized' ? (
              <View style={styles.modeSection}>
                <View style={styles.itemizedScanBar}>
                  <Text style={styles.itemizedScanBarText}>Receipt actions:</Text>
                  <Pressable
                    style={styles.itemizedScanBtn}
                    onPress={() => handleStartReceiptScan('camera')}
                    testID="scan-receipt-button"
                  >
                    <Ionicons name="camera-outline" size={13} color={t.color.primaryFg} />
                    <Text style={styles.itemizedScanBtnText}>Camera</Text>
                  </Pressable>
                  <Pressable
                    style={styles.itemizedScanBtn}
                    onPress={() => handleStartReceiptScan('library')}
                    testID="pick-receipt-library-button"
                  >
                    <Ionicons name="images-outline" size={13} color={t.color.primaryFg} />
                    <Text style={styles.itemizedScanBtnText}>Choose Photo</Text>
                  </Pressable>
                </View>

                <View style={styles.itemizedHeaderRow}>
                  <SectionLabel style={styles.fieldLabel}>RECEIPT ITEMS ({items.length})</SectionLabel>
                  <Pressable
                    style={styles.addItemHeaderBtn}
                    onPress={() =>
                      setItems((prev) => [
                        ...prev,
                        {
                          name: '',
                          priceCents: 0,
                          isAlcohol: false,
                          assigneeIds: allParticipants.map((p) => p.id),
                        },
                      ])
                    }
                  >
                    <Text style={styles.addItemHeaderBtnText}>+ Add Item</Text>
                  </Pressable>
                </View>

                {items.map((it, idx) => (
                  <Card key={idx} style={styles.itemCard} testID={`item-card-${idx}`}>
                    <View style={styles.itemHeader}>
                      <TextInput
                        style={[styles.input, styles.itemNameInput]}
                        placeholder="Item name (e.g. Burger)"
                        placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}
                        keyboardAppearance={t.scheme}
                        value={it.name}
                        onChangeText={(v) => {
                          const copy = [...items];
                          copy[idx]!.name = v;
                          setItems(copy);
                        }}
                        testID={`item-name-${idx}`}
                      />
                      <View style={styles.itemPriceWrap}>
                        <Text style={styles.itemPricePrefix}>$</Text>
                        <TextInput
                          style={[styles.input, styles.itemPriceInput]}
                          placeholder="0.00"
                          placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}
                          keyboardAppearance={t.scheme}
                          keyboardType="decimal-pad"
                          value={(it.priceCents / 100).toFixed(2)}
                          onChangeText={(v) => {
                            const copy = [...items];
                            copy[idx]!.priceCents = Math.round((parseFloat(v) || 0) * 100);
                            setItems(copy);
                          }}
                          testID={`item-price-${idx}`}
                        />
                      </View>
                      <Pressable
                        style={styles.iconBtn}
                        onPress={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove item ${idx + 1}`}
                      >
                        <Ionicons name="trash-outline" size={16} color={t.color.danger} />
                      </Pressable>
                    </View>

                    {/* Alcohol Toggle */}
                    <View style={styles.alcoholRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.alcoholIcon}>🍸</Text>
                        <Text style={styles.alcoholLabel}>Alcoholic Drink</Text>
                      </View>
                      <Switch
                        key={t.scheme}
                        value={it.isAlcohol}
                        onValueChange={(val) => {
                          const copy = [...items];
                          copy[idx]!.isAlcohol = val;
                          setItems(copy);
                        }}
                        testID={`item-alcohol-toggle-${idx}`}
                        {...themedSwitchProps(t, it.isAlcohol, {
                          trackColor: { false: switchPal.trackOff, true: switchPal.trackOn },
                          thumbColor: it.isAlcohol ? switchPal.thumbOn : t.color.textOnPrimary,
                        })}
                      />
                    </View>

                    {/* Assignees */}
                    <View style={styles.assigneesWrap}>
                      <View style={styles.assigneesHeader}>
                        <Text style={styles.assigneeTitle}>Assignees:</Text>
                        <Pressable
                          onPress={() => {
                            const copy = [...items];
                            copy[idx]!.assigneeIds = allParticipants.map((p) => p.id);
                            setItems(copy);
                          }}
                          testID={`item-everyone-btn-${idx}`}
                          style={styles.everyoneBtn}
                        >
                          <Text style={styles.everyoneBtnText}>Everyone</Text>
                        </Pressable>
                      </View>
                      <View style={styles.assigneeChips}>
                        {allParticipants.map((p) => {
                          const isAssigned = it.assigneeIds.includes(p.id);
                          const avatarColor = getAvatarColor(p.name, t);
                          return (
                            <Pressable
                              key={p.id}
                              style={[
                                styles.assigneeChip,
                                isAssigned && styles.assigneeChipSelected,
                              ]}
                              onPress={() => {
                                const copy = [...items];
                                const cur = copy[idx]!.assigneeIds;
                                copy[idx]!.assigneeIds = isAssigned
                                  ? cur.filter((id) => id !== p.id)
                                  : [...cur, p.id];
                                setItems(copy);
                              }}
                              testID={`item-assignee-${idx}-${p.id}`}
                            >
                              <View style={[
                                styles.assigneeMiniAvatar,
                                { backgroundColor: isAssigned ? t.color.surface : avatarColor },
                              ]}>
                                <Text style={[
                                  styles.assigneeMiniAvatarText,
                                  { color: isAssigned ? pal.assigneeInitialSelected : t.color.textOnPrimary },
                                ]}>
                                  {p.name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.assigneeChipText,
                                  isAssigned && styles.assigneeChipTextSelected,
                                ]}
                              >
                                {p.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </Card>
                ))}

                <SecondaryButton
                  label="+ Add Item"
                  onPress={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        name: '',
                        priceCents: 0,
                        isAlcohol: false,
                        assigneeIds: allParticipants.map((p) => p.id),
                      },
                    ])
                  }
                  testID="add-item-btn"
                />

                {/* Charge Lines */}
                <SectionLabel style={styles.fieldLabel}>TAX, GRATUITY & CHARGES</SectionLabel>
                {chargeLines.map((cl, idx) => (
                  <View key={idx} style={styles.chargeRow} testID={`charge-line-${idx}`}>
                    <Text style={styles.chargeKind}>{cl.kind.toUpperCase()}</Text>
                    <TextInput
                      style={[styles.input, styles.chargeInput]}
                      placeholder="Amount ($)"
                      placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary : undefined}
                      keyboardAppearance={t.scheme}
                      keyboardType="decimal-pad"
                      value={(cl.amountCents / 100).toFixed(2)}
                      onChangeText={(v) => {
                        const copy = [...chargeLines];
                        const cents = Math.round((parseFloat(v) || 0) * 100);
                        copy[idx]!.amountCents = cl.kind === 'discount' ? -Math.abs(cents) : Math.abs(cents);
                        setChargeLines(copy);
                      }}
                      testID={`charge-amount-${idx}`}
                    />
                    {cl.kind === 'discount' ? (
                      <View style={styles.alcoholExcludeWrap}>
                        <Text style={styles.excludeText}>Exclude Alcohol</Text>
                        <Switch
                          key={t.scheme}
                          value={Boolean(cl.excludeAlcohol)}
                          onValueChange={(val) => {
                            const copy = [...chargeLines];
                            copy[idx]!.excludeAlcohol = val;
                            setChargeLines(copy);
                          }}
                          {...themedSwitchProps(t, Boolean(cl.excludeAlcohol), {
                            trackColor: { false: switchPal.trackOff, true: switchPal.trackOn },
                            thumbColor: cl.excludeAlcohol ? switchPal.thumbOn : t.color.textOnPrimary,
                          })}
                        />
                      </View>
                    ) : null}
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => setChargeLines((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={16} color={t.color.danger} />
                    </Pressable>
                  </View>
                ))}

                <View style={styles.chargeButtonsRow}>
                  {CHARGE_LINE_KINDS.map((k: ChargeLineKind) => (
                    <Pressable
                      key={k}
                      style={styles.addChargeBtn}
                      onPress={() =>
                        setChargeLines((prev) => [
                          ...prev,
                          {
                            kind: k,
                            amountCents: k === 'discount' ? -100 : 100,
                            excludeAlcohol: k === 'discount',
                          },
                        ])
                      }
                      testID={`add-charge-${k}`}
                    >
                      <Text style={styles.addChargeBtnText}>+ {k}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Manage Guests Link */}
            <Pressable
              style={styles.guestLinkRow}
              onPress={() => {
                if (onOpenManageGuests) {
                  onOpenManageGuests();
                } else {
                  setShowManageGuestsModal(true);
                }
              }}
              testID="open-manage-guests-link"
            >
              <Ionicons name="people-outline" size={16} color={t.color.primaryFg} />
              <Text style={styles.guestLinkText}>Manage Trip Guests</Text>
            </Pressable>

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Action Buttons - Pinned Sticky Bottom Footer */}
          <View style={styles.footerRow}>
            <SecondaryButton label="Cancel" onPress={onClose} style={styles.footerCancelBtn} />
            <PrimaryButton
              label={
                isEditing
                  ? 'Save Changes'
                  : parsedAmountCents > 0
                    ? `Save Expense ($${(parsedAmountCents / 100).toFixed(2)})`
                    : 'Save Expense'
              }
              onPress={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              testID="submit-expense-button"
              style={styles.footerSubmitBtn}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Catalog Restaurant Picker Modal */}
      {showExpPicker ? (
        <Modal
          visible={showExpPicker}
          animationType="slide"
          transparent
          onRequestClose={() => setShowExpPicker(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalOverlay}
          >
            <View style={styles.modalContent} testID="restaurant-picker-modal">
              <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>Select Disney Restaurant</Text>
                <Pressable
                  onPress={() => setShowExpPicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                >
                  <Ionicons name="close" size={24} color={t.color.textPrimary} />
                </Pressable>
              </View>
              <ExperiencePicker
                enabled={showExpPicker}
                defaultTab="dining"
                showTabs={false}
                testIDPrefix="expense-restaurant-picker"
                onSelect={(exp: ExperienceDTO) => {
                  setExperienceId(exp.id);
                  setExperienceName(exp.name);
                  if (!description.trim()) setDescription(exp.name);
                  setShowExpPicker(false);
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}

      {/* Catalog Resort Picker Modal */}
      {showResortPicker ? (
        <ResortPickerModal
          visible={showResortPicker}
          selectedResortId={resortId}
          onSelect={(resort: ResortItem) => {
            setResortId(resort.id);
            setResortName(resort.name);
            if (!description.trim()) setDescription(resort.name);
            setShowResortPicker(false);
          }}
          onClose={() => setShowResortPicker(false)}
        />
      ) : null}

      {/* Receipt Review Modal */}
      {showReceiptReview ? (
        <ReceiptReviewModal
          visible={showReceiptReview}
          members={members}
          guests={guests}
          callerId={callerId}
          initialRawText={scannedRawText}
          restaurantMenuNames={restaurantMenuNames}
          onConfirm={(scannedItems, scannedChargeLines) => {
            setItems(
              scannedItems.map((it) => ({
                id: it.id,
                name: it.name,
                priceCents: it.priceCents,
                isAlcohol: it.isAlcohol,
                assigneeIds: it.assigneeIds && it.assigneeIds.length > 0 ? it.assigneeIds : [callerId],
              }))
            );
            setChargeLines(
              scannedChargeLines.map((cl) => ({
                id: cl.id,
                kind: cl.kind,
                amountCents: cl.amountCents,
                excludeAlcohol: cl.excludeAlcohol,
              }))
            );
            setShowReceiptReview(false);
          }}
          onFallbackToManual={() => setShowReceiptReview(false)}
          onClose={() => setShowReceiptReview(false)}
        />
      ) : null}

      {/* Manage Guests Modal */}
      {showManageGuestsModal ? (
        <TripGuestManagementModal
          visible={showManageGuestsModal}
          tripId={tripId}
          guests={guests}
          members={members}
          callerId={callerId}
          isOrganizer={Boolean(members.find((m) => m.userId === callerId)?.role === 'organizer')}
          onClose={() => setShowManageGuestsModal(false)}
        />
      ) : null}
    </Modal>
  );
};

const useStyles = makeStyles((t) => ({
  modalOverlay: {
    flex: 1,
    backgroundColor: FORM[t.scheme].scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '92%',
    paddingTop: 10,
    overflow: 'hidden',
    shadowColor: FORM[t.scheme].sheetShadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: FORM[t.scheme].sheetHandle,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: t.color.textPrimary,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 12.5,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FORM[t.scheme].lavenderWell,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: withAlpha(t.color.danger, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(t.color.danger, 0.2),
    padding: 10,
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  errorText: {
    color: t.color.danger,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  heroExpenseCard: {
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heroAmountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  heroCurrencyPrefix: {
    fontSize: 32,
    fontWeight: '800',
    color: t.color.primaryFg,
    marginRight: 4,
  },
  heroAmountInput: {
    fontSize: 34,
    fontWeight: '800',
    color: t.color.textPrimary,
    flex: 1,
    paddingVertical: 0,
  },
  heroAmountDisplay: {
    fontSize: 34,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  heroDescRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FORM[t.scheme].lavenderInput,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  heroDescInput: {
    flex: 1,
    fontSize: 14,
    color: t.color.textPrimary,
    fontWeight: '500',
    paddingVertical: 0,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroDateWrap: {
    flex: 1,
  },
  heroVenueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: FORM[t.scheme].lavenderWell,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: '52%',
  },
  heroVenueBtnActive: {
    backgroundColor: FORM[t.scheme].venueActiveBg,
    borderColor: t.color.primaryFg,
  },
  heroVenueBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: t.color.primaryFg,
    flexShrink: 1,
  },
  tierHeroSummaryBadge: {
    alignItems: 'flex-end',
    backgroundColor: FORM[t.scheme].lavenderWell,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tierHeroSummaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  tierHeroCountText: {
    fontSize: 10,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  receiptScannerQuickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  quickBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  quickBarIconBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBarTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  quickBarActions: {
    flexDirection: 'row',
    gap: 6,
  },
  quickBarBtnCamera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.primary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
  },
  quickBarBtnCameraText: {
    color: t.color.textOnPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  quickBarBtnPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
  },
  quickBarBtnPhotoText: {
    color: t.color.primaryFg,
    fontSize: 11,
    fontWeight: '700',
  },
  quickBarBtnSample: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: FORM[t.scheme].lavenderWell,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  quickBarBtnSampleText: {
    color: t.color.primaryFg,
    fontSize: 11,
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    padding: 4,
    borderRadius: 14,
    gap: 4,
    marginBottom: 16,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  modeChipSelected: {
    backgroundColor: FORM[t.scheme].modeChipSelectedBg,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  modeChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  modeChipTextSelected: {
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: t.color.surface,
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: t.color.border,
  },
  payerChipSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  payerAvatarMini: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerAvatarMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  payerChipText: {
    fontSize: 12.5,
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  payerChipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: t.color.surface,
    marginRight: 6,
    borderWidth: 1.5,
    borderColor: t.color.border,
  },
  catChipSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  catChipText: {
    fontSize: 12,
    color: t.color.textSecondary,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  catChipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  catalogLinkSection: {
    marginBottom: 14,
  },
  catalogButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  catalogButtonActive: {
    borderColor: t.color.borderStrong,
    backgroundColor: FORM[t.scheme].lavenderWell,
  },
  catalogButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  catalogIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogButtonText: {
    fontSize: 13,
    color: t.color.primaryFg,
    fontWeight: '700',
    flex: 1,
  },
  input: {
    backgroundColor: t.color.surface,
    borderWidth: 1.5,
    borderColor: t.color.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: t.color.textPrimary,
    marginBottom: 14,
  },
  datePickerContainer: {
    marginBottom: 14,
  },
  manualAmountContainer: {
    marginBottom: 16,
  },
  amountLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  manualBadge: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  derivedHeroCard: {
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  derivedHeroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  derivedHeroTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  derivedHeroSubtitle: {
    fontSize: 11.5,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  derivedBadgeLock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FORM[t.scheme].greenBadgeBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  derivedBadgeLockText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: FORM[t.scheme].greenDeepText,
  },
  derivedHeroValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    marginTop: 6,
  },
  derivedHeroDollarPrefix: {
    fontSize: 20,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  derivedHeroValue: {
    fontSize: 26,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  tierTotalHelperBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FORM[t.scheme].lavenderWell,
    padding: 8,
    borderRadius: 8,
    marginVertical: 8,
  },
  tierTotalHelperText: {
    fontSize: 11.5,
    color: t.color.textSecondary,
    flex: 1,
    lineHeight: 15,
  },
  tierExtraText: {
    fontSize: 11.5,
    color: t.color.primaryFg,
    fontWeight: '600',
    marginTop: 6,
  },
  modeSection: {
    marginTop: 4,
    marginBottom: 14,
  },
  helperText: {
    fontSize: 12,
    color: t.color.textSecondary,
    marginBottom: 10,
    lineHeight: 16,
  },
  exactBalanceMeter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  exactBalanceMeterLabel: {
    fontSize: 12.5,
    color: FORM[t.scheme].slate600Text,
  },
  exactBalanceMeterBold: {
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  meterStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  meterStatusBalanced: {
    backgroundColor: FORM[t.scheme].greenBadgeBg,
  },
  meterStatusOver: {
    backgroundColor: FORM[t.scheme].redBadgeBg,
  },
  meterStatusNeutral: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
  },
  meterStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  meterStatusTextBalanced: {
    color: FORM[t.scheme].greenDeepText,
  },
  meterStatusTextOver: {
    color: FORM[t.scheme].redText,
  },
  meterStatusTextNeutral: {
    color: t.color.textSecondary,
  },
  exactProgressBarTrack: {
    height: 4,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 2,
    marginBottom: 12,
    overflow: 'hidden',
  },
  exactProgressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    marginBottom: 8,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  participantLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatarBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBubbleText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  participantNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  participantName: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  participantNameDimmed: {
    color: FORM[t.scheme].slate400Text,
  },
  payerPill: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  payerPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  guestPill: {
    backgroundColor: FORM[t.scheme].guestBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  guestPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: FORM[t.scheme].guestText,
  },
  shareInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FORM[t.scheme].shareInputBg,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  currencyPrefix: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  shareInput: {
    width: 68,
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
    textAlign: 'right',
    paddingVertical: 4,
  },
  payerImplicitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  payerImplicitIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerImplicitTextWrap: {
    flex: 1,
  },
  payerImplicitSubtext: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  previewBox: {
    backgroundColor: withAlpha(t.color.primary, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(t.color.primary, 0.15),
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.primaryFg,
    marginBottom: 4,
  },
  previewLine: {
    fontSize: 12,
    color: t.color.textPrimary,
    marginTop: 2,
  },
  previewText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  participantsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickToggleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  quickToggleBtn: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  quickToggleBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    marginBottom: 8,
  },
  checkRowChecked: {
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderColor: t.color.borderStrong,
  },
  participantShareVal: {
    fontSize: 13.5,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  participantExcludedText: {
    fontSize: 11.5,
    color: FORM[t.scheme].slate400Text,
    fontWeight: '500',
  },
  tierSuggestionCard: {
    padding: 12,
    marginBottom: 12,
    backgroundColor: withAlpha(t.color.primary, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(t.color.primary, 0.2),
    borderRadius: 12,
  },
  tierSuggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  tierSuggestionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  tierSuggestionBody: {
    fontSize: 13,
    color: t.color.textPrimary,
    marginBottom: 8,
  },
  tierSuggestionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  tierHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addTierHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FORM[t.scheme].addTierBg,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  addTierHeaderBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  tierCard: {
    backgroundColor: t.color.surface,
    borderWidth: 1.5,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  tierCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tierNameCol: {
    flex: 1.3,
  },
  tierNameInput: {
    backgroundColor: FORM[t.scheme].tierNameBg,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginBottom: 0,
  },
  tierPriceCol: {
    flex: 1,
  },
  tierPriceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FORM[t.scheme].greenWell,
    borderWidth: 1,
    borderColor: FORM[t.scheme].greenBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tierPriceDollarSign: {
    fontSize: 12,
    fontWeight: '700',
    color: FORM[t.scheme].greenPriceText,
    marginRight: 2,
  },
  tierPriceInput: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: FORM[t.scheme].greenPriceText,
    paddingVertical: 0,
  },
  tierPriceUnitSuffix: {
    fontSize: 10,
    color: FORM[t.scheme].slate500Text,
    marginLeft: 2,
  },
  tierDeleteBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: FORM[t.scheme].violetFooterDivider,
  },
  tierSummaryBadgeText: {
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  participantTierCard: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  participantTierCardActive: {
    borderColor: FORM[t.scheme].violetBorderActive,
    backgroundColor: FORM[t.scheme].cardActiveBg,
  },
  participantHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  avatarBubbleMini: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBubbleMiniText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  participantSubtotalPill: {
    backgroundColor: FORM[t.scheme].neutralWell,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  participantSubtotalPillActive: {
    backgroundColor: FORM[t.scheme].subtotalActiveBg,
  },
  participantSubtotalText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: FORM[t.scheme].slate500Text,
  },
  participantSubtotalTextActive: {
    color: t.color.primaryFg,
  },
  tierCountsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 6,
  },
  tierCountsSubheader: {
    fontSize: 11,
    color: FORM[t.scheme].mutedVioletText,
    fontWeight: '600',
    marginTop: -4,
  },
  tierViewToggleContainer: {
    flexDirection: 'row',
    backgroundColor: FORM[t.scheme].addTierBg,
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorderSoft,
  },
  tierViewToggleBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tierViewToggleBtnActive: {
    backgroundColor: t.color.primary,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  tierViewToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: FORM[t.scheme].toggleIdleText,
  },
  tierViewToggleTextActive: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  tierQuickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  tierQuickActionBtn: {
    backgroundColor: FORM[t.scheme].quickActionBg,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tierQuickActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  tierQuickActionBtnReset: {
    backgroundColor: FORM[t.scheme].resetBg,
    borderWidth: 1,
    borderColor: FORM[t.scheme].resetBorder,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tierQuickActionResetText: {
    fontSize: 11,
    fontWeight: '600',
    color: FORM[t.scheme].resetText,
  },
  matrixScrollHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: FORM[t.scheme].matrixHeaderBg,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: FORM[t.scheme].violetDivider,
  },
  matrixScrollHintText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  tierMatrixCard: {
    backgroundColor: t.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    overflow: 'hidden',
    marginBottom: 10,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  tierMatrixScrollContent: {
    minWidth: '100%',
  },
  tierMatrixTable: {
    minWidth: '100%',
  },
  tierMatrixHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FORM[t.scheme].matrixHeaderBg,
    borderBottomWidth: 1,
    borderBottomColor: FORM[t.scheme].violetDivider,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  tierMatrixParticipantCol: {
    width: 92,
    paddingRight: 4,
  },
  tierMatrixTierCol: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  tierMatrixTierColThree: {
    flex: 0,
    width: 58,
  },
  tierMatrixTierColMany: {
    flex: 0,
    width: 66,
  },
  tierMatrixSubtotalCol: {
    width: 68,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  tierMatrixColHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.color.primaryFg,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tierMatrixColHeaderPrice: {
    fontSize: 9.5,
    fontWeight: '600',
    color: FORM[t.scheme].mutedVioletText,
  },
  tierMatrixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: FORM[t.scheme].violetRowDivider,
    backgroundColor: t.color.surface,
  },
  tierMatrixRowActive: {
    backgroundColor: FORM[t.scheme].rowActiveBg,
  },
  tierMatrixRowLast: {
    borderBottomWidth: 0,
  },
  tierMatrixParticipantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tierMatrixNameGroup: {
    flex: 1,
  },
  tierMatrixParticipantName: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  payerSubtext: {
    fontSize: 9,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  guestSubtext: {
    fontSize: 9,
    fontWeight: '600',
    color: FORM[t.scheme].slate500Text,
  },
  matrixStepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FORM[t.scheme].stepperPillBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    padding: 1,
  },
  matrixStepperPillActive: {
    backgroundColor: t.color.surface,
    borderColor: FORM[t.scheme].matrixPillActiveBorder,
    shadowColor: FORM[t.scheme].violetShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  matrixStepperBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: FORM[t.scheme].stepperBtnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matrixStepperBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
    lineHeight: 13,
  },
  matrixCountInput: {
    fontSize: 11,
    fontWeight: '700',
    color: FORM[t.scheme].mutedVioletText2,
    textAlign: 'center',
    minWidth: 16,
    paddingHorizontal: 1,
    paddingVertical: 0,
  },
  matrixCountInputActive: {
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  matrixSubtotalText: {
    fontSize: 10,
    fontWeight: '600',
    color: FORM[t.scheme].slate400Text,
    textAlign: 'right',
    lineHeight: 13,
  },
  matrixSubtotalTextActive: {
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  tierCountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  tierCountPillCard: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FORM[t.scheme].rowActiveBg,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tierCountPillCardActive: {
    backgroundColor: FORM[t.scheme].tierPillActiveBg,
    borderColor: FORM[t.scheme].tierPillActiveBorder,
  },
  tierCountPillName: {
    fontSize: 11.5,
    fontWeight: '700',
    color: t.color.textPrimary,
    flexShrink: 1,
    marginRight: 4,
  },
  tierCountPillPrice: {
    fontSize: 10.5,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    padding: 1,
  },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: FORM[t.scheme].lavenderWell,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
    lineHeight: 15,
  },
  tierCountInput: {
    fontSize: 12,
    fontWeight: '800',
    color: t.color.textPrimary,
    minWidth: 20,
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  itemizedScanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FORM[t.scheme].lavenderPanel,
    padding: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  itemizedScanBarText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  itemizedScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  itemizedScanBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  itemizedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addItemHeaderBtn: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  addItemHeaderBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  itemCard: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemNameInput: {
    flex: 2,
    marginBottom: 0,
    fontSize: 13.5,
  },
  itemPriceWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    borderWidth: 1.5,
    borderColor: t.color.border,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  itemPricePrefix: {
    fontSize: 13,
    fontWeight: '700',
    color: FORM[t.scheme].slate500Text,
    marginRight: 2,
  },
  itemPriceInput: {
    flex: 1,
    borderWidth: 0,
    marginBottom: 0,
    paddingHorizontal: 0,
    fontSize: 13.5,
    fontWeight: '700',
  },
  alcoholRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: FORM[t.scheme].greyDivider,
  },
  alcoholIcon: {
    fontSize: 14,
    ...t.textDefault,
  },
  alcoholLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: FORM[t.scheme].slate600Text,
  },
  assigneesWrap: {
    marginTop: 8,
  },
  assigneesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  assigneeTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: FORM[t.scheme].slate500Text,
    textTransform: 'uppercase',
  },
  everyoneBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderRadius: 6,
  },
  everyoneBtnText: {
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  assigneeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  assigneeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  assigneeChipSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  assigneeMiniAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeMiniAvatarText: {
    fontSize: 9,
    fontWeight: '800',
  },
  assigneeChipText: {
    fontSize: 11,
    color: FORM[t.scheme].slate600Text,
  },
  assigneeChipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  chargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  chargeKind: {
    fontSize: 11.5,
    fontWeight: '700',
    color: FORM[t.scheme].slate700Text,
    width: 70,
  },
  chargeInput: {
    flex: 1,
    marginBottom: 0,
  },
  alcoholExcludeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  excludeText: {
    fontSize: 10,
    color: FORM[t.scheme].slate500Text,
  },
  chargeButtonsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  addChargeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: FORM[t.scheme].neutralWell,
    borderWidth: 1,
    borderColor: FORM[t.scheme].greyHairline,
  },
  addChargeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: FORM[t.scheme].slate700Text,
  },
  guestLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 14,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: FORM[t.scheme].lavenderPanel,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
  },
  guestLinkText: {
    fontSize: 13,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: t.color.surface,
    borderTopWidth: 1,
    borderTopColor: FORM[t.scheme].footerDivider,
  },
  footerCancelBtn: {
    flex: 1,
  },
  footerSubmitBtn: {
    flex: 2,
  },
  iconBtn: {
    padding: 6,
  },
  taxTipHelperCard: {
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: FORM[t.scheme].violetHairline,
    borderRadius: 14,
    marginVertical: 10,
    overflow: 'hidden',
  },
  taxTipHelperHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: FORM[t.scheme].lavenderPanel,
  },
  taxTipHelperTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  taxTipHelperBody: {
    padding: 12,
  },
  taxTipHelperSub: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginBottom: 10,
    lineHeight: 15,
  },
  helperMiniLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: FORM[t.scheme].slate500Text,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  helperSegmentRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  helperSegmentBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: FORM[t.scheme].greyWell,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  helperSegmentBtnActive: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderColor: t.color.primaryFg,
  },
  helperSegmentText: {
    fontSize: 11,
    fontWeight: '600',
    color: FORM[t.scheme].slate500Text,
  },
  helperSegmentTextActive: {
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  helperInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginVertical: 4,
  },
  miniPresetChip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: FORM[t.scheme].greyWell,
    borderWidth: 1,
    borderColor: FORM[t.scheme].greyHairline,
  },
  miniPresetChipActive: {
    backgroundColor: FORM[t.scheme].lavenderWellAlt,
    borderColor: t.color.primaryFg,
  },
  miniPresetText: {
    fontSize: 10,
    color: FORM[t.scheme].slate500Text,
    fontWeight: '600',
  },
  miniPresetTextActive: {
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  helperPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: FORM[t.scheme].greyDivider,
  },
  helperPreviewText: {
    fontSize: 11,
    fontWeight: '700',
    color: FORM[t.scheme].greenText,
  },
  helperApplyBtn: {
    backgroundColor: t.color.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  helperApplyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  helperSuccessNotice: {
    fontSize: 11,
    fontWeight: '600',
    color: FORM[t.scheme].greenText,
    marginTop: 6,
    textAlign: 'right',
  },
}));
