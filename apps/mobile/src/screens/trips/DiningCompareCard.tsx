// Feature: dining-plan-calculator — the Compare tab (Requirements 13.8, 15.6, 19.7, 19.9, 21.3, 22.1, 25.11, 27.6).
//
// Shows Best Plan Per Hotel with explicit official Disney plan names, a collapsible 3-column combination matrix for
// split-stay alternatives, and scenario comparison cards whose 7-row accounting breakdown toggles on tap (starting
// expanded for the recommended scenario). Every figure comes straight from the server result.

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCentsAsDollarString, type DiningPlanResultDTO, type DiningScenarioCode } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { DINING_PALETTE } from './diningPlan.palette';
import {
  alternativeMatrixRows,
  combinationView,
  netSavingsText,
  scenarioRows,
  shortHotelLabel,
  stayResultRows,
  type ScenarioRowView,
} from './diningPlanView';

function Figure({ label, value, strong = false }: { readonly label: string; readonly value: string; readonly strong?: boolean }): JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.figureLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.figureValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

function scenarioBarColor(
  row: ScenarioRowView,
  winnerBar: string,
  baselineBar: string,
  qsBar: string,
  expensiveBar: string,
): string {
  if (row.recommended) return winnerBar;
  if (row.code === 'none') return baselineBar;
  if (row.code === 'quick_service') return qsBar;
  return expensiveBar;
}

function Row({
  row,
  expanded,
  onToggle,
  barPercent,
}: {
  readonly row: ScenarioRowView;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly barPercent: number;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  return (
    <View style={[styles.row, row.recommended && { borderColor: pal.goldBorder, borderWidth: 1.5 }]} testID={`dining-compare-row-${row.code}`}>
      <Pressable
        onPress={row.available ? onToggle : undefined}
        accessibilityRole={row.available ? 'button' : 'text'}
        accessibilityState={row.available ? { expanded } : undefined}
        accessibilityLabel={`${row.name}, total ${row.total}${row.netSavings ? `, ${row.netSavings}` : ''}`}
        testID={`dining-compare-toggle-${row.code}`}
        style={({ pressed }) => [pressed && row.available && styles.pressed]}
      >
        <View style={styles.rowHeader}>
          <View style={styles.rowTitleBlock}>
            <Text style={styles.name} accessibilityRole="header">
              {row.code === 'mix' ? 'Per-Hotel Plan Mix' : row.name}
            </Text>
            {row.recommended ? (
              <View style={[styles.tag, { backgroundColor: pal.goldBg, borderColor: pal.goldBorder }]} testID={`dining-compare-recommended-${row.code}`} accessible accessibilityLabel="Recommended">
                <Ionicons name="star" size={11} color={pal.goldFg} />
                <Text style={[styles.tagText, { color: pal.goldFg }]}>Recommended</Text>
              </View>
            ) : null}
          </View>
          {row.available ? (
            <View style={styles.rowRight}>
              <Text style={[styles.totalHeadline, row.recommended && { color: pal.goldFg }]}>{row.total}</Text>
              {row.netSavings !== null ? <Text style={[styles.netInline, row.recommended && { color: pal.savesFg }]}>{row.netSavings}</Text> : null}
            </View>
          ) : null}
        </View>

        {row.promoLabel !== null ? <Text style={styles.note}>{row.promoLabel}</Text> : null}
        {row.priceNote !== null ? (
          <View style={styles.inline}>
            <Ionicons name="alert-circle-outline" size={14} color={t.color.warningText} />
            <Text style={[styles.note, styles.warning]}>{row.priceNote}</Text>
          </View>
        ) : null}

        {row.available ? (
          <>
            <View style={[styles.barTrack, { backgroundColor: pal.trackBg }]}>
              <View
                style={[
                  styles.barFill,
                  { width: `${barPercent}%`, backgroundColor: scenarioBarColor(row, pal.winnerBar, pal.baselineBar, pal.qsBar, pal.expensiveBar) },
                ]}
              />
            </View>
            <Text style={styles.tapHint}>{expanded ? 'Hide 7-row breakdown ▲' : 'Tap for 7-row breakdown ▼'}</Text>
          </>
        ) : null}
      </Pressable>

      {!row.available ? (
        <View style={styles.inline} testID={`dining-compare-unavailable-${row.code}`}>
          <Ionicons name="remove-circle-outline" size={16} color={t.color.textSecondary} />
          <Text style={styles.reason}>Not available. {row.unavailableText}</Text>
        </View>
      ) : expanded ? (
        <View style={styles.ledger} testID={`dining-compare-ledger-${row.code}`}>
          {row.code !== 'none' ? <Figure label="Plan cost (tax included)" value={row.planCost} /> : null}
          <Figure label="Meals you pay for" value={row.foodOutOfPocket} />
          <Figure label="Tax on what you pay" value={row.tax} />
          <Figure label="Tips" value={row.tip} />
          <Figure label="Snacks you pay for" value={row.snacks} />
          <Figure label="Refillable mugs you pay for" value={row.mugs} />
          <Figure label="Total" value={row.total} strong />
          {row.netSavings !== null ? (
            <Text style={styles.net} testID={`dining-compare-net-${row.code}`}>
              {row.netSavings}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Several hotel stays (Requirements 25.11, 25.15, 27.6): Best plan per hotel + collapsible matrix of alternatives. */
function StaysResult({ result }: { readonly result: DiningPlanResultDTO }): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  const [altOpen, setAltOpen] = useState(result.verdict === 'about_even');

  useEffect(() => {
    if (result.verdict === 'about_even') setAltOpen(true);
  }, [result.verdict]);

  const combo = combinationView(result);
  if (combo === null) return null;
  const stays = stayResultRows(result);
  const matrix = alternativeMatrixRows(result);
  const mixScenario = result.scenarios.find((s) => s.code === 'mix');
  const noneScenario = result.scenarios.find((s) => s.code === 'none');
  const isAboutEven = result.verdict === 'about_even';
  const comboBadge = isAboutEven
    ? 'About even'
    : mixScenario !== undefined && mixScenario.available && mixScenario.netSavingsCents > 0
      ? netSavingsText(mixScenario.netSavingsCents)
      : null;

  const comboTitle = isAboutEven
    ? 'TOO CLOSE TO CALL (~2% MARGIN)'
    : combo.heading === 'Recommended for your hotels'
      ? 'BEST PLAN PER HOTEL'
      : combo.heading;
  const hasMarginMatches = isAboutEven && matrix.some((r) => r.withinMargin);
  const hasHeldPlan = (result.stays ?? []).some((s) => s.status === 'have_plan');

  return (
    <View style={[styles.comboCard, { borderColor: isAboutEven ? t.color.border : pal.goldBorder }]} testID="dining-stays-result">
      <View style={styles.comboHeader} testID="dining-combination">
        <View style={styles.inlineHeader}>
          <Ionicons name={isAboutEven ? 'swap-horizontal-outline' : 'bed-outline'} size={16} color={isAboutEven ? t.color.textSecondary : pal.goldFg} />
          <Text style={[styles.comboHeading, { color: isAboutEven ? t.color.textPrimary : pal.goldFg }]}>{comboTitle}</Text>
        </View>
        {comboBadge !== null ? (
          <View
            style={[
              styles.planBadge,
              isAboutEven
                ? { backgroundColor: t.color.surfaceAlt, borderColor: t.color.border }
                : { backgroundColor: pal.savesBg, borderColor: pal.savesBorder },
            ]}
          >
            <Text style={[styles.planBadgeText, { color: isAboutEven ? t.color.textSecondary : pal.savesFg }]}>{comboBadge}</Text>
          </View>
        ) : null}
      </View>

      {isAboutEven && !hasHeldPlan ? (
        <View style={styles.staysList}>
          <View style={styles.stayRowCard} testID="dining-stay-cash-baseline">
            <View style={styles.stayRowTop}>
              <View style={styles.stayRowLeft}>
                <Text style={styles.name}>Paying cash (No plan anywhere)</Text>
                <Text style={styles.note}>{stays.map((s) => shortHotelLabel(s.label)).join(' · ')}</Text>
              </View>
              {noneScenario !== undefined && noneScenario.available ? (
                <View style={styles.matrixPriceCol}>
                  <Text style={styles.matrixTotal}>{formatCentsAsDollarString(noneScenario.totalCents)}</Text>
                  <Text style={styles.note}>Baseline</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.staysList}>
          {stays.map((s) => {
            const hasPlan = s.planCost !== null;
            const rawStay = (result.stays ?? []).find((x) => x.key === s.key);
            const cr = rawStay?.credits;
            const creditParts: string[] = [];
            if (cr && cr.ts.issued > 0) creditParts.push(`${cr.ts.issued} TS`);
            if (cr && cr.qs.issued > 0) creditParts.push(`${cr.qs.issued} QS`);
            if (cr && cr.snack.issued > 0) creditParts.push(`${cr.snack.issued} Snacks`);
            const noPlanBg = isAboutEven ? t.color.surface : pal.cashBg;
            const noPlanBorder = isAboutEven ? t.color.border : pal.cashBorder;
            const noPlanFg = isAboutEven ? t.color.textSecondary : pal.cashFg;
            return (
              <View
                key={s.key}
                style={[styles.stayRowCard, hasPlan && { backgroundColor: pal.goldBg, borderColor: pal.goldBorder }]}
                testID={`dining-stay-result-${s.key}`}
              >
                <View style={styles.stayRowTop}>
                  <View style={styles.stayRowLeft}>
                    <Text style={styles.name}>{shortHotelLabel(s.label)}</Text>
                    <Text style={styles.note}>{s.dates}</Text>
                  </View>
                  <View style={[styles.planBadge, { backgroundColor: hasPlan ? pal.goldBg : noPlanBg, borderColor: hasPlan ? pal.goldBorder : noPlanBorder }]}>
                    <Text style={[styles.planBadgeText, { color: hasPlan ? pal.goldFg : noPlanFg }]}>{s.plan}</Text>
                  </View>
                </View>
                {creditParts.length > 0 ? <Text style={styles.note}>Includes {creditParts.join(' · ')}</Text> : null}
                {s.planCost !== null || s.contribution !== null ? (
                  <View style={styles.stayFootRow}>
                    {s.planCost !== null ? <Text style={styles.note}>Plan cost: {s.planCost}</Text> : <View />}
                    {s.contribution !== null ? <Text style={[styles.contribution, { color: pal.savesFg }]}>{s.contribution}</Text> : null}
                  </View>
                ) : null}
                {s.unavailableText !== null ? <Text style={styles.note}>Not available. {s.unavailableText}</Text> : null}
              </View>
            );
          })}
        </View>
      )}

      {matrix.length > 0 ? (
        <View style={styles.alternativesSection} testID="dining-alternatives">
          <Pressable
            onPress={() => setAltOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: altOpen }}
            accessibilityLabel={`Compare other hotel combinations (${matrix.length})`}
            testID="dining-alternatives-toggle"
            style={styles.altToggle}
          >
            <Text style={[styles.altToggleText, { color: t.color.primaryFg }]}>
              Compare all other hotel combinations ({matrix.length})
            </Text>
            <Ionicons name={altOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.primaryFg} />
          </Pressable>

          {altOpen ? (
            <View style={styles.matrixWrap}>
              {hasMarginMatches ? (
                <Text style={styles.note}>
                  Highlighted combinations are within ~2% ({formatCentsAsDollarString(result.evenThresholdCents)}) of paying cash.
                </Text>
              ) : null}
              <View style={styles.matrixHeader}>
                {stays.map((s) => (
                  <Text key={s.key} style={styles.matrixColHdr} numberOfLines={2}>
                    {shortHotelLabel(s.label)}
                  </Text>
                ))}
                <Text style={[styles.matrixColHdr, styles.matrixRight]}>Total</Text>
              </View>
              {matrix.map((row, i) => (
                <View
                  key={i}
                  style={[styles.matrixRow, row.withinMargin && { borderColor: pal.goldBorder }]}
                  testID={`dining-alternative-${i}`}
                >
                  {row.columns.map((col) => {
                    const bg = col.optionCode === 'quick_service' ? pal.qsBg : col.optionCode === 'none' ? t.color.surface : pal.creditBg;
                    const fg = col.optionCode === 'quick_service' ? pal.qsFg : col.optionCode === 'none' ? t.color.textSecondary : pal.creditFg;
                    return (
                      <View key={col.stayKey} style={[styles.matrixPill, { backgroundColor: bg }]}>
                        <Text style={[styles.matrixPillText, { color: fg }]} numberOfLines={1}>
                          {col.optionShortLabel}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={styles.matrixPriceCol}>
                    <Text style={styles.matrixTotal}>{row.total}</Text>
                    <Text style={[styles.matrixNet, { color: row.isCostMore ? t.color.danger : pal.savesFg }]}>
                      {row.net}
                    </Text>
                    {row.withinMargin ? <Text style={[styles.matrixNet, { color: pal.goldFg }]}>Within margin</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function DiningCompareCard({ result }: { readonly result: DiningPlanResultDTO }): JSX.Element {
  const styles = useStyles();
  const rows = [...scenarioRows(result)].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return 0;
  });
  const availableTotals = result.scenarios.filter((s) => s.available && s.totalCents > 0).map((s) => s.totalCents);
  const maxCents = Math.max(1, ...availableTotals);

  const initialOpen = rows.find((r) => r.recommended)?.code ?? rows.find((r) => r.available)?.code ?? 'none';
  const [openSet, setOpenSet] = useState<ReadonlySet<DiningScenarioCode>>(() => new Set([initialOpen]));

  useEffect(() => {
    setOpenSet(new Set([initialOpen]));
  }, [initialOpen]);

  function toggleRow(code: DiningScenarioCode): void {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <View style={styles.card} testID="dining-compare-card">
      <StaysResult result={result} />
      <Text style={styles.title} accessibilityRole="header">
        Compare the options
      </Text>
      {rows.map((r) => {
        const sc = result.scenarios.find((s) => s.code === r.code);
        const pct = sc && sc.available ? Math.max(15, Math.min(100, Math.round((sc.totalCents / maxCents) * 100))) : 0;
        return <Row key={r.code} row={r} expanded={openSet.has(r.code)} onToggle={() => toggleRow(r.code)} barPercent={pct} />;
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: { marginBottom: theme.spacing.md },
  title: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', color: t.color.textPrimary, marginBottom: 6 },
  row: {
    padding: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: 6,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.xs },
  rowTitleBlock: { flex: 1, gap: 3 },
  rowRight: { alignItems: 'flex-end' },
  name: { fontSize: 13.5, lineHeight: 17, fontWeight: '700', color: t.color.textPrimary, flexShrink: 1 },
  totalHeadline: { fontSize: 14.5, lineHeight: 18, fontWeight: '800', color: t.color.textPrimary },
  netInline: { fontSize: 11.5, lineHeight: 15, color: t.color.textSecondary, fontWeight: '700' },
  tag: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  tagText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  inlineHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  note: { fontSize: 11.5, lineHeight: 15, color: t.color.textSecondary, marginTop: 1 },
  warning: { color: t.color.warningText },
  reason: { fontSize: 12, lineHeight: 16, color: t.color.textSecondary, flex: 1 },
  barTrack: { height: 5, borderRadius: theme.radius.pill, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: theme.radius.pill },
  tapHint: { fontSize: 11, lineHeight: 14, color: t.color.textSecondary, fontWeight: '600', marginTop: 4 },
  ledger: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: t.color.border },
  figure: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm, paddingVertical: 1.5 },
  figureLabel: { fontSize: 12, lineHeight: 16, color: t.color.textSecondary, flex: 1 },
  figureValue: { fontSize: 12, lineHeight: 16, color: t.color.textPrimary },
  strong: { fontWeight: '700', color: t.color.textPrimary },
  net: { fontSize: 12.5, lineHeight: 16, fontWeight: '700', color: t.color.primaryFg, marginTop: 4 },
  comboCard: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.sm + 2,
  },
  comboHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  comboHeading: { fontSize: 12.5, lineHeight: 16, fontWeight: '800', letterSpacing: 0.4 },
  staysList: { gap: 6, marginTop: 6 },
  stayRowCard: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  stayRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.xs },
  stayRowLeft: { flex: 1 },
  planBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, borderWidth: 1 },
  planBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  stayFootRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm, marginTop: 3 },
  contribution: { fontSize: 11.5, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  alternativesSection: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.color.border },
  altToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  altToggleText: { fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
  matrixWrap: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  matrixHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  matrixColHdr: { flex: 1, fontSize: 10.5, lineHeight: 13, color: t.color.textSecondary, fontWeight: '700' },
  matrixRight: { flex: 1.25, textAlign: 'right' },
  matrixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  matrixPill: { flex: 1, paddingVertical: 4, paddingHorizontal: 3, borderRadius: 4, alignItems: 'center' },
  matrixPillText: { fontSize: 10.5, fontWeight: '700' },
  matrixPriceCol: { flex: 1.25, alignItems: 'flex-end' },
  matrixTotal: { fontSize: 12, color: t.color.textPrimary, fontWeight: '800' },
  matrixNet: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', textAlign: 'right' },
  pressed: { opacity: 0.8 },
}));
