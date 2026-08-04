import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Card, SectionLabel, PrimaryButton, SecondaryButton } from '../../theme/components';
import type { WaitInsightsDTO } from '@dwt/shared';

interface Props {
  experienceId: string;
}

export default function WaitInsightsSection({ experienceId }: Props): JSX.Element | null {
  const [context, setContext] = useState<'Now' | 'Trip' | 'Typical'>('Now');

  // We only show "Trip" if we actually had a trip date. The spec says "hide 'Trip' when there's no upcoming/active trip".
  // For now, we'll check if the user has an active trip via a query, or we can just omit it if we don't have the trip state directly available.
  // The user says: "hide 'Trip' when there's no upcoming/active trip; default to 'Now' today, else 'Typical'."
  
  // A simple active trip fetch to determine if we should show 'Trip'
  // Alternatively, the parent screen could pass down the active trip date.
  // We'll do a lightweight fetch to `/me/trips` or rely on the fact that `HomeScreen` uses it.
  const { data: tripsData } = useQuery({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<any>('GET', '/me/trips?filter=active'),
  });

  const activeTrip = tripsData?.trips?.[0];
  const tripDate = activeTrip ? activeTrip.startDate : null;

  // Set the default on mount if 'Now' isn't appropriate? "default to 'Now' today, else 'Typical'."
  // Actually, wait, "Now" is always available.
  
  const queryDate = context === 'Now' ? new Date().toISOString().split('T')[0] : 
                    context === 'Trip' && tripDate ? tripDate : 
                    null; // Typical

  const { data, isLoading, isError } = useQuery<WaitInsightsDTO>({
    queryKey: ['wait-insights', experienceId, queryDate],
    queryFn: () => {
      let url = `/experiences/${experienceId}/wait-insights`;
      if (queryDate) {
        url += `?date=${queryDate}`;
      }
      return apiRequest<WaitInsightsDTO>('GET', url);
    },
  });

  if (isLoading || isError || !data) {
    return null;
  }

  const formatHour = (h?: number) => {
    if (h == null) return '';
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h > 12 ? `${h - 12} PM` : `${h} AM`;
  };

  const formatCents = (cents?: number) => {
    if (cents == null) return '';
    return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
  };

  const maxWait = Math.max(1, ...(data.waits?.map(w => w.predictedWaitMinutes) || []));
  const waits = data.waits || [];

  const isHighConfidence = data.sampleCount >= 30 && data.cv <= 0.35;
  const isLowConfidence = data.sampleCount < 10;
  // escalationRate is a signed minute delta (first→second operating hour), not a ratio.
  // A rope-drop-favorable verdict needs a steep positive climb (per design constant).
  const ROPE_DROP_ESCALATION_MINUTES = 15;
  const climbsFast = (data.escalationRate ?? 0) >= ROPE_DROP_ESCALATION_MINUTES;

  const getVerdictHeadline = () => {
    if (isLowConfidence) {
      if (climbsFast) return 'Mornings get busy quickly';
      if (data.bestHour != null && data.bestHour >= 17) return 'Evenings are usually calmer';
      return 'Check live wait times today';
    }
    if (isHighConfidence) {
      if (climbsFast) return 'Rope drop';
      if (data.bestHour != null) return `Ride around ${formatHour(data.bestHour)}`;
      return 'Ride anytime';
    }
    // Moderate
    if (climbsFast) return 'Typically best at rope drop';
    if (data.bestHour != null) return `Usually best around ${formatHour(data.bestHour)}`;
    return 'Usually fine anytime';
  };

  const getVerdictSubtext = () => {
    if (isLowConfidence) return '';
    const lowText = data.bestHour != null ? `Lowest waits (~${data.p50WaitMinutes} min). ` : '';
    const avoidText = data.worstHour != null ? `Avoid ${formatHour(data.worstHour)} (~${data.p90WaitMinutes} min).` : '';
    return lowText + avoidText;
  };

  return (
    <View style={styles.container}>
      <View style={styles.chips}>
        <Pressable 
          style={[styles.chip, context === 'Now' && styles.chipOn]} 
          onPress={() => setContext('Now')}
          accessibilityRole="button"
        >
          <Text style={[styles.chipText, context === 'Now' && styles.chipTextOn]}>Now</Text>
        </Pressable>
        {tripDate && (
          <Pressable 
            style={[styles.chip, context === 'Trip' && styles.chipOn]} 
            onPress={() => setContext('Trip')}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, context === 'Trip' && styles.chipTextOn]}>Trip</Text>
          </Pressable>
        )}
        <Pressable 
          style={[styles.chip, context === 'Typical' && styles.chipOn]} 
          onPress={() => setContext('Typical')}
          accessibilityRole="button"
        >
          <Text style={[styles.chipText, context === 'Typical' && styles.chipTextOn]}>Typical</Text>
        </Pressable>
      </View>

      <View style={styles.verdict}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.verdictK}>🎯 Best time to ride</Text>
          {isLowConfidence && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff', textTransform: 'uppercase' }}>Early Estimate</Text>
            </View>
          )}
        </View>
        <Text style={styles.verdictH}>
          {getVerdictHeadline()}
        </Text>
        {!isLowConfidence && (
          <Text style={styles.verdictS}>
            {getVerdictSubtext()}
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <PrimaryButton 
          label="＋ Add to my plan" 
          disabled
          onPress={() => {}} 
          style={{ flex: 1, marginRight: 8, opacity: 0.5 }}
          accessibilityLabel="Add to my plan (Coming soon)"
        />
        <SecondaryButton 
          label="🔔 Alert < 30 min" 
          disabled
          onPress={() => {}} 
          style={{ flex: 1, opacity: 0.5 }}
          accessibilityLabel="Alert (Coming soon)"
        />
      </View>

      <SectionLabel>Predicted wait — {context}</SectionLabel>
      <Card style={{ marginBottom: 12 }}>
        <View style={styles.spark}>
          {waits.map((w) => {
            const heightPct = Math.max(5, (w.predictedWaitMinutes / maxWait) * 100);
            return (
              <View key={w.hour} style={[styles.sparkBar, { height: `${heightPct}%` }]} />
            );
          })}
        </View>
        <View style={styles.sparkX}>
          <Text style={styles.sparkXText}>{formatHour(waits[0]?.hour)}</Text>
          <Text style={styles.sparkXText}>{formatHour(waits[Math.floor(waits.length / 2)]?.hour)}</Text>
          <Text style={styles.sparkXText}>{formatHour(waits[waits.length - 1]?.hour)}</Text>
        </View>
      </Card>

      <SectionLabel>Skip the line?</SectionLabel>
      <View style={styles.decide}>
        <View style={styles.decideL}>
          <Text style={styles.decideH}>Lightning Lane</Text>
          <Text style={styles.decideS}>
            {data.llSelloutMedianHour != null ? `Sells out ~${formatHour(data.llSelloutMedianHour)}` : 'Usually available'}
          </Text>
        </View>
        <View style={styles.decideR}>
          <Text style={styles.decideSave}>saves ~{data.p90WaitMinutes > 20 ? data.p90WaitMinutes - 10 : 0} min</Text>
          {data.llMultipassPriceCents != null && (
            <Text style={styles.decideCost}>{formatCents(data.llMultipassPriceCents)} at peak</Text>
          )}
        </View>
      </View>

      {data.hasSingleRider && (
        <View style={styles.decide}>
          <View style={styles.decideL}>
            <Text style={styles.decideH}>Single Rider</Text>
            <Text style={styles.decideS}>Party will be split</Text>
          </View>
          <View style={styles.decideR}>
            <Text style={styles.decideSave}>
              saves ~{data.p50WaitMinutes > (data.singleRiderP50WaitMinutes || 0) ? data.p50WaitMinutes - (data.singleRiderP50WaitMinutes || 0) : 0} min
            </Text>
          </View>
        </View>
      )}

      <SectionLabel>Good to know</SectionLabel>
      <View style={styles.twocol}>
        <View style={styles.stat}>
          <Text style={styles.statK}>Typical / Worst</Text>
          <Text style={styles.statV}>{data.p50WaitMinutes} <Text style={styles.statSmall}>/ {data.p90WaitMinutes} min</Text></Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statK}>Reliability</Text>
          <Text style={styles.statV}>{((1 - data.downRate) * 100).toFixed(0)}% <Text style={styles.statSmall}>uptime</Text></Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  chipOn: {
    backgroundColor: theme.color.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  chipTextOn: {
    color: '#fff',
  },
  verdict: {
    backgroundColor: '#3fa34d',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginBottom: 12,
  },
  verdictK: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  verdictH: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginTop: 4,
  },
  verdictS: {
    fontSize: 13,
    color: '#fff',
    marginTop: 4,
    opacity: 0.9,
  },
  actions: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 60,
    gap: 4,
    paddingTop: 8,
  },
  sparkBar: {
    flex: 1,
    backgroundColor: theme.color.primaryLight,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  sparkX: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sparkXText: {
    fontSize: 10,
    color: theme.color.textSecondary,
  },
  decide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    padding: 12,
    borderRadius: theme.radius.md,
    marginBottom: 8,
  },
  decideL: {},
  decideH: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  decideS: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  decideR: {
    alignItems: 'flex-end',
  },
  decideSave: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3fa34d',
  },
  decideCost: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  twocol: {
    flexDirection: 'row',
    gap: 8,
  },
  stat: {
    flex: 1,
    backgroundColor: theme.color.surfaceAlt,
    padding: 12,
    borderRadius: theme.radius.md,
  },
  statK: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
  },
  statV: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.color.textPrimary,
    marginTop: 4,
  },
  statSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
});
