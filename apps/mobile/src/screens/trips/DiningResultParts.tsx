// Feature: dining-plan-calculator — sticky 2-line verdict header, 4-tab bar, sensitivity table, and notes on the
// figures, shared by the Trip screen and standalone calculator (Requirements 15.3–15.6, 21.1–21.3, 22.1–22.4, 27).
//
// The disclaimer sits permanently inside the compact verdict strip so it stays above the fold (Requirement 21.1).
// No text has a fixed height or single-line clamp on headlines so dynamic font scaling never clips (Requirement 22.4).

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiningOrderStyle, DiningPlanResultDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { DINING_PALETTE } from './diningPlan.palette';
import { Notice } from './diningPlanControls';
import {
  DINING_DISCLAIMER,
  pricesAsOfText,
  qualityNotice,
  ratesText,
  sensitivityRows,
  verdictCompactView,
} from './diningPlanView';

export type DiningTabKey = 'meals' | 'compare' | 'credits' | 'settings';

const TABS: readonly { key: DiningTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'meals', label: 'Meals', icon: 'restaurant-outline' },
  { key: 'compare', label: 'Compare', icon: 'stats-chart-outline' },
  { key: 'credits', label: 'Credits', icon: 'ticket-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

export function DiningTabBar({
  activeTab,
  onSelectTab,
  daysCount,
}: {
  readonly activeTab: DiningTabKey;
  readonly onSelectTab: (tab: DiningTabKey) => void;
  readonly daysCount?: number;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  return (
    <View style={styles.tabBar} accessibilityRole="tablist" testID="dining-tab-bar">
      {TABS.map((tab) => {
        const selected = tab.key === activeTab;
        const label = tab.key === 'meals' && daysCount !== undefined && daysCount > 0 ? `Meals (${daysCount}d)` : tab.label;
        const iconColor = selected
          ? t.color.textOnPrimary
          : tab.key === 'compare'
            ? pal.compareTabFg
            : tab.key === 'credits'
              ? pal.creditsTabFg
              : t.color.textSecondary;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelectTab(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            testID={`dining-tab-${tab.key}`}
            style={({ pressed }) => [styles.tabItem, selected && styles.tabItemSelected, pressed && styles.pressed]}
          >
            <Ionicons name={tab.icon} size={14} color={iconColor} />
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Sticky 2-line verdict header with Requirement 21.1 disclaimer always visible above the fold and an expandable
 * `Why?` drawer showing the 4-way mini comparison and data-quality notices (Requirement 27.1).
 */
export function DiningVerdictCard({
  result,
  defaultExpanded = false,
  onExpandedChange,
}: {
  readonly result: DiningPlanResultDTO;
  readonly defaultExpanded?: boolean;
  readonly onExpandedChange?: (expanded: boolean) => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const v = verdictCompactView(result);
  const q = qualityNotice(result);

  const isSaves = result.verdict === 'plan_saves';
  const iconColor = isSaves ? pal.savesFg : result.verdict === 'about_even' ? t.color.primaryFg : t.color.textSecondary;

  return (
    <View style={[styles.verdict, isSaves && { backgroundColor: pal.savesBg, borderColor: pal.savesBorder }]} testID="dining-verdict">
      <Pressable
        onPress={() => {
          const next = !expanded;
          setExpanded(next);
          onExpandedChange?.(next);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${v.headline}. ${v.bestSummary}. ${expanded ? 'Hide details' : 'Why?'}`}
        testID="dining-verdict-toggle"
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View style={styles.verdictRow1}>
          <View style={styles.verdictLeft}>
            <Ionicons name={v.icon} size={16} color={iconColor} />
            <Text style={[styles.verdictHeadline, isSaves && { color: pal.savesFg }]} accessibilityRole="header" testID="dining-verdict-title">
              {v.headline}
            </Text>
          </View>
          <View style={styles.verdictRight}>
            {v.totalText !== null ? (
              <Text style={[styles.verdictTotal, { color: pal.goldFg }]} testID="dining-verdict-total">
                {v.totalText}
              </Text>
            ) : null}
            <View style={styles.whyPill}>
              <Text style={styles.whyText}>{expanded ? 'Hide ▲' : 'Why? ▾'}</Text>
            </View>
          </View>
        </View>
        {result.verdict === 'about_even' ? (
          <View style={styles.aboutEvenLines}>
            <Text style={styles.verdictBestSummary} testID="dining-verdict-best">
              {v.bestMain}
            </Text>
            {v.bestAside !== null ? <Text style={styles.verdictBestAside}>{v.bestAside}</Text> : null}
          </View>
        ) : (
          <Text
            style={styles.verdictBestSummary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            ellipsizeMode="tail"
            testID="dining-verdict-best"
          >
            {v.bestMain}
            {v.bestAside !== null ? <Text style={styles.verdictBestAside}> {v.bestAside}</Text> : null}
          </Text>
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.drawer} testID="dining-verdict-drawer">
          <Text style={styles.body} testID="dining-verdict-detail">
            {v.detail}
          </Text>
          {v.miniStats.length > 0 ? (
            <View style={styles.miniGrid}>
              {v.miniStats.map((m) => (
                <View
                  key={m.code}
                  style={[styles.miniStat, m.isRecommended && { borderColor: pal.goldBorder, backgroundColor: pal.goldBg }]}
                  testID={`dining-verdict-mini-${m.code}`}
                >
                  <Text style={[styles.miniStatLabel, m.isRecommended && { color: pal.goldFg }]} numberOfLines={1}>
                    {m.isRecommended ? `★ ${m.label}` : m.label}
                  </Text>
                  <Text style={[styles.miniStatVal, m.isRecommended && { color: pal.goldFg }]}>{m.total}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {q.notice !== null ? <DiningQualityNotice result={result} /> : null}
          <Text style={styles.disclaimer} testID="dining-disclaimer">
            {DINING_DISCLAIMER}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The data-quality notice (Requirement 15.3); nothing for a result built only on verified data and derived rules. */
export function DiningQualityNotice({ result }: { readonly result: DiningPlanResultDTO }): JSX.Element | null {
  const q = qualityNotice(result);
  return q.notice === null ? null : <Notice tone="warning" text={q.notice} testID="dining-quality-notice" />;
}

export function DiningSensitivityTable({ result, orderStyle }: { readonly result: DiningPlanResultDTO; readonly orderStyle: DiningOrderStyle }): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const rows = sensitivityRows(result, orderStyle);
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} testID="dining-sensitivity">
      <Text style={styles.title} accessibilityRole="header">
        If you order differently
      </Text>
      {result.verdict === 'about_even' ? <Text style={styles.body}>This one is too close to call; here is how the answer moves with how you order.</Text> : null}
      {rows.map((r) => (
        <View
          key={r.orderStyle}
          style={[styles.sensRow, r.current && styles.sensCurrent]}
          testID={`dining-sensitivity-${r.orderStyle}`}
          accessible
          accessibilityLabel={`${r.label}${r.current ? ', your setting' : ''}: best is ${r.best}. ${r.net}`}
        >
          <View style={styles.sensLabel}>
            {r.current ? <Ionicons name="person-circle-outline" size={14} color={t.color.primaryFg} /> : null}
            <Text style={styles.sensStyle} numberOfLines={1}>
              {r.label}
              {r.current ? ' (your setting)' : ''}
            </Text>
          </View>
          <Text style={styles.sensRight}>
            {r.best}: {r.net}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Where the figures come from: derived rules, prices date, tax and tip, and what is left out. */
export function DiningAboutFigures({
  result,
  collapsible = false,
  defaultExpanded = true,
}: {
  readonly result: DiningPlanResultDTO;
  readonly collapsible?: boolean;
  readonly defaultExpanded?: boolean;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const [open, setOpen] = useState(collapsible ? defaultExpanded : true);
  const q = qualityNotice(result);
  const a = result.assumptions;
  const outside = result.dataQuality.outsideStayEntries;
  return (
    <View style={styles.card} testID="dining-about-figures">
      {collapsible ? (
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel="About these figures"
          testID="dining-about-figures-toggle"
          style={styles.aboutHeader}
        >
          <View style={styles.aboutHeaderLeft}>
            <Ionicons name="information-circle-outline" size={16} color={t.color.textSecondary} />
            <Text style={styles.aboutTitle}>About these figures &amp; pricing rules</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textSecondary} />
        </Pressable>
      ) : (
        <Text style={styles.title} accessibilityRole="header">
          About these figures
        </Text>
      )}
      {open ? (
        <View style={collapsible ? styles.aboutBody : undefined}>
          {q.derivedLine !== null ? (
            <Text style={styles.small} testID="dining-derived-line">
              {q.derivedLine}
            </Text>
          ) : null}
          <Text style={styles.small} testID="dining-prices-as-of">
            {pricesAsOfText(result)}
          </Text>
          <Text style={styles.small} testID="dining-rates">
            {ratesText(result)}
          </Text>
          {a.planPricesIncludeTax ? <Text style={styles.small}>Plan prices include tax; tax is added only to what you pay yourself.</Text> : null}
          {a.passDiscountBps !== null ? (
            <Text style={styles.small} testID="dining-pass-discount">
              A pass holder discount of {a.passDiscountBps / 100}% is applied for the whole party to meals you pay for, except at restaurants marked as not offering it.
            </Text>
          ) : null}
          {outside > 0 ? (
            <Text style={styles.small}>
              {outside} {outside === 1 ? 'meal is' : 'meals are'} outside your stay dates and not counted.
            </Text>
          ) : null}
          <Text style={styles.small}>Guests under 3 are not priced.</Text>
          <Text style={styles.small} testID="dining-fixed-price-note">
            Buffets and fixed-price meals are counted at their set price, with no separate drink or alcohol added.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: 2,
    gap: 2,
    marginBottom: 2,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: theme.radius.sm,
  },
  tabItemSelected: { backgroundColor: t.color.primary },
  tabLabel: { fontSize: 11.5, color: t.color.textSecondary, fontWeight: '700' },
  tabLabelSelected: { color: t.color.textOnPrimary },
  aboutEvenLines: { marginTop: 2, gap: 1 },
  verdict: {
    marginHorizontal: theme.spacing.md,
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
  },
  verdictRow1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  verdictLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  verdictHeadline: { fontSize: 13.5, lineHeight: 17, fontWeight: '800', color: t.color.textPrimary, flex: 1 },
  verdictRight: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  verdictTotal: { fontSize: 12, fontWeight: '800' },
  whyPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.surfaceAlt,
  },
  whyText: { fontSize: 10.5, color: t.color.textSecondary, fontWeight: '700' },
  verdictBestSummary: { fontSize: 11, lineHeight: 15, color: t.color.textPrimary, fontWeight: '600', marginTop: 2 },
  verdictBestAside: { fontWeight: '400', color: t.color.textSecondary },
  disclaimer: { fontSize: 10, lineHeight: 13, color: t.color.textSecondary, fontWeight: '400', marginTop: 4 },
  drawer: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    gap: 6,
  },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  miniStat: {
    flex: 1,
    minWidth: 68,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
  },
  miniStatLabel: { fontSize: 10.5, color: t.color.textSecondary, fontWeight: '700', textAlign: 'center' },
  miniStatVal: { fontSize: 13, fontWeight: '800', color: t.color.textPrimary, marginTop: 2 },
  body: { ...theme.typography.body, color: t.color.textPrimary },
  card: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.sm + 2,
  },
  title: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', color: t.color.textPrimary, marginBottom: 4 },
  sensRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    marginTop: 4,
  },
  sensCurrent: { borderColor: t.color.primaryFg, borderWidth: 1.5 },
  sensLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  sensStyle: { fontSize: 12, fontWeight: '700', color: t.color.textPrimary },
  sensRight: { fontSize: 11.5, lineHeight: 15, color: t.color.textSecondary, flex: 1, textAlign: 'right' },
  aboutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  aboutHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, flex: 1 },
  aboutTitle: { ...theme.typography.subtitle, color: t.color.textSecondary },
  aboutBody: { marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: t.color.border },
  small: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400', marginBottom: theme.spacing.xs },
  pressed: { opacity: 0.8 },
}));
