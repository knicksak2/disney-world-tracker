/**
 * Trip Balances Screen (Tasks 12.1, 12.2, 12.3).
 *
 * Requirements:
 * - Net_Balance view (Card per member with signed amounts and clear "owed to them" / "they owe" framing, Req 6.1-6.3).
 * - Pairwise simplified view toggle (Req 6.5).
 * - Balance drill-down modal per member (Req 6.4).
 * - Settle-up flow pre-filling Settlement modal from nonzero pairwise balance (Req 7.7).
 * - Standalone "Record Settlement" action (Req 7.1).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.7
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type {
  TripMemberDTO,
  TripDTO,
  BalanceDrillDownEntryDTO,
  NetBalanceDTO,
  PairwiseBalanceDTO,
} from '@dwt/shared';

import type { TripsStackParamList } from '../../navigation/TripsStack';
import {
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { BALANCES } from './TripBalancesScreen.palette';
import { apiRequest } from '../../api/client';
import { involvesDeletedUser, withDeletedUserNames } from '../../components/presentPerson';
import { tripDetailKeys } from './tripDetailQueryKeys';
import {
  fetchTripBalances,
  fetchBalanceDrillDown,
  tripExpenseKeys,
} from './tripExpenseApi';
import { SettlementModal } from './SettlementModal';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripBalances'>;

export default function TripBalancesScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(BALANCES);
  const { tripId } = route.params;

  // View toggle: 'net' or 'pairwise' (Req 6.5)
  const [viewMode, setViewMode] = useState<'net' | 'pairwise'>('net');

  // Drill-down state (Req 6.4)
  const [drillDownMemberId, setDrillDownMemberId] = useState<string | null>(null);

  // Pairwise Breakdown Modal State (Req 6.7)
  const [pairwiseBreakdownPair, setPairwiseBreakdownPair] = useState<{
    memberIdA: string;
    memberIdB: string;
    aOwesBCents?: number;
  } | null>(null);

  // Settlement modal state (Req 7.7)
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [prefillPayerId, setPrefillPayerId] = useState<string | undefined>();
  const [prefillRecipientId, setPrefillRecipientId] = useState<string | undefined>();
  const [prefillAmountCents, setPrefillAmountCents] = useState<number | undefined>();

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

  const balancesQuery = useQuery({
    queryKey: tripExpenseKeys.balances(tripId),
    queryFn: () => fetchTripBalances(tripId),
  });
  const balancesData = balancesQuery.data;

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

  const netBalances = balancesData?.net ?? [];
  const pairwiseBalances = balancesData?.pairwise ?? [];

  // The roster omits non-visible people, so a deleted party found in the
  // balances is named "Deleted user" rather than a generic "Member"
  // (account-deletion R6.4).
  const memberNameMap = useMemo(() => {
    const ids: string[] = [];
    for (const b of netBalances) ids.push(b.memberId);
    for (const p of pairwiseBalances) ids.push(p.memberIdA, p.memberIdB);
    return withDeletedUserNames(
      new Map(members.map((m) => [m.userId, m.displayName])),
      ids,
    );
  }, [members, netBalances, pairwiseBalances]);

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

  const handleOpenGeneralSettlement = () => {
    setPrefillPayerId(undefined);
    setPrefillRecipientId(undefined);
    setPrefillAmountCents(undefined);
    setIsSettlementOpen(true);
  };

  return (
    <ScreenContainer>
      <GradientHeader
        title="Trip Balances"
        subtitle={trip?.name}
        onBack={() => navigation.goBack()}
        backTestID="trip-balances-back-button"
        backAccessibilityLabel="Back to expenses"
        right={
          <Pressable
            onPress={() => navigation.navigate('TripExpenses', { tripId })}
            accessibilityRole="button"
            accessibilityLabel="View ledger"
            hitSlop={8}
          >
            <Ionicons name="receipt-outline" size={22} color={t.color.textOnPrimary} />
          </Pressable>
        }
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        {/* View Toggle Bar (Req 6.5) */}
        <View style={styles.toggleRow} testID="balances-view-toggle">
          <Pressable
            style={[styles.toggleBtn, viewMode === 'net' && styles.toggleBtnActive]}
            onPress={() => setViewMode('net')}
            accessibilityRole="button"
            testID="toggle-net-balances"
          >
            <Text style={[styles.toggleText, viewMode === 'net' && styles.toggleTextActive]}>
              Net Balances
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, viewMode === 'pairwise' && styles.toggleBtnActive]}
            onPress={() => setViewMode('pairwise')}
            accessibilityRole="button"
            testID="toggle-pairwise-balances"
          >
            <Text style={[styles.toggleText, viewMode === 'pairwise' && styles.toggleTextActive]}>
              Pairwise Debts
            </Text>
          </Pressable>
        </View>

        {/* Record Settlement Action */}
        <View style={styles.toolbar}>
          <Pressable
            style={styles.recordSettlementHeroBtn}
            onPress={handleOpenGeneralSettlement}
            testID="open-record-settlement-btn"
            accessibilityRole="button"
            accessibilityLabel="Record a settlement"
          >
            <Ionicons name="swap-horizontal" size={16} color={t.color.textOnPrimary} />
            <Text style={styles.recordSettlementHeroBtnText}>+ Record a Settlement</Text>
          </Pressable>
        </View>

        {balancesQuery.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={t.color.primaryFg} />
        ) : viewMode === 'net' ? (
          /* NET BALANCES VIEW (Req 6.1-6.4) */
          <View style={styles.section} testID="net-balances-section">
            <SectionLabel>WHO IS OWED / WHO OWES</SectionLabel>
            <Text style={styles.sectionSubtitle}>
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
                        <View style={[styles.memberAvatarWrap, isPositive ? { backgroundColor: pal.owedBg } : !isZero ? { backgroundColor: pal.owesBg } : { backgroundColor: pal.settledBg }]}>
                          <Text style={[styles.avatarInitial, isPositive ? { color: pal.owedText } : !isZero ? { color: pal.owesText } : { color: pal.slateText }]}>
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
                          <Ionicons name="chevron-forward" size={16} color={t.color.textSecondary} />
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : (
          /* PAIRWISE VIEW (Req 6.5, 7.7) */
          <View style={styles.section} testID="pairwise-balances-section">
            <SectionLabel>SIMPLIFIED PAIRWISE DEBTS</SectionLabel>
            <Text style={styles.sectionSubtitle}>
              Direct member-to-member debts with single-tap settlement.
            </Text>

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
                const debtor = p.aOwesBCents > 0 ? nameA : nameB;
                const creditor = p.aOwesBCents > 0 ? nameB : nameA;
                const absDollars = (Math.abs(p.aOwesBCents) / 100).toFixed(2);
                const isNonzero = p.aOwesBCents !== 0;

                return (
                  <Card key={idx} style={styles.pairwiseCard} testID={`pairwise-card-${idx}`}>
                    <Pressable
                      onPress={() => handleOpenPairwiseBreakdown(p)}
                      testID={`open-pairwise-breakdown-${idx}`}
                      accessibilityRole="button"
                      accessibilityLabel={`View mutual breakdown between ${debtor} and ${creditor}`}
                    >
                      <View style={styles.pairwiseRow}>
                        <View style={styles.pairwiseInfo}>
                          <Text style={styles.pairwiseDebtText}>
                            <Text style={{ fontWeight: '700' }}>{debtor}</Text> owes{' '}
                            <Text style={{ fontWeight: '700' }}>{creditor}</Text>
                          </Text>
                          <Text style={styles.pairwiseAmount} testID={`pairwise-amount-${idx}`}>
                            ${absDollars}
                          </Text>
                        </View>
                        {isNonzero && !involvesDeletedUser(p.memberIdA, p.memberIdB) ? (
                          <Pressable
                            style={styles.settleBtn}
                            onPress={() => handleSettlePair(p)}
                            accessibilityRole="button"
                            testID={`settle-pair-btn-${idx}`}
                          >
                            <Ionicons name="checkmark-circle-outline" size={16} color={t.color.textOnPrimary} />
                            <Text style={styles.settleBtnText}>Settle</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      <View style={styles.pairwiseHintRow}>
                        <Ionicons name="receipt-outline" size={12} color={t.color.primaryFg} />
                        <Text style={styles.pairwiseHintText}>View transaction breakdown</Text>
                        <Ionicons name="chevron-forward" size={12} color={t.color.primaryFg} />
                      </View>
                    </Pressable>
                  </Card>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* Drill-Down Modal (Req 6.4) */}
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
                <Text style={styles.modalTitle}>
                  {memberNameMap.get(drillDownMemberId) ?? 'Member'}'s Activity
                </Text>
                <Pressable
                  onPress={() => setDrillDownMemberId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  testID="close-drilldown-modal"
                >
                  <Ionicons name="close" size={24} color={t.color.textPrimary} />
                </Pressable>
              </View>

              {drillDownQuery.isLoading ? (
                <ActivityIndicator style={{ marginVertical: 32 }} color={t.color.primaryFg} />
              ) : (
                <ScrollView style={styles.drillDownList} keyboardShouldPersistTaps="handled">
                  {drillDownEntries.length === 0 ? (
                    <Text style={styles.emptyText}>No activity for this member.</Text>
                  ) : (
                    drillDownEntries.map((entry, idx) => {
                      const isPositive = entry.contributionCents > 0;
                      const absDollars = (Math.abs(entry.contributionCents) / 100).toFixed(2);
                      return (
                        <View key={idx} style={styles.drillDownItem} testID={`drilldown-entry-${idx}`}>
                          <View style={styles.drillDownItemLeft}>
                            <Text style={styles.drillDownItemTitle}>{entry.description}</Text>
                            <Text style={styles.drillDownItemMeta}>
                              📅 {entry.date} · {entry.kind === 'expense' ? 'Expense' : 'Settlement'}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.drillDownItemAmount,
                              isPositive ? styles.amountPositive : styles.amountNegative,
                            ]}
                          >
                            {isPositive ? `+$${absDollars}` : `-$${absDollars}`}
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
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={1}>
                    {memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member'} & {memberNameMap.get(pairwiseBreakdownPair.memberIdB) ?? 'Member'}
                  </Text>
                  <Text style={styles.pairwiseModalSub} testID="pairwise-modal-subtitle">
                    {(() => {
                      const nameA = memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member A';
                      const nameB = memberNameMap.get(pairwiseBreakdownPair.memberIdB) ?? 'Member B';
                      const amount = (Math.abs(pairwiseBreakdownPair.aOwesBCents ?? 0) / 100).toFixed(2);
                      if (!pairwiseBreakdownPair.aOwesBCents || pairwiseBreakdownPair.aOwesBCents === 0) {
                        return 'All settled up ($0.00)';
                      }
                      return `${nameA} owes ${nameB}: $${amount}`;
                    })()}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setPairwiseBreakdownPair(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  testID="close-pairwise-breakdown-modal"
                >
                  <Ionicons name="close" size={24} color={t.color.textPrimary} />
                </Pressable>
              </View>

              {pairwiseBreakdownPair.aOwesBCents &&
              pairwiseBreakdownPair.aOwesBCents !== 0 &&
              !involvesDeletedUser(
                pairwiseBreakdownPair.memberIdA,
                pairwiseBreakdownPair.memberIdB,
              ) ? (
                <View style={{ marginBottom: 12 }}>
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

              {pairwiseDrillDownQuery.isLoading ? (
                <ActivityIndicator style={{ marginVertical: 32 }} color={t.color.primaryFg} />
              ) : (
                <ScrollView style={styles.drillDownList} testID="pairwise-drilldown-list" keyboardShouldPersistTaps="handled">
                  {pairwiseDrillDownEntries.length === 0 ? (
                    <Text style={styles.emptyText} testID="pairwise-drilldown-empty">No mutual transactions between these members.</Text>
                  ) : (
                    pairwiseDrillDownEntries.map((entry, idx) => {
                      const isSettlement = entry.kind === 'settlement';
                      const absDollars = (Math.abs(entry.contributionCents) / 100).toFixed(2);
                      const isPositive = entry.contributionCents > 0;
                      const isZero = entry.contributionCents === 0;

                      const nameA = memberNameMap.get(pairwiseBreakdownPair.memberIdA) ?? 'Member A';

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

      {/* Record Settlement Modal (Req 7.1, 7.7) */}
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
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: BALANCES[t.scheme].toggleTrack,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: BALANCES[t.scheme].toggleActiveBg,
    shadowColor: BALANCES[t.scheme].toggleActiveShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  toggleText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: BALANCES[t.scheme].slateText,
  },
  toggleTextActive: {
    color: BALANCES[t.scheme].inkText,
    fontWeight: '800',
  },
  toolbar: {
    marginBottom: 14,
  },
  recordSettlementHeroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BALANCES[t.scheme].heroFill,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    shadowColor: BALANCES[t.scheme].heroShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  recordSettlementHeroBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  section: {
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: t.color.textSecondary,
    marginBottom: 12,
  },
  balanceCard: {
    marginBottom: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: 1,
    shadowColor: t.shadow.card.shadowColor,
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
    color: BALANCES[t.scheme].inkText,
  },
  statusBadgePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
  },
  statusBadgeSettled: {
    backgroundColor: BALANCES[t.scheme].settledBg,
  },
  statusBadgeOwed: {
    backgroundColor: BALANCES[t.scheme].owedBg,
  },
  statusBadgeOwes: {
    backgroundColor: BALANCES[t.scheme].owesBg,
  },
  balanceStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusSettled: {
    color: BALANCES[t.scheme].slateText,
    fontWeight: '500',
  },
  statusOwed: {
    color: BALANCES[t.scheme].owedText,
    fontWeight: '700',
  },
  statusOwes: {
    color: BALANCES[t.scheme].owesText,
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
  amountZero: {
    color: BALANCES[t.scheme].zeroAmountText,
  },
  amountPositive: {
    color: BALANCES[t.scheme].owedText,
  },
  amountNegative: {
    color: BALANCES[t.scheme].owesText,
  },
  pairwiseCard: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.color.surface,
    borderColor: t.color.border,
    borderWidth: 1,
    shadowColor: t.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
  },
  pairwiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pairwiseInfo: {
    flex: 1,
  },
  pairwiseDebtText: {
    fontSize: 14,
    color: t.color.textPrimary,
  },
  pairwiseAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
    marginTop: 2,
  },
  settleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BALANCES[t.scheme].settleFill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  settleBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  drillDownList: {
    maxHeight: 400,
  },
  emptyText: {
    color: t.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 20,
  },
  drillDownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  drillDownItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  drillDownItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  drillDownItemMeta: {
    fontSize: 12,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  drillDownItemAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  pairwiseHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: BALANCES[t.scheme].hintDivider,
  },
  pairwiseHintText: {
    fontSize: 11,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  pairwiseModalSub: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
    marginTop: 2,
  },
  pairwiseModalSettleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: BALANCES[t.scheme].logPaymentFill,
    paddingVertical: 10,
    borderRadius: 10,
  },
  pairwiseModalSettleBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  pairwiseEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BALANCES[t.scheme].entryBorder,
    backgroundColor: t.color.surface,
    gap: 12,
  },
  pairwiseSettlementCard: {
    backgroundColor: BALANCES[t.scheme].settlementCardBg,
    borderColor: BALANCES[t.scheme].settlementCardBorder,
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
    backgroundColor: BALANCES[t.scheme].expenseTint,
    borderColor: BALANCES[t.scheme].expenseIconBorder,
    borderWidth: 1,
  },
  pairwiseSettlementIconWrap: {
    backgroundColor: BALANCES[t.scheme].owedBg,
    borderColor: BALANCES[t.scheme].settlementIconBorder,
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
    backgroundColor: BALANCES[t.scheme].expenseTint,
  },
  pairwiseSettlementBadge: {
    backgroundColor: BALANCES[t.scheme].owedBg,
  },
  pairwiseBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  pairwiseExpenseBadgeText: {
    color: BALANCES[t.scheme].expenseBadgeText,
  },
  pairwiseSettlementBadgeText: {
    color: BALANCES[t.scheme].owedText,
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
    color: BALANCES[t.scheme].owedText,
  },
}));
