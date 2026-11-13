// Feature: dining-plan-calculator — the Trip's Dining Plan screen (Requirements 1.1, 5.4, 14.5, 15.3–15.6,
// 19.1–19.10, 21.1–21.3, 22.1–22.4, 25, 26, 27).
//
// Presents a compact sticky 2-line verdict strip + fixed 4-tab bar (`Meals`, `Compare`, `Credits`, `Settings`).
// Every figure is the server's and every edit returns the recomputed `DiningPlanDTO` written into the query cache.

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  DINING_CONFIG_DEFAULTS,
  type DiningMealPeriod,
  type DiningPlanStayResultDTO,
  type DiningScenarioCode,
  type TripMemberDTO,
} from '@dwt/shared';

import { apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { EmptyState, GradientHeader, PrimaryButton, ScreenContainer, SecondaryButton } from '../../theme/components';
import { theme, withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { DiningBudgetExportSheet } from './DiningBudgetExportSheet';
import { DiningCompareCard } from './DiningCompareCard';
import { DiningCreditSummary, shownScenario } from './DiningMealList';
import { DiningResortChapters } from './DiningResortChapters';
import {
  DiningAboutFigures,
  DiningSensitivityTable,
  DiningTabBar,
  DiningVerdictCard,
  type DiningTabKey,
} from './DiningResultParts';
import { DiningSettingsForm } from './DiningSettingsSheet';
import { DiningSlotSheet } from './DiningSlotSheet';
import { Notice } from './diningPlanControls';
import {
  type DiningSlot,
  useDeleteDiningEntry,
  useDiningPlan,
  useImportDiningReservations,
  usePutDiningEntry,
  usePutDiningSettings,
} from './diningPlanApi';
import {
  bestScenario,
  canExportToBudget,
  headerMetaSummary,
  importActionLabel,
  importResultText,
  isSynthesizedStay,
  needsMealTimeText,
  PARTY_SIZE_MISMATCH_TEXT,
  partyBreakdownText,
  settingsChipLabel,
  stayDates,
  staySummaryText,
  suggestionSourceLabel,
  suggestionText,
  type DiningCalFilter,
} from './diningPlanView';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripDiningPlan'>;

interface MeResponse {
  readonly user?: { readonly id?: string };
}

/**
 * The settings' custom dates and stay type apply only to a single segment with no dated lodging (design.md
 * "Multi-Stay Extension"); with dated or several stays they are ignored, so the Settings form hides them.
 */
export function customStayApplies(stays: readonly DiningPlanStayResultDTO[] | undefined): boolean {
  if (stays === undefined) return true;
  return stays.length === 1 && (stays[0]!.source === 'implicit_no_lodging' || stays[0]!.source === 'legacy_resorts');
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'Something went wrong. Please try again.';
}

export default function TripDiningPlanScreen({ navigation, route }: Props): JSX.Element {
  const { tripId } = route.params;
  const styles = useStyles();
  const t = useAppTheme();
  const query = useDiningPlan(tripId);
  const putEntry = usePutDiningEntry(tripId);
  const deleteEntry = useDeleteDiningEntry(tripId);
  const putSettings = usePutDiningSettings(tripId);
  const importReservations = useImportDiningReservations(tripId);

  const [activeTab, setActiveTab] = useState<DiningTabKey>('meals');
  const [calFilter, setCalFilter] = useState<DiningCalFilter>('all');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [openSlot, setOpenSlot] = useState<DiningSlot | null>(null);
  const [listCode, setListCode] = useState<DiningScenarioCode | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const needsRole = (query.data?.result.stays ?? []).some(isSynthesizedStay);
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: needsRole,
  });
  const membersQuery = useQuery<readonly TripMemberDTO[]>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    staleTime: 30 * 1000,
    retry: false,
    enabled: needsRole,
  });
  const callerId = meQuery.data?.user?.id;
  const isOrganizer =
    needsRole && callerId !== undefined && Array.isArray(membersQuery.data) && membersQuery.data.some((m) => m.userId === callerId && m.role === 'organizer');

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const plan = query.data;
  const headerSubtitle = plan !== undefined ? headerMetaSummary(plan.party.length, plan.stay) : undefined;
  const chipLabel = plan !== undefined ? settingsChipLabel(plan.settings, plan.result.assumptions.tipBps) : null;
  const headerRight =
    chipLabel !== null ? (
      <Pressable
        onPress={() => setActiveTab('settings')}
        accessibilityRole="button"
        accessibilityLabel={`How you eat and other settings: ${chipLabel}`}
        testID="dining-open-settings"
        style={({ pressed }) => [
          styles.settingsChip,
          { backgroundColor: withAlpha(t.color.textOnPrimary, 0.14), borderColor: withAlpha(t.color.textOnPrimary, 0.28) },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.settingsChipText, { color: t.color.textOnPrimary }]} numberOfLines={1}>
          {chipLabel}
        </Text>
        <Ionicons name="settings-outline" size={12} color={t.color.textOnPrimary} />
      </Pressable>
    ) : undefined;

  const header = <GradientHeader title="Dining Plan" icon="restaurant-outline" subtitle={headerSubtitle} right={headerRight} compact onBack={handleBack} />;

  if (plan === undefined && query.isError) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="dining-plan-error">
          <EmptyState icon="cloud-offline-outline" title="We couldn't load the dining plan" body="Please check your connection and try again." />
          <PrimaryButton label="Retry" icon="refresh-outline" onPress={() => void query.refetch()} testID="dining-plan-retry" />
        </View>
      </ScreenContainer>
    );
  }

  if (plan === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="dining-plan-loading">
          <ActivityIndicator color={t.color.primaryFg} size="large" accessibilityLabel="Loading the dining plan" />
        </View>
      </ScreenContainer>
    );
  }

  const { result } = plan;
  const a = result.assumptions;
  const pendingSuggestions = plan.suggestions.filter((s) => !s.alreadyHasEntry);
  const newSuggestions = pendingSuggestions.length;
  const mismatchCount = pendingSuggestions.filter((s) => s.partySizeMismatch).length;
  const shown = shownScenario(result, listCode);
  const creditScenario = shown?.credits != null ? shown : bestScenario(result);
  const slotEntry = openSlot === null ? undefined : plan.entries.find((e) => e.date === openSlot.date && e.mealPeriod === openSlot.mealPeriod);
  const slotLine = openSlot === null ? undefined : shown?.meals.find((m) => m.date === openSlot.date && m.mealPeriod === openSlot.mealPeriod);
  const coveredHotelLabel =
    slotLine?.coveredByStayKey != null && (result.stays ?? []).length > 1
      ? result.stays?.find((s) => s.key === slotLine.coveredByStayKey)?.label ?? null
      : null;

  const fallbackStays: readonly DiningPlanStayResultDTO[] = result.stays ?? [
    {
      key: 'stay',
      label: staySummaryText(plan.stay),
      lodgingKind: plan.settings.stayType === 'not_disney_resort' ? 'offsite' : 'resort',
      checkIn: plan.stay.checkIn,
      checkOut: plan.stay.checkOut,
      nights: plan.stay.nights,
      partyCount: plan.party.length,
      status: 'compare',
      heldPlan: null,
      channel: plan.settings.stayType === 'dvc_or_passholder_resort' ? 'dvc_or_passholder' : 'package',
      source: 'stay',
      available: result.verdict !== 'plan_unavailable',
      unavailableReason: null,
      recommendedPlan: result.bestPlan ?? 'none',
      planCostCents: 0,
      credits: null,
      contributionCents: 0,
    },
  ];
  const daysCount = stayDates(plan.stay.checkIn, plan.stay.checkOut).length;

  function openSlotSheet(date: string, mealPeriod: DiningMealPeriod): void {
    setOpenSlot({ date, mealPeriod });
  }

  function runImport(): void {
    setImportError(null);
    setImportMessage(null);
    importReservations.mutate(
      { overwrite: false },
      {
        onSuccess: (r) => setImportMessage(importResultText(r)),
        onError: (err) => setImportError(messageOf(err)),
      },
    );
  }

  return (
    <ScreenContainer>
      {header}
      <View style={styles.stickyTop} testID="dining-plan-screen">
        <DiningVerdictCard result={result} />
        <View style={styles.tabWrap}>
          <DiningTabBar activeTab={activeTab} onSelectTab={setActiveTab} daysCount={daysCount} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {activeTab === 'meals' ? (
          <View testID="dining-pane-meals">
            {newSuggestions > 0 ? (
              <View style={styles.resBanner} testID="dining-suggestions">
                <View style={styles.resTop}>
                  <Pressable onPress={() => setReviewOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: reviewOpen }} style={styles.resTitleBtn}>
                    <Ionicons name="calendar-outline" size={15} color={t.color.primaryFg} />
                    <Text style={styles.resTitle}>
                      {newSuggestions} {newSuggestions === 1 ? 'reservation' : 'reservations'} ready
                    </Text>
                  </Pressable>
                  {mismatchCount > 0 ? (
                    <View style={styles.mismatchBadge}>
                      <Ionicons name="people-outline" size={12} color={t.color.warningText} />
                      <Text style={styles.mismatchText}>{mismatchCount} party mismatch</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.resActions}>
                  <SecondaryButton label={reviewOpen ? 'Hide ▲' : 'Review ▼'} onPress={() => setReviewOpen((o) => !o)} testID="dining-suggestions-review" style={styles.resReviewBtn} />
                  <PrimaryButton
                    label={importActionLabel(newSuggestions)}
                    icon="download-outline"
                    onPress={runImport}
                    loading={importReservations.isPending}
                    accessibilityLabel={`${importActionLabel(newSuggestions)} from this trip into the meal grid`}
                    testID="dining-import"
                    style={styles.resImportBtn}
                  />
                </View>

                {reviewOpen ? (
                  <View style={styles.suggestionsList}>
                    {pendingSuggestions.map((s) => (
                      <View key={s.plannedItemId} style={styles.suggestion} testID={`dining-suggestion-${s.plannedItemId}`}>
                        <Text style={styles.summaryText}>{suggestionText(s)}</Text>
                        <View style={styles.suggestionTags}>
                          <View style={styles.tag} accessible accessibilityLabel={`Source: ${suggestionSourceLabel(s.source)}`}>
                            <Ionicons name={s.source === 'reservation' ? 'calendar-outline' : 'list-outline'} size={12} color={t.color.textPrimary} />
                            <Text style={styles.tagText}>{suggestionSourceLabel(s.source)}</Text>
                          </View>
                          {s.partySizeMismatch ? (
                            <View style={styles.tag} testID={`dining-suggestion-mismatch-${s.plannedItemId}`}>
                              <Ionicons name="people-outline" size={12} color={t.color.warningText} />
                              <Text style={[styles.tagText, styles.warningText]}>{PARTY_SIZE_MISMATCH_TEXT}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {needsMealTimeText(plan.suggestionsNeedingMealPeriod) !== null ? (
              <Notice tone="info" text={needsMealTimeText(plan.suggestionsNeedingMealPeriod)!} testID="dining-needs-meal-time" />
            ) : null}
            {importMessage !== null ? <Notice tone="info" text={importMessage} testID="dining-import-result" /> : null}
            {importError !== null ? <Notice tone="error" text={importError} testID="dining-import-error" /> : null}

            <DiningResortChapters
              stays={fallbackStays}
              entries={plan.entries}
              mealLines={shown?.meals ?? []}
              filter={calFilter}
              onChangeFilter={setCalFilter}
              onPressSlot={openSlotSheet}
              result={result}
              {...(result.stays !== undefined
                ? {
                    staySettings: {
                      settings: plan.settings,
                      isOrganizer,
                      onEditStays: () => navigation.navigate('TripEdit', { tripId }),
                      onSaveSettings: (settings) => putSettings.mutateAsync(settings),
                    },
                  }
                : {})}
            />
          </View>
        ) : null}

        {activeTab === 'compare' ? (
          <View testID="dining-pane-compare">
            <DiningCompareCard result={result} />
            {canExportToBudget(result) ? (
              <SecondaryButton
                label="Add to Trip Budget"
                icon="wallet-outline"
                onPress={() => setExportOpen(true)}
                accessibilityLabel="Add the dining plan, meals and tips of the result to the Trip Budget"
                testID="dining-export-open"
                style={styles.importBtn}
              />
            ) : null}
          </View>
        ) : null}

        {activeTab === 'credits' ? (
          <View testID="dining-pane-credits">
            <DiningCreditSummary
              scenario={creditScenario}
              result={result}
              onSelectScenario={setListCode}
              onViewCreditMealsOnCalendar={() => {
                setCalFilter('credits');
                setActiveTab('meals');
              }}
            />
            <DiningSensitivityTable result={result} orderStyle={plan.settings.orderStyle} />
            <DiningAboutFigures result={result} collapsible defaultExpanded={false} />
          </View>
        ) : null}

        {activeTab === 'settings' ? (
          <View testID="dining-pane-settings">
            <View style={styles.summary} testID="dining-summary">
              <View style={styles.summaryTop}>
                <Text style={styles.summaryCardLabel}>PARTY (SYNCED WITH TRIP)</Text>
                <View style={styles.summaryCountPill}>
                  <Text style={styles.summaryCountText}>
                    {plan.party.length} {plan.party.length === 1 ? 'Person' : 'People'}
                  </Text>
                </View>
              </View>
              <Text style={styles.summaryParty}>{partyBreakdownText(plan.party)}</Text>
              <Text style={styles.summaryMeta}>
                {staySummaryText(plan.stay)}
                {(result.stays ?? []).length > 1 ? ` · ${(result.stays ?? []).length} hotels` : ''}
              </Text>
            </View>
            <DiningSettingsForm
              settings={plan.settings}
              party={plan.party}
              defaultTaxBps={a.taxIsDefault ? a.taxBps : DINING_CONFIG_DEFAULTS.taxBps}
              defaultTipBps={a.tipIsDefault ? a.tipBps : DINING_CONFIG_DEFAULTS.tipBps}
              showStay={customStayApplies(result.stays)}
              onSave={(settings) => putSettings.mutateAsync(settings)}
            />
          </View>
        ) : null}
      </ScrollView>

      {openSlot !== null ? (
        <DiningSlotSheet
          visible
          date={openSlot.date}
          mealPeriod={openSlot.mealPeriod}
          entry={slotEntry}
          mealLine={slotLine}
          coveredByHotelLabel={coveredHotelLabel}
          party={plan.party}
          onSave={(entry) => putEntry.mutateAsync({ slot: openSlot, entry })}
          {...(slotEntry === undefined ? {} : { onClear: () => deleteEntry.mutateAsync(openSlot) })}
          onClose={() => setOpenSlot(null)}
        />
      ) : null}

      {exportOpen ? (
        <DiningBudgetExportSheet
          tripId={tripId}
          onClose={() => setExportOpen(false)}
          onOpenBudget={() => {
            setExportOpen(false);
            navigation.navigate('TripBudget', { tripId });
          }}
        />
      ) : null}
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  stickyTop: {},
  tabWrap: { paddingHorizontal: theme.spacing.md, paddingTop: 6, paddingBottom: 2 },
  settingsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  settingsChipText: { fontSize: 11.5, fontWeight: '700' },
  body: { paddingHorizontal: theme.spacing.md, paddingTop: 4, paddingBottom: theme.spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg, gap: theme.spacing.md },
  summary: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.sm + 2,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  summaryCardLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: t.color.textSecondary },
  summaryCountPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border },
  summaryCountText: { fontSize: 11, fontWeight: '700', color: t.color.textSecondary },
  summaryParty: { fontSize: 13.5, fontWeight: '700', color: t.color.textPrimary },
  summaryMeta: { fontSize: 12, color: t.color.textSecondary, marginTop: 2 },
  summaryText: { ...theme.typography.body, color: t.color.textPrimary },
  resBanner: {
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surfaceAlt,
    marginBottom: theme.spacing.sm,
  },
  resTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.xs },
  resTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  resTitle: { ...theme.typography.subtitle, color: t.color.textPrimary },
  mismatchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.warningSurface,
  },
  mismatchText: { ...theme.typography.meta, color: t.color.warningText, fontWeight: '700' },
  resActions: { flexDirection: 'row', gap: theme.spacing.xs, marginTop: theme.spacing.xs },
  resReviewBtn: { flex: 1 },
  resImportBtn: { flex: 1.5 },
  importBtn: { marginBottom: theme.spacing.md },
  suggestionsList: { marginTop: theme.spacing.sm, paddingTop: theme.spacing.xs, borderTopWidth: 1, borderTopColor: t.color.border },
  suggestion: { paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: t.color.border },
  suggestionTags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: 2 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
  },
  tagText: { ...theme.typography.meta, color: t.color.textPrimary },
  warningText: { color: t.color.warningText },
  pressed: { opacity: 0.8 },
}));
