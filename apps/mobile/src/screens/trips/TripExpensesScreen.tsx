/**
 * Trip Expenses Ledger Screen (Tasks 10.2, 10.7, 11.1, 13.1, 16.1, 16.2).
 *
 * Requirements:
 * - Top tab switcher between [Expenses] and [Who Owes What] (Req 10.5).
 * - Balance Overview Hero Card on Expenses tab with personal net position and quick settle actions (Req 10.5).
 * - Ledger list from listExpensesAndSettlements, Date-ordered (Req 7.6).
 * - Expense personal share indicators and collapsible participant split breakdowns (Req 10.5).
 * - Expense and Settlement rows visually distinguished not by color alone (Req 7.6).
 * - Category and Payer filter chips (Req 13.1).
 * - Post-trip settle-up banner when tripStatus === 'past' and nonzero balances (Req 13.2).
 * - Export CSV button triggering device share sheet (Req 13.3, 13.4).
 * - Add/Edit expense modal covering all 4 Split_Modes.
 * - Refund modal showing running refund and net amount (Req 12.4).
 * - Guest management modal (Req 2.1-2.10).
 * - Simplified Pairwise debts and Member Net Balances view with drilldown (Req 6.1-6.5).
 *
 * Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.6, 7.7,
 * 8.1, 8.4, 10.5, 12.1, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  EXPENSE_CATEGORIES,
  type ExpenseDTO,
  type SettlementDTO,
  type TripDTO,
  type TripMemberDTO,
  type TripGuestDTO,
  type ExpenseCategory,
  type PairwiseBalanceDTO,
  type NetBalanceDTO,
  type BalanceDrillDownEntryDTO,
} from '@dwt/shared';

import type { TripsStackParamList } from '../../navigation/TripsStack';
import type { AppTheme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { CATEGORY_META, EXPENSES } from './TripExpensesScreen.palette';
import { apiRequest } from '../../api/client';
import { tripDetailKeys } from './tripDetailQueryKeys';
import {
  fetchTripExpenses,
  fetchTripBalances,
  fetchTripGuests,
  fetchBalanceDrillDown,
  deleteExpense,
  deleteSettlement,
  exportExpensesCsv,
  tripExpenseKeys,
  type ListExpensesFilters,
} from './tripExpenseApi';
import { involvesDeletedUser, withDeletedUserNames } from '../../components/presentPerson';
import { ExpenseFormModal } from './ExpenseFormModal';
import { RefundModal } from './RefundModal';
import { SettlementModal } from './SettlementModal';
import { TripGuestManagementModal } from './TripGuestManagementModal';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripExpenses'>;

function getCategoryMeta(cat: ExpenseCategory | null | undefined, t: Pick<AppTheme, 'scheme'>): {
  icon: keyof typeof Ionicons.glyphMap;
  emoji: string;
  bg: string;
  fg: string;
} {
  const catPal = CATEGORY_META[t.scheme];
  switch (cat) {
    case 'hotel':
      return { icon: 'bed-outline', emoji: '🏨', bg: catPal.hotelBg, fg: catPal.hotelFg };
    case 'tickets':
      return { icon: 'ticket-outline', emoji: '🎟️', bg: catPal.ticketsBg, fg: catPal.ticketsFg };
    case 'dining':
      return { icon: 'restaurant-outline', emoji: '🍽️', bg: catPal.diningBg, fg: catPal.diningFg };
    case 'shopping':
      return { icon: 'bag-handle-outline', emoji: '🛍️', bg: catPal.shoppingBg, fg: catPal.shoppingFg };
    case 'transportation':
      return { icon: 'car-outline', emoji: '🚗', bg: catPal.transportBg, fg: catPal.transportFg };
    default:
      return { icon: 'sparkles-outline', emoji: '✨', bg: catPal.otherBg, fg: catPal.otherFg };
  }
}

function formatDateHeader(dateStr: string): string {
  if (!dateStr) return 'TRIP ENTRIES';
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0]!, 10);
      const monthIdx = parseInt(parts[1]!, 10) - 1;
      const day = parseInt(parts[2]!, 10);
      const dateObj = new Date(year, monthIdx, day);
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = monthNames[monthIdx] ?? 'OCT';

      if (dateStr === todayStr) {
        return `TODAY • ${month} ${day}, ${year}`;
      } else if (dateStr === yesterdayStr) {
        return `YESTERDAY • ${month} ${day}, ${year}`;
      } else {
        const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const weekday = dayNames[dateObj.getDay()] ?? 'DAY';
        return `${weekday} • ${month} ${day}, ${year}`;
      }
    }
    return dateStr.toUpperCase();
  } catch {
    return dateStr.toUpperCase();
  }
}

export default function TripExpensesScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(EXPENSES);
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  // Top Tab Switcher: 'expenses' or 'balances' (Who Owes What)
  const [activeTab, setActiveTab] = useState<'expenses' | 'balances'>('expenses');

  // Filters State (Expenses Tab)
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'all'>('all');
  const [selectedPayerId, setSelectedPayerId] = useState<string | 'all'>('all');

  // Split Breakdown Collapsible State (set of expense IDs)
  const [expandedExpenseIds, setExpandedExpenseIds] = useState<Set<string>>(new Set());

  // Modal States
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseDTO | null>(null);
  const [refundingExpense, setRefundingExpense] = useState<ExpenseDTO | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<SettlementDTO | null>(null);
  const [isManageGuestsOpen, setIsManageGuestsOpen] = useState(false);

  // Settlement Flow States (from Who Owes What or Hero Card)
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [prefillPayerId, setPrefillPayerId] = useState<string | undefined>();
  const [prefillRecipientId, setPrefillRecipientId] = useState<string | undefined>();
  const [prefillAmountCents, setPrefillAmountCents] = useState<number | undefined>();

  // Drilldown Modal State
  const [drillDownMemberId, setDrillDownMemberId] = useState<string | null>(null);

  // Pairwise Breakdown Modal State (Req 6.7)
  const [pairwiseBreakdownPair, setPairwiseBreakdownPair] = useState<{
    memberIdA: string;
    memberIdB: string;
    aOwesBCents?: number;
  } | null>(null);

  // Queries
  const meQuery = useQuery<{ user: { id: string } }>({
    queryKey: ['me'],
    queryFn: () => apiRequest<{ user: { id: string } }>('GET', '/me'),
  });
  const callerId = meQuery.data?.user.id ?? '';

  const tripQuery = useQuery<TripDTO>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
  });
  const trip = tripQuery.data;

  const membersQuery = useQuery<readonly TripMemberDTO[]>({
    queryKey: ['trips', tripId, 'members'],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
  });
  const members = membersQuery.data ?? [];

  const guestsQuery = useQuery<readonly TripGuestDTO[]>({
    queryKey: tripExpenseKeys.guests(tripId),
    queryFn: () => fetchTripGuests(tripId),
  });
  const guests = guestsQuery.data ?? [];

  const balancesQuery = useQuery({
    queryKey: tripExpenseKeys.balances(tripId),
    queryFn: () => fetchTripBalances(tripId),
  });
  const balancesData = balancesQuery.data;
  const netBalances = balancesData?.net ?? [];
  const pairwiseBalances = balancesData?.pairwise ?? [];

  const drillDownQuery = useQuery<readonly BalanceDrillDownEntryDTO[]>({
    queryKey: tripExpenseKeys.drilldown(tripId, drillDownMemberId ?? ''),
    queryFn: () => fetchBalanceDrillDown(tripId, drillDownMemberId!),
    enabled: Boolean(drillDownMemberId),
  });
  const drillDownEntries = drillDownQuery.data ?? [];

  const pairwiseDrillDownQuery = useQuery<readonly BalanceDrillDownEntryDTO[]>({
    queryKey: tripExpenseKeys.drilldown(
      tripId,
      pairwiseBreakdownPair?.memberIdA ?? '',
      pairwiseBreakdownPair?.memberIdB ?? '',
    ),
    queryFn: () =>
      fetchBalanceDrillDown(
        tripId,
        pairwiseBreakdownPair!.memberIdA,
        pairwiseBreakdownPair!.memberIdB,
      ),
    enabled: Boolean(pairwiseBreakdownPair),
  });
  const pairwiseDrillDownEntries = pairwiseDrillDownQuery.data ?? [];

  const queryFilters: ListExpensesFilters | undefined = useMemo(() => {
    const f: { category?: string; payerId?: string } = {};
    if (selectedCategory !== 'all') f.category = selectedCategory;
    if (selectedPayerId !== 'all') f.payerId = selectedPayerId;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedCategory, selectedPayerId]);

  const ledgerQuery = useQuery<readonly (ExpenseDTO | SettlementDTO)[]>({
    queryKey: tripExpenseKeys.list(tripId, queryFilters),
    queryFn: () => fetchTripExpenses(tripId, queryFilters),
  });
  const ledgerItems = ledgerQuery.data ?? [];

  const callerMember = members.find((m) => m.userId === callerId);
  const isOrganizer = callerMember?.role === 'organizer';

  // The roster omits non-visible people, so a deleted payer / sharer / settlement
  // party found in the balances or the ledger is named "Deleted user" here rather
  // than falling back to a generic "Member" (account-deletion R6.4).
  const memberNameMap = useMemo(() => {
    const ids: string[] = [];
    for (const b of netBalances) ids.push(b.memberId);
    for (const p of pairwiseBalances) ids.push(p.memberIdA, p.memberIdB);
    for (const item of ledgerItems) {
      ids.push(item.payerId);
      if ('recipientId' in item) ids.push(item.recipientId);
    }
    return withDeletedUserNames(
      new Map(members.map((m) => [m.userId, m.displayName])),
      ids,
    );
  }, [members, netBalances, pairwiseBalances, ledgerItems]);

  const guestMap = useMemo(
    () => new Map(guests.map((g) => [g.id, g])),
    [guests],
  );

  const resolveParticipantName = (id: string): string => {
    if (memberNameMap.has(id)) {
      return memberNameMap.get(id)!;
    }
    const g = guestMap.get(id);
    if (g) {
      const sponsor = memberNameMap.get(g.sponsorMemberId) ?? 'Member';
      return `${sponsor} — ${g.name}`;
    }
    return 'Guest';
  };

  // Check if settle-up banner should be shown (Req 13.2)
  const showSettleUpBanner = useMemo(() => {
    if (!trip || trip.status !== 'past') return false;
    const balances = balancesQuery.data?.net ?? [];
    return balances.some((b: { netCents: number }) => b.netCents !== 0);
  }, [trip, balancesQuery.data]);

  // Current user's net status and pairwise debts
  const callerNet = useMemo(() => {
    return netBalances.find((b: NetBalanceDTO) => b.memberId === callerId);
  }, [netBalances, callerId]);

  const callerNetCents = callerNet?.netCents ?? 0;

  const pairwiseForCaller = useMemo(() => {
    const owedToCaller: { otherId: string; name: string; amountCents: number }[] = [];
    const callerOwes: { otherId: string; name: string; amountCents: number }[] = [];

    for (const pair of pairwiseBalances) {
      if (pair.memberIdA === callerId) {
        if (pair.aOwesBCents > 0) {
          callerOwes.push({
            otherId: pair.memberIdB,
            name: memberNameMap.get(pair.memberIdB) ?? 'Member',
            amountCents: pair.aOwesBCents,
          });
        } else if (pair.aOwesBCents < 0) {
          owedToCaller.push({
            otherId: pair.memberIdB,
            name: memberNameMap.get(pair.memberIdB) ?? 'Member',
            amountCents: Math.abs(pair.aOwesBCents),
          });
        }
      } else if (pair.memberIdB === callerId) {
        if (pair.aOwesBCents > 0) {
          owedToCaller.push({
            otherId: pair.memberIdA,
            name: memberNameMap.get(pair.memberIdA) ?? 'Member',
            amountCents: pair.aOwesBCents,
          });
        } else if (pair.aOwesBCents < 0) {
          callerOwes.push({
            otherId: pair.memberIdA,
            name: memberNameMap.get(pair.memberIdA) ?? 'Member',
            amountCents: Math.abs(pair.aOwesBCents),
          });
        }
      }
    }
    return { owedToCaller, callerOwes };
  }, [pairwiseBalances, callerId, memberNameMap]);

  // Total group spending in ledger
  const totalSpendingCents = useMemo(() => {
    return ledgerItems.reduce((sum, it) => {
      if ('splitMode' in it) {
        return sum + it.amountCents;
      }
      return sum;
    }, 0);
  }, [ledgerItems]);

  // Personal share across all group expenses for the caller (Req 10.5)
  const callerPersonalShareCents = useMemo(() => {
    return ledgerItems.reduce((sum, it) => {
      if ('splitMode' in it) {
        const isCallerPayer = it.payerId === callerId;
        const nonPayerSumCents = it.shares.reduce((s, sh) => s + sh.amountCents, 0);
        const payerShareCents = Math.max(0, it.amountCents - nonPayerSumCents);
        const callerShareObj = it.shares.find(
          (s) => (s.memberId ?? s.guestId) === callerId,
        );
        if (isCallerPayer) {
          return sum + payerShareCents;
        } else if (callerShareObj) {
          return sum + callerShareObj.amountCents;
        }
      }
      return sum;
    }, 0);
  }, [ledgerItems, callerId]);

  // Settled to date total (from settlements in ledger)
  const totalSettledCents = useMemo(() => {
    return ledgerItems.reduce((sum, it) => {
      if (!('splitMode' in it)) {
        return sum + it.amountCents;
      }
      return sum;
    }, 0);
  }, [ledgerItems]);

  // Grouped ledger items by date (Mockup specification)
  // Compute dynamically per render to avoid stale memoized references when test mocks mutate in-place
  const ledgerMap = new Map<string, (ExpenseDTO | SettlementDTO)[]>();
  for (const item of ledgerItems) {
    const d = item.date || 'Undated';
    const existing = ledgerMap.get(d);
    if (existing) {
      existing.push(item);
    } else {
      ledgerMap.set(d, [item]);
    }
  }
  const sortedDates = Array.from(ledgerMap.keys()).sort((a, b) => b.localeCompare(a));
  const groupedLedgerItems = sortedDates.map((date) => ({
    date,
    label: formatDateHeader(date),
    items: ledgerMap.get(date)!,
  }));

  // Toggle breakdown expanded state
  const toggleBreakdown = (expenseId: string) => {
    setExpandedExpenseIds((prev) => {
      const next = new Set(prev);
      if (next.has(expenseId)) {
        next.delete(expenseId);
      } else {
        next.add(expenseId);
      }
      return next;
    });
  };

  // Direct Settle Pairwise handler
  const handleSettlePair = (pair: PairwiseBalanceDTO) => {
    if (pair.aOwesBCents > 0) {
      setPrefillPayerId(pair.memberIdA);
      setPrefillRecipientId(pair.memberIdB);
      setPrefillAmountCents(pair.aOwesBCents);
    } else {
      setPrefillPayerId(pair.memberIdB);
      setPrefillRecipientId(pair.memberIdA);
      setPrefillAmountCents(Math.abs(pair.aOwesBCents));
    }
    setIsSettlementOpen(true);
  };

  // Pairwise Breakdown Openers (Req 6.7)
  const handleOpenPairwiseBreakdown = (pair: PairwiseBalanceDTO) => {
    if (pair.aOwesBCents >= 0) {
      setPairwiseBreakdownPair({
        memberIdA: pair.memberIdA,
        memberIdB: pair.memberIdB,
        aOwesBCents: pair.aOwesBCents,
      });
    } else {
      setPairwiseBreakdownPair({
        memberIdA: pair.memberIdB,
        memberIdB: pair.memberIdA,
        aOwesBCents: Math.abs(pair.aOwesBCents),
      });
    }
  };

  const handleOpenPairwiseBreakdownWith = (otherId: string) => {
    const match = pairwiseBalances.find(
      (p) =>
        (p.memberIdA === callerId && p.memberIdB === otherId) ||
        (p.memberIdB === callerId && p.memberIdA === otherId),
    );
    if (match) {
      handleOpenPairwiseBreakdown(match);
    } else {
      setPairwiseBreakdownPair({
        memberIdA: otherId,
        memberIdB: callerId,
        aOwesBCents: 0,
      });
    }
  };

  // Hero Settle Up handler
  const handleHeroSettleUp = () => {
    if (pairwiseForCaller.callerOwes.length > 0) {
      const debt = pairwiseForCaller.callerOwes[0]!;
      setPrefillPayerId(callerId);
      setPrefillRecipientId(debt.otherId);
      setPrefillAmountCents(debt.amountCents);
    } else if (pairwiseForCaller.owedToCaller.length > 0) {
      const debt = pairwiseForCaller.owedToCaller[0]!;
      setPrefillPayerId(debt.otherId);
      setPrefillRecipientId(callerId);
      setPrefillAmountCents(debt.amountCents);
    } else {
      setPrefillPayerId(undefined);
      setPrefillRecipientId(undefined);
      setPrefillAmountCents(undefined);
    }
    setIsSettlementOpen(true);
  };

  // Delete Mutations
  const deleteExpenseMutation = useMutation({
    mutationFn: (expenseId: string) => deleteExpense(tripId, expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
    },
    onError: (err: unknown) => {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete expense');
    },
  });

  const deleteSettlementMutation = useMutation({
    mutationFn: (settlementId: string) => deleteSettlement(tripId, settlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
    },
    onError: (err: unknown) => {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete settlement');
    },
  });

  // Export CSV Action (Req 13.3, 13.4)
  const handleExportCsv = async () => {
    try {
      const csv = await exportExpensesCsv(tripId);
      await Share.share({
        message: csv,
        title: `Trip Expenses - ${trip?.name ?? 'Ledger'}`,
      });
    } catch (err: unknown) {
      Alert.alert('Export Failed', err instanceof Error ? err.message : 'Could not export CSV');
    }
  };

  const isExpense = (item: ExpenseDTO | SettlementDTO): item is ExpenseDTO => {
    return 'splitMode' in item;
  };

  return (
    <ScreenContainer>
      <GradientHeader
        title={trip?.name ?? 'Trip Expenses'}
        subtitle={`${members.length} Members${guests.length > 0 ? ` • ${guests.length} Guest${guests.length > 1 ? 's' : ''}` : ''}`}
        onBack={() => navigation.goBack()}
        backTestID="trip-expenses-back-button"
        backAccessibilityLabel="Back to trip details"
        right={
          <View style={styles.headerRightActions}>
            <Pressable
              onPress={() => setIsManageGuestsOpen(true)}
              testID="manage-guests-button"
              accessibilityRole="button"
              accessibilityLabel="Manage trip guests"
              hitSlop={8}
              style={styles.headerIconButton}
            >
              <Ionicons name="people-outline" size={20} color={t.color.textOnPrimary} />
            </Pressable>
            <Pressable
              onPress={handleExportCsv}
              testID="trip-expenses-export-button"
              accessibilityRole="button"
              accessibilityLabel="Export ledger as CSV"
              hitSlop={8}
              style={styles.headerIconButton}
            >
              <Ionicons name="share-outline" size={20} color={t.color.textOnPrimary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('TripBalances', { tripId })}
              accessibilityRole="button"
              accessibilityLabel="View group balances"
              testID="view-balances-button"
              hitSlop={8}
              style={styles.headerIconButton}
            >
              <Ionicons name="wallet-outline" size={20} color={t.color.textOnPrimary} />
            </Pressable>
          </View>
        }
      />

      {/* Top Segmented Tab Switcher (Mockup Specification) */}
      <View style={styles.tabSwitcher} testID="trip-expenses-tab-switcher">
        <Pressable
          style={[styles.tabButton, activeTab === 'expenses' && styles.tabButtonActive]}
          onPress={() => setActiveTab('expenses')}
          testID="tab-expenses-btn"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'expenses' }}
        >
          <Ionicons
            name={activeTab === 'expenses' ? 'receipt' : 'receipt-outline'}
            size={15}
            color={activeTab === 'expenses' ? t.color.primaryFg : pal.tabIdleText}
          />
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'expenses' && styles.tabButtonTextActive,
            ]}
          >
            Expenses
          </Text>
          <View style={[styles.tabBadgePill, activeTab === 'expenses' ? styles.tabBadgePillActive : styles.tabBadgePillInactive]}>
            <Text style={[styles.tabBadgePillText, activeTab === 'expenses' ? styles.tabBadgePillTextActive : styles.tabBadgePillTextInactive]}>
              {ledgerItems.length}
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'balances' && styles.tabButtonActive]}
          onPress={() => setActiveTab('balances')}
          testID="tab-balances-btn"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'balances' }}
        >
          <Ionicons
            name={activeTab === 'balances' ? 'scale' : 'scale-outline'}
            size={15}
            color={activeTab === 'balances' ? t.color.primaryFg : pal.tabIdleText}
          />
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'balances' && styles.tabButtonTextActive,
            ]}
          >
            Who Owes What
          </Text>
          <View style={[styles.tabBadgePill, activeTab === 'balances' ? styles.tabBadgePillActive : styles.tabBadgePillInactive]}>
            <Text style={[styles.tabBadgePillText, activeTab === 'balances' ? styles.tabBadgePillTextActive : styles.tabBadgePillTextInactive]}>
              {pairwiseBalances.filter((p) => p.aOwesBCents !== 0).length || pairwiseBalances.length || 0}
            </Text>
          </View>
        </Pressable>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        {activeTab === 'expenses' ? (
          <>
            {/* Post-Trip Settle-Up Banner (Req 13.2, Task 16.2) */}
            {showSettleUpBanner ? (
              <Pressable
                onPress={() => navigation.navigate('TripBalances', { tripId })}
                testID="trip-expenses-settle-up-banner"
              >
                <Card style={styles.settleUpBanner}>
                  <View style={styles.bannerRow}>
                    <Ionicons name="sparkles" size={20} color={t.color.accent} />
                    <View style={styles.bannerTextWrap}>
                      <Text style={styles.bannerTitle}>Time to Settle Up!</Text>
                      <Text style={styles.bannerSubtitle}>
                        This trip is in the past and has outstanding balances. Tap to view simplified repayments.
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.color.primaryFg} />
                  </View>
                </Card>
              </Pressable>
            ) : null}

            {/* Vacation Balance Hero Card (Mockup Specification) */}
            <Card style={styles.heroBalanceCard} testID="expenses-balance-hero">
              {/* Row 1: Status Pill */}
              <View style={styles.heroHeaderPillRow}>
                <View style={[
                  styles.heroStatusPill,
                  callerNetCents > 0 ? styles.heroStatusPillOwed : callerNetCents < 0 ? styles.heroStatusPillOwes : styles.heroStatusPillSettled
                ]}>
                  <Ionicons
                    name={callerNetCents > 0 ? 'checkmark-circle' : callerNetCents < 0 ? 'hourglass-outline' : 'sparkles'}
                    size={12}
                    color={callerNetCents > 0 ? pal.greenText : callerNetCents < 0 ? pal.amberText : pal.violetText}
                  />
                  <Text style={[
                    styles.heroStatusPillText,
                    callerNetCents > 0 ? styles.heroStatusPillTextOwed : callerNetCents < 0 ? styles.heroStatusPillTextOwes : styles.heroStatusPillTextSettled
                  ]}>
                    {callerNetCents > 0 ? 'YOU ARE OWED OVERALL' : callerNetCents < 0 ? 'YOU OWE THE GROUP' : 'ALL SETTLED UP'}
                  </Text>
                  <Text style={styles.srOnly}>YOUR NET POSITION</Text>
                  <Text style={styles.srOnly}>
                    {callerNetCents > 0 ? 'You are owed overall' : callerNetCents < 0 ? 'You owe overall' : 'All settled'}
                  </Text>
                </View>
              </View>

              {/* Row 2 & 3: Big Net Figure & Caption */}
              <View style={styles.heroFigureWrap}>
                <Text
                  style={[
                    styles.heroFigureText,
                    callerNetCents > 0 ? styles.heroFigureTextPositive : callerNetCents < 0 ? styles.heroFigureTextNegative : styles.heroFigureTextZero
                  ]}
                  testID="hero-net-balance-figure"
                >
                  {callerNetCents > 0 ? `+$${(callerNetCents / 100).toFixed(2)}` : callerNetCents < 0 ? `-$${(Math.abs(callerNetCents) / 100).toFixed(2)}` : '$0.00'}
                </Text>
                <Text style={styles.heroCaptionText}>
                  {callerNetCents > 0
                    ? 'The group owes you across all shared expenses & settlements.'
                    : callerNetCents < 0
                    ? 'You owe the group for shared vacation expenses.'
                    : 'All vacation balances settled! No pending reimbursements.'}
                </Text>
              </View>

              {/* Row 4: 3-Cell Financial Stats Row */}
              <View style={styles.heroStatsRow} testID="hero-financial-stats-row">
                <View style={styles.heroStatCell}>
                  <Text style={styles.heroStatLabel}>TOTAL TRIP SPEND</Text>
                  <Text style={styles.heroStatVal} testID="hero-total-spend">
                    ${(totalSpendingCents / 100).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatCell}>
                  <Text style={styles.heroStatLabel}>YOUR NET SHARE</Text>
                  <Text style={styles.heroStatVal} testID="hero-personal-share">
                    ${(callerPersonalShareCents / 100).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatCell}>
                  <Text style={styles.heroStatLabel}>SETTLED TO DATE</Text>
                  <Text style={styles.heroStatVal} testID="hero-settled-total">
                    ${(totalSettledCents / 100).toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Row 5: Side-by-Side Hero Action Buttons */}
              <View style={styles.heroActionButtonsRow}>
                <Pressable
                  style={styles.heroPrimarySettleBtn}
                  onPress={handleHeroSettleUp}
                  testID="hero-settle-up-btn"
                  accessibilityRole="button"
                  accessibilityLabel="Log payment"
                >
                  <Ionicons name="swap-horizontal" size={15} color={t.color.textOnPrimary} />
                  <Text style={styles.heroPrimarySettleBtnText}>Log Payment</Text>
                </Pressable>

                <Pressable
                  style={styles.heroSecondaryStatementBtn}
                  onPress={() => setActiveTab('balances')}
                  testID="hero-view-balances-btn"
                  accessibilityRole="button"
                >
                  <Ionicons name="document-text-outline" size={15} color={pal.violetDeepText} />
                  <Text style={styles.heroSecondaryStatementBtnText}>Statement</Text>
                </Pressable>
              </View>

              {/* Row 6: Pending Repayments / Debtor Chips */}
              {pairwiseForCaller.callerOwes.length > 0 || pairwiseForCaller.owedToCaller.length > 0 ? (
                <View style={styles.heroDebtsSection}>
                  <Text style={styles.heroDebtsSectionLabel}>
                    {pairwiseForCaller.owedToCaller.length > 0 ? 'PENDING REPAYMENTS TO YOU:' : 'YOUR PENDING TRANSFERS:'}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.heroDebtsSnippetList}
                    keyboardShouldPersistTaps="handled"
                  >
                    {pairwiseForCaller.owedToCaller.map((d) => (
                      <Pressable
                        key={`owed-${d.otherId}`}
                        style={styles.heroDebtorChip}
                        onPress={() => handleOpenPairwiseBreakdownWith(d.otherId)}
                        testID={`hero-debt-item-${d.otherId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Settle debt with ${d.name}`}
                      >
                        <View style={[styles.debtAvatarMini, { backgroundColor: pal.owedBg }]}>
                          <Text style={[styles.debtAvatarText, { color: pal.owedText }]}>
                            {d.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.heroDebtorChipName}>
                          {d.name} owes you: <Text style={styles.heroDebtorChipAmount}>${(d.amountCents / 100).toFixed(2)}</Text>
                        </Text>
                      </Pressable>
                    ))}
                    {pairwiseForCaller.callerOwes.map((d) => (
                      <Pressable
                        key={`owe-${d.otherId}`}
                        style={styles.heroDebtorChip}
                        onPress={() => handleOpenPairwiseBreakdownWith(d.otherId)}
                        testID={`hero-debt-item-${d.otherId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Pay debt to ${d.name}`}
                      >
                        <View style={[styles.debtAvatarMini, { backgroundColor: pal.owesBg }]}>
                          <Text style={[styles.debtAvatarText, { color: pal.owesText }]}>
                            {d.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.heroDebtorChipName}>
                          You owe {d.name}: <Text style={[styles.heroDebtorChipAmount, { color: pal.owesText }]}>${(d.amountCents / 100).toFixed(2)}</Text>
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </Card>

            {/* Unified Filter Strip (Mockup Specification) */}
            <View style={styles.unifiedFilterBar} testID="category-filter-chips">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.unifiedFilterScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <Pressable
                  style={[styles.filterChip, selectedCategory === 'all' && styles.filterChipSelected]}
                  onPress={() => setSelectedCategory('all')}
                  testID="category-chip-all"
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedCategory === 'all' && styles.filterChipTextSelected,
                    ]}
                  >
                    ✨ All
                  </Text>
                </Pressable>
                {EXPENSE_CATEGORIES.map((cat) => {
                  const isSel = selectedCategory === cat;
                  const meta = getCategoryMeta(cat, t);
                  return (
                    <Pressable
                      key={cat}
                      style={[styles.filterChip, isSel && styles.filterChipSelected]}
                      onPress={() => setSelectedCategory(cat)}
                      testID={`category-filter-${cat}`}
                    >
                      <Text style={[styles.filterChipText, isSel && styles.filterChipTextSelected]}>
                        {meta.emoji} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}

                <View style={styles.filterDivider} />

                <View style={styles.payerSectionInline} testID="payer-filter-chips">
                  <Pressable
                    style={[styles.payerFilterChip, selectedPayerId === 'all' && styles.payerFilterChipSelected]}
                    onPress={() => setSelectedPayerId('all')}
                    testID="payer-chip-all"
                  >
                    <Text
                      style={[
                        styles.payerFilterChipText,
                        selectedPayerId === 'all' && styles.payerFilterChipTextSelected,
                      ]}
                    >
                      👤 All Payers
                    </Text>
                  </Pressable>
                  {members.map((m) => {
                    const isSel = selectedPayerId === m.userId;
                    return (
                      <Pressable
                        key={m.userId}
                        style={[styles.payerFilterChip, isSel && styles.payerFilterChipSelected]}
                        onPress={() => setSelectedPayerId(m.userId)}
                        testID={`payer-filter-${m.userId}`}
                      >
                        <View style={[styles.payerAvatarMini, isSel && styles.payerAvatarMiniSelected]}>
                          <Text style={[styles.payerAvatarMiniText, isSel && styles.payerAvatarMiniTextSelected]}>
                            {m.displayName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[styles.payerFilterChipText, isSel && styles.payerFilterChipTextSelected]}>
                          {m.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {/* Date-Grouped Ledger List (Mockup Specification) */}
            {ledgerQuery.isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={t.color.primaryFg} />
            ) : ledgerItems.length === 0 ? (
              <EmptyState
                title="No Expenses Yet"
                body="No expenses or settlements recorded yet. Tap '+ Expense' to track vacation spending."
                testID="empty-ledger-state"
              />
            ) : (
              groupedLedgerItems.map((group) => (
                <View key={group.date} style={styles.dateSectionContainer}>
                  <View style={styles.dateSectionHeader}>
                    <Text style={styles.dateSectionTitle}>{group.label}</Text>
                    <Text style={styles.dateSectionSum}>
                      {group.items.length} {group.items.length === 1 ? 'ENTRY' : 'ENTRIES'}
                    </Text>
                  </View>

                  <View style={styles.dateSectionItemsList}>
                    {group.items.map((item) => {
                      if (isExpense(item)) {
                        // EXPENSE ROW
                        const payerName = memberNameMap.get(item.payerId) ?? 'Member';
                        const canEdit = isOrganizer || item.createdByUserId === callerId;
                        const refundSumCents = item.refunds.reduce((s, r) => s + r.amountCents, 0);
                        const netCents = Math.max(0, item.amountCents - refundSumCents);
                        const catMeta = getCategoryMeta(item.category, t);

                        // Personal share calculation for current user (Req 10.5)
                        const isCallerPayer = item.payerId === callerId;
                        const nonPayerSumCents = item.shares.reduce((s, sh) => s + sh.amountCents, 0);
                        const payerShareCents = Math.max(0, item.amountCents - nonPayerSumCents);
                        const callerShareObj = item.shares.find(
                          (s) => (s.memberId ?? s.guestId) === callerId,
                        );

                        let personalShareText = '';
                        let personalShareTone: 'payer' | 'participant' | 'neutral' = 'neutral';

                        if (isCallerPayer) {
                          personalShareTone = 'payer';
                          if (nonPayerSumCents === 0) {
                            personalShareText = `You paid $${(item.amountCents / 100).toFixed(2)} (Solo)`;
                          } else if (payerShareCents === 0) {
                            personalShareText = `You paid $${(item.amountCents / 100).toFixed(2)} · Lent $${(item.amountCents / 100).toFixed(2)}`;
                          } else {
                            personalShareText = `You paid $${(item.amountCents / 100).toFixed(2)} · Lent $${(nonPayerSumCents / 100).toFixed(2)}`;
                          }
                        } else {
                          if (callerShareObj && callerShareObj.amountCents > 0) {
                            personalShareTone = 'participant';
                            personalShareText = `Paid by ${payerName} · Your share is $${(callerShareObj.amountCents / 100).toFixed(2)}`;
                          } else {
                            personalShareTone = 'neutral';
                            personalShareText = `Not in this split · Paid by ${payerName}`;
                          }
                        }

                        const isExpanded = expandedExpenseIds.has(item.id);

                        // Participant list for breakdown
                        const nonPayerParticipants = item.shares.map((s) => ({
                          id: (s.memberId ?? s.guestId)!,
                          amountCents: s.amountCents,
                          isPayer: false,
                        }));

                        const allExpenseParticipants = [
                          ...(payerShareCents > 0 || isCallerPayer
                            ? [{ id: item.payerId, amountCents: payerShareCents, isPayer: true }]
                            : []),
                          ...nonPayerParticipants,
                        ];

                        return (
                          <Card key={item.id} style={[styles.expenseCard, isExpanded && styles.expenseCardExpanded]} testID={`expense-card-${item.id}`}>
                            <Pressable
                              style={styles.expenseMainSurface}
                              onPress={() => toggleBreakdown(item.id)}
                              testID={`toggle-breakdown-${item.id}`}
                              accessibilityRole="button"
                            >
                              <View style={[styles.categoryAvatar, { backgroundColor: catMeta.bg, borderColor: catMeta.fg + '33' }]}>
                                <Text style={styles.categoryAvatarEmoji}>{catMeta.emoji}</Text>
                              </View>

                              <View style={styles.expenseInfoBlock}>
                                <View style={styles.expenseTitleRow}>
                                  <Text style={styles.expenseTitle} testID={`expense-desc-${item.id}`} numberOfLines={1}>
                                    {item.description}
                                  </Text>
                                  {item.resortId ? (
                                    <View style={styles.catalogTagGold}>
                                      <Text style={styles.catalogTagGoldText}>RESORT LINKED</Text>
                                    </View>
                                  ) : item.experienceId ? (
                                    <View style={styles.catalogTagGold}>
                                      <Text style={styles.catalogTagGoldText}>DINING LINKED</Text>
                                    </View>
                                  ) : (
                                    <View style={styles.splitModeBadge}>
                                      <Text style={styles.splitModeBadgeText}>{item.splitMode.toUpperCase()}</Text>
                                    </View>
                                  )}
                                </View>

                                <View style={styles.expenseMetaSubtitle}>
                                  <Text style={styles.expenseSubtitleText}>
                                    Paid by <Text style={styles.expenseSubtitlePayer}>{payerName}</Text> •{' '}
                                  </Text>
                                  <Text style={styles.expenseSubtitleText}>
                                    Split among {allExpenseParticipants.length} {allExpenseParticipants.length === 1 ? 'person' : 'people'}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.expenseAmountBlock}>
                                <Text style={styles.expenseTotalVal} testID={`expense-amount-${item.id}`}>
                                  ${(item.amountCents / 100).toFixed(2)}
                                </Text>
                                <View
                                  style={[
                                    styles.personalImpactTagWrap,
                                    personalShareTone === 'payer'
                                      ? styles.personalImpactTagWrapLent
                                      : personalShareTone === 'participant'
                                      ? styles.personalImpactTagWrapOwe
                                      : styles.personalImpactTagWrapSettled,
                                  ]}
                                  testID={`expense-personal-share-${item.id}`}
                                >
                                  <Text
                                    style={[
                                      styles.personalImpactTagText,
                                      personalShareTone === 'payer'
                                        ? styles.personalImpactLent
                                        : personalShareTone === 'participant'
                                        ? styles.personalImpactOwe
                                        : styles.personalImpactSettled,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {isCallerPayer
                                      ? nonPayerSumCents > 0
                                        ? `+lent $${(nonPayerSumCents / 100).toFixed(2)}`
                                        : 'You paid (Solo)'
                                      : callerShareObj && callerShareObj.amountCents > 0
                                      ? `-you owe $${(callerShareObj.amountCents / 100).toFixed(2)}`
                                      : 'Not in split'}
                                  </Text>
                                  <Ionicons
                                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                    size={11}
                                    color={
                                      personalShareTone === 'payer'
                                        ? pal.greenText
                                        : personalShareTone === 'participant'
                                        ? pal.amberText
                                        : pal.slate500Text
                                    }
                                  />
                                  <Text style={styles.srOnly}>{personalShareText}</Text>
                                </View>
                              </View>
                            </Pressable>

                            {refundSumCents > 0 ? (
                              <View style={styles.refundsBanner} testID={`expense-refunds-banner-${item.id}`}>
                                <Ionicons name="arrow-undo" size={12} color={pal.owesText} />
                                <Text style={styles.refundsText}>
                                  Refunded: ${(refundSumCents / 100).toFixed(2)} ·{' '}
                                  <Text style={{ fontWeight: '800' }}>
                                    Net: ${(netCents / 100).toFixed(2)}
                                  </Text>
                                </Text>
                              </View>
                            ) : null}

                            <View style={styles.cardActionsBar}>
                              <Pressable
                                style={styles.cardActionIconBtn}
                                onPress={() => setRefundingExpense(item)}
                                testID={`refund-expense-${item.id}`}
                                accessibilityRole="button"
                                accessibilityLabel="Refund expense"
                                hitSlop={6}
                              >
                                <Ionicons name="arrow-undo-outline" size={12} color={pal.slate600Text} />
                                <Text style={styles.cardActionBtnLabel}>Refund</Text>
                              </Pressable>

                              {canEdit ? (
                                <>
                                  <Pressable
                                    style={styles.cardActionIconBtn}
                                    onPress={() => setEditingExpense(item)}
                                    testID={`edit-expense-${item.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel="Edit expense"
                                    hitSlop={6}
                                  >
                                    <Ionicons name="pencil-outline" size={12} color={pal.slate600Text} />
                                    <Text style={styles.cardActionBtnLabel}>Edit</Text>
                                  </Pressable>
                                  <Pressable
                                    style={[styles.cardActionIconBtn, styles.cardActionIconBtnDanger]}
                                    onPress={() => deleteExpenseMutation.mutate(item.id)}
                                    testID={`delete-expense-${item.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel="Delete expense"
                                    hitSlop={6}
                                  >
                                    <Ionicons name="trash-outline" size={12} color={pal.dangerText} />
                                    <Text style={[styles.cardActionBtnLabel, styles.cardActionBtnLabelDanger]}>
                                      Delete
                                    </Text>
                                  </Pressable>
                                </>
                              ) : null}
                            </View>

                            {isExpanded ? (
                              <View style={styles.expenseExpandDrawer} testID={`expense-breakdown-${item.id}`}>
                                <View style={styles.drawerSplitHeader}>
                                  <Text style={styles.drawerSplitHeaderText}>
                                    {item.splitMode.charAt(0).toUpperCase() + item.splitMode.slice(1)} Split Breakdown ({allExpenseParticipants.length} participants)
                                  </Text>
                                  {item.splitMode === 'even' && allExpenseParticipants.length > 0 ? (
                                    <Text style={styles.drawerSplitHeaderSub}>
                                      ${(Math.round(item.amountCents / allExpenseParticipants.length) / 100).toFixed(2)} / person
                                    </Text>
                                  ) : null}
                                </View>

                                <View style={styles.drawerParticipantsList}>
                                  {allExpenseParticipants.map((p, pIdx) => {
                                    const pName = resolveParticipantName(p.id);
                                    const isP = p.id === callerId;

                                    let tierDetailStr = '';
                                    if (item.splitMode === 'tiered' && item.tierCounts && item.tiers) {
                                      const userTierCounts = item.tierCounts.filter(
                                        (tc) => (tc.memberId ?? tc.guestId) === p.id && tc.count > 0,
                                      );
                                      if (userTierCounts.length > 0) {
                                        tierDetailStr = userTierCounts
                                          .map((tc) => {
                                            const tierObj = item.tiers.find(
                                              (t) => t.id === tc.tierId || t.name === tc.tierId,
                                            );
                                            return `${tc.count} ${tierObj?.name ?? 'Ticket'}`;
                                          })
                                          .join(', ');
                                      }
                                    }

                                    return (
                                      <View key={`${p.id}-${pIdx}`} style={styles.participantRow}>
                                        <View style={styles.participantLeft}>
                                          <View style={[styles.participantAvatarMini, { backgroundColor: isP ? pal.violetFill : pal.neutralAvatarFill }]}>
                                            <Text style={styles.participantAvatarMiniText}>
                                              {pName.charAt(0).toUpperCase()}
                                            </Text>
                                          </View>
                                          <View>
                                            <Text style={styles.participantName}>
                                              {pName} {isP ? '(You)' : ''} {p.isPayer ? '👑' : ''}
                                            </Text>
                                            {tierDetailStr ? (
                                              <Text style={styles.participantRole}>{tierDetailStr}</Text>
                                            ) : (
                                              <Text style={styles.participantRole}>
                                                {p.isPayer ? `Paid $${(item.amountCents / 100).toFixed(2)}` : `Owes ${payerName}`}
                                              </Text>
                                            )}
                                          </View>
                                        </View>
                                        <Text style={[styles.participantShareVal, p.isPayer ? styles.participantSharePayer : styles.participantShareOwes]}>
                                          {p.isPayer
                                            ? `Net +$${(nonPayerSumCents / 100).toFixed(2)}`
                                            : `$${(p.amountCents / 100).toFixed(2)}`}
                                        </Text>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            ) : null}
                          </Card>
                        );
                      } else {
                        // SETTLEMENT ROW
                        const payerName = memberNameMap.get(item.payerId) ?? 'Member';
                        const recipientName = memberNameMap.get(item.recipientId) ?? 'Member';
                        const canEdit = isOrganizer || item.createdByUserId === callerId;

                        return (
                          <Card key={item.id} style={styles.settlementCard} testID={`settlement-card-${item.id}`}>
                            <View style={styles.expenseMainSurface}>
                              <View style={[styles.categoryAvatar, { backgroundColor: pal.owedBg, borderColor: pal.owedCardBorder }]}>
                                <Ionicons name="swap-horizontal" size={20} color={pal.greenText} />
                              </View>

                              <View style={styles.expenseInfoBlock}>
                                <View style={styles.expenseTitleRow}>
                                  <Text style={styles.expenseTitle} numberOfLines={1}>
                                    {payerName} paid {recipientName}
                                  </Text>
                                  <View style={styles.settlementTag}>
                                    <Text style={styles.settlementTagText}>SETTLEMENT</Text>
                                  </View>
                                </View>
                                <View style={styles.expenseMetaSubtitle}>
                                  <Text style={styles.expenseSubtitleText}>
                                    Direct Repayment • {item.date}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.expenseAmountBlock}>
                                <Text style={styles.settlementTotalVal} testID={`settlement-amount-${item.id}`}>
                                  ${(item.amountCents / 100).toFixed(2)}
                                </Text>
                                <Text style={styles.settlementSettledStatus}>Direct payment</Text>
                              </View>
                            </View>

                            {canEdit ? (
                              <View style={styles.cardActionsBar}>
                                <Pressable
                                  style={styles.cardActionIconBtn}
                                  onPress={() => setEditingSettlement(item)}
                                  testID={`edit-settlement-${item.id}`}
                                  accessibilityRole="button"
                                  accessibilityLabel="Edit settlement"
                                  hitSlop={6}
                                >
                                  <Ionicons name="pencil-outline" size={12} color={pal.slate600Text} />
                                  <Text style={styles.cardActionBtnLabel}>Edit</Text>
                                </Pressable>
                                <Pressable
                                  style={[styles.cardActionIconBtn, styles.cardActionIconBtnDanger]}
                                  onPress={() => deleteSettlementMutation.mutate(item.id)}
                                  testID={`delete-settlement-${item.id}`}
                                  accessibilityRole="button"
                                  accessibilityLabel="Delete settlement"
                                  hitSlop={6}
                                >
                                  <Ionicons name="trash-outline" size={12} color={pal.dangerText} />
                                  <Text style={[styles.cardActionBtnLabel, styles.cardActionBtnLabelDanger]}>
                                    Delete
                                  </Text>
                                </Pressable>
                              </View>
                            ) : null}
                          </Card>
                        );
                      }
                    })}
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          /* WHO OWES WHAT VIEW (Req 6.1-6.5, Req 10.5) */
          <View testID="who-owes-what-view">
            {/* Top Action Header Bar */}
            <View style={styles.whoOwesWhatTopHeader}>
              <View style={styles.whoOwesWhatTitleCol}>
                <Text style={styles.sectionHeaderTitle}>SIMPLIFIED DIRECT REPAYMENTS</Text>
                <Text style={styles.sectionHeaderSubtitle}>
                  Direct member-to-member repayments computed to minimize transfers.
                </Text>
              </View>
              <Pressable
                style={styles.recordSettlementCompactBtn}
                onPress={() => {
                  setPrefillPayerId(undefined);
                  setPrefillRecipientId(undefined);
                  setPrefillAmountCents(undefined);
                  setIsSettlementOpen(true);
                }}
                testID="open-record-settlement-btn"
                accessibilityRole="button"
                accessibilityLabel="Record a settlement"
              >
                <Ionicons name="swap-horizontal" size={14} color={t.color.textOnPrimary} />
                <Text style={styles.recordSettlementCompactBtnText}>+ Settle</Text>
              </Pressable>
            </View>

            {balancesQuery.isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={t.color.primaryFg} />
            ) : (
              <>
                {pairwiseBalances.length === 0 ? (
                  <EmptyState
                    title="All Settled Up!"
                    body="No outstanding debts between members."
                    testID="pairwise-empty-state"
                  />
                ) : (
                  pairwiseBalances.map((p: PairwiseBalanceDTO, idx: number) => {
                    const nameA = memberNameMap.get(p.memberIdA) ?? 'Member A';
                    const nameB = memberNameMap.get(p.memberIdB) ?? 'Member B';
                    const debtorId = p.aOwesBCents > 0 ? p.memberIdA : p.memberIdB;
                    const creditorId = p.aOwesBCents > 0 ? p.memberIdB : p.memberIdA;
                    const debtor = p.aOwesBCents > 0 ? nameA : nameB;
                    const creditor = p.aOwesBCents > 0 ? nameB : nameA;
                    const isCallerDebtor = debtorId === callerId;
                    const isCallerCreditor = creditorId === callerId;
                    const absDollars = (Math.abs(p.aOwesBCents) / 100).toFixed(2);
                    const isNonzero = p.aOwesBCents !== 0;

                    return (
                      <Card key={idx} style={styles.pairwiseCard} testID={`pairwise-card-${idx}`}>
                        <Pressable
                          style={styles.pairwiseCardTouchArea}
                          onPress={() => handleOpenPairwiseBreakdown(p)}
                          testID={`open-pairwise-breakdown-${idx}`}
                          accessibilityRole="button"
                          accessibilityLabel={`View mutual breakdown between ${debtor} and ${creditor}`}
                        >
                          <View style={styles.pairwiseRow}>
                            <View style={styles.pairwiseFlowWrap}>
                              {/* Debtor */}
                              <View style={styles.flowPartyCol}>
                                <View style={[styles.flowAvatarBubble, isCallerDebtor ? styles.flowAvatarCaller : styles.flowAvatarDebtor]}>
                                  <Text style={[styles.flowAvatarText, isCallerDebtor ? styles.flowAvatarCallerText : styles.flowAvatarDebtorText]}>
                                    {debtor.charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                                <Text style={styles.flowPartyName} numberOfLines={1}>
                                  {isCallerDebtor ? `${debtor} (You)` : debtor}
                                </Text>
                              </View>

                              {/* Arrow and Amount Center */}
                              <View style={styles.flowCenterCol}>
                                <Text style={styles.pairwiseAmount} testID={`pairwise-amount-${idx}`}>
                                  ${absDollars}
                                </Text>
                                <View style={styles.flowArrowLineRow}>
                                  <View style={styles.flowArrowLine} />
                                  <Ionicons name="arrow-forward-circle" size={16} color={t.color.primaryFg} />
                                </View>
                                <Text style={styles.pairwiseDebtText}>
                                  <Text style={{ fontWeight: '700' }}>{debtor}</Text> owes <Text style={{ fontWeight: '700' }}>{creditor}</Text>
                                </Text>
                              </View>

                              {/* Creditor */}
                              <View style={styles.flowPartyCol}>
                                <View style={[styles.flowAvatarBubble, isCallerCreditor ? styles.flowAvatarCallerGreen : styles.flowAvatarCreditor]}>
                                  <Text style={[styles.flowAvatarText, isCallerCreditor ? styles.flowAvatarCallerGreenText : styles.flowAvatarCreditorText]}>
                                    {creditor.charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                                <Text style={styles.flowPartyName} numberOfLines={1}>
                                  {isCallerCreditor ? `${creditor} (You)` : creditor}
                                </Text>
                              </View>
                            </View>

                            {isNonzero && !involvesDeletedUser(p.memberIdA, p.memberIdB) ? (
                              <Pressable
                                style={styles.settleBtn}
                                onPress={() => handleSettlePair(p)}
                                accessibilityRole="button"
                                testID={`settle-pair-btn-${idx}`}
                              >
                                <Ionicons name="checkmark-circle" size={15} color={t.color.textOnPrimary} />
                                <Text style={styles.settleBtnText}>Settle</Text>
                              </Pressable>
                            ) : null}
                          </View>

                          <View style={styles.pairwiseBreakdownHintRow}>
                            <Ionicons name="receipt-outline" size={12} color={t.color.primaryFg} />
                            <Text style={styles.pairwiseBreakdownHintText}>View transaction breakdown</Text>
                            <Ionicons name="chevron-forward" size={12} color={t.color.primaryFg} />
                          </View>
                        </Pressable>
                      </Card>
                    );
                  })
                )}

                {/* 2. NET GROUP BALANCES */}
                <View style={{ marginTop: 24 }}>
                  <Text style={styles.sectionHeaderTitle}>MEMBER NET BALANCES</Text>
                  <Text style={styles.sectionHeaderSubtitle}>
                    Tap any member to view their contributing expenses and settlements.
                  </Text>

                  {netBalances.length === 0 ? (
                    <EmptyState title="No Balances" body="No trip members found." />
                  ) : (
                    netBalances.map((b: NetBalanceDTO) => {
                      const name = memberNameMap.get(b.memberId) ?? 'Member';
                      const isZero = b.netCents === 0;
                      const isPositive = b.netCents > 0;
                      const absDollars = (Math.abs(b.netCents) / 100).toFixed(2);

                      return (
                        <Pressable
                          key={b.memberId}
                          onPress={() => setDrillDownMemberId(b.memberId)}
                          testID={`net-balance-card-${b.memberId}`}
                        >
                          <Card style={styles.balanceCard}>
                            <View style={styles.balanceCardRow}>
                              <View style={[styles.memberAvatarWrap, isPositive ? { backgroundColor: pal.owedBg } : !isZero ? { backgroundColor: pal.owesBg } : { backgroundColor: pal.greyPillBg }]}>
                                <Text style={[styles.avatarInitial, isPositive ? { color: pal.owedText } : !isZero ? { color: pal.owesText } : { color: pal.slate500Text }]}>
                                  {name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.memberInfo}>
                                <Text style={styles.memberName}>{name}</Text>
                                <View style={[styles.statusBadgePill, isZero ? styles.statusBadgeSettled : isPositive ? styles.statusBadgeOwed : styles.statusBadgeOwes]}>
                                  <Text
                                    style={[
                                      styles.balanceStatusText,
                                      isZero
                                        ? styles.statusSettled
                                        : isPositive
                                        ? styles.statusOwed
                                        : styles.statusOwes,
                                    ]}
                                    testID={`net-balance-status-${b.memberId}`}
                                  >
                                    {isZero
                                      ? 'Settled up'
                                      : isPositive
                                      ? `Owed $${absDollars}`
                                      : `Owes $${absDollars}`}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.drillDownArrow}>
                                <Text
                                  style={[
                                    styles.amountLarge,
                                    isZero
                                      ? styles.amountZero
                                      : isPositive
                                      ? styles.amountPositive
                                      : styles.amountNegative,
                                  ]}
                                  testID={`net-balance-amount-${b.memberId}`}
                                >
                                  {isZero ? '$0.00' : isPositive ? `+$${absDollars}` : `-$${absDollars}`}
                                </Text>
                                <Ionicons
                                  name="chevron-forward"
                                  size={16}
                                  color={t.color.textSecondary}
                                />
                              </View>
                            </View>
                          </Card>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Floating Add Expense Action Button */}
      {activeTab === 'expenses' ? (
        <Pressable
          style={styles.fabAddButton}
          onPress={() => setIsAddExpenseOpen(true)}
          testID="add-expense-button"
          accessibilityRole="button"
          accessibilityLabel="Add an expense"
        >
          <Ionicons name="add" size={18} color={t.color.textOnPrimary} />
          <Text style={styles.fabAddButtonText}>Expense</Text>
        </Pressable>
      ) : null}

      {/* Add Expense Modal */}
      {isAddExpenseOpen ? (
        <ExpenseFormModal
          visible={isAddExpenseOpen}
          tripId={tripId}
          members={members}
          guests={guests}
          callerId={callerId}
          onClose={() => setIsAddExpenseOpen(false)}
        />
      ) : null}

      {/* Edit Expense Modal */}
      {editingExpense ? (
        <ExpenseFormModal
          visible={Boolean(editingExpense)}
          tripId={tripId}
          initialExpense={editingExpense}
          members={members}
          guests={guests}
          callerId={callerId}
          onClose={() => setEditingExpense(null)}
        />
      ) : null}

      {/* Record Refund Modal */}
      {refundingExpense ? (
        <RefundModal
          visible={Boolean(refundingExpense)}
          tripId={tripId}
          expense={refundingExpense}
          onClose={() => setRefundingExpense(null)}
        />
      ) : null}

      {/* Settlement Modal (Edit or Settle Up) */}
      {isSettlementOpen ? (
        <SettlementModal
          visible={isSettlementOpen}
          tripId={tripId}
          members={members}
          prefillPayerId={prefillPayerId}
          prefillRecipientId={prefillRecipientId}
          prefillAmountCents={prefillAmountCents}
          onClose={() => setIsSettlementOpen(false)}
        />
      ) : null}

      {/* Edit Settlement Modal */}
      {editingSettlement ? (
        <SettlementModal
          visible={Boolean(editingSettlement)}
          tripId={tripId}
          members={members}
          initialSettlement={editingSettlement}
          onClose={() => setEditingSettlement(null)}
        />
      ) : null}

      {/* Manage Guests Modal */}
      {isManageGuestsOpen ? (
        <TripGuestManagementModal
          visible={isManageGuestsOpen}
          tripId={tripId}
          guests={guests}
          members={members}
          callerId={callerId}
          isOrganizer={isOrganizer}
          onClose={() => setIsManageGuestsOpen(false)}
        />
      ) : null}

      {/* Balance Drill-Down Modal (Req 6.4) */}
      {drillDownMemberId ? (
        <Modal
          visible={Boolean(drillDownMemberId)}
          animationType="slide"
          transparent
          onRequestClose={() => setDrillDownMemberId(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent} testID="balance-drilldown-modal">
              <View style={styles.modalHeader}>
                <View style={styles.drilldownHeaderLeft}>
                  <View style={styles.memberAvatarWrap}>
                    <Text style={styles.avatarInitial}>
                      {(memberNameMap.get(drillDownMemberId) ?? 'M').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.modalTitle}>
                      {memberNameMap.get(drillDownMemberId) ?? 'Member'}'s Activity
                    </Text>
                    {(() => {
                      const net = netBalances.find((b) => b.memberId === drillDownMemberId)?.netCents ?? 0;
                      const abs = (Math.abs(net) / 100).toFixed(2);
                      return (
                        <Text
                          style={[
                            styles.modalSub,
                            net > 0 ? { color: pal.owedText, fontWeight: '700' } : net < 0 ? { color: pal.owesText, fontWeight: '700' } : {},
                          ]}
                        >
                          {net === 0 ? 'All settled up ($0.00)' : net > 0 ? `Net position: +$${abs}` : `Net position: -$${abs}`}
                        </Text>
                      );
                    })()}
                  </View>
                </View>
                <Pressable
                  onPress={() => setDrillDownMemberId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  testID="close-drilldown-modal"
                  hitSlop={10}
                >
                  <Ionicons name="close" size={24} color={t.color.textPrimary} />
                </Pressable>
              </View>

              {drillDownQuery.isLoading ? (
                <ActivityIndicator style={{ marginVertical: 32 }} color={t.color.primaryFg} />
              ) : (
                <ScrollView style={styles.drillDownList}>
                  {drillDownEntries.length === 0 ? (
                    <Text style={styles.emptyText}>No activity for this member.</Text>
                  ) : (
                    drillDownEntries.map((entry, idx) => {
                      const isPositive = entry.contributionCents > 0;
                      const isZero = entry.contributionCents === 0;
                      const absDollars = (Math.abs(entry.contributionCents) / 100).toFixed(2);
                      const isSettlement = entry.kind === 'settlement';
                      return (
                        <View key={idx} style={styles.drillDownItem} testID={`drilldown-entry-${idx}`}>
                          <View
                            style={[
                              styles.drillDownIconCircle,
                              isSettlement ? { backgroundColor: pal.owedBg } : { backgroundColor: pal.expenseTint },
                            ]}
                          >
                            <Text style={{ fontSize: 16, ...t.textDefault }}>{isSettlement ? '🤝' : '🧾'}</Text>
                          </View>
                          <View style={styles.drillDownItemLeft}>
                            <Text style={styles.drillDownItemTitle}>{entry.description}</Text>
                            <Text style={styles.drillDownItemMeta}>
                              📅 {entry.date} · {isSettlement ? 'Settlement' : 'Expense'}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.drillDownAmount,
                              isZero ? styles.amountZero : isPositive ? styles.amountPositive : styles.amountNegative,
                            ]}
                          >
                            {isZero ? '$0.00' : isPositive ? `+$${absDollars}` : `-$${absDollars}`}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Pairwise Transaction Breakdown Modal (Req 6.7) */}
      {pairwiseBreakdownPair ? (
        <Modal
          visible={Boolean(pairwiseBreakdownPair)}
          animationType="slide"
          transparent
          onRequestClose={() => setPairwiseBreakdownPair(null)}
          testID="pairwise-breakdown-modal"
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent} testID="pairwise-breakdown-modal-content">
              {/* Header */}
              <View style={styles.modalHeader}>
                <View style={styles.pairwiseModalTitleWrap}>
                  <View style={styles.pairwiseAvatarPair}>
                    <View style={[styles.debtAvatarMini, styles.flowAvatarDebtor]}>
                      <Text style={styles.flowAvatarDebtorText}>
                        {(memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'M').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Ionicons name="swap-horizontal" size={16} color={t.color.primaryFg} />
                    <View style={[styles.debtAvatarMini, styles.flowAvatarCreditor]}>
                      <Text style={styles.flowAvatarCreditorText}>
                        {(memberNameMap.get(pairwiseBreakdownPair.memberIdB) ?? 'M').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      {memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member'} & {memberNameMap.get(pairwiseBreakdownPair.memberIdB) ?? 'Member'}
                    </Text>
                    <Text style={styles.pairwiseBreakdownSubtitle} testID="pairwise-modal-subtitle">
                      {(() => {
                        const nameA = memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member A';
                        const nameB = memberNameMap.get(pairwiseBreakdownPair.memberIdB) ?? 'Member B';
                        const amount = (Math.abs(pairwiseBreakdownPair.aOwesBCents ?? 0) / 100).toFixed(2);
                        if (!pairwiseBreakdownPair.aOwesBCents || pairwiseBreakdownPair.aOwesBCents === 0) {
                          return 'All settled up ($0.00)';
                        }
                        const isCallerA = pairwiseBreakdownPair.memberIdA === callerId;
                        const isCallerB = pairwiseBreakdownPair.memberIdB === callerId;
                        if (isCallerA) {
                          return `You owe ${nameB}: $${amount}`;
                        } else if (isCallerB) {
                          return `${nameA} owes you: $${amount}`;
                        }
                        return `${nameA} owes ${nameB}: $${amount}`;
                      })()}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setPairwiseBreakdownPair(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  testID="close-pairwise-breakdown-modal"
                  hitSlop={10}
                >
                  <Ionicons name="close" size={24} color={t.color.textPrimary} />
                </Pressable>
              </View>

              {/* Settle Up Action Button in Modal */}
              {pairwiseBreakdownPair.aOwesBCents &&
              pairwiseBreakdownPair.aOwesBCents !== 0 &&
              !involvesDeletedUser(
                pairwiseBreakdownPair.memberIdA,
                pairwiseBreakdownPair.memberIdB,
              ) ? (
                <View style={styles.pairwiseModalSettleRow}>
                  <Pressable
                    style={styles.pairwiseModalSettleBtn}
                    onPress={() => {
                      const pair = pairwiseBreakdownPair;
                      setPairwiseBreakdownPair(null);
                      setPrefillPayerId(pair.memberIdA);
                      setPrefillRecipientId(pair.memberIdB);
                      setPrefillAmountCents(Math.abs(pair.aOwesBCents ?? 0));
                      setIsSettlementOpen(true);
                    }}
                    testID="pairwise-modal-settle-btn"
                    accessibilityRole="button"
                  >
                    <Ionicons name="swap-horizontal" size={16} color={t.color.textOnPrimary} />
                    <Text style={styles.pairwiseModalSettleBtnText}>
                      Log Payment ${(Math.abs(pairwiseBreakdownPair.aOwesBCents) / 100).toFixed(2)}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* List Header */}
              <View style={styles.pairwiseListHeader}>
                <Text style={styles.pairwiseListHeaderText}>MUTUAL TRANSACTIONS</Text>
                <Text style={styles.pairwiseListHeaderCount}>
                  {pairwiseDrillDownEntries.length} {pairwiseDrillDownEntries.length === 1 ? 'item' : 'items'}
                </Text>
              </View>

              {/* Scrollable list */}
              {pairwiseDrillDownQuery.isLoading ? (
                <ActivityIndicator style={{ marginVertical: 32 }} color={t.color.primaryFg} />
              ) : (
                <ScrollView style={styles.drillDownList} testID="pairwise-drilldown-list">
                  {pairwiseDrillDownEntries.length === 0 ? (
                    <Text style={styles.emptyText} testID="pairwise-drilldown-empty">No mutual transactions between these members.</Text>
                  ) : (
                    pairwiseDrillDownEntries.map((entry, idx) => {
                      const isSettlement = entry.kind === 'settlement';
                      const absDollars = (Math.abs(entry.contributionCents) / 100).toFixed(2);
                      const isPositive = entry.contributionCents > 0;
                      const isZero = entry.contributionCents === 0;

                      const nameA = memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member A';

                      // Determine who paid and who received
                      const payerId = entry.payerId ?? (isSettlement ? pairwiseBreakdownPair.memberIdA : pairwiseBreakdownPair.memberIdB);
                      const recipientId = entry.recipientId ?? (isSettlement ? pairwiseBreakdownPair.memberIdB : pairwiseBreakdownPair.memberIdA);
                      const payerName = memberNameMap.get(payerId) ?? (payerId === callerId ? 'You' : 'Member');
                      const recipientName = memberNameMap.get(recipientId) ?? (recipientId === callerId ? 'You' : 'Member');

                      if (isSettlement) {
                        const isCallerPayer = payerId === callerId;
                        const isCallerRecipient = recipientId === callerId;
                        const title = isCallerRecipient
                          ? `Payment from ${payerName}`
                          : isCallerPayer
                          ? `Payment to ${recipientName}`
                          : `${payerName} paid ${recipientName}`;
                        const badgeText = isCallerRecipient
                          ? 'Payment Received'
                          : isCallerPayer
                          ? 'Payment Sent'
                          : 'Settlement Paid';

                        return (
                          <View
                            key={idx}
                            style={[styles.pairwiseEntryCard, styles.pairwiseSettlementCard]}
                            testID={`pairwise-entry-${idx}`}
                          >
                            <View style={[styles.pairwiseEntryIcon, styles.pairwiseSettlementIconWrap]}>
                              <Ionicons name="checkmark-circle" size={20} color={pal.owedText} />
                            </View>
                            <View style={styles.pairwiseEntryContent}>
                              <View style={styles.pairwiseTitleRow}>
                                <Text style={styles.pairwiseEntryTitle} numberOfLines={1}>
                                  {title}
                                </Text>
                                <View style={[styles.pairwiseBadge, styles.pairwiseSettlementBadge]}>
                                  <Text style={[styles.pairwiseBadgeText, styles.pairwiseSettlementBadgeText]}>
                                    {badgeText}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.pairwiseEntryMeta}>
                                📅 {entry.date} · Direct repayment · Reduced balance
                              </Text>
                            </View>
                            <View style={styles.pairwiseAmountCol}>
                              <Text
                                style={[styles.pairwiseAmountText, styles.pairwiseSettlementAmount]}
                                testID={`pairwise-entry-amount-${idx}`}
                              >
                                -${absDollars}
                              </Text>
                              <Text style={[styles.pairwiseAmountSub, { color: pal.paidDownText }]}>
                                Paid down
                              </Text>
                            </View>
                          </View>
                        );
                      }

                      // Expense entry
                      const payerDisplay = payerId === callerId
                        ? 'You'
                        : memberNameMap.get(payerId) ?? 'Member';
                      const isPayerCaller = payerId === callerId;
                      const expenseMeta = isPayerCaller
                        ? `📅 ${entry.date} · You paid · ${nameA}'s share`
                        : payerId === pairwiseBreakdownPair.memberIdA
                        ? `📅 ${entry.date} · ${nameA} paid · Shared expense`
                        : `📅 ${entry.date} · ${payerDisplay} paid · Shared expense`;

                      return (
                        <View
                          key={idx}
                          style={styles.pairwiseEntryCard}
                          testID={`pairwise-entry-${idx}`}
                        >
                          <View style={[styles.pairwiseEntryIcon, styles.pairwiseExpenseIconWrap]}>
                            <Text style={{ fontSize: 18, ...t.textDefault }}>🧾</Text>
                          </View>
                          <View style={styles.pairwiseEntryContent}>
                            <View style={styles.pairwiseTitleRow}>
                              <Text style={styles.pairwiseEntryTitle} numberOfLines={1}>
                                {entry.description}
                              </Text>
                              <View style={[styles.pairwiseBadge, styles.pairwiseExpenseBadge]}>
                                <Text style={[styles.pairwiseBadgeText, styles.pairwiseExpenseBadgeText]}>
                                  Shared Expense
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.pairwiseEntryMeta}>{expenseMeta}</Text>
                          </View>
                          <View style={styles.pairwiseAmountCol}>
                            <Text
                              style={[
                                styles.pairwiseAmountText,
                                isZero
                                  ? styles.amountZero
                                  : isPositive
                                  ? { color: t.color.textPrimary }
                                  : styles.amountNegative,
                              ]}
                              testID={`pairwise-entry-amount-${idx}`}
                            >
                              {isZero ? '$0.00' : isPositive ? `+$${absDollars}` : `-$${absDollars}`}
                            </Text>
                            <Text style={[styles.pairwiseAmountSub, { color: t.color.textSecondary }]}>
                              {isPositive ? 'Added to debt' : 'Your share'}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      ) : null}
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 130,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: EXPENSES[t.scheme].tabTrack,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].tabTrackBorder,
    padding: 4,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 999,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  tabButtonActive: {
    backgroundColor: EXPENSES[t.scheme].tabActiveBg,
    shadowColor: EXPENSES[t.scheme].tabActiveShadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
  tabButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: EXPENSES[t.scheme].tabIdleText,
  },
  tabButtonTextActive: {
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  tabBadgePill: {
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 10,
    marginLeft: 2,
  },
  tabBadgePillActive: {
    backgroundColor: EXPENSES[t.scheme].tabBadgeActiveBg,
  },
  tabBadgePillInactive: {
    backgroundColor: EXPENSES[t.scheme].tabBadgeIdleBg,
  },
  tabBadgePillText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  tabBadgePillTextActive: {
    color: t.color.primaryFg,
  },
  tabBadgePillTextInactive: {
    color: EXPENSES[t.scheme].tabIdleText,
  },
  settleUpBanner: {
    backgroundColor: EXPENSES[t.scheme].amberTint,
    borderColor: EXPENSES[t.scheme].amberStrongBorder,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerTextWrap: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: EXPENSES[t.scheme].bannerTitle,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: EXPENSES[t.scheme].amberDeepText,
    marginTop: 2,
    lineHeight: 16,
  },
  heroBalanceCard: {
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].violetCardBorder,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderRadius: 22,
    shadowColor: EXPENSES[t.scheme].heroShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  heroHeaderPillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  heroStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 20,
    borderWidth: 1,
  },
  heroStatusPillOwed: {
    backgroundColor: EXPENSES[t.scheme].greenTint,
    borderColor: EXPENSES[t.scheme].greenBorder,
  },
  heroStatusPillOwes: {
    backgroundColor: EXPENSES[t.scheme].amberTint,
    borderColor: EXPENSES[t.scheme].amberBorder,
  },
  heroStatusPillSettled: {
    backgroundColor: EXPENSES[t.scheme].greyPillBg,
    borderColor: EXPENSES[t.scheme].hairline,
  },
  heroStatusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroStatusPillTextOwed: {
    color: EXPENSES[t.scheme].greenText,
  },
  heroStatusPillTextOwes: {
    color: EXPENSES[t.scheme].amberText,
  },
  heroStatusPillTextSettled: {
    color: EXPENSES[t.scheme].slate500Text,
  },
  heroFigureWrap: {
    marginVertical: 4,
  },
  heroFigureText: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 2,
  },
  heroFigureTextPositive: {
    color: EXPENSES[t.scheme].greenText,
  },
  heroFigureTextNegative: {
    color: EXPENSES[t.scheme].amberText,
  },
  heroFigureTextZero: {
    color: EXPENSES[t.scheme].slate600Text,
  },
  heroCaptionText: {
    fontSize: 12,
    color: EXPENSES[t.scheme].slate500Text,
    fontWeight: '500',
    marginBottom: 12,
    lineHeight: 16,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: EXPENSES[t.scheme].subtleWellBg,
    borderColor: EXPENSES[t.scheme].hairline,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  heroStatCell: {
    flex: 1,
    alignItems: 'center',
  },
  heroStatLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: EXPENSES[t.scheme].slate500Text,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  heroStatVal: {
    fontSize: 13,
    fontWeight: '800',
    color: EXPENSES[t.scheme].inkText,
  },
  heroStatDivider: {
    width: 1,
    height: 22,
    backgroundColor: EXPENSES[t.scheme].hairline,
  },
  heroActionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  heroPrimarySettleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EXPENSES[t.scheme].violetFill,
    paddingVertical: 10,
    borderRadius: 14,
    shadowColor: EXPENSES[t.scheme].violetFillShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  heroPrimarySettleBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  heroSecondaryStatementBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EXPENSES[t.scheme].violetWellBg,
    borderColor: EXPENSES[t.scheme].violetButtonBorder,
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 14,
  },
  heroSecondaryStatementBtnText: {
    color: EXPENSES[t.scheme].violetDeepText,
    fontSize: 13,
    fontWeight: '700',
  },
  heroDebtsSection: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: EXPENSES[t.scheme].softDivider,
  },
  heroDebtsSectionLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: EXPENSES[t.scheme].slate400Text,
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  heroDebtsSnippetList: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 2,
  },
  heroDebtorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: EXPENSES[t.scheme].subtleWellBg,
    borderColor: EXPENSES[t.scheme].hairline,
    borderWidth: 1,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 8,
    borderRadius: 20,
  },
  debtAvatarMini: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtAvatarText: {
    fontSize: 9,
    fontWeight: '800',
  },
  heroDebtorChipName: {
    fontSize: 11,
    fontWeight: '600',
    color: EXPENSES[t.scheme].slate700Text,
  },
  heroDebtorChipAmount: {
    fontSize: 11,
    fontWeight: '800',
    color: EXPENSES[t.scheme].greenText,
  },
  unifiedFilterBar: {
    marginBottom: 12,
  },
  unifiedFilterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: EXPENSES[t.scheme].subtleWellBg,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].hairline,
  },
  filterChipSelected: {
    backgroundColor: EXPENSES[t.scheme].filterSelectedFill,
    borderColor: EXPENSES[t.scheme].filterSelectedFill,
    shadowColor: EXPENSES[t.scheme].filterSelectedShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  filterChipText: {
    fontSize: 11.5,
    color: EXPENSES[t.scheme].slate600Text,
    fontWeight: '600',
  },
  filterChipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '800',
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: EXPENSES[t.scheme].strongLine,
    marginHorizontal: 4,
  },
  payerSectionInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  payerFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 12,
    backgroundColor: EXPENSES[t.scheme].subtleWellBg,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].hairline,
  },
  payerFilterChipSelected: {
    backgroundColor: EXPENSES[t.scheme].payerSelectedBg,
    borderColor: EXPENSES[t.scheme].violetBorderStrong,
  },
  payerAvatarMini: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: EXPENSES[t.scheme].neutralAvatarFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  payerAvatarMiniSelected: {
    backgroundColor: EXPENSES[t.scheme].violetFill,
  },
  payerAvatarMiniText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  payerAvatarMiniTextSelected: {
    color: t.color.textOnPrimary,
  },
  payerFilterChipText: {
    fontSize: 11,
    color: EXPENSES[t.scheme].slate500Text,
    fontWeight: '600',
  },
  payerFilterChipTextSelected: {
    color: EXPENSES[t.scheme].violetDeepText,
    fontWeight: '800',
  },
  dateSectionContainer: {
    marginBottom: 14,
  },
  dateSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  dateSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: EXPENSES[t.scheme].slate500Text,
    letterSpacing: 0.8,
  },
  dateSectionSum: {
    fontSize: 10.5,
    fontWeight: '700',
    color: EXPENSES[t.scheme].slate400Text,
    letterSpacing: 0.5,
  },
  dateSectionItemsList: {
    gap: 8,
  },
  expenseCard: {
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].violetCardBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    shadowColor: EXPENSES[t.scheme].expenseShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  expenseCardExpanded: {
    borderColor: EXPENSES[t.scheme].violetBorderStrong,
    backgroundColor: EXPENSES[t.scheme].expandedBg,
    shadowOpacity: 0.08,
  },
  expenseMainSurface: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryAvatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryAvatarEmoji: {
    fontSize: 20,
    ...t.textDefault,
  },
  expenseInfoBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  expenseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 3,
  },
  expenseTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: EXPENSES[t.scheme].inkText,
    flexShrink: 1,
  },
  catalogTagGold: {
    backgroundColor: EXPENSES[t.scheme].amberBadgeBg,
    borderColor: EXPENSES[t.scheme].amberBorder,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  catalogTagGoldText: {
    fontSize: 9,
    fontWeight: '800',
    color: EXPENSES[t.scheme].amberDeepText,
    letterSpacing: 0.4,
  },
  splitModeBadge: {
    backgroundColor: EXPENSES[t.scheme].greyPillBg,
    borderColor: EXPENSES[t.scheme].hairline,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  splitModeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: EXPENSES[t.scheme].slate600Text,
    letterSpacing: 0.4,
  },
  expenseMetaSubtitle: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 2,
    rowGap: 2,
  },
  expenseSubtitleText: {
    fontSize: 11.5,
    color: EXPENSES[t.scheme].slate500Text,
    fontWeight: '500',
  },
  expenseSubtitlePayer: {
    fontWeight: '700',
    color: EXPENSES[t.scheme].slate700Text,
  },
  expenseAmountBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  expenseTotalVal: {
    fontSize: 15.5,
    fontWeight: '800',
    color: EXPENSES[t.scheme].inkText,
    letterSpacing: -0.3,
  },
  personalImpactTagWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  personalImpactTagWrapLent: {
    backgroundColor: EXPENSES[t.scheme].greenTint,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].greenBorder,
  },
  personalImpactTagWrapOwe: {
    backgroundColor: EXPENSES[t.scheme].amberTint,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].amberBorder,
  },
  personalImpactTagWrapSettled: {
    backgroundColor: EXPENSES[t.scheme].greyPillBg,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].hairline,
  },
  personalImpactTagText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  personalImpactLent: {
    color: EXPENSES[t.scheme].greenText,
  },
  personalImpactOwe: {
    color: EXPENSES[t.scheme].amberText,
  },
  personalImpactSettled: {
    color: EXPENSES[t.scheme].slate500Text,
  },
  cardActionsBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: EXPENSES[t.scheme].softDivider,
  },
  cardActionIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: EXPENSES[t.scheme].subtleWellBg,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].hairline,
  },
  cardActionIconBtnDanger: {
    backgroundColor: EXPENSES[t.scheme].dangerTint,
    borderColor: EXPENSES[t.scheme].dangerBorder,
  },
  cardActionBtnLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: EXPENSES[t.scheme].slate600Text,
  },
  cardActionBtnLabelDanger: {
    color: EXPENSES[t.scheme].dangerText,
  },
  expenseExpandDrawer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].violetCardBorder,
    borderWidth: 1,
    borderRadius: 12,
  },
  drawerSplitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: EXPENSES[t.scheme].softDivider,
  },
  drawerSplitHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: EXPENSES[t.scheme].violetText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  drawerSplitHeaderSub: {
    fontSize: 11,
    fontWeight: '700',
    color: EXPENSES[t.scheme].slate500Text,
  },
  drawerParticipantsList: {
    gap: 6,
  },
  participantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  participantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  participantAvatarMini: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarMiniText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  participantName: {
    fontSize: 12,
    fontWeight: '700',
    color: EXPENSES[t.scheme].slate800Text,
  },
  participantRole: {
    fontSize: 10.5,
    color: EXPENSES[t.scheme].slate500Text,
  },
  participantShareVal: {
    fontSize: 12,
    fontWeight: '800',
  },
  participantSharePayer: {
    color: EXPENSES[t.scheme].greenText,
  },
  participantShareOwes: {
    color: EXPENSES[t.scheme].slate800Text,
  },
  settlementCard: {
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].owedBorder,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 12,
    marginBottom: 10,
    shadowColor: EXPENSES[t.scheme].settlementShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  settlementTag: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
    borderColor: EXPENSES[t.scheme].owedBorder,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  settlementTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: EXPENSES[t.scheme].owedText,
    letterSpacing: 0.4,
  },
  settlementTotalVal: {
    fontSize: 15.5,
    fontWeight: '800',
    color: EXPENSES[t.scheme].greenText,
  },
  settlementSettledStatus: {
    fontSize: 10,
    fontWeight: '700',
    color: EXPENSES[t.scheme].greenText,
    backgroundColor: EXPENSES[t.scheme].greenTint,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].greenBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  fabAddButton: {
    position: 'absolute',
    bottom: 24,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: EXPENSES[t.scheme].violetFill,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 24,
    shadowColor: EXPENSES[t.scheme].violetFillShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabAddButtonText: {
    color: t.color.textOnPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    overflow: 'hidden',
  },
  refundsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: EXPENSES[t.scheme].refundBg,
    borderColor: EXPENSES[t.scheme].refundBorder,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 5,
  },
  refundsText: {
    fontSize: 10.5,
    color: EXPENSES[t.scheme].refundText,
  },
  whoOwesWhatTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  whoOwesWhatTitleCol: {
    flex: 1,
    paddingRight: 8,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: EXPENSES[t.scheme].slate600Text,
    letterSpacing: 0.8,
  },
  sectionHeaderSubtitle: {
    fontSize: 11.5,
    color: EXPENSES[t.scheme].slate500Text,
    marginTop: 2,
  },
  recordSettlementCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: EXPENSES[t.scheme].violetFill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    shadowColor: EXPENSES[t.scheme].violetFillShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  recordSettlementCompactBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  pairwiseCard: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].violetCardBorder,
    borderWidth: 1,
    shadowColor: EXPENSES[t.scheme].pairwiseShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  pairwiseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  pairwiseFlowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  flowPartyCol: {
    alignItems: 'center',
    minWidth: 54,
    maxWidth: 80,
  },
  flowAvatarBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  flowAvatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  flowAvatarDebtor: {
    backgroundColor: EXPENSES[t.scheme].owesBg,
  },
  flowAvatarDebtorText: {
    color: EXPENSES[t.scheme].owesText,
    fontWeight: '800',
    fontSize: 15,
  },
  flowAvatarCreditor: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
  },
  flowAvatarCreditorText: {
    color: EXPENSES[t.scheme].owedText,
    fontWeight: '800',
    fontSize: 15,
  },
  flowAvatarCaller: {
    backgroundColor: EXPENSES[t.scheme].amberBadgeBg,
  },
  flowAvatarCallerText: {
    color: EXPENSES[t.scheme].amberDeepText,
    fontWeight: '800',
    fontSize: 15,
  },
  flowAvatarCallerGreen: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
  },
  flowAvatarCallerGreenText: {
    color: EXPENSES[t.scheme].owedText,
    fontWeight: '800',
    fontSize: 15,
  },
  flowPartyName: {
    fontSize: 11,
    fontWeight: '700',
    color: EXPENSES[t.scheme].indigoText,
    textAlign: 'center',
    maxWidth: 78,
  },
  pairwiseCardTouchArea: {
    padding: 0,
  },
  pairwiseBreakdownHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 9,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: EXPENSES[t.scheme].softDivider,
  },
  pairwiseBreakdownHintText: {
    fontSize: 11,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  pairwiseModalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  pairwiseAvatarPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pairwiseBreakdownSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
    marginTop: 2,
  },
  pairwiseModalSettleRow: {
    marginBottom: 12,
  },
  pairwiseModalSettleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EXPENSES[t.scheme].logPaymentFill,
    paddingVertical: 10,
    borderRadius: 10,
  },
  pairwiseModalSettleBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  pairwiseListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: EXPENSES[t.scheme].softDivider,
    marginBottom: 8,
  },
  pairwiseListHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  pairwiseListHeaderCount: {
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  flowCenterCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  flowArrowLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 2,
    gap: 2,
  },
  flowArrowLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: EXPENSES[t.scheme].strongLine,
  },
  pairwiseDebtText: {
    fontSize: 9.5,
    color: EXPENSES[t.scheme].slate500Text,
    textAlign: 'center',
  },
  pairwiseAmount: {
    fontSize: 16,
    fontWeight: '900',
    color: EXPENSES[t.scheme].inkText,
  },
  settleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: EXPENSES[t.scheme].settleFill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    shadowColor: EXPENSES[t.scheme].settleShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  settleBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 11.5,
    fontWeight: '800',
  },
  balanceCard: {
    marginBottom: 8,
    padding: 13,
    borderRadius: 16,
    backgroundColor: t.color.surface,
    borderColor: EXPENSES[t.scheme].violetCardBorder,
    borderWidth: 1,
    shadowColor: EXPENSES[t.scheme].pairwiseShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
  },
  balanceCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: EXPENSES[t.scheme].avatarWellBg ?? EXPENSES[t.scheme].avatarWellFallback,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: EXPENSES[t.scheme].indigoText,
  },
  statusBadgePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  statusBadgeSettled: {
    backgroundColor: EXPENSES[t.scheme].greyPillBg,
  },
  statusBadgeOwed: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
  },
  statusBadgeOwes: {
    backgroundColor: EXPENSES[t.scheme].owesBg,
  },
  balanceStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusSettled: {
    color: EXPENSES[t.scheme].slate500Text,
    fontWeight: '500',
  },
  statusOwed: {
    color: EXPENSES[t.scheme].owedText,
    fontWeight: '700',
  },
  statusOwes: {
    color: EXPENSES[t.scheme].owesText,
    fontWeight: '700',
  },
  drillDownArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  amountLarge: {
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  amountPositive: {
    color: EXPENSES[t.scheme].owedText,
  },
  amountNegative: {
    color: EXPENSES[t.scheme].owesText,
  },
  amountZero: {
    color: EXPENSES[t.scheme].slate400Text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: EXPENSES[t.scheme].softDivider,
  },
  drilldownHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  modalSub: {
    fontSize: 11,
    color: t.color.textSecondary,
  },
  drillDownList: {
    maxHeight: 340,
  },
  drillDownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: EXPENSES[t.scheme].softDivider,
    gap: 10,
  },
  drillDownIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drillDownItemLeft: {
    flex: 1,
  },
  drillDownItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  drillDownItemMeta: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  drillDownAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  emptyText: {
    fontSize: 13,
    color: t.color.textSecondary,
    textAlign: 'center',
    marginVertical: 20,
  },
  pairwiseEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: EXPENSES[t.scheme].hairline,
    backgroundColor: t.color.surface,
    gap: 12,
  },
  pairwiseSettlementCard: {
    backgroundColor: EXPENSES[t.scheme].owedCardBg,
    borderColor: EXPENSES[t.scheme].owedCardBorder,
    borderWidth: 1.5,
  },
  pairwiseEntryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairwiseExpenseIconWrap: {
    backgroundColor: EXPENSES[t.scheme].expenseTint,
    borderColor: EXPENSES[t.scheme].expenseIconBorder,
    borderWidth: 1,
  },
  pairwiseSettlementIconWrap: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
    borderColor: EXPENSES[t.scheme].owedBorder,
    borderWidth: 1,
  },
  pairwiseEntryContent: {
    flex: 1,
  },
  pairwiseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  pairwiseEntryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  pairwiseBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pairwiseExpenseBadge: {
    backgroundColor: EXPENSES[t.scheme].expenseTint,
  },
  pairwiseSettlementBadge: {
    backgroundColor: EXPENSES[t.scheme].owedBg,
  },
  pairwiseBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  pairwiseExpenseBadgeText: {
    color: EXPENSES[t.scheme].expenseBadgeText,
  },
  pairwiseSettlementBadgeText: {
    color: EXPENSES[t.scheme].owedText,
  },
  pairwiseEntryMeta: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 3,
  },
  pairwiseAmountCol: {
    alignItems: 'flex-end',
  },
  pairwiseAmountText: {
    fontSize: 14,
    fontWeight: '800',
  },
  pairwiseAmountSub: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  pairwiseSettlementAmount: {
    color: EXPENSES[t.scheme].owedText,
  },
}));
