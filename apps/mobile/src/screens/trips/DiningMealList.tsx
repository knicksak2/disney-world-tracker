// Feature: dining-plan-calculator — visual credit meters & Top 5 best-value credit meals for the Credits tab
// (Requirements 14.3–14.5, 15.6, 21.2, 22.1, 27.7). Reuses `DiningMealList` exports cleanly.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiningPlanResultDTO, DiningScenarioCode, DiningScenarioResultDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { DINING_PALETTE } from './diningPlan.palette';
import { OptionGroup } from './diningPlanControls';
import { mealPeriodLabel, money, shortDate } from './diningPlanView';

/** The scenario the credits/meals focus on: `code` when available, otherwise recommended. */
export function shownScenario(result: DiningPlanResultDTO, code: DiningScenarioCode | null): DiningScenarioResultDTO | undefined {
  const available = result.scenarios.filter((s) => s.available);
  return available.find((s) => s.code === code) ?? available.find((s) => s.code === result.recommended) ?? available[0];
}

interface MeterCardProps {
  readonly label: string;
  readonly issued: number;
  readonly used: number;
  readonly unused: number;
  readonly barColor: string;
  readonly trackColor: string;
  readonly accentColor: string;
}

function MeterCard({ label, issued, used, unused, barColor, trackColor, accentColor }: MeterCardProps): JSX.Element {
  const styles = useStyles();
  const pct = issued > 0 ? Math.min(100, Math.round((used / issued) * 100)) : 0;
  return (
    <View
      style={styles.meterCard}
      accessible
      accessibilityLabel={`${label}: ${issued} for the party, ${used} used, ${unused} left over`}
    >
      <Text style={[styles.meterNum, { color: barColor }]}>
        {used} / {issued}
      </Text>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={[styles.meterTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.meterSub, unused === 0 && { color: accentColor }]}>{unused === 0 ? '0 left over ✓' : `${unused} left over`}</Text>
    </View>
  );
}

/** Visual credit summary + Top 5 highest-value credit meals + jump to filtered Meals calendar (Requirement 27.7). */
export function DiningCreditSummary({
  scenario,
  result,
  onSelectScenario,
  onViewCreditMealsOnCalendar,
}: {
  readonly scenario: DiningScenarioResultDTO | null | undefined;
  readonly result?: DiningPlanResultDTO;
  readonly onSelectScenario?: (code: DiningScenarioCode) => void;
  readonly onViewCreditMealsOnCalendar?: () => void;
}): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  if (scenario === null || scenario === undefined || scenario.credits === null) return null;

  const c = scenario.credits;
  const snackTip =
    c.snack.issued > 0
      ? `Use about ${c.snacksPerDayToUseAll} snack ${c.snacksPerDayToUseAll === 1 ? 'credit' : 'credits'} a day to use them all`
      : null;
  const mugTip =
    c.mugsCovered > 0
      ? `${c.mugsCovered} ${c.mugsCovered === 1 ? 'refillable mug' : 'refillable mugs'} included. Refills work only at self-service stations in Disney Resort hotel quick-service locations, not in the parks or Disney Springs.`
      : null;
  const best = scenario.bestCreditUses.slice(0, 5);
  const creditOptions =
    result === undefined || onSelectScenario === undefined
      ? []
      : result.scenarios
          .filter((s) => s.available && s.credits !== null)
          .map((s) => ({
            value: s.code,
            label: s.displayName,
            shortLabel: s.code === 'quick_service' ? 'Quick-Service' : s.code === 'table_service' ? 'Dining Plan' : s.code === 'mix' ? 'Per-Hotel Mix' : s.displayName,
          }));

  const creditsHeading =
    scenario.code === 'mix' ? 'Credits with the per-hotel mix' : `Credits with the ${scenario.displayName}`;

  return (
    <View style={styles.wrap} testID="dining-credit-summary">
      {creditOptions.length > 1 && onSelectScenario !== undefined ? (
        <View style={styles.card}>
          <OptionGroup label="Inspect credits for" options={creditOptions} value={scenario.code} layout="row" onChange={onSelectScenario} testIDPrefix="dining-credits-option" />
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">
            {creditsHeading}
          </Text>
          <View style={[styles.pillBadge, { backgroundColor: pal.cashBg, borderColor: pal.cashBorder }]}>
            <Text style={[styles.pillText, { color: pal.cashFg }]}>Party total</Text>
          </View>
        </View>
        <Text style={styles.reason}>Credits are per person and cannot be shared.</Text>

        <View style={styles.meterGrid}>
          {c.ts.issued > 0 ? (
            <MeterCard label="Table-Service" issued={c.ts.issued} used={c.ts.used} unused={c.ts.unused} barColor={pal.tsBar} trackColor={pal.trackBg} accentColor={pal.savesFg} />
          ) : null}
          {c.qs.issued > 0 ? (
            <MeterCard label="Quick-Service" issued={c.qs.issued} used={c.qs.used} unused={c.qs.unused} barColor={pal.qsBar} trackColor={pal.trackBg} accentColor={pal.savesFg} />
          ) : null}
          {c.snack.issued > 0 ? (
            <MeterCard label="Snacks" issued={c.snack.issued} used={c.snack.used} unused={c.snack.unused} barColor={pal.snackBar} trackColor={pal.trackBg} accentColor={pal.savesFg} />
          ) : null}
        </View>

        {snackTip !== null ? <Text style={styles.detailRow}>{snackTip}</Text> : null}
        {mugTip !== null ? <Text style={styles.detailRow}>{mugTip}</Text> : null}

        {onViewCreditMealsOnCalendar !== undefined ? (
          <Pressable
            onPress={onViewCreditMealsOnCalendar}
            accessibilityRole="button"
            accessibilityLabel="See credit meals on the Calendar"
            testID="dining-jump-to-credits"
            style={({ pressed }) => [styles.jumpBtn, { borderColor: t.color.borderStrong, backgroundColor: pal.creditBg }, pressed && styles.pressed]}
          >
            <Ionicons name="calendar-outline" size={16} color={pal.creditFg} />
            <Text style={[styles.jumpBtnText, { color: pal.creditFg }]}>See credit meals on the Calendar →</Text>
          </Pressable>
        ) : null}
      </View>

      {best.length > 0 ? (
        <View style={styles.card} testID="dining-best-credit-meals">
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: pal.goldFg }]} accessibilityRole="header">
              ★ Top {best.length} Highest-Value Credit Meals
            </Text>
          </View>
          {best.map((b, idx) => (
            <View key={`${b.date}-${b.mealPeriod}`} style={styles.bestRow}>
              <Text style={styles.bestLabel}>
                {idx + 1}. {b.label} ({shortDate(b.date)}, {mealPeriodLabel(b.mealPeriod).toLowerCase()})
              </Text>
              <Text style={[styles.bestAmount, { color: pal.savesFg }]}>Covers about {money(b.savingsCents)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { gap: theme.spacing.sm + 2 },
  card: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, marginBottom: 3 },
  title: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', color: t.color.textPrimary, flex: 1 },
  pillBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, borderWidth: 1 },
  pillText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  reason: { fontSize: 11.5, lineHeight: 15, color: t.color.textSecondary, marginBottom: theme.spacing.xs + 2 },
  meterGrid: { flexDirection: 'row', gap: 6, marginBottom: theme.spacing.xs + 2 },
  meterCard: {
    flex: 1,
    padding: 7,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
  },
  meterNum: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  meterLabel: { fontSize: 11, lineHeight: 14, color: t.color.textSecondary, fontWeight: '700', marginTop: 2 },
  meterTrack: { width: '100%', height: 4, borderRadius: theme.radius.pill, overflow: 'hidden', marginTop: 5 },
  meterFill: { height: '100%', borderRadius: theme.radius.pill },
  meterSub: { fontSize: 11, lineHeight: 14, color: t.color.textSecondary, marginTop: 3 },
  detailRow: { fontSize: 11.5, lineHeight: 15, color: t.color.textSecondary, fontWeight: '400', paddingVertical: 1.5 },
  bestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  bestLabel: { fontSize: 12.5, lineHeight: 16, color: t.color.textPrimary, flex: 1 },
  bestAmount: { fontSize: 11.5, lineHeight: 15, fontWeight: '700', flexShrink: 0 },
  jumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs + 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
  },
  jumpBtnText: { fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
  pressed: { opacity: 0.8 },
}));
