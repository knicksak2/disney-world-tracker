import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'react-native-calendars';
import { useNavigation } from '@react-navigation/native';

import { type Park, type CrowdCalendarDayDTO } from '@dwt/shared';
import { apiRequest } from '../../api/client';
import { ScreenContainer, GradientHeader, Card, SectionLabel, Badge } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { CROWD_LEVEL, EVENT_BADGE } from './CrowdCalendarScreen.palette';

interface CrowdCalendarResponse {
  readonly days: readonly CrowdCalendarDayDTO[];
}

const PARK_FILTERS: (Park | 'All')[] = ['All', 'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];

function getWeatherIcon(cond?: string): string {
  switch (cond?.toLowerCase()) {
    case 'rain': return '🌧️';
    case 'storm': return '⛈️';
    case 'cloudy': return '☁️';
    case 'partly-cloudy': return '⛅';
    case 'clear': return '☀️';
    default: return '🌤️';
  }
}

export default function CrowdCalendarScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const crowd = usePalette(CROWD_LEVEL);
  const events = usePalette(EVENT_BADGE);
  const navigation = useNavigation();
  const [selectedPark, setSelectedPark] = useState<Park | 'All'>('All');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0]!, []);
  const [visibleMonth, setVisibleMonth] = useState<string>(() => todayStr.substring(0, 7));

  // Compute a ~70 day query window around the active visible month
  const { queryFrom, queryTo } = useMemo(() => {
    const [y, m] = visibleMonth.split('-').map(Number);
    const startDate = new Date(Date.UTC(y!, m! - 1, 1));
    startDate.setUTCDate(startDate.getUTCDate() - 15);

    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 70);

    return {
      queryFrom: startDate.toISOString().split('T')[0]!,
      queryTo: endDate.toISOString().split('T')[0]!,
    };
  }, [visibleMonth]);

  const { data } = useQuery<CrowdCalendarResponse>({
    queryKey: ['crowd-calendar', selectedPark, queryFrom, queryTo],
    queryFn: () => {
      let url = `/crowd-calendar?from=${queryFrom}&to=${queryTo}`;
      if (selectedPark !== 'All') {
        url += `&park=${encodeURIComponent(selectedPark)}`;
      }
      return apiRequest<CrowdCalendarResponse>('GET', url);
    },
    // Crowd forecasts don't change meaningfully within a few minutes, and this
    // query's ~70-day window is the app's most expensive single read. Without a
    // staleTime, react-query treats the data as stale immediately, so simply
    // navigating away and back (a screen focus, not just a park/month change)
    // re-triggers the full 70-day fetch again. Matches the catalog's existing
    // 5-minute staleness convention (STALE_TIME_MS in CatalogScreen/
    // DestinationScreen) rather than inventing a new interval.
    staleTime: 5 * 60 * 1000,
  });

  const activeDate = selectedDate ?? todayStr;

  const bestDay = useMemo(() => {
    if (!data?.days || data.days.length === 0) return null;
    const futureDays = data.days.filter((d) => d.date >= todayStr);
    if (futureDays.length === 0) return null;
    return futureDays.reduce((min, d) => (d.forecastIndex < min.forecastIndex ? d : min), futureDays[0]!);
  }, [data, todayStr]);

  const selectedDayInfo = useMemo(() => {
    if (!activeDate || !data?.days) return null;
    return data.days.find((d) => d.date === activeDate);
  }, [activeDate, data]);

  const getLevelInfo = (index: number) => {
    const lvl = Math.max(1, Math.min(10, Math.round(index > 2 ? index : index * 5)));
    let color: string = t.color.textSecondary;
    let label = 'Unknown';
    if (lvl <= 3) { color = crowd.quiet; label = 'Quiet'; }
    else if (lvl <= 5) { color = crowd.belowAverage; label = 'Below Average'; }
    else if (lvl <= 7) { color = t.color.accent; label = 'Moderate'; }
    else if (lvl <= 8) { color = crowd.high; label = 'High'; }
    else { color = crowd.peak; label = 'Peak'; }
    return { level: lvl, color, label };
  };

  const renderDay = ({ date }: any) => {
    const dateStr = date.dateString;
    const dayData = data?.days.find((d) => d.date === dateStr);
    const isSelected = dateStr === activeDate;
    const isBest = bestDay && dateStr === bestDay.date;

    if (!dayData) {
      return (
        <View style={styles.dayCell}>
          <Text style={[styles.dayText, { color: t.color.textSecondary }]}>{date.day}</Text>
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
                Crowd level {getLevelInfo(bestDay.forecastIndex).level}/10 — head to {selectedPark === 'All' ? 'Magic Kingdom' : selectedPark}
              </Text>
            </View>
          </View>
        )}

        <Card style={{ padding: 8 }}>
          <Calendar
            // `Calendar` captures its styles once at mount; remount it on a scheme switch.
            key={t.scheme}
            current={todayStr}
            onMonthChange={(month: any) => {
              if (month?.dateString) {
                setVisibleMonth(month.dateString.substring(0, 7));
              }
            }}
            hideExtraDays={false}
            dayComponent={renderDay}
            theme={{
              // Light keeps 'transparent' (the Card's surface shows through, as
              // before); dark paints the surface token explicitly.
              calendarBackground: t.scheme === 'dark' ? t.color.surface : 'transparent',
              textSectionTitleColor: t.color.textSecondary,
              monthTextColor: t.color.textPrimary,
              textMonthFontWeight: '700',
              arrowColor: t.color.primaryFg,
            }}
          />
          <View style={styles.legend}>
            <Text style={styles.legendText}>Quiet</Text>
            <View style={[styles.legendSwatch, { backgroundColor: crowd.quiet }]} />
            <View style={[styles.legendSwatch, { backgroundColor: crowd.belowAverage }]} />
            <View style={[styles.legendSwatch, { backgroundColor: t.color.accent }]} />
            <View style={[styles.legendSwatch, { backgroundColor: crowd.high }]} />
            <View style={[styles.legendSwatch, { backgroundColor: crowd.peak }]} />
            <Text style={styles.legendText}>Packed</Text>
          </View>
          
          {activeDate && selectedDayInfo && (
            <Text style={styles.dayCap}>
              Selected <Text style={{ fontWeight: '700' }}>{activeDate}</Text> · Level <Text style={{ fontWeight: '700' }}>{getLevelInfo(selectedDayInfo.forecastIndex).level} / 10</Text> — {getLevelInfo(selectedDayInfo.forecastIndex).label}
            </Text>
          )}
        </Card>

        {activeDate && selectedDayInfo && (
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
                  <Text style={styles.levelHeroSub}>
                    {selectedDayInfo.expectedAvgWaitMinutes != null
                      ? `Expected standby wait ~${selectedDayInfo.expectedAvgWaitMinutes} min`
                      : 'Based on typical history.'}
                  </Text>
                </View>
              </View>
            </Card>

            {selectedDayInfo.allParks && selectedDayInfo.allParks.length > 0 && (
              <>
                <SectionLabel>All parks on this day</SectionLabel>
                <Card>
                  {selectedDayInfo.allParks.map((p, idx) => {
                    const info = getLevelInfo(p.forecastIndex);
                    const isSelected = (selectedPark === 'All' && p.park === 'Magic Kingdom') || selectedPark === p.park;
                    const isLast = idx === (selectedDayInfo.allParks?.length ?? 0) - 1;
                    return (
                      <Pressable
                        key={p.park}
                        style={[styles.parkComparisonRow, isLast && { borderBottomWidth: 0 }]}
                        onPress={() => setSelectedPark(p.park)}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.park}: Level ${info.level}/10 ${info.label}${p.expectedAvgWaitMinutes != null ? `, expected wait ~${p.expectedAvgWaitMinutes} minutes` : ''}`}
                      >
                        <View style={styles.parkComparisonTop}>
                          <Text style={[styles.parkComparisonName, isSelected && styles.parkComparisonNameCurrent]}>
                            {p.park}
                          </Text>
                          <View style={styles.parkComparisonRight}>
                            {p.expectedAvgWaitMinutes != null && (
                              <Text style={styles.parkComparisonWait}>~{p.expectedAvgWaitMinutes}m wait</Text>
                            )}
                            <View style={[styles.parkComparisonBadge, { backgroundColor: info.color }]}>
                              <Text style={styles.parkComparisonBadgeText}>{info.level}/10</Text>
                            </View>
                          </View>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${info.level * 10}%`, backgroundColor: info.color }]} />
                        </View>
                      </Pressable>
                    );
                  })}
                </Card>
              </>
            )}

            <SectionLabel>Park info</SectionLabel>
            <Card>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Hours</Text>
                <Text style={styles.infoVal}>
                  {selectedDayInfo.parkHours?.openTime ? `${new Date(selectedDayInfo.parkHours.openTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit'})} - ${new Date(selectedDayInfo.parkHours.closeTime!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit'})}` : 'Unknown'}
                </Text>
              </View>
              {selectedDayInfo.expectedAvgWaitMinutes != null && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Expected Standby Avg</Text>
                  <Text style={styles.infoVal}>~{selectedDayInfo.expectedAvgWaitMinutes} min</Text>
                </View>
              )}
              {selectedDayInfo.llMultipassPriceCents != null && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Lightning Lane Multi Pass</Text>
                  <Text style={styles.infoVal}>${(selectedDayInfo.llMultipassPriceCents / 100).toFixed(0)}</Text>
                </View>
              )}
              {selectedDayInfo.weather && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Weather</Text>
                  <Text style={styles.infoVal}>
                    {getWeatherIcon(selectedDayInfo.weather.condition)} {selectedDayInfo.weather.tempMaxF}° / {selectedDayInfo.weather.tempMinF}°
                    {selectedDayInfo.weather.precipProbability ? ` · ${selectedDayInfo.weather.precipProbability}% rain` : ''}
                  </Text>
                </View>
              )}
              {selectedDayInfo.festival && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Festival</Text>
                  <Text style={[styles.infoVal, { color: t.color.primaryFg }]}>
                    🎉 {selectedDayInfo.festival}
                  </Text>
                </View>
              )}
              {(selectedDayInfo.earlyEntry || selectedDayInfo.extendedEvening || selectedDayInfo.ticketedEvent) && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Events</Text>
                  <View style={styles.flagsRow}>
                    {selectedDayInfo.earlyEntry && <Badge label="Early Entry" color={events.earlyEntry} />}
                    {selectedDayInfo.extendedEvening && <Badge label="Extended Eve" color={events.extendedEvening} />}
                    {selectedDayInfo.ticketedEvent && <Badge label="Ticketed Event" color={events.ticketedEvent} />}
                  </View>
                </View>
              )}
            </Card>
            {selectedDayInfo.observedIndex != null && (
              <>
                <SectionLabel>{selectedDayInfo.isLiveTracking ? 'Live tracking today' : 'How we did'}</SectionLabel>
                <Card>
                  <Text
                    style={styles.accNote}
                    accessibilityLabel={
                      selectedDayInfo.isLiveTracking
                        ? `We predicted ${selectedDayInfo.forecastIndex} out of 10. Today is tracking ${selectedDayInfo.observedIndex} out of 10 so far.`
                        : selectedDayInfo.capturedForecast
                          ? `We predicted ${selectedDayInfo.capturedForecast.index} out of 10, ${selectedDayInfo.capturedForecast.leadDays} days ahead. Actual was ${selectedDayInfo.observedIndex} out of 10.`
                          : `Actual was ${selectedDayInfo.observedIndex} out of 10.`
                    }
                  >
                    {/*
                      R7.5: the "we predicted" figure is the FROZEN capture, not
                      today's recomputed forecast. Recomputing would let the
                      model see the observed index and echo it back, which would
                      make this line meaningless.
                    */}
                    {selectedDayInfo.isLiveTracking
                      ? `We predicted ${selectedDayInfo.forecastIndex}/10 · tracking ${selectedDayInfo.observedIndex}/10 so far ✓`
                      : selectedDayInfo.capturedForecast
                        ? `We predicted ${selectedDayInfo.capturedForecast.index}/10 · actual was ${selectedDayInfo.observedIndex}/10`
                        : `Actual was ${selectedDayInfo.observedIndex}/10`}
                  </Text>
                  {selectedDayInfo.capturedForecast && !selectedDayInfo.isLiveTracking && (
                    <Text style={styles.accSub}>
                      Forecast made {selectedDayInfo.capturedForecast.leadDays}{' '}
                      {selectedDayInfo.capturedForecast.leadDays === 1 ? 'day' : 'days'} ahead
                    </Text>
                  )}
                  {selectedDayInfo.forecastAccuracy && (
                    <Text style={styles.accSub}>
                      Typically within {selectedDayInfo.forecastAccuracy.meanAbsoluteErrorLevels} levels at
                      this range ({selectedDayInfo.forecastAccuracy.sampleCount}{' '}
                      {selectedDayInfo.forecastAccuracy.sampleCount === 1 ? 'day' : 'days'} scored)
                    </Text>
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  body: {
    padding: t.spacing.md,
    paddingBottom: 60,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    padding: 4,
    marginBottom: t.spacing.md,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: t.radius.sm,
  },
  segmentSelected: {
    // Dark: lighter than the `surfaceAlt` track so it reads raised (Requirement 9.12).
    backgroundColor: t.scheme === 'dark' ? t.color.borderStrong : t.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  segmentTextSelected: {
    color: t.color.primaryFg,
  },
  bestBanner: {
    flexDirection: 'row',
    backgroundColor: t.color.accent,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    alignItems: 'center',
    marginBottom: t.spacing.md,
  },
  bestBannerIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  bestBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textOnAccent,
  },
  bestBannerSub: {
    fontSize: 12,
    color: t.color.textOnAccent,
    opacity: 0.8,
    marginTop: 2,
  },
  dayCell: {
    aspectRatio: 1,
    borderRadius: t.radius.sm,
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
    color: t.color.textOnPrimary,
  },
  dayTextEmpty: {
    fontSize: 16,
    color: t.color.textSecondary,
    opacity: 0.5,
  },
  dayCellSelected: {
    borderWidth: 3,
    borderColor: t.color.primaryFg,
  },
  dayTextSelected: {
    color: t.color.textOnPrimary,
  },
  bestStar: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: 8,
    color: t.color.textOnPrimary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: t.spacing.sm,
    gap: 4,
  },
  legendSwatch: {
    width: 16,
    height: 10,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: t.color.textSecondary,
  },
  dayCap: {
    textAlign: 'center',
    fontSize: 12,
    color: t.color.textSecondary,
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
    marginRight: t.spacing.md,
  },
  lvlBadgeNum: {
    fontSize: 26,
    fontWeight: '800',
    color: t.color.textOnPrimary,
    lineHeight: 28,
  },
  lvlBadgeOut: {
    fontSize: 10,
    color: t.color.textOnPrimary,
    opacity: 0.9,
  },
  levelHeroText: {
    flex: 1,
  },
  levelHeroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  levelHeroSub: {
    fontSize: 13,
    color: t.color.textSecondary,
    marginTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  infoKey: {
    fontSize: 13,
    color: t.color.textSecondary,
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  accNote: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textPrimary,
    textAlign: 'center',
  },
  accSub: {
    fontSize: 12,
    color: t.color.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  parkComparisonRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  parkComparisonTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  parkComparisonName: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  parkComparisonNameCurrent: {
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  parkComparisonRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  parkComparisonWait: {
    fontSize: 12,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  parkComparisonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: t.radius.sm,
  },
  parkComparisonBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  barTrack: {
    height: 6,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
}));
