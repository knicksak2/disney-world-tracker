import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  type BudgetBucketDTO,
  type BudgetCategory,
  type BudgetDTO,
  type BudgetLineDTO,
  type BudgetSuggestionDTO,
  type TripDTO,
  type TripGuestDTO,
  type TripMemberDTO,
} from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { PriceBadge } from '../../components/PriceBadge';
import { GradientHeader } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { withAlpha } from '../../theme/theme';
import { TRIP_BUDGET_SCREEN } from './TripBudgetScreen.palette';
import {
  budgetKeys,
  fetchBudget,
  fetchBudgetSuggestions,
  useDeleteBudgetLine,
  useDismissBudgetSuggestion,
  useLinkBudgetLineExpense,
  usePatchBudgetSettings,
} from './budgetApi';
import { budgetLineToExpenseDraft } from './budgetToExpenseDraft';
import { ExpenseFormModal } from './ExpenseFormModal';
import { BudgetLineFormModal, type BudgetDraftProp } from './BudgetLineFormModal';
import { BudgetTravelersModal } from './BudgetTravelersModal';
import { BudgetSettingsModal } from './BudgetSettingsModal';

export type BudgetViewMode = 'party' | 'person' | 'day' | 'park' | 'category';

export const BUDGET_VIEW_MODES: readonly BudgetViewMode[] = [
  'party',
  'person',
  'day',
  'park',
  'category',
];

const VIEW_MODE_ICONS: Record<BudgetViewMode, keyof typeof Ionicons.glyphMap> = {
  party: 'grid-outline',
  person: 'people-outline',
  day: 'calendar-outline',
  park: 'compass-outline',
  category: 'albums-outline',
};

export const VIEW_MODE_TITLES: Record<BudgetViewMode, string> = {
  party: 'Categories',
  person: 'Crew Split',
  day: 'Daily Plan',
  park: 'By Park',
  category: 'Grouped',
};

export function formatCents(cents: number): string {
  const isNeg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return isNeg ? `-$${dollars}` : `$${dollars}`;
}

function formatFriendlyDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatAsOfDisplay(isoDate: string | null | undefined): string {
  if (!isoDate) return 'recently';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
  }
  const parsed = new Date(isoDate);
  if (isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface TripBudgetScreenProps {
  readonly route?: { params: { tripId: string } };
  readonly navigation?: { canGoBack?: () => boolean; goBack?: () => void } | unknown;
  readonly tripId?: string;
  readonly isOrganizer?: boolean;
}

const LINK_FAILED_TEXT = 'Expense saved, but it could not be linked to this budget line.';

const BUDGET_CATEGORY_META: Record<
  BudgetCategory,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  tickets: { label: 'Tickets & Passes', icon: 'ticket-outline' },
  lightning_lane: { label: 'Lightning Lane', icon: 'flash-outline' },
  dining: { label: 'Dining & Snacks', icon: 'restaurant-outline' },
  lodging: { label: 'Hotel & Lodging', icon: 'bed-outline' },
  transportation: { label: 'Transportation', icon: 'car-outline' },
  shopping: { label: 'Souvenirs & Merch', icon: 'bag-handle-outline' },
  other: { label: 'Other & Extras', icon: 'sparkles-outline' },
};

export function TripBudgetScreen(props: TripBudgetScreenProps) {
  const tripId = props.tripId ?? props.route?.params?.tripId ?? '';
  const isOrganizerProp = props.isOrganizer;

  const styles = useStyles();
  const palette = usePalette(TRIP_BUDGET_SCREEN);

  const [currentView, setCurrentView] = useState<BudgetViewMode>('party');

  // Modals state
  const [lineModalVisible, setLineModalVisible] = useState<boolean>(false);
  const [editingLine, setEditingLine] = useState<BudgetLineDTO | null>(null);
  const [activeSuggestionDraft, setActiveSuggestionDraft] = useState<BudgetDraftProp | null>(null);

  const [travelersModalVisible, setTravelersModalVisible] = useState<boolean>(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState<boolean>(false);

  // Queries
  const budgetQuery = useQuery<BudgetDTO>({
    queryKey: budgetKeys.detail(tripId),
    queryFn: () => fetchBudget(tripId),
    enabled: Boolean(tripId),
  });

  const suggestionsQuery = useQuery<readonly BudgetSuggestionDTO[]>({
    queryKey: budgetKeys.suggestions(tripId),
    queryFn: () => fetchBudgetSuggestions(tripId),
    enabled: Boolean(tripId),
  });

  const membersQuery = useQuery<readonly TripMemberDTO[]>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    enabled: Boolean(tripId),
  });

  const guestsQuery = useQuery<readonly TripGuestDTO[]>({
    queryKey: ['trips', tripId, 'guests'],
    queryFn: () => apiRequest<readonly TripGuestDTO[]>('GET', `/trips/${tripId}/guests`),
    enabled: Boolean(tripId),
  });

  const meQuery = useQuery<{ user?: { id?: string } }>({
    queryKey: ['me'],
    queryFn: () => apiRequest<{ user?: { id?: string } }>('GET', '/me'),
    // Always on: "Log as expense" needs the caller's id (the Expense payer defaults to the caller)
    // even when the `isOrganizer` prop is supplied.
    enabled: true,
  });

  const tripQuery = useQuery<TripDTO>({
    queryKey: ['trips', tripId],
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  // Mutations
  const dismissMutation = useDismissBudgetSuggestion(tripId);
  const deleteLineMutation = useDeleteBudgetLine(tripId);
  const patchBudgetSettings = usePatchBudgetSettings(tripId);

  // Log a Budget_Line as an Expense (trip-budget Requirement 23)
  const linkExpenseMutation = useLinkBudgetLineExpense(tripId);
  const [expenseDraftLine, setExpenseDraftLine] = useState<BudgetLineDTO | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const expenseDraft = useMemo(
    () => (expenseDraftLine ? budgetLineToExpenseDraft(expenseDraftLine) : null),
    [expenseDraftLine],
  );
  const callerUserId = meQuery.data?.user?.id;
  // The Expense form needs the member roster and the caller's id (it defaults the payer to the caller).
  const canLogExpense = Boolean(callerUserId) && Array.isArray(membersQuery.data);

  // Quick & Custom savings deposits
  const [showCustomDeposit, setShowCustomDeposit] = useState<boolean>(false);
  const [customDepositText, setCustomDepositText] = useState<string>('');

  const handleQuickDeposit = async (addCents: number) => {
    try {
      const currentSaved = budget?.savings?.savedCents ?? 0;
      await patchBudgetSettings.mutateAsync({
        savedCents: currentSaved + addCents,
      });
    } catch (err: unknown) {
      console.error('[TripBudgetScreen] Quick deposit failed:', err);
      Alert.alert('Deposit Failed', err instanceof Error ? err.message : 'Unable to record deposit');
    }
  };

  const handleToggleCustomDeposit = () => {
    setShowCustomDeposit((prev) => {
      const next = !prev;
      if (next && !customDepositText.trim()) {
        setCustomDepositText('250.00');
      }
      return next;
    });
  };

  const handleConfirmCustomDeposit = () => {
    const raw = customDepositText.trim() || '250.00';
    const dollars = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (!isNaN(dollars) && dollars > 0) {
      const addCents = Math.round(dollars * 100);
      void handleQuickDeposit(addCents);
      setCustomDepositText('');
      setShowCustomDeposit(false);
    }
  };

  // Determine if user is organizer
  const isOrganizer = useMemo(() => {
    if (isOrganizerProp !== undefined) return isOrganizerProp;
    const callerId = meQuery.data?.user?.id;
    const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
    return Boolean(
      callerId &&
        members.some((m) => {
          const raw = m as unknown as Record<string, unknown>;
          const mId = (m.userId ?? raw.id ?? raw.user_id) as string | undefined;
          return mId === callerId && m.role === 'organizer';
        })
    );
  }, [isOrganizerProp, meQuery.data?.user?.id, membersQuery.data]);

  const eyebrowText = useMemo(() => {
    const start = tripQuery.data?.startDate;
    const end = tripQuery.data?.endDate;
    if (!start || !end) return 'FINANCES & PLANNING';
    try {
      const s = new Date(`${start}T00:00:00Z`);
      const e = new Date(`${end}T00:00:00Z`);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'FINANCES & PLANNING';
      const sMonth = s.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
      const sDay = s.getUTCDate();
      const eDay = e.getUTCDate();
      const diffDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      return `🏰 ${sMonth} ${sDay} - ${eDay} · ${diffDays} DAYS`;
    } catch {
      return 'FINANCES & PLANNING';
    }
  }, [tripQuery.data?.startDate, tripQuery.data?.endDate]);

  const budget = budgetQuery.data;
  const suggestions = suggestionsQuery.data ?? [];

  // Handlers
  const handleOpenAddLine = () => {
    setEditingLine(null);
    setActiveSuggestionDraft(null);
    setLineModalVisible(true);
  };

  const handleEditLine = (line: BudgetLineDTO) => {
    setEditingLine(line);
    setActiveSuggestionDraft(null);
    setLineModalVisible(true);
  };

  const handleAcceptSuggestion = (s: BudgetSuggestionDTO) => {
    setEditingLine(null);
    setActiveSuggestionDraft({
      ...s.draft,
      suggestionKey: s.suggestionKey,
    });
    setLineModalVisible(true);
  };

  const handleDismissSuggestion = async (suggestionKey: string) => {
    try {
      await dismissMutation.mutateAsync({ suggestionKey });
    } catch {
      // handled by mutation error
    }
  };

  const handleLogAsExpense = (line: BudgetLineDTO) => {
    setLinkError(null);
    setExpenseDraftLine(line);
  };

  // After the Expense is saved: record which Expense the line became. A failure here never
  // re-creates the Expense (Requirement 23.9); the line simply stays unlinked.
  const handleExpenseSaved = async (lineId: string, expenseId: string) => {
    try {
      await linkExpenseMutation.mutateAsync({ lineId, expenseId });
    } catch {
      setLinkError(LINK_FAILED_TEXT);
      void budgetQuery.refetch();
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    try {
      await deleteLineMutation.mutateAsync(lineId);
    } catch {
      // handled by mutation error
    }
  };

  const navObj = props.navigation as
    | { canGoBack?: () => boolean; goBack?: () => void }
    | undefined;
  const canGoBack = typeof navObj?.canGoBack === 'function' ? navObj.canGoBack() : false;

  if (budgetQuery.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={palette.chipActiveBg} />
      </View>
    );
  }

  const lines = budget?.lines ?? [];
  const savings = budget?.savings;

  // Consolidated attribution footer detection (Requirements 21.3 & 21.4)
  const disneyLines = lines.filter(
    (l) => l.attribution === 'disney' || l.effectivePriceSource === 'disney_ticket_calendar'
  );
  const llLines = lines.filter(
    (l) => l.attribution === 'themeparks_wiki' || l.effectivePriceSource === 'themeparks_ll'
  );
  const latestDisneyAsOf =
    disneyLines.find((l) => Boolean(l.asOf))?.asOf ?? null;

  const membersList = (membersQuery.data ?? []).map((m, index) => {
    const raw = m as unknown as Record<string, unknown>;
    const id = (m.userId ?? raw.id ?? raw.user_id ?? `member-${index}`) as string;
    const name = (m.displayName ?? raw.name ?? raw.display_name ?? raw.email ?? `Member ${index + 1}`) as string;
    return {
      id,
      name,
      isGuest: false,
    };
  });

  const guestsList = (guestsQuery.data ?? []).map((g, index) => {
    const raw = g as unknown as Record<string, unknown>;
    const id = (g.id ?? raw.guestId ?? raw.guest_id ?? `guest-${index}`) as string;
    const name = (g.name ?? raw.displayName ?? raw.display_name ?? `Guest ${index + 1}`) as string;
    return {
      id,
      name,
      isGuest: true,
    };
  });

  const savingsPct =
    savings && savings.targetCents > 0
      ? Math.min(100, Math.max(0, Math.round((savings.savedCents / savings.targetCents) * 100)))
      : 0;

  const totalBudgetCents = budget?.totalCents ?? 0;

  const renderBucketCard = (
    b: BudgetBucketDTO,
    mode: Exclude<BudgetViewMode, 'party'>
  ) => {
    const sharePct =
      totalBudgetCents > 0
        ? Math.min(100, Math.max(0, Math.round((b.totalCents / totalBudgetCents) * 100)))
        : 0;

    let iconName: keyof typeof Ionicons.glyphMap = 'folder-outline';
    let friendlyHeading: string | null = null;
    let matchingLines: BudgetLineDTO[] = [];

    if (mode === 'person') {
      iconName = b.key === 'deleted-user' ? 'person-remove-outline' : 'person-outline';
      matchingLines = lines.filter((l) =>
        l.allocations.some(
          (a) => (a.memberId ?? a.guestId ?? 'deleted-user') === b.key
        )
      );
    } else if (mode === 'day') {
      iconName = 'calendar-outline';
      friendlyHeading = b.key === 'unscheduled' ? 'Flexible / Unscheduled' : formatFriendlyDate(b.key);
      matchingLines = lines.filter(
        (l) => (l.plannedDate ?? 'unscheduled') === b.key
      );
    } else if (mode === 'park') {
      iconName = 'compass-outline';
      matchingLines = lines.filter((l) => (l.park ?? 'none') === b.key);
    } else if (mode === 'category') {
      const catMeta = BUDGET_CATEGORY_META[b.key as BudgetCategory];
      iconName = catMeta?.icon ?? 'grid-outline';
      friendlyHeading = catMeta?.label ?? null;
      matchingLines = lines.filter((l) => l.category === b.key);
    }

    return (
      <View key={b.key} style={styles.bucketCardRich}>
        <View style={styles.bucketHeaderRow}>
          <View style={styles.bucketHeaderLeft}>
            <View style={styles.categoryIconWrap}>
              <Ionicons name={iconName} size={18} color={palette.categoryIconColor} />
            </View>
            <View style={styles.bucketTitleGroup}>
              {friendlyHeading && friendlyHeading !== b.label ? (
                <>
                  <Text style={styles.bucketFriendlyTitle}>{friendlyHeading}</Text>
                  <Text style={styles.bucketLabelSub} accessibilityLabel={b.label}>
                    {b.label}
                  </Text>
                </>
              ) : (
                <Text style={styles.bucketLabel} accessibilityLabel={b.label}>
                  {b.label}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.bucketHeaderRight}>
            <Text style={styles.bucketTotal}>{formatCents(b.totalCents)}</Text>
            <Text style={styles.bucketShareText}>{sharePct}% of total</Text>
          </View>
        </View>

        {/* Share of budget bar */}
        <View style={styles.bucketProgressBg}>
          <View style={[styles.bucketProgressFill, { width: `${sharePct}%` }]} />
        </View>

        {/* Subtotal / Tax / Tip breakdown computed from matching lines */}
        {matchingLines.length > 0 && mode !== 'person' && (
          <View style={styles.bucketMiniPillsRow}>
            <Text style={styles.bucketMiniPillText}>
              Sub: {formatCents(matchingLines.reduce((sum, l) => sum + l.subtotalCents, 0))}
            </Text>
            {matchingLines.some((l) => l.taxCents > 0) && (
              <Text style={styles.bucketMiniPillText}>
                Tax: {formatCents(matchingLines.reduce((sum, l) => sum + l.taxCents, 0))}
              </Text>
            )}
            {matchingLines.some((l) => l.tipCents > 0) && (
              <Text style={styles.bucketMiniPillText}>
                Tip: {formatCents(matchingLines.reduce((sum, l) => sum + l.tipCents, 0))}
              </Text>
            )}
          </View>
        )}

        {/* Matching lines preview */}
        {matchingLines.length > 0 && (
          <View style={styles.bucketLinesList}>
            {matchingLines.map((ml) => (
              <Pressable
                key={ml.id}
                onPress={() => handleEditLine(ml)}
                style={styles.bucketLineItem}
              >
                <Text style={styles.bucketLineDesc} numberOfLines={1}>
                  {ml.description}
                </Text>
                <Text style={styles.bucketLineAmt}>{formatCents(ml.totalCents)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <GradientHeader
        compact
        eyebrow={eyebrowText}
        title="Trip Budget"
        subtitle="Plan magical moments, track savings & compare to actual spend."
        icon="sparkles-outline"
        right={
          isOrganizer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => setSettingsModalVisible(true)}
              hitSlop={8}
              style={styles.settingsHeaderBtn}
            >
              <Ionicons name="settings-sharp" size={18} color={styles.actionBtnPrimaryText.color} />
            </Pressable>
          ) : undefined
        }
        onBack={canGoBack && navObj?.goBack ? () => navObj.goBack?.() : undefined}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Header with totals & actions */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerLabel}>TOTAL ESTIMATED BUDGET</Text>
            <View style={[styles.heroCountBadge, { backgroundColor: palette.heroBadgeBg }]}>
              <Ionicons name="people-outline" size={13} color={palette.heroBadgeText} />
              <Text style={[styles.heroCountBadgeText, { color: palette.heroBadgeText }]}>
                {Math.max(1, membersList.length + guestsList.length)}{' '}
                {membersList.length + guestsList.length === 1 ? 'Traveler' : 'Travelers'}
              </Text>
            </View>
          </View>
          <Text style={styles.headerTotal}>{formatCents(budget?.totalCents ?? 0)}</Text>
          <View style={styles.subtotalsRow}>
            <View style={styles.subtotalPill}>
              <Text style={styles.subtotalText}>
                Subtotal: {formatCents(budget?.subtotalCents ?? 0)}
              </Text>
            </View>
            <View style={styles.subtotalPill}>
              <Text style={styles.subtotalText}>
                Tax: {formatCents(budget?.taxCents ?? 0)}
              </Text>
            </View>
            <View style={styles.subtotalPill}>
              <Text style={styles.subtotalText}>
                Tip: {formatCents(budget?.tipCents ?? 0)}
              </Text>
            </View>
          </View>

          {/* Action buttons (Mockup layout: + Add Line Item, Crew) */}
          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add line"
              onPress={handleOpenAddLine}
              style={[styles.actionBtnPrimary, { flex: 1.2 }]}
            >
              <Ionicons name="sparkles" size={16} color={styles.actionBtnPrimaryText.color} />
              <Text style={styles.actionBtnPrimaryText}>+ Add Line Item</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Travelers"
              onPress={() => setTravelersModalVisible(true)}
              style={[styles.actionBtnSecondary, { flex: 1 }]}
            >
              <Ionicons name="people" size={16} color={palette.categoryIconColor} />
              <Text style={styles.actionBtnSecondaryText}>
                👥 Crew ( {Math.max(1, membersList.length + guestsList.length)} )
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Savings Plan Card (Mockup Pixie Dust Savings Fund) */}
        {savings && (
          <View style={styles.savingsCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderTitleGroup}>
                <Text style={{ fontSize: 16 }}>🧚</Text>
                <Text style={styles.cardHeading}>Savings Plan</Text>
                <Text style={styles.cardSubHeading}>Pixie Dust Fund</Text>
              </View>
              <View style={[styles.savingsStatusBadge, { backgroundColor: palette.savingsBadgeBg }]}>
                <Text style={[styles.savingsStatusBadgeText, { color: palette.savingsBadgeText, fontWeight: '700' }]}>
                  {formatCents(savings.savedCents)} Saved ({savingsPct}%)
                </Text>
              </View>
            </View>

            {savings.status === 'on_track' ? (
              <Text style={styles.savingsStatusText}>
                On track! Saved {formatCents(savings.savedCents)} of{' '}
                {formatCents(savings.targetCents)}.
              </Text>
            ) : savings.status === 'saving' ? (
              <View style={styles.savingsGoalBox}>
                <Text style={styles.savingsGoalLabel}>
                  Weekly Goal ({savings.weeksRemaining === 1 ? '1 week' : `${savings.weeksRemaining ?? 1} weeks`} until trip):
                </Text>
                <Text style={styles.savingsWeeklyText}>
                  Save {formatCents(savings.perWeekCents ?? 0)} per week
                </Text>
                <Text style={styles.savingsSubText}>
                  {formatCents(savings.remainingCents)} remaining over{' '}
                  {savings.weeksRemaining === 1
                    ? '1 week'
                    : `${savings.weeksRemaining ?? 1} weeks`}
                  .
                </Text>
              </View>
            ) : (
              <Text style={styles.savingsStatusText}>
                Trip started or past ({formatCents(savings.remainingCents)} remaining).
              </Text>
            )}

            {/* Visual progress bar */}
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${savingsPct}%` }]} />
            </View>

            {/* Milestones beneath progress bar */}
            <View style={styles.milestoneRow}>
              <View style={styles.milestoneItem}>
                <Ionicons name="ticket-outline" size={12} color={palette.savingsText} />
                <Text style={styles.milestoneText}>Tickets</Text>
              </View>
              <View style={styles.milestoneItem}>
                <Ionicons name="bed-outline" size={12} color={palette.savingsText} />
                <Text style={styles.milestoneText}>Resort</Text>
              </View>
              <View style={styles.milestoneItem}>
                <Ionicons name="sparkles" size={12} color={palette.savingsText} />
                <Text style={styles.milestoneText}>100% Ready</Text>
              </View>
            </View>

            {/* Quick Savings Deposits & Custom Deposit */}
            <View style={styles.quickDepositRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Deposit $50 to savings"
                onPress={() => handleQuickDeposit(5000)}
                style={styles.quickDepositBtn}
              >
                <Text style={styles.quickDepositBtnText}>+$50</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Deposit $100 to savings"
                onPress={() => handleQuickDeposit(10000)}
                style={styles.quickDepositBtn}
              >
                <Text style={styles.quickDepositBtnText}>+$100</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Custom deposit to savings"
                onPress={handleToggleCustomDeposit}
                style={styles.quickDepositBtn}
              >
                <Text style={styles.quickDepositBtnText}>✏️ +Custom</Text>
              </Pressable>
            </View>

            {showCustomDeposit && (
              <View style={styles.customDepositRow}>
                <Text style={styles.customDepositDollar}>$</Text>
                <TextInput
                  accessibilityLabel="Custom deposit amount"
                  value={customDepositText}
                  onChangeText={setCustomDepositText}
                  placeholder="250.00"
                  placeholderTextColor={palette.chipInactiveText}
                  keyboardType="numeric"
                  style={styles.customDepositInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm custom deposit"
                  onPress={handleConfirmCustomDeposit}
                  style={styles.customDepositConfirmBtn}
                >
                  <Text style={styles.customDepositConfirmText}>Deposit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close custom deposit"
                  onPress={() => setShowCustomDeposit(false)}
                  style={styles.customDepositCloseBtn}
                >
                  <Text style={styles.customDepositCloseText}>✕</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* View Mode Selector Chips with Modern Section Heading */}
        <Text style={styles.breakdownHeader}>EXPLORE BREAKDOWN</Text>
        <View style={styles.chipScrollWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {BUDGET_VIEW_MODES.map((mode) => {
              const isSelected = currentView === mode;
              const title = mode.charAt(0).toUpperCase() + mode.slice(1);
              const displayTitle = VIEW_MODE_TITLES[mode];
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setCurrentView(mode)}
                  style={[
                    styles.viewChip,
                    {
                      backgroundColor: isSelected
                        ? palette.chipActiveBg
                        : palette.chipInactiveBg,
                      borderColor: isSelected ? palette.chipActiveBg : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={VIEW_MODE_ICONS[mode]}
                    size={14}
                    color={isSelected ? palette.chipActiveText : palette.chipInactiveText}
                  />
                  <Text
                    style={[
                      styles.viewChipText,
                      {
                        color: isSelected
                          ? palette.chipActiveText
                          : palette.chipInactiveText,
                      },
                    ]}
                  >
                    {displayTitle}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Main View Display (Hero Breakdown Items) */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>
            {currentView === 'party'
              ? 'Budget Lines'
              : `By ${currentView.charAt(0).toUpperCase() + currentView.slice(1)}`}
          </Text>

          {linkError ? (
            <View
              style={styles.linkErrorBox}
              accessibilityLiveRegion="polite"
              testID="budget-link-error"
            >
              <Ionicons name="alert-circle-outline" size={16} color={palette.overByText} />
              <Text style={[styles.linkErrorText, { color: palette.overByText }]}>{linkError}</Text>
            </View>
          ) : null}

          {/* 1. Party view: list of lines */}
          {currentView === 'party' && (
            <>
              {lines.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="sparkles-outline" size={36} color={palette.categoryIconColor} />
                  <Text style={styles.emptyText}>
                    No budget lines yet. Tap 'Add line' to get started.
                  </Text>
                </View>
              ) : (
                lines.map((line) => {
                  const catMeta = BUDGET_CATEGORY_META[line.category] ?? {
                    label: line.category,
                    icon: 'receipt-outline' as const,
                  };
                  const friendlyDate = formatFriendlyDate(line.plannedDate);
                  const sharePct =
                    totalBudgetCents > 0
                      ? Math.round((line.totalCents / totalBudgetCents) * 100)
                      : 0;

                  return (
                    <Pressable
                      key={line.id}
                      onPress={() => handleEditLine(line)}
                      style={styles.lineCard}
                    >
                      <View style={styles.lineHeaderRow}>
                        <View style={styles.lineLeftGroup}>
                          <View style={styles.categoryIconWrap}>
                            <Ionicons
                              name={catMeta.icon}
                              size={18}
                              color={palette.categoryIconColor}
                            />
                          </View>
                          <View style={styles.lineTitleWrap}>
                            <Text style={styles.lineTitle} numberOfLines={2}>
                              {line.description}
                            </Text>
                            <Text style={styles.lineMeta}>
                              {friendlyDate ? friendlyDate : 'Whole Trip'}
                              {line.park ? ` · ${line.park}` : ''} · Sub {formatCents(line.subtotalCents)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.lineTotalWrap}>
                          <View style={styles.lineTotalTextCol}>
                            <Text style={styles.lineTotal}>{formatCents(line.totalCents)}</Text>
                            <Text style={styles.lineSharePct}>{sharePct}%</Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${line.description}`}
                            onPress={() => handleDeleteLine(line.id)}
                            hitSlop={8}
                            style={styles.lineDeleteBtn}
                          >
                            <Ionicons name="close-circle-outline" size={18} color={palette.hintText} />
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.lineFooterRow}>
                        <PriceBadge
                          priceLabelKind={line.priceLabelKind}
                          effectivePriceSource={line.effectivePriceSource}
                          asOfDate={line.asOf}
                          showAttribution={false}
                        />
                        {(line.taxCents > 0 || line.tipCents > 0) && (
                          <Text style={styles.lineTaxTipSummary}>
                            Sub {formatCents(line.subtotalCents)}
                            {line.taxCents > 0 ? ` + Tax ${formatCents(line.taxCents)}` : ''}
                            {line.tipCents > 0 ? ` + Tip ${formatCents(line.tipCents)}` : ''}
                          </Text>
                        )}
                      </View>

                      <View style={styles.lineExpenseRow}>
                        {line.linkedExpenseId ? (
                          <View
                            accessible
                            accessibilityLabel="Logged as expense"
                            style={styles.loggedMark}
                            testID={`logged-expense-${line.id}`}
                          >
                            <Ionicons name="checkmark-circle" size={14} color={palette.leftText} />
                            <Text style={[styles.loggedMarkText, { color: palette.leftText }]}>
                              Logged as expense
                            </Text>
                          </View>
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Log ${line.description} as expense`}
                            accessibilityState={{ disabled: !canLogExpense }}
                            disabled={!canLogExpense}
                            onPress={() => handleLogAsExpense(line)}
                            hitSlop={6}
                            style={[
                              styles.logExpenseBtn,
                              { borderColor: palette.savingsText, opacity: canLogExpense ? 1 : 0.5 },
                            ]}
                            testID={`log-expense-${line.id}`}
                          >
                            <Ionicons name="receipt-outline" size={14} color={palette.savingsText} />
                            <Text style={[styles.logExpenseBtnText, { color: palette.savingsText }]}>
                              Log as expense
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </>
          )}

          {/* 2. Person view: rich buckets */}
          {currentView === 'person' && (
            <View style={styles.bucketList}>
              {(budget?.byPerson ?? []).map((b) => renderBucketCard(b, 'person'))}
            </View>
          )}

          {/* 3. Day view: rich buckets */}
          {currentView === 'day' && (
            <View style={styles.bucketList}>
              {(budget?.byDay ?? []).map((b) => renderBucketCard(b, 'day'))}
            </View>
          )}

          {/* 4. Park view: rich buckets */}
          {currentView === 'park' && (
            <View style={styles.bucketList}>
              {(budget?.byPark ?? []).map((b) => renderBucketCard(b, 'park'))}
            </View>
          )}

          {/* 5. Category view: rich buckets */}
          {currentView === 'category' && (
            <View style={styles.bucketList}>
              {(budget?.byCategory ?? []).map((b) => renderBucketCard(b, 'category'))}
            </View>
          )}
        </View>

        {/* Suggestions List */}
        {suggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Magical Suggestions</Text>
            {suggestions.map((s) => (
              <View key={s.suggestionKey} style={styles.suggestionCard}>
                <View style={styles.suggestionLeftRow}>
                  <View style={styles.categoryIconWrap}>
                    <Ionicons name="sparkles" size={16} color={palette.categoryIconColor} />
                  </View>
                  <View style={styles.suggestionInfo}>
                    <Text style={styles.suggestionTitle}>{s.draft.description}</Text>
                    <Text style={styles.suggestionSub}>
                      {BUDGET_CATEGORY_META[s.draft.category]?.label ?? s.kind} ·{' '}
                      {s.draft.plannedDate ? formatFriendlyDate(s.draft.plannedDate) : 'Flexible date'}
                    </Text>
                  </View>
                </View>
                <View style={styles.suggestionActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Accept"
                    onPress={() => handleAcceptSuggestion(s)}
                    style={styles.acceptBtn}
                  >
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss"
                    onPress={() => handleDismissSuggestion(s.suggestionKey)}
                    style={styles.dismissBtn}
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Consolidated Pricing & Attribution Footer (Requirements 21.3 & 21.4) */}
        {(disneyLines.length > 0 || llLines.length > 0) && (
          <View
            style={[styles.attributionFooter, { backgroundColor: palette.footerBg }]}
            testID="budget-attribution-footer"
          >
            <View style={styles.attributionHeaderRow}>
              <Ionicons name="information-circle-outline" size={15} color={palette.hintText} />
              <Text style={styles.attributionTitle}>Price Sources & Disclaimers</Text>
            </View>
            {disneyLines.length > 0 && (
              <View style={styles.attributionBlock}>
                <Text style={styles.attributionText} accessibilityLabel="Disney price source attribution">
                  {`Prices from Disney's website, as of ${formatAsOfDisplay(latestDisneyAsOf)}; final price at checkout may differ`}
                </Text>
                <Text style={styles.attributionText} accessibilityLabel="Ticket price scope disclaimer">
                  Discounted, military, seller and special-offer prices are not covered.
                </Text>
              </View>
            )}
            {llLines.length > 0 && (
              <Text style={styles.attributionText} accessibilityLabel="Powered by ThemeParks.wiki">
                Powered by ThemeParks.wiki
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Add / Edit Budget Line Form Modal */}
      {lineModalVisible && (
        <BudgetLineFormModal
          key={editingLine?.id ?? activeSuggestionDraft?.suggestionKey ?? 'new-modal'}
          visible={lineModalVisible}
          tripId={tripId}
          tripStart={tripQuery.data?.startDate ?? budget?.travelers?.[0]?.ticketStartDate ?? null}
          tripEnd={tripQuery.data?.endDate ?? null}
          initialLine={editingLine}
          initialDraft={activeSuggestionDraft}
          travelers={budget?.travelers ?? []}
          settings={budget?.settings ?? null}
          members={membersList.length > 0 ? membersList : undefined}
          guests={guestsList.length > 0 ? guestsList : undefined}
          onCancel={() => {
            setLineModalVisible(false);
            setEditingLine(null);
            setActiveSuggestionDraft(null);
          }}
          onSaveSuccess={() => {
            setLineModalVisible(false);
            setEditingLine(null);
            setActiveSuggestionDraft(null);
          }}
        />
      )}

      {/* Log as expense: the Expense form, pre-filled from the chosen line (Requirement 23) */}
      {expenseDraftLine && expenseDraft && callerUserId && Array.isArray(membersQuery.data) ? (
        <ExpenseFormModal
          visible
          tripId={tripId}
          initialDraft={expenseDraft}
          members={membersQuery.data}
          guests={guestsQuery.data ?? []}
          callerId={callerUserId}
          onClose={() => setExpenseDraftLine(null)}
          onSaved={(expense) => handleExpenseSaved(expenseDraftLine.id, expense.id)}
        />
      ) : null}

      {/* Travelers Modal */}
      <BudgetTravelersModal
        visible={travelersModalVisible}
        tripId={tripId}
        travelers={budget?.travelers ?? []}
        members={membersList.length > 0 ? membersList : undefined}
        guests={guestsList.length > 0 ? guestsList : undefined}
        onClose={() => setTravelersModalVisible(false)}
      />

      {/* Settings Modal (Organizers only) */}
      <BudgetSettingsModal
        visible={settingsModalVisible}
        tripId={tripId}
        settings={budget?.settings ?? null}
        onClose={() => setSettingsModalVisible(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.color.background,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.color.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: t.spacing.md,
      paddingBottom: t.spacing.xl,
    },
    headerCard: {
      padding: t.spacing.lg,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      marginBottom: t.spacing.md,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLabel: {
      fontSize: 12,
      color: t.color.textSecondary,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    heroCountBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: t.radius.pill,
    },
    heroCountBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    headerTotal: {
      fontSize: 36,
      fontWeight: '800',
      color: t.color.textPrimary,
      marginVertical: t.spacing.xs,
    },
    subtotalsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.xs,
      marginBottom: t.spacing.md,
    },
    subtotalPill: {
      backgroundColor: t.color.surfaceAlt,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    subtotalText: {
      fontSize: 12,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
      marginTop: t.spacing.xs,
    },
    actionBtnPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: t.radius.md,
      backgroundColor: t.color.primary,
    },
    actionBtnPrimaryText: {
      color: t.color.textOnPrimary,
      fontWeight: '700',
      fontSize: 14,
    },
    actionBtnSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceAlt,
    },
    actionBtnSecondaryText: {
      color: t.color.textPrimary,
      fontWeight: '600',
      fontSize: 14,
    },
    chipScrollWrap: {
      marginBottom: t.spacing.md,
    },
    chipRow: {
      flexDirection: 'row',
      gap: t.spacing.xs,
    },
    viewChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: t.radius.pill,
      marginRight: t.spacing.xs,
      borderWidth: 1,
    },
    viewChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    savingsCard: {
      padding: t.spacing.md,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      marginBottom: t.spacing.md,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.spacing.xs,
    },
    cardHeaderTitleGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cardHeading: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    cardSubHeading: {
      fontSize: 12,
      fontWeight: '600',
      color: t.color.primaryFg,
    },
    savingsStatusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceAlt,
    },
    savingsStatusBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: t.color.primaryFg,
    },
    breakdownHeader: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: t.color.textSecondary,
      marginBottom: 6,
      marginTop: 8,
    },
    savingsGoalBox: {
      marginTop: 4,
    },
    savingsGoalLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    milestoneRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 6,
      paddingHorizontal: 2,
    },
    milestoneItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    milestoneText: {
      fontSize: 11,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    savingsWeeklyText: {
      fontSize: 18,
      fontWeight: '800',
      color: t.color.primaryFg,
      marginTop: 4,
    },
    savingsSubText: {
      fontSize: 13,
      color: t.color.textSecondary,
      marginTop: 2,
    },
    savingsStatusText: {
      fontSize: 14,
      color: t.color.textPrimary,
      fontWeight: '600',
      marginTop: 4,
    },
    progressBarBg: {
      height: 6,
      borderRadius: 3,
      backgroundColor: t.color.surfaceAlt,
      marginTop: t.spacing.md,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: t.color.primary,
      borderRadius: 3,
    },
    quickDepositRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: t.spacing.sm,
    },
    quickDepositBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.surfaceAlt,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    quickDepositBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: t.color.primaryFg,
    },
    customDepositRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border,
    },
    customDepositDollar: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textSecondary,
    },
    customDepositInput: {
      flex: 1,
      minHeight: 40,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceAlt,
      color: t.color.textPrimary,
      fontSize: 14,
      fontWeight: '600',
      textAlignVertical: 'center',
    },
    customDepositConfirmBtn: {
      minHeight: 40,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    customDepositConfirmText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.color.textOnPrimary,
    },
    customDepositCloseBtn: {
      minHeight: 40,
      paddingHorizontal: 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    customDepositCloseText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.color.textSecondary,
    },
    settingsHeaderBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(t.color.textOnPrimary, 0.15),
    },
    categoryIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.color.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    section: {
      marginBottom: t.spacing.md,
    },
    sectionHeading: {
      fontSize: 16,
      fontWeight: '700',
      color: t.color.textPrimary,
      marginBottom: t.spacing.sm,
    },
    suggestionCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: t.spacing.md,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      marginBottom: t.spacing.xs,
      gap: 8,
    },
    suggestionLeftRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    suggestionInfo: {
      flex: 1,
    },
    suggestionTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: t.color.textPrimary,
    },
    suggestionSub: {
      fontSize: 12,
      color: t.color.textSecondary,
      marginTop: 2,
    },
    suggestionActions: {
      flexDirection: 'row',
      gap: t.spacing.xs,
      flexShrink: 0,
    },
    acceptBtn: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.primary,
    },
    acceptText: {
      color: t.color.textOnPrimary,
      fontWeight: '700',
      fontSize: 13,
    },
    dismissBtn: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceAlt,
    },
    dismissText: {
      color: t.color.textSecondary,
      fontWeight: '600',
      fontSize: 13,
    },
    lineCard: {
      padding: t.spacing.md,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      marginBottom: t.spacing.sm,
    },
    lineHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
    },
    lineLeftGroup: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    lineTitleWrap: {
      flex: 1,
      minWidth: 0,
    },
    lineTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textPrimary,
      flexShrink: 1,
    },
    lineMeta: {
      fontSize: 12,
      color: t.color.textSecondary,
      marginTop: 3,
    },
    lineTotal: {
      fontSize: 16,
      fontWeight: '800',
      color: t.color.textPrimary,
    },
    lineTotalTextCol: {
      alignItems: 'flex-end',
      marginRight: 4,
    },
    lineSharePct: {
      fontSize: 11,
      fontWeight: '700',
      color: t.color.textSecondary,
      marginTop: 2,
    },
    lineTotalWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    lineDeleteBtn: {
      padding: 2,
    },
    lineFooterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border,
      gap: 6,
    },
    lineTaxTipSummary: {
      fontSize: 11,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    lineExpenseRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 8,
    },
    logExpenseBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: t.radius.lg,
      borderWidth: 1,
    },
    logExpenseBtnText: {
      fontSize: 12,
      fontWeight: '700',
    },
    loggedMark: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
    },
    loggedMarkText: {
      fontSize: 12,
      fontWeight: '700',
    },
    linkErrorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: t.spacing.sm,
    },
    linkErrorText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
    },
    emptyState: {
      padding: t.spacing.xl,
      alignItems: 'center',
      gap: 8,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    emptyText: {
      fontSize: 14,
      color: t.color.textSecondary,
      textAlign: 'center',
    },
    bucketList: {
      gap: t.spacing.sm,
    },
    bucketCardRich: {
      padding: t.spacing.md,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    bucketHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
    },
    bucketHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    bucketTitleGroup: {
      flex: 1,
    },
    bucketFriendlyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    bucketLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    bucketLabelSub: {
      fontSize: 11,
      color: t.color.textSecondary,
      marginTop: 1,
    },
    bucketHeaderRight: {
      alignItems: 'flex-end',
    },
    bucketTotal: {
      fontSize: 16,
      fontWeight: '800',
      color: t.color.textPrimary,
    },
    bucketShareText: {
      fontSize: 11,
      fontWeight: '600',
      color: t.color.textSecondary,
      marginTop: 1,
    },
    bucketProgressBg: {
      height: 5,
      borderRadius: 3,
      backgroundColor: t.color.surfaceAlt,
      marginTop: 10,
      overflow: 'hidden',
    },
    bucketProgressFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: t.color.primary,
    },
    bucketMiniPillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 8,
    },
    bucketMiniPillText: {
      fontSize: 11,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    bucketLinesList: {
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border,
      gap: 6,
    },
    bucketLineItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    bucketLineDesc: {
      fontSize: 13,
      color: t.color.textSecondary,
      flex: 1,
    },
    bucketLineAmt: {
      fontSize: 13,
      fontWeight: '600',
      color: t.color.textPrimary,
    },
    attributionFooter: {
      padding: t.spacing.md,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      marginTop: t.spacing.xs,
      gap: 6,
    },
    attributionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    attributionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: t.color.textSecondary,
    },
    attributionBlock: {
      gap: 2,
    },
    attributionText: {
      fontSize: 11,
      color: t.color.textSecondary,
      lineHeight: 15,
    },
  })
);
