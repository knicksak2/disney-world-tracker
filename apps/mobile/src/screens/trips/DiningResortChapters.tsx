// Feature: dining-plan-calculator — Meals tab with collapsible Resort Chapters, calendar filters, inline stay
// controls, and compact 3-column meal cells (Requirements 19.3, 22.1, 22.2, 25.15, 25.16, 27.2–27.5).
//
// Zero client arithmetic: every dollar figure and credit badge comes straight from the server's `DiningMealLineDTO`
// and `DiningPlanStayResultDTO`. Every badge uses text + icon, never colour alone.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DINING_MEAL_PERIODS,
  DINING_PLAN_CODES,
  type DiningEntryDTO,
  type DiningMealLineDTO,
  type DiningMealPeriod,
  type DiningPlanCode,
  type DiningPlanResultDTO,
  type DiningPlanSettings,
  type DiningPlanStayResultDTO,
  type DiningStayChannel,
  type DiningStayPlanStatus,
  type StayPlanSetting,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { DINING_PALETTE } from './diningPlan.palette';
import { Notice, OptionGroup } from './diningPlanControls';
import {
  compactRangeText,
  groupStayChapters,
  lineBadges,
  lineUsesCredit,
  money,
  NO_LODGING_TEXT,
  PLAN_NAME,
  shortHotelLabel,
  slotAccessibilityLabel,
  slotLabel,
  slotMatchesFilter,
  switchDaySummary,
  unavailableReasonText,
  type DiningCalFilter,
} from './diningPlanView';

const STATUS_OPTIONS: readonly { value: DiningStayPlanStatus; label: string; shortLabel: string; hint: string }[] = [
  { value: 'compare', label: 'Find best', shortLabel: 'Compare plans', hint: 'Work out whether a dining plan is worth it here' },
  { value: 'have_plan', label: 'Already have plan', shortLabel: 'Have a plan', hint: 'Booked with this hotel stay' },
  { value: 'no_plan', label: 'Pay cash only', shortLabel: 'No plan', hint: 'Do not buy a dining plan here' },
];

const CHANNEL_OPTIONS: readonly { value: DiningStayChannel; label: string; shortLabel: string; hint: string }[] = [
  { value: 'package', label: 'Booked as a package', shortLabel: 'Package (Kids Free)', hint: 'Kids Eat Free can apply' },
  { value: 'dvc_or_passholder', label: 'DVC or Annual Passholder booking', shortLabel: 'DVC / Passholder', hint: 'No Kids Eat Free' },
];

const PLAN_SHORT: Readonly<Record<DiningPlanCode, string>> = {
  quick_service: 'Quick-Service',
  table_service: 'Dining Plan',
  deluxe: 'Deluxe',
};

const PLAN_OPTIONS = DINING_PLAN_CODES.map((code) => ({ value: code, label: PLAN_NAME[code], shortLabel: PLAN_SHORT[code] }));

const FILTER_OPTIONS: readonly { value: DiningCalFilter; label: string }[] = [
  { value: 'all', label: 'All Days' },
  { value: 'credits', label: 'Use Credits' },
  { value: 'cash', label: 'Pay Cash' },
];

function staySummaryLine1(stay: DiningPlanStayResultDTO, status: DiningStayPlanStatus): string {
  if (!stay.available) return 'Dining plan unavailable';
  if (status === 'have_plan' && stay.heldPlan !== null) {
    return `Booked: ${PLAN_SHORT[stay.heldPlan]}`;
  }
  if (status === 'no_plan') return 'Pay cash only ($0 plan)';
  if (stay.recommendedPlan !== 'none') {
    const net = stay.contributionCents > 0 ? ` (Saves ${money(stay.contributionCents)})` : '';
    return `Auto-pick: ★ ${PLAN_SHORT[stay.recommendedPlan]}${net}`;
  }
  return 'Auto-pick: No Plan (Pay Cash)';
}

function staySummaryLine2(stay: DiningPlanStayResultDTO, channel: DiningStayChannel): string {
  const chText = channel === 'package' ? 'Package (Kids Eat Free)' : 'DVC / Passholder';
  const costText = stay.planCostCents > 0 ? ` · ${money(stay.planCostCents)}` : '';
  return `${chText}${costText}`;
}

function mealTagText(line: DiningMealLineDTO | undefined): string | null {
  if (line === undefined) return null;
  if (line.action === 'use_plan') {
    if (line.twoCredit) return '2 TS';
    return line.serviceType === 'quick_service' ? '1 QS' : '1 TS';
  }
  if (line.action === 'partly_covered') {
    const unit = line.serviceType === 'quick_service' ? 'QS' : 'TS';
    return `${line.coveredDinerCount}/${line.dinerCount} ${unit}`;
  }
  if (line.action === 'pay_out_of_pocket') return 'Cash';
  return 'No plan';
}

export interface DiningResortChaptersProps {
  readonly stays: readonly DiningPlanStayResultDTO[];
  readonly entries: readonly DiningEntryDTO[];
  readonly mealLines: readonly DiningMealLineDTO[];
  readonly filter: DiningCalFilter;
  readonly onChangeFilter: (f: DiningCalFilter) => void;
  readonly onPressSlot: (date: string, mealPeriod: DiningMealPeriod) => void;
  /** Optional stay-editing wiring (Trip screen). Omitted on standalone single-stay calculator. */
  readonly staySettings?: {
    readonly settings: DiningPlanSettings;
    readonly isOrganizer: boolean;
    readonly onEditStays: () => void;
    readonly onSaveSettings: (settings: DiningPlanSettings) => Promise<unknown>;
  };
  /** Highlight stays/hand-offs using result data when available. */
  readonly result?: DiningPlanResultDTO | null;
}

export function DiningResortChapters({
  stays,
  entries,
  mealLines,
  filter,
  onChangeFilter,
  onPressSlot,
  staySettings,
}: DiningResortChaptersProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);

  const [collapsedChapters, setCollapsedChapters] = useState<ReadonlySet<string>>(() => new Set());
  const [editingStayKey, setEditingStayKey] = useState<string | null>(null);
  const [choosingHeldKey, setChoosingHeldKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryMap = new Map(entries.map((e) => [`${e.date}|${e.mealPeriod}`, e]));
  const lineMap = new Map(mealLines.map((l) => [`${l.date}|${l.mealPeriod}`, l]));
  const chapters = groupStayChapters(stays, entries, mealLines, filter);
  const showEmptyIntro = entries.length === 0;
  const activeMeals = entries.filter((e) => e.kind !== 'skip');
  const creditMealCount = activeMeals.filter((e) => lineUsesCredit(lineMap.get(`${e.date}|${e.mealPeriod}`))).length;
  const cashMealCount = activeMeals.length - creditMealCount;

  function toggleCollapse(key: string): void {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function saveStaySetting(key: string, nextSetting: StayPlanSetting): void {
    if (staySettings === undefined || busy) return;
    setBusy(true);
    setError(null);
    staySettings
      .onSaveSettings({
        ...staySettings.settings,
        stayPlans: { ...staySettings.settings.stayPlans, [key]: nextSetting },
      })
      .then(
        () => setBusy(false),
        (err: unknown) => {
          setError(err instanceof Error && err.message.length > 0 ? err.message : 'That change could not be saved. Please try again.');
          setBusy(false);
        },
      );
  }

  return (
    <View testID="dining-meal-grid">
      {showEmptyIntro ? (
        <View style={styles.emptyIntro} testID="dining-empty-meals">
          <Ionicons name="restaurant-outline" size={20} color={t.color.primaryFg} />
          <View style={styles.flexOne}>
            <Text style={styles.emptyTitle}>Add the places you plan to eat</Text>
            <Text style={styles.emptyBody}>Tap any Breakfast, Lunch, or Dinner slot below to pick a restaurant or typical meal.</Text>
          </View>
        </View>
      ) : null}

      {error !== null ? <Notice tone="error" text={error} testID="dining-stays-error" /> : null}

      {/* Filter pills: All Days / Use Credits / Pay Cash */}
      <View style={styles.filterBar} testID="dining-filter-bar">
        {FILTER_OPTIONS.map((opt) => {
          const active = opt.value === filter;
          const countVal = opt.value === 'all' ? activeMeals.length : opt.value === 'credits' ? creditMealCount : cashMealCount;
          const pillLabel = activeMeals.length > 0 ? `${opt.label} (${countVal})` : opt.label;
          const pillIcon =
            opt.value === 'credits' ? 'ticket-outline' : opt.value === 'cash' ? 'cash-outline' : null;
          const pillIconColor = active
            ? t.color.textOnPrimary
            : opt.value === 'credits'
              ? pal.creditsTabFg
              : pal.cashFg;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChangeFilter(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter meals: ${pillLabel}`}
              testID={`dining-filter-${opt.value}`}
              style={({ pressed }) => [styles.filterPill, active && styles.filterPillActive, pressed && styles.pressed]}
            >
              {pillIcon !== null ? <Ionicons name={pillIcon} size={12} color={pillIconColor} /> : null}
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{pillLabel}</Text>
            </Pressable>
          );
        })}
      </View>

      {chapters.map((ch, idx) => {
        const s = ch.stay;
        const stayId = `dining-stay-${s.key}`;
        const isEditing = editingStayKey === s.key;
        const isCollapsed = collapsedChapters.has(s.key);
        const choosingHeld = choosingHeldKey === s.key;
        const effectiveStatus: DiningStayPlanStatus = choosingHeld ? 'have_plan' : s.status;
        const canHavePlan = s.unavailableReason !== 'not_disney_resort';
        const isWinnerStay = s.recommendedPlan !== 'none' && s.available;

        // Auto-collapse chapters with 0 matching meals when Use Credits or Pay Cash is active.
        if (filter !== 'all' && ch.visibleDays.length === 0) {
          const emptyMsg = filter === 'credits' ? '0 credit meals' : '0 cash meals';
          return (
            <View key={s.key} style={[styles.chapterCard, styles.chapterEmptyFiltered]} testID={`dining-chapter-empty-${s.key}`}>
              <View style={styles.chapterEmptyRow}>
                <Text style={styles.chapterEmptyTitle}>
                  {s.label} ({ch.datesText})
                </Text>
                <View style={styles.emptyCountPill}>
                  <Text style={styles.emptyCountText}>{emptyMsg}</Text>
                </View>
              </View>
            </View>
          );
        }

        const firstDay = ch.visibleDays[0];
        const showSwitchDivider = filter === 'all' && idx > 0 && firstDay?.handOff === true;
        const prevStay = idx > 0 ? chapters[idx - 1]?.stay ?? null : null;
        const switchMsg = firstDay !== undefined ? switchDaySummary(firstDay.date, prevStay?.label ?? null, s.label) : '';
        const hotelDisplay = shortHotelLabel(s.label);
        const compactDates = `${compactRangeText(s.checkIn, s.checkOut)} · ${s.nights} ${s.nights === 1 ? 'night' : 'nights'} · ${s.partyCount} ${s.partyCount === 1 ? 'guest' : 'guests'}`;

        return (
          <View key={s.key}>
            {showSwitchDivider ? (
              <View
                style={[styles.switchDivider, { backgroundColor: pal.switchBg, borderColor: pal.switchBorder }]}
                testID={`dining-handoff-${firstDay!.date}`}
                accessible
                accessibilityLabel={switchMsg}
              >
                <Ionicons name="swap-horizontal-outline" size={16} color={pal.switchFg} />
                <Text style={[styles.switchDividerText, { color: pal.switchFg }]}>{switchMsg}</Text>
              </View>
            ) : null}

            <View style={[styles.chapterCard, isWinnerStay && { borderColor: pal.goldBorder }]} testID={stayId}>
              <View style={styles.chapterHeader}>
                <View style={styles.chapterHeaderTop}>
                  <View style={styles.flexOne}>
                    <Text style={styles.chapterTitle} accessibilityRole="header">
                      {hotelDisplay}
                    </Text>
                    <Text style={styles.chapterDates}>{compactDates}</Text>
                  </View>
                  <Pressable
                    onPress={() => toggleCollapse(s.key)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    accessibilityLabel={isCollapsed ? `Show ${ch.visibleDays.length} days for ${s.label}` : `Hide days for ${s.label}`}
                    testID={`dining-chapter-collapse-${s.key}`}
                    style={styles.collapseBtn}
                  >
                    <Text style={styles.collapseBtnText}>{isCollapsed ? `Show ${ch.visibleDays.length}d ▼` : 'Hide days ▲'}</Text>
                  </Pressable>
                </View>

                {ch.isSynthesized ? (
                  <View style={styles.inlineNotice} testID={`${stayId}-no-lodging`}>
                    <Ionicons name="information-circle-outline" size={15} color={t.color.textSecondary} />
                    <Text style={styles.note}>{NO_LODGING_TEXT}</Text>
                    {staySettings?.isOrganizer ? (
                      <Pressable onPress={staySettings.onEditStays} accessibilityRole="link" accessibilityLabel="Edit stays in trip settings" testID={`${stayId}-edit-stays`}>
                        <Text style={styles.link}>Edit stays</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {!s.available ? (
                  <View style={styles.inlineNotice} testID={`${stayId}-unavailable`}>
                    <Ionicons name="remove-circle-outline" size={15} color={t.color.textSecondary} />
                    <Text style={styles.note}>{unavailableReasonText(s.unavailableReason)}</Text>
                  </View>
                ) : null}

                {staySettings !== undefined && canHavePlan ? (
                  <>
                    <Pressable
                      onPress={() => setEditingStayKey((cur) => (cur === s.key ? null : s.key))}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isEditing }}
                      accessibilityLabel={`Plan and booking settings for ${s.label}: ${staySummaryLine1(s, effectiveStatus)}`}
                      testID={`${stayId}-change`}
                      style={[
                        styles.stayEditBar,
                        isWinnerStay && { backgroundColor: pal.goldBg, borderColor: pal.goldBorder },
                      ]}
                    >
                      <View style={styles.flexOne}>
                        <Text style={[styles.stayEditLine1, { color: isWinnerStay ? pal.goldFg : pal.savesFg }]} numberOfLines={1}>
                          {staySummaryLine1(s, effectiveStatus)}
                        </Text>
                        <Text style={styles.stayEditLine2} numberOfLines={1}>
                          {staySummaryLine2(s, s.channel)}
                        </Text>
                      </View>
                      <View style={[styles.changeBadge, isWinnerStay && { backgroundColor: pal.goldBg }]}>
                        <Text style={[styles.changeBadgeText, isWinnerStay && { color: pal.goldFg }]}>{isEditing ? 'Done ▲' : 'Change ▼'}</Text>
                      </View>
                    </Pressable>

                    {isEditing ? (
                      <View style={styles.stayDrawer} testID={`${stayId}-drawer`}>
                        <OptionGroup
                          label={`Dining plan at ${s.label}`}
                          options={STATUS_OPTIONS}
                          value={effectiveStatus}
                          layout="row"
                          onChange={(next) => {
                            if (next === 'have_plan') {
                              if (s.status !== 'have_plan') setChoosingHeldKey(s.key);
                              return;
                            }
                            setChoosingHeldKey(null);
                            if (next !== s.status) saveStaySetting(s.key, { status: next, heldPlan: null, channel: s.channel });
                          }}
                          testIDPrefix={`${stayId}-status`}
                        />
                        {effectiveStatus === 'have_plan' ? (
                          <OptionGroup
                            label="Which plan do you have?"
                            options={PLAN_OPTIONS}
                            value={choosingHeld ? null : s.heldPlan}
                            layout="row"
                            onChange={(planCode: DiningPlanCode) => {
                              setChoosingHeldKey(null);
                              saveStaySetting(s.key, { status: 'have_plan', heldPlan: planCode, channel: s.channel });
                            }}
                            testIDPrefix={`${stayId}-plan`}
                          />
                        ) : null}
                        {effectiveStatus !== 'no_plan' ? (
                          <OptionGroup
                            label="How is this hotel booked?"
                            options={CHANNEL_OPTIONS}
                            value={s.channel}
                            layout="row"
                            onChange={(channel) => {
                              if (channel !== s.channel) {
                                saveStaySetting(s.key, { status: s.status, heldPlan: s.heldPlan, channel });
                              }
                            }}
                            testIDPrefix={`${stayId}-channel`}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>

              {!isCollapsed ? (
                <View>
                  {filter !== 'all' && ch.visibleDays.length < ch.totalDays ? (
                    <View style={[styles.filterNoteBar, { backgroundColor: pal.qsBg, borderBottomColor: pal.qsBorder }]}>
                      <Text style={[styles.filterNoteText, { color: pal.qsFg }]}>
                        Showing {ch.visibleDays.length} of {ch.totalDays} days with {filter === 'cash' ? 'cash' : 'credit'} meals
                      </Text>
                      <Pressable onPress={() => onChangeFilter('all')} accessibilityRole="button" accessibilityLabel="Show all days">
                        <Text style={[styles.showAllLink, { color: pal.qsFg }]}>Show all</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {/* Column header printed ONCE per Resort Chapter */}
                  <View style={styles.colHeaderRow}>
                    <View style={styles.dayCol}>
                      <Text style={styles.colHeaderText}>DAY</Text>
                    </View>
                    <View style={styles.mealColHeader}>
                      <Ionicons name="sunny-outline" size={10} color={pal.snackBar} />
                      <Text style={styles.colHeaderText} numberOfLines={1}>BREAKFAST</Text>
                    </View>
                    <View style={styles.mealColHeader}>
                      <Ionicons name="partly-sunny-outline" size={10} color={pal.goldFg} />
                      <Text style={styles.colHeaderText}>LUNCH</Text>
                    </View>
                    <View style={styles.mealColHeader}>
                      <Ionicons name="moon-outline" size={10} color={pal.creditFg} />
                      <Text style={styles.colHeaderText}>DINNER</Text>
                    </View>
                  </View>

                  <View style={styles.daysList}>
                    {ch.visibleDays.map((day) => (
                      <View key={day.date} style={styles.dayRow}>
                        <View style={styles.dayCol}>
                          <Text style={styles.dayDow}>{day.weekday}</Text>
                          <Text style={styles.dayDt}>{day.monthDay}</Text>
                          {day.handOff ? (
                            <Text style={[styles.switchTag, { color: pal.switchFg }]} testID={`dining-day-switch-${day.date}`}>
                              ⇄ Switch
                            </Text>
                          ) : null}
                        </View>

                        {DINING_MEAL_PERIODS.map((period) => {
                          const slotKey = `${day.date}|${period}`;
                          const entry = entryMap.get(slotKey);
                          const line = lineMap.get(slotKey);
                          const matches = slotMatchesFilter(entry, line, filter);

                          if (!matches) {
                            return (
                              <View key={period} style={[styles.mealCell, styles.mealCellDimmed]}>
                                <Text style={styles.dimDash}>—</Text>
                              </View>
                            );
                          }

                          if (entry === undefined) {
                            return (
                              <Pressable
                                key={period}
                                onPress={() => onPressSlot(day.date, period)}
                                accessibilityRole="button"
                                accessibilityLabel={slotAccessibilityLabel(day.date, period, undefined)}
                                testID={`dining-slot-${day.date}-${period}`}
                                style={({ pressed }) => [styles.mealCell, styles.mealCellEmpty, pressed && styles.pressed]}
                              >
                                <Text style={styles.addText}>+ Add</Text>
                              </Pressable>
                            );
                          }

                          if (entry.kind === 'skip') {
                            return (
                              <Pressable
                                key={period}
                                onPress={() => onPressSlot(day.date, period)}
                                accessibilityRole="button"
                                accessibilityLabel={slotAccessibilityLabel(day.date, period, entry)}
                                testID={`dining-slot-${day.date}-${period}`}
                                style={({ pressed }) => [styles.mealCell, styles.mealCellEmpty, pressed && styles.pressed]}
                              >
                                <Text style={styles.skipText}>Skipped</Text>
                              </Pressable>
                            );
                          }

                          const usesCredit = lineUsesCredit(line);
                          const isSig = usesCredit && (line?.twoCredit === true || line?.action === 'partly_covered');
                          const isQs = usesCredit && !isSig && line?.serviceType === 'quick_service';
                          const badgeText = mealTagText(line);
                          const badges = line !== undefined ? lineBadges(line) : [];
                          const hasEst = badges.includes('Estimate') || badges.includes('Unverified rule');
                          const dollarAmount =
                            line === undefined
                              ? null
                              : usesCredit && line.savingsCents > 0
                                ? money(line.savingsCents)
                                : money(line.outOfPocketCents);

                          const cellBg = isSig ? pal.goldBg : isQs ? pal.qsBg : usesCredit ? pal.creditBg : t.color.surface;
                          const cellBorder = isSig ? pal.goldBorder : isQs ? pal.qsBorder : usesCredit ? pal.creditBorder : t.color.border;
                          const tagBg = isSig ? pal.goldBg : isQs ? pal.qsBg : usesCredit ? pal.creditBg : pal.cashBg;
                          const tagFg = isSig ? pal.goldFg : isQs ? pal.qsFg : usesCredit ? pal.creditFg : pal.cashFg;
                          const tagBorder = isSig ? pal.goldBorder : isQs ? pal.qsBorder : usesCredit ? pal.creditBorder : pal.cashBorder;

                          return (
                            <Pressable
                              key={period}
                              onPress={() => onPressSlot(day.date, period)}
                              accessibilityRole="button"
                              accessibilityLabel={slotAccessibilityLabel(day.date, period, entry)}
                              testID={`dining-slot-${day.date}-${period}`}
                              style={({ pressed }) => [styles.mealCell, { backgroundColor: cellBg, borderColor: cellBorder }, pressed && styles.pressed]}
                            >
                              <Text style={styles.cellName} numberOfLines={2}>
                                {slotLabel(entry)}
                              </Text>
                              <View style={styles.cellFoot}>
                                {badgeText !== null ? (
                                  <View style={[styles.cellTagPill, { backgroundColor: tagBg, borderColor: tagBorder }]}>
                                    <Text style={[styles.cellTag, { color: tagFg }]} numberOfLines={1}>
                                      {badgeText}
                                    </Text>
                                  </View>
                                ) : null}
                                {dollarAmount !== null ? (
                                  <Text style={styles.cellPrice} numberOfLines={1}>
                                    {hasEst ? `~${dollarAmount}` : dollarAmount}
                                  </Text>
                                ) : null}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  flexOne: { flex: 1 },
  emptyIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: t.color.textPrimary },
  emptyBody: { fontSize: 11.5, color: t.color.textSecondary, fontWeight: '400', marginTop: 1 },
  filterBar: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  filterPillActive: { backgroundColor: t.color.primary, borderColor: t.color.primary },
  filterText: { fontSize: 11.5, color: t.color.textSecondary, fontWeight: '700' },
  filterTextActive: { color: t.color.textOnPrimary },
  switchDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 6,
  },
  switchDividerText: { fontSize: 11, lineHeight: 14, fontWeight: '600', flex: 1 },
  chapterCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: 6,
    overflow: 'hidden',
  },
  chapterEmptyFiltered: { borderStyle: 'dashed', opacity: 0.8 },
  chapterEmptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 6, gap: theme.spacing.sm },
  chapterEmptyTitle: { ...theme.typography.meta, color: t.color.textSecondary, flex: 1 },
  emptyCountPill: { paddingHorizontal: theme.spacing.sm, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: t.color.surfaceAlt },
  emptyCountText: { ...theme.typography.meta, color: t.color.textSecondary },
  chapterHeader: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: t.color.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  chapterHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  chapterTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: t.color.textPrimary },
  chapterDates: { fontSize: 11, color: t.color.textSecondary, fontWeight: '400', marginTop: 1 },
  collapseBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  collapseBtnText: { fontSize: 11, color: t.color.textSecondary, fontWeight: '700' },
  inlineNotice: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  note: { ...theme.typography.meta, color: t.color.textSecondary, flexShrink: 1 },
  link: { ...theme.typography.meta, color: t.color.primaryFg, fontWeight: '700', textDecorationLine: 'underline' },
  stayEditBar: {
    marginTop: 5,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
  },
  stayEditLine1: { fontSize: 11.5, lineHeight: 14, fontWeight: '800' },
  stayEditLine2: { fontSize: 10.5, lineHeight: 13, color: t.color.textSecondary, fontWeight: '400', marginTop: 1 },
  changeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.sm, backgroundColor: t.color.surfaceAlt },
  changeBadgeText: { fontSize: 11, color: t.color.primaryFg, fontWeight: '800' },
  stayDrawer: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  filterNoteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    borderBottomWidth: 1,
  },
  filterNoteText: { ...theme.typography.meta, fontWeight: '600' },
  showAllLink: { ...theme.typography.meta, fontWeight: '800', textDecorationLine: 'underline' },
  colHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  colHeaderText: { color: t.color.textSecondary, fontWeight: '800', fontSize: 9.5 },
  mealColHeader: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  daysList: { paddingHorizontal: theme.spacing.xs, paddingBottom: 4 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  dayCol: { width: 50, justifyContent: 'center' },
  dayDow: { fontSize: 11.5, color: t.color.textPrimary, fontWeight: '800' },
  dayDt: { fontSize: 10.5, color: t.color.textSecondary, fontWeight: '400' },
  switchTag: { fontSize: 9.5, fontWeight: '800', marginTop: 1 },
  mealCell: {
    flex: 1,
    minHeight: 40,
    padding: 4,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  mealCellEmpty: {
    borderStyle: 'dashed',
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealCellDimmed: {
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    opacity: 0.3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimDash: { ...theme.typography.meta, color: t.color.textSecondary },
  addText: { ...theme.typography.meta, color: t.color.textSecondary },
  skipText: { ...theme.typography.meta, color: t.color.textSecondary, opacity: 0.7 },
  cellName: { fontSize: 11.5, color: t.color.textPrimary, fontWeight: '700', lineHeight: 14 },
  cellFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3, marginTop: 4 },
  cellTagPill: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 1, flexShrink: 1 },
  cellTag: { fontSize: 9.5, fontWeight: '800' },
  cellPrice: { fontSize: 9.5, fontWeight: '700', color: t.color.textSecondary, flexShrink: 0, marginLeft: 'auto' },
  pressed: { opacity: 0.8 },
}));
