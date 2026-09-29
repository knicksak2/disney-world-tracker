// Feature: experience-detail-redesign, Task 18.1 — LiveWaitCockpit
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10
//
// Tactical live cockpit for Ride and Character_Meet experiences, composing:
//   1. WaitContextSelector (Now / Trip / Typical)
//   2. Standby wait instrument & Lightning Lane ticket
//   3. VirtualQueueBanner
//   4. SingleRiderStrip
//   5. Forecast chart driven by selected context
//   6. Typical / Worst + Reliability stats
//   7. Best_Time_Verdict

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { LiveDetailDTO, WaitInsightsDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Card } from '../../theme/components';
import { resolveTripContextDate } from './tripContextDate';
import { formatParkTime, getTodayWdwDate } from './live/parkTime';
import VirtualQueueBanner from './VirtualQueueBanner';

export type WaitContextMode = 'Now' | 'Trip' | 'Typical';

export interface LiveWaitCockpitProps {
  readonly experienceId: string;
  readonly liveDetail?: LiveDetailDTO | undefined;
  readonly plannedDate?: string | null | undefined;
  readonly activeTripRange?:
    | { readonly startDate: string; readonly endDate: string }
    | null
    | undefined;
  readonly todayWdw?: string | undefined;
  readonly waitContext?: WaitContextMode | undefined;
  readonly onWaitContextChange?: ((context: WaitContextMode) => void) | undefined;
}

export default function LiveWaitCockpit({
  experienceId,
  liveDetail,
  plannedDate: propPlannedDate,
  activeTripRange: propActiveTripRange,
  todayWdw: propTodayWdw,
  waitContext: controlledContext,
  onWaitContextChange,
}: LiveWaitCockpitProps): JSX.Element {
  const [internalContext, setInternalContext] = useState<WaitContextMode>('Now');
  const context = controlledContext ?? internalContext;
  const setContext = onWaitContextChange ?? setInternalContext;

  const todayWdw = propTodayWdw ?? getTodayWdwDate();

  // Trips query fallback if not provided via props
  const { data: tripsData } = useQuery({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<any>('GET', '/me/trips?filter=active'),
    enabled: propActiveTripRange === undefined,
  });

  const activeTrip = React.useMemo(() => {
    if (!tripsData) return undefined;
    if (Array.isArray(tripsData)) {
      const activeGroup = tripsData.find((g: any) => g.status === 'active');
      const upcomingGroup = tripsData.find((g: any) => g.status === 'upcoming');
      return activeGroup?.trips?.[0] ?? upcomingGroup?.trips?.[0] ?? undefined;
    }
    const trips = tripsData?.trips;
    if (Array.isArray(trips)) {
      return (
        trips.find((t: any) => t.status === 'active') ??
        trips.find((t: any) => t.status === 'upcoming') ??
        undefined
      );
    }
    return undefined;
  }, [tripsData]);

  const activeTripRange =
    propActiveTripRange !== undefined
      ? propActiveTripRange
      : activeTrip
      ? { startDate: activeTrip.startDate, endDate: activeTrip.endDate }
      : null;

  // Planned items query fallback if not provided via props
  const tripIdForPlanned = activeTrip?.id;
  const { data: plannedItemsData } = useQuery({
    queryKey: ['trip-planned-items', tripIdForPlanned, experienceId] as const,
    queryFn: () =>
      tripIdForPlanned
        ? apiRequest<any>('GET', `/trips/${tripIdForPlanned}/planned-items`)
        : null,
    enabled: propPlannedDate === undefined && !!tripIdForPlanned,
  });

  const plannedDate =
    propPlannedDate !== undefined
      ? propPlannedDate
      : (plannedItemsData?.items?.find(
          (item: any) => item.experienceId === experienceId,
        )?.plannedDate ?? null);

  const resolvedTripDate = resolveTripContextDate({
    plannedDate,
    activeTripRange,
    todayWdw,
  });

  // Query date per Requirements 13.4, 13.5, 13.6:
  // - Now: today's date
  // - Typical: null (no query parameter)
  // - Trip: resolvedTripDate
  const queryDate =
    context === 'Now'
      ? todayWdw
      : context === 'Trip' && resolvedTripDate
      ? resolvedTripDate
      : null;

  const { data: insights } = useQuery<WaitInsightsDTO>({
    queryKey: ['wait-insights', experienceId, queryDate],
    queryFn: () => {
      let url = `/experiences/${experienceId}/wait-insights`;
      if (queryDate) {
        url += `?date=${queryDate}`;
      }
      return apiRequest<WaitInsightsDTO>('GET', url);
    },
  });

  const [inspectedBar, setInspectedBar] = useState<{ hour: number; wait: number } | null>(null);

  const formatHour = (h?: number) => {
    if (h == null) return '';
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h > 12 ? `${h - 12} PM` : `${h} AM`;
  };

  const formatHourTime = (h?: number) => {
    if (h == null) return '';
    const period = h === 0 || h < 12 ? 'AM' : 'PM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:00 ${period}`;
  };

  const isOperating = liveDetail?.status === 'Operating';
  const standbyWait =
    isOperating && typeof liveDetail?.waitMinutes === 'number'
      ? `${liveDetail.waitMinutes} min`
      : isOperating
      ? 'No wait posted'
      : liveDetail?.status ?? 'Closed';

  // LL ticket details
  const ll = liveDetail?.lightningLane;
  let llWindow: string | null = null;
  if (ll?.returnStart && ll?.returnEnd) {
    llWindow = `${formatParkTime(ll.returnStart)} \u2013 ${formatParkTime(ll.returnEnd)}`;
  } else if (ll?.state) {
    llWindow = ll.state;
  } else if (ll?.available !== undefined) {
    llWindow = ll.available ? 'Available' : 'Unavailable';
  }

  // Verdict logic from existing WaitInsightsSection
  const isLowConfidence = (insights?.sampleCount ?? 0) < 10;
  const isHighConfidence =
    (insights?.sampleCount ?? 0) >= 30 && (insights?.cv ?? 1) <= 0.35;
  const climbsFast = (insights?.escalationRate ?? 0) >= 15;

  const getVerdictHeadline = () => {
    if (!insights) return 'Check live wait times today';
    if (isLowConfidence) {
      if (climbsFast) return 'Mornings get busy quickly';
      if (insights.bestHour != null && insights.bestHour >= 17)
        return 'Evenings are usually calmer';
      return 'Check live wait times today';
    }
    if (isHighConfidence) {
      if (climbsFast) return 'Rope drop';
      if (insights.bestHour != null)
        return `Ride around ${formatHour(insights.bestHour)}`;
      return 'Ride anytime';
    }
    if (climbsFast) return 'Typically best at rope drop';
    if (insights.bestHour != null)
      return `Usually best around ${formatHour(insights.bestHour)}`;
    return 'Usually fine anytime';
  };

  const getVerdictSubtext = () => {
    if (!insights || isLowConfidence) return '';
    const lowText =
      insights.bestHour != null
        ? `Lowest waits (~${insights.p50WaitMinutes} min). `
        : '';
    const avoidText =
      insights.worstHour != null
        ? `Avoid ${formatHour(insights.worstHour)} (~${insights.p90WaitMinutes} min).`
        : '';
    return lowText + avoidText;
  };

  const waits = insights?.waits || [];
  const maxWait = Math.max(
    1,
    ...waits.map((w) => w.predictedWaitMinutes || 0),
  );

  return (
    <Card style={styles.card} testID="live-wait-cockpit">
      {/* 1. Wait_Context_Selector (R13.2, R13.3) */}
      <View style={styles.contextChips} testID="wait-context-selector">
        <Pressable
          style={[styles.chip, context === 'Now' && styles.chipActive]}
          onPress={() => setContext('Now')}
          testID="wait-context-now"
          accessibilityRole="button"
          accessibilityState={{ selected: context === 'Now' }}
          accessibilityLabel="Wait forecast context: Now"
        >
          <Text
            style={[styles.chipText, context === 'Now' && styles.chipTextActive]}
          >
            Now
          </Text>
        </Pressable>

        {/* Trip segment present only when resolvable per R13.2, R16.4 */}
        {resolvedTripDate ? (
          <Pressable
            style={[styles.chip, context === 'Trip' && styles.chipActive]}
            onPress={() => setContext('Trip')}
            testID="wait-context-trip"
            accessibilityRole="button"
            accessibilityState={{ selected: context === 'Trip' }}
            accessibilityLabel={`Wait forecast context: Trip (${resolvedTripDate})`}
          >
            <Text
              style={[
                styles.chipText,
                context === 'Trip' && styles.chipTextActive,
              ]}
            >
              Trip
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.chip, context === 'Typical' && styles.chipActive]}
          onPress={() => setContext('Typical')}
          testID="wait-context-typical"
          accessibilityRole="button"
          accessibilityState={{ selected: context === 'Typical' }}
          accessibilityLabel="Wait forecast context: Typical"
        >
          <Text
            style={[
              styles.chipText,
              context === 'Typical' && styles.chipTextActive,
            ]}
          >
            Typical
          </Text>
        </Pressable>
      </View>

      {/* Cockpit Headline & Live Operational Pulse Badge */}
      <View style={styles.cockpitHead}>
        <View style={styles.cockpitTitleWrap}>
          <Ionicons name="flash" size={15} color="#5b2a86" />
          <Text style={styles.cockpitTitleText}>Live Park Cockpit</Text>
        </View>
        <View
          style={[
            styles.opBadge,
            isOperating ? styles.opBadgeOperating : styles.opBadgeClosed,
          ]}
        >
          <View
            style={[
              styles.pulseDot,
              isOperating ? styles.pulseDotOperating : styles.pulseDotClosed,
            ]}
          />
          <Text
            style={[
              styles.opBadgeText,
              isOperating ? styles.opBadgeTextOperating : styles.opBadgeTextClosed,
            ]}
          >
            {liveDetail?.status ?? (isOperating ? 'Operating' : 'Closed')}
          </Text>
        </View>
      </View>

      {/* 2. Standby instrument + Lightning Lane Ticket */}
      <View style={styles.instrumentsRow}>
        <View
          style={[
            styles.standbyInstrument,
            isOperating ? styles.standbyInstrumentOperating : styles.standbyInstrumentClosed,
          ]}
          testID="standby-wait"
        >
          <Text
            style={[
              styles.standbyValue,
              isOperating ? styles.standbyValueOperating : styles.standbyValueClosed,
            ]}
            testID="cockpit-standby-wait"
          >
            {standbyWait}
          </Text>
          <Text
            style={[
              styles.instrumentLabel,
              isOperating ? styles.instrumentLabelOperating : styles.instrumentLabelClosed,
            ]}
          >
            STANDBY WAIT
          </Text>
          <Text
            style={[
              styles.instrumentStatus,
              isOperating ? styles.instrumentStatusOperating : styles.instrumentStatusClosed,
            ]}
          >
            {isOperating
              ? `Typical is ~${insights?.p50WaitMinutes ?? 8} min`
              : 'Reopens with park'}
          </Text>
        </View>

        <View style={styles.llTicket} testID="cockpit-lightning-lane">
          <View style={styles.llTicketHead}>
            <Ionicons name="flash" size={12} color="#5b2a86" />
            <Text style={styles.llTicketTitle}>LIGHTNING LANE</Text>
          </View>
          <Text style={styles.llWindowText}>
            {llWindow ?? (isOperating ? 'Available' : 'Finished for day')}
          </Text>
          <Text style={styles.llBenefitText}>
            {insights?.llMultipassPriceCents != null
              ? `Saves ~10 min \u2022 $${(insights.llMultipassPriceCents / 100).toFixed(0)} peak`
              : 'Saves ~10 min \u2022 Sells out fast'}
          </Text>
        </View>
      </View>

      {/* Tactical Quick Action Buttons */}
      <View style={styles.actionBtnRow}>
        <Pressable
          style={styles.actionBtnPlan}
          accessibilityRole="button"
          accessibilityLabel="Add to my plan"
        >
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={styles.actionBtnPlanText}>Add to my plan</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtnAlert}
          accessibilityRole="button"
          accessibilityLabel="Alert when wait drops under 30 minutes"
        >
          <Ionicons name="notifications-outline" size={15} color="#5b2a86" />
          <Text style={styles.actionBtnAlertText}>Alert &lt; 30 min</Text>
        </Pressable>
      </View>

      {/* 3. VirtualQueueBanner (R13.9, R15) */}
      <VirtualQueueBanner boardingGroup={liveDetail?.boardingGroup} />

      {/* 4. Single_Rider_Strip (R13.10) */}
      {insights?.hasSingleRider ||
      (isOperating && liveDetail?.singleRiderWaitMinutes !== undefined) ? (
        <View style={styles.singleRiderStrip} testID="single-rider-strip">
          <View style={styles.singleRiderLeft}>
            <Ionicons name="person" size={14} color="#7e22ce" />
            <Text style={styles.singleRiderTitle}>Single Rider</Text>
            {liveDetail?.singleRiderWaitMinutes !== undefined ? (
              <Text style={styles.singleRiderWait} testID="single-rider-wait">
                {liveDetail.singleRiderWaitMinutes} min
              </Text>
            ) : null}
          </View>
          <Text style={styles.singleRiderSub}>Party will be split</Text>
        </View>
      ) : null}

      {/* 7. Best_Time_Verdict (R13.8) */}
      {insights ? (
        <View style={styles.verdictBox} testID="cockpit-verdict">
          <View style={styles.verdictHead}>
            <Text style={styles.verdictTitle} testID="cockpit-verdict-headline">
              🎯 BEST TIME TO RIDE: {getVerdictHeadline().toUpperCase()}
            </Text>
          </View>
          {getVerdictSubtext() ? (
            <Text style={styles.verdictSubtext}>{getVerdictSubtext()}</Text>
          ) : null}
        </View>
      ) : null}

      {/* 6. Typical / Worst + Reliability stat pair (R13.7) */}
      {insights ? (
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Typical / Worst</Text>
            <Text style={styles.statValue} testID="cockpit-stat-typical">
              {insights.p50WaitMinutes}{' '}
              <Text style={styles.statUnit}>/ {insights.p90WaitMinutes} min</Text>
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Reliability</Text>
            <Text
              style={[styles.statValue, { color: '#16a34a' }]}
              testID="cockpit-stat-reliability"
            >
              {((1 - insights.downRate) * 100).toFixed(0)}%{' '}
              <Text style={[styles.statUnit, { color: '#16a34a' }]}>uptime</Text>
            </Text>
          </View>
        </View>
      ) : null}

      {/* 5. Forecast chart driven by selected context (R13.4-R13.6) */}
      {waits.length > 0 ? (
        <View style={styles.forecastBox} testID="cockpit-forecast-chart">
          <View style={styles.forecastHeader}>
            <Text style={styles.forecastTitle}>
              Predicted Wait — {context === 'Now' ? 'Today' : context}
            </Text>
            <Text style={styles.forecastScrubLabel} testID="forecast-scrub-label">
              {inspectedBar
                ? `${formatHour(inspectedBar.hour)}: ~${inspectedBar.wait}m wait`
                : 'Tap bars to inspect'}
            </Text>
          </View>
          <View style={styles.spark}>
            {waits.map((w) => {
              const heightPct = Math.max(
                12,
                (w.predictedWaitMinutes / maxWait) * 100,
              );
              const isPeak = w.predictedWaitMinutes === maxWait;
              const isInspected = inspectedBar?.hour === w.hour;
              return (
                <Pressable
                  key={w.hour}
                  testID={`forecast-bar-${w.hour}`}
                  onPress={() =>
                    setInspectedBar((prev) =>
                      prev?.hour === w.hour
                        ? null
                        : { hour: w.hour, wait: w.predictedWaitMinutes },
                    )
                  }
                  style={styles.sparkBarCol}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatHour(w.hour)}, predicted wait ${w.predictedWaitMinutes} minutes`}
                >
                  <View
                    style={[
                      styles.sparkBar,
                      { height: `${heightPct}%` },
                      isPeak && styles.sparkBarPeak,
                      isInspected && styles.sparkBarActive,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.sparkX}>
            <Text style={styles.sparkXText}>{formatHour(waits[0]?.hour)}</Text>
            <Text style={styles.sparkXText}>
              {formatHour(waits[Math.floor(waits.length / 2)]?.hour)} (Peak)
            </Text>
            <Text style={styles.sparkXText}>
              {formatHour(waits[waits.length - 1]?.hour)} (Close)
            </Text>
          </View>
          {insights?.bestHour != null ? (
            <Text style={styles.lowestForecastLegend} testID="lowest-forecast-legend">
              Lowest predicted wait: {insights.p50WaitMinutes} min at {formatHourTime(insights.bestHour)}
            </Text>
          ) : null}
          <View style={styles.freshnessFooter}>
            <Text style={styles.freshnessText}>Retrieved today, 7:44 PM</Text>
            <Text style={styles.freshnessText}>Source updated 7:36 PM</Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 0,
    marginVertical: theme.spacing.xs,
    padding: 16,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 2,
  },
  contextChips: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  chip: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2d9f3',
    backgroundColor: '#fbf9fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#655d78',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  cockpitHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cockpitTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cockpitTitleText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#190c2d',
    letterSpacing: -0.2,
  },
  opBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  opBadgeOperating: {
    backgroundColor: '#ecfdf5',
    borderColor: 'rgba(22, 163, 74, 0.25)',
  },
  opBadgeClosed: {
    backgroundColor: '#fef2f2',
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  pulseDotOperating: {
    backgroundColor: '#16a34a',
  },
  pulseDotClosed: {
    backgroundColor: '#dc2626',
  },
  opBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  opBadgeTextOperating: {
    color: '#16a34a',
  },
  opBadgeTextClosed: {
    color: '#dc2626',
  },
  instrumentsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  standbyInstrument: {
    flex: 1.1,
    borderRadius: 18,
    padding: 14,
    justifyContent: 'space-between',
  },
  standbyInstrumentOperating: {
    backgroundColor: '#1b864d',
    shadowColor: '#1b864d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 3,
  },
  standbyInstrumentClosed: {
    backgroundColor: '#1e293b',
  },
  instrumentLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  instrumentLabelOperating: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  instrumentLabelClosed: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  standbyValue: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  standbyValueOperating: {
    color: '#ffffff',
  },
  standbyValueClosed: {
    color: '#ffffff',
  },
  instrumentStatus: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  instrumentStatusOperating: {
    color: '#bbf7d0',
  },
  instrumentStatusClosed: {
    color: '#94a3b8',
  },
  llTicket: {
    flex: 1.25,
    backgroundColor: '#fbf9fe',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#c8b7e6',
    justifyContent: 'space-between',
  },
  llTicketHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  llTicketTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#5b2a86',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  llWindowText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#190c2d',
    marginTop: 4,
  },
  llBenefitText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#15803d',
    marginTop: 4,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionBtnPlan: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#5b2a86',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  actionBtnPlanText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  actionBtnAlert: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f3edf9',
    borderWidth: 1,
    borderColor: '#d8c8ed',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  actionBtnAlertText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#5b2a86',
  },
  singleRiderStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#faf5ff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#d8b4fe',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginVertical: 6,
  },
  singleRiderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  singleRiderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7e22ce',
  },
  singleRiderWait: {
    fontSize: 12,
    fontWeight: '900',
    color: '#581c87',
  },
  singleRiderSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b21a8',
  },
  forecastBox: {
    backgroundColor: '#fbf9fe',
    borderRadius: 14,
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#ede6f6',
  },
  forecastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forecastTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#655d78',
  },
  forecastScrubLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5b2a86',
  },
  forecastPeak: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8b5cf6',
  },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 48,
    gap: 4,
  },
  sparkBarCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  sparkBar: {
    width: '100%',
    backgroundColor: '#cfc2e5',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  sparkBarPeak: {
    backgroundColor: '#8b5cf6',
  },
  sparkBarActive: {
    backgroundColor: '#5b2a86',
    borderWidth: 1.5,
    borderColor: '#3b145d',
  },
  sparkX: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sparkXText: {
    fontSize: 10,
    color: '#948ca5',
    fontWeight: '600',
  },
  lowestForecastLegend: {
    fontSize: 10,
    color: '#16a34a',
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  freshnessFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f0eaf7',
  },
  freshnessText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#948ca5',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3edf9',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginVertical: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#e2d9f3',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#655d78',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.color.textPrimary,
    marginTop: 2,
  },
  statUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: '#655d78',
  },
  verdictBox: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 4,
    borderLeftColor: '#16a34a',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  verdictHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verdictIcon: {
    fontSize: 12,
  },
  verdictTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.5,
  },
  verdictHeadline: {
    fontSize: 13,
    fontWeight: '800',
    color: '#14532d',
    marginTop: 2,
  },
  verdictSubtext: {
    fontSize: 11,
    color: '#166534',
    fontWeight: '600',
    marginTop: 2,
  },
});
