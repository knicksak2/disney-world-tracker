import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'react-native-calendars';
import { useNavigation } from '@react-navigation/native';

import { type Park, type CrowdCalendarDayDTO } from '@dwt/shared';
import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { ScreenContainer, GradientHeader, Card, SectionLabel, Badge } from '../../theme/components';

interface CrowdCalendarResponse {
  readonly days: readonly CrowdCalendarDayDTO[];
}

const PARK_FILTERS: (Park | 'All')[] = ['All', 'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];

export default function CrowdCalendarScreen(): JSX.Element {
  const navigation = useNavigation();
  const [selectedPark, setSelectedPark] = useState<Park | 'All'>('All');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // We query from the start of the current month up to 90 days out.
  const queryFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  }, []);

  const queryTo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().split('T')[0];
  }, []);

  const { data } = useQuery<CrowdCalendarResponse>({
    queryKey: ['crowd-calendar', selectedPark, queryFrom, queryTo],
    queryFn: () => {
      let url = `/crowd-calendar?from=${queryFrom}&to=${queryTo}`;
      if (selectedPark !== 'All') {
        url += `&park=${encodeURIComponent(selectedPark)}`;
      }
      return apiRequest<CrowdCalendarResponse>('GET', url);
    },
  });

  const bestDay = useMemo(() => {
    if (!data?.days || data.days.length === 0) return null;
    // Just find the lowest forecast index that is in the future
    const futureDays = data!.days.filter(d => d.date >= new Date().toISOString().split('T')[0]!);
    if (futureDays.length === 0) return null;
    return futureDays.reduce((min, d) => d.forecastIndex < min.forecastIndex ? d : min, futureDays[0]!);
  }, [data]);

  const selectedDayInfo = useMemo(() => {
    if (!selectedDate || !data?.days) return null;
    if (selectedPark !== 'All') {
      return data.days.find(d => d.date === selectedDate);
    }
    // If 'All', return MK by default or just show an aggregate?
    // Actually, if 'All', the API returns MK's index as the default response for the "All" park query if we don't supply ?park?
    // Wait, the API might fail if we don't provide park=...
    // Let's check `GET /crowd-calendar?park&from&to`. The spec says it needs park? Or is it optional?
    // If it's optional and returns aggregate? We'll assume the API expects park, or defaults to something.
    return data.days.find(d => d.date === selectedDate);
  }, [selectedDate, data, selectedPark]);

  const getLevelInfo = (index: number) => {
    const lvl = Math.max(1, Math.min(10, Math.round(index * 5)));
    let color: string = theme.color.textSecondary;
    let label = 'Unknown';
    if (lvl <= 3) { color = '#3fa34d'; label = 'Quiet'; }
    else if (lvl <= 5) { color = '#8bbf3f'; label = 'Below Average'; }
    else if (lvl <= 7) { color = '#f6c343'; label = 'Moderate'; }
    else if (lvl <= 8) { color = '#e8792b'; label = 'High'; }
    else { color = '#d64545'; label = 'Peak'; }
    return { level: lvl, color, label };
  };

  const renderDay = ({ date, state }: any) => {
    const dateStr = date.dateString;
    const dayData = data?.days.find(d => d.date === dateStr);
    const isSelected = dateStr === selectedDate;
    const isBest = bestDay && dateStr === bestDay.date;
    
    if (state === 'disabled') {
      return (
        <View style={styles.dayCellEmpty}>
          <Text style={styles.dayTextEmpty}>{date.day}</Text>
        </View>
      );
    }

    if (!dayData) {
      return (
        <View style={styles.dayCell}>
          <Text style={styles.dayText}>{date.day}</Text>
        </View>
      );
    }

    const { color } = getLevelInfo(dayData.forecastIndex);
    
    return (
      <Pressable
        style={[styles.dayCell, { backgroundColor: color }, isSelected && styles.dayCellSelected]}
        onPress={() => setSelectedDate(dateStr)}
        accessibilityLabel={`Crowd level ${getLevelInfo(dayData.forecastIndex).level} for ${dateStr}`}
      >
        <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{date.day}</Text>
        {isBest && <Text style={styles.bestStar}>★</Text>}
      </Pressable>
    );
  };

  return (
    <ScreenContainer>
      <GradientHeader
        title="Crowd Calendar"
        subtitle="Best days to go & what to expect"
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.segmentedControl}>
          {PARK_FILTERS.map(p => {
            const isSel = selectedPark === p;
            const shortName = p === 'Magic Kingdom' ? 'MK' : p === 'Hollywood Studios' ? 'HS' : p === 'Animal Kingdom' ? 'AK' : p;
            return (
              <Pressable
                key={p}
                style={[styles.segment, isSel && styles.segmentSelected]}
                onPress={() => { setSelectedPark(p); setSelectedDate(null); }}
              >
                <Text style={[styles.segmentText, isSel && styles.segmentTextSelected]}>{shortName}</Text>
              </Pressable>
            );
          })}
        </View>

        {bestDay && (
          <View style={styles.bestBanner}>
            <Text style={styles.bestBannerIcon}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.bestBannerTitle}>Best day: {bestDay.date}</Text>
              <Text style={styles.bestBannerSub}>
                Crowd level {getLevelInfo(bestDay.forecastIndex).level}/10 — head to {bestDay.park || selectedPark}
              </Text>
            </View>
          </View>
        )}

        <Card style={{ padding: 8 }}>
          <Calendar
            current={queryFrom!}
            minDate={queryFrom!}
            maxDate={queryTo!}
            hideExtraDays
            dayComponent={renderDay}
            theme={{
              calendarBackground: 'transparent',
              textSectionTitleColor: theme.color.textSecondary,
              monthTextColor: theme.color.textPrimary,
              textMonthFontWeight: '700',
              arrowColor: theme.color.primary,
            }}
          />
          <View style={styles.legend}>
            <Text style={styles.legendText}>Quiet</Text>
            <View style={[styles.legendSwatch, { backgroundColor: '#3fa34d' }]} />
            <View style={[styles.legendSwatch, { backgroundColor: '#8bbf3f' }]} />
            <View style={[styles.legendSwatch, { backgroundColor: '#f6c343' }]} />
            <View style={[styles.legendSwatch, { backgroundColor: '#e8792b' }]} />
            <View style={[styles.legendSwatch, { backgroundColor: '#d64545' }]} />
            <Text style={styles.legendText}>Packed</Text>
          </View>
          
          {selectedDate && selectedDayInfo && (
            <Text style={styles.dayCap}>
              Selected <Text style={{ fontWeight: '700' }}>{selectedDate}</Text> · Level <Text style={{ fontWeight: '700' }}>{getLevelInfo(selectedDayInfo.forecastIndex).level} / 10</Text> — {getLevelInfo(selectedDayInfo.forecastIndex).label}
            </Text>
          )}
        </Card>

        {selectedDate && selectedDayInfo && (
          <>
            <SectionLabel>Day detail</SectionLabel>
            <Card>
              <View style={styles.levelHero}>
                <View style={[styles.lvlBadge, { backgroundColor: getLevelInfo(selectedDayInfo.forecastIndex).color }]}>
                  <Text style={styles.lvlBadgeNum}>{getLevelInfo(selectedDayInfo.forecastIndex).level}</Text>
                  <Text style={styles.lvlBadgeOut}>/ 10</Text>
                </View>
                <View style={styles.levelHeroText}>
                  <Text style={styles.levelHeroTitle}>{getLevelInfo(selectedDayInfo.forecastIndex).label}</Text>
                  <Text style={styles.levelHeroSub}>Based on typical history.</Text>
                </View>
              </View>
            </Card>

            <SectionLabel>Park info</SectionLabel>
            <Card>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Hours</Text>
                <Text style={styles.infoVal}>
                  {selectedDayInfo.parkHours?.openTime ? `${new Date(selectedDayInfo.parkHours.openTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit'})} - ${new Date(selectedDayInfo.parkHours.closeTime!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit'})}` : 'Unknown'}
                </Text>
              </View>
              {selectedDayInfo.llMultipassPriceCents != null && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Lightning Lane Multi Pass</Text>
                  <Text style={styles.infoVal}>${(selectedDayInfo.llMultipassPriceCents / 100).toFixed(0)}</Text>
                </View>
              )}
              {(selectedDayInfo.earlyEntry || selectedDayInfo.extendedEvening || selectedDayInfo.ticketedEvent) && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Events</Text>
                  <View style={styles.flagsRow}>
                    {selectedDayInfo.earlyEntry && <Badge label="Early Entry" color="#e9f6ec" />}
                    {selectedDayInfo.extendedEvening && <Badge label="Extended Eve" color="#fdeede" />}
                    {selectedDayInfo.ticketedEvent && <Badge label="Ticketed Event" color="#fdeede" />}
                  </View>
                </View>
              )}
            </Card>
            {selectedDayInfo.observedIndex != null && (
              <Text style={styles.accNote}>
                We predicted {getLevelInfo(selectedDayInfo.forecastIndex).level}/10 · actual was {getLevelInfo(selectedDayInfo.observedIndex).level}/10
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: theme.spacing.md,
    paddingBottom: 60,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 4,
    marginBottom: theme.spacing.md,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  segmentSelected: {
    backgroundColor: theme.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  segmentTextSelected: {
    color: theme.color.primary,
  },
  bestBanner: {
    flexDirection: 'row',
    backgroundColor: '#f6c343',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  bestBannerIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  bestBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3d1c5c',
  },
  bestBannerSub: {
    fontSize: 12,
    color: '#3d1c5c',
    opacity: 0.8,
    marginTop: 2,
  },
  dayCell: {
    aspectRatio: 1,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
  },
  dayCellEmpty: {
    width: 40,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  dayTextEmpty: {
    fontSize: 16,
    color: theme.color.textSecondary,
    opacity: 0.5,
  },
  dayCellSelected: {
    borderWidth: 3,
    borderColor: theme.color.primary,
  },
  dayTextSelected: {
    color: '#fff',
  },
  bestStar: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: 8,
    color: '#fff',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
    gap: 4,
  },
  legendSwatch: {
    width: 16,
    height: 10,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: theme.color.textSecondary,
  },
  dayCap: {
    textAlign: 'center',
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 12,
  },
  levelHero: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lvlBadge: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  lvlBadgeNum: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 28,
  },
  lvlBadgeOut: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.9,
  },
  levelHeroText: {
    flex: 1,
  },
  levelHeroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  levelHeroSub: {
    fontSize: 13,
    color: theme.color.textSecondary,
    marginTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  infoKey: {
    fontSize: 13,
    color: theme.color.textSecondary,
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  accNote: {
    fontSize: 12,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});
