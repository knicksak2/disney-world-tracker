// Feature: trips, Task 23 — Celebratory Trip_Summary Screen
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.9, 14.10, 14.11, 14.12, 14.13
//
// Behavior summary:
//   - Serves as the celebratory, magical culmination of the Disney vacation.
//   - Displays an itinerary progress ring comparing planned vs completed items (R5.4).
//   - Quick stat grid: distinct experiences (R14.1), total completions, ratings logged, and parks explored.
//   - Group Superlatives & Awards: MVP, Lead Explorer, Best Co-Pilot, Chief Critic, Crowd Favorite, Top Park (R14.11).
//   - Top-Rated Moments: Ranked cards with thumbnails, park badges, and mean ratings (R14.2, R14.3).
//   - Adventures by Park: Breakdown cards with park colors and progress bars (R14.9).
//   - Member Hall of Fame: Avatars, roles, logs/tags, and personal favorite moments (R14.4, R14.5, R14.12).
//   - Share Trip Highlights: Formats vacation highlights into a shareable message (R14.13).

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import type { ExperienceCategory, Park, TripSummaryDTO, TripSuperlativeDTO } from '@dwt/shared';
import { isAvatarPresetId } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { ProgressBar, ProgressRing } from '../../theme/charts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripSummary'>;

/** Wire shape of `GET /trips/:id/summary`: the derived Trip_Summary (R14.6). */
type TripSummaryResponse = TripSummaryDTO;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for the Trip_Summary read; scoped per Trip. */
export const tripSummaryKeys = {
  summary: (tripId: string) => ['trips', 'summary', tripId] as const,
};

/** Load timeout for summary read. */
const SUMMARY_LOAD_TIMEOUT_MS = 10_000;

const AVATAR_COLORS = [
  '#5856D6',
  '#FF2D55',
  '#AF52DE',
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#5AC8FA',
  '#FF3B30',
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripSummaryScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;

  const summaryQuery = useQuery<TripSummaryResponse, ApiError>({
    queryKey: tripSummaryKeys.summary(tripId),
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, SUMMARY_LOAD_TIMEOUT_MS);
      try {
        return await apiRequest<TripSummaryResponse>(
          'GET',
          `/trips/${tripId}/summary`,
          undefined,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    retry: false,
  });

  const backToHub = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripDetail', { tripId });
  };

  const handleShare = async (data: TripSummaryDTO): Promise<void> => {
    const text = formatSummaryShareText(data);
    try {
      await Share.share({
        message: text,
        title: 'Walt Disney World Vacation Summary',
      });
    } catch {
      // User cancelled or share failed silently.
    }
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (summaryQuery.isLoading && summaryQuery.data === undefined) {
    return (
      <ScreenContainer>
        <SummaryHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-summary-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Load error
  // -------------------------------------------------------------------------

  if (summaryQuery.isError && summaryQuery.data === undefined) {
    return (
      <ScreenContainer>
        <SummaryHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-summary-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this summary"
            body={readErrorMessage(summaryQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void summaryQuery.refetch();
            }}
            testID="trip-summary-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const summary = summaryQuery.data ?? {
    distinctExperienceCount: 0,
    topRated: [],
    perMember: [],
    plannedTotalCount: 0,
    plannedCompletedCount: 0,
  };

  const totalCompletions =
    summary.totalCompletionsCount ??
    summary.perMember.reduce(
      (acc, m) => acc + (m.totalCompletedCount ?? m.logEntryCount + m.confirmedTagCount),
      0,
    );

  const itineraryPercent =
    summary.plannedTotalCount > 0
      ? Math.min(100, Math.round((summary.plannedCompletedCount / summary.plannedTotalCount) * 100))
      : 100;

  const isCompleteItinerary =
    summary.plannedTotalCount > 0 && summary.plannedCompletedCount >= summary.plannedTotalCount;

  return (
    <ScreenContainer>
      <SummaryHeader
        onBack={backToHub}
        onShare={() => {
          void handleShare(summary);
        }}
      />
      <ScrollView contentContainerStyle={styles.content} testID="trip-summary">
        {/* ================================================================= */}
        {/* 1. Celebratory Hero Card */}
        {/* ================================================================= */}
        <LinearGradient
          colors={['#3B185F', '#5E227F', '#2A0845']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
          testID="trip-summary-hero"
        >
          <View style={styles.heroGlow} />
          <View style={styles.heroHeader}>
            <View style={styles.heroBadge}>
              <Ionicons name="sparkles" size={14} color="#FFD700" />
              <Text style={styles.heroBadgeText}>Vacation Wrap-Up</Text>
            </View>
            <Text style={styles.heroTitle}>A Magical Adventure!</Text>
            <Text style={styles.heroSubtitle}>
              Look back at all the memories, thrills, and milestones your party shared together.
            </Text>
          </View>

          {summary.plannedTotalCount > 0 ? (
            <View style={styles.heroRingRow} testID="trip-summary-planned">
              <ProgressRing
                percent={itineraryPercent}
                size={110}
                strokeWidth={11}
                complete={isCompleteItinerary}
                centerLabel={`${itineraryPercent}%`}
                centerSubLabel="Itinerary Done"
                accessibilityLabel={`${itineraryPercent}% of planned experiences completed`}
              />
              <View style={styles.heroProgressTextCol}>
                <Text style={styles.heroProgressNum} testID="trip-summary-planned-count">
                  {summary.plannedCompletedCount} of {summary.plannedTotalCount}
                </Text>
                <Text style={styles.heroProgressLabel}>planned Experiences completed</Text>
                {isCompleteItinerary ? (
                  <View style={styles.congratsPill}>
                    <Ionicons name="ribbon" size={13} color="#FFD700" />
                    <Text style={styles.congratsText}>100% Itinerary Completed! 🎉</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.heroRingRow} testID="trip-summary-planned">
              <View style={styles.heroCastleBadge}>
                <Ionicons name="trophy" size={32} color="#FFD700" />
              </View>
              <View style={styles.heroProgressTextCol}>
                <Text style={styles.heroProgressNum} testID="trip-summary-planned-count">
                  0 of 0
                </Text>
                <Text style={styles.heroProgressLabel}>planned Experiences completed</Text>
              </View>
            </View>
          )}
        </LinearGradient>

        {/* ================================================================= */}
        {/* 2. Quick Stats Grid */}
        {/* ================================================================= */}
        <View style={styles.quickStatsGrid}>
          {/* Distinct Experiences (R14.1) */}
          <Card style={styles.statGridCard} testID="trip-summary-distinct">
            <View style={[styles.statIconBadge, { backgroundColor: 'rgba(155, 81, 224, 0.15)' }]}>
              <Ionicons name="sparkles" size={18} color="#9B51E0" />
            </View>
            <Text style={styles.statGridValue} testID="trip-summary-distinct-count">
              {summary.distinctExperienceCount}
            </Text>
            <Text style={styles.statGridLabel}>
              {summary.distinctExperienceCount === 1 ? 'Distinct Ride' : 'Distinct Rides & Shows'}
            </Text>
          </Card>

          {/* Total Group Completions */}
          <Card style={styles.statGridCard} testID="trip-summary-total-completions">
            <View style={[styles.statIconBadge, { backgroundColor: 'rgba(255, 107, 107, 0.15)' }]}>
              <Ionicons name="checkmark-done-circle" size={18} color="#FF6B6B" />
            </View>
            <Text style={styles.statGridValue}>{totalCompletions}</Text>
            <Text style={styles.statGridLabel}>Total Logged Rides</Text>
          </Card>

          {/* Ratings Submitted */}
          <Card style={styles.statGridCard} testID="trip-summary-total-ratings">
            <View style={[styles.statIconBadge, { backgroundColor: 'rgba(246, 195, 67, 0.18)' }]}>
              <Ionicons name="star" size={18} color="#F6C343" />
            </View>
            <Text style={styles.statGridValue}>{summary.totalRatingsCount ?? 0}</Text>
            <Text style={styles.statGridLabel}>Ratings Given</Text>
          </Card>

          {/* Parks Explored */}
          <Card style={styles.statGridCard} testID="trip-summary-parks-explored">
            <View style={[styles.statIconBadge, { backgroundColor: 'rgba(46, 204, 113, 0.15)' }]}>
              <Ionicons name="compass" size={18} color="#2ECC71" />
            </View>
            <Text style={styles.statGridValue}>{summary.parkBreakdown?.length ?? 0}</Text>
            <Text style={styles.statGridLabel}>Parks Explored</Text>
          </Card>
        </View>

        {/* ================================================================= */}
        {/* 3. Group Superlatives & Awards (R14.11) */}
        {/* ================================================================= */}
        {summary.superlatives && summary.superlatives.length > 0 ? (
          <View style={styles.section} testID="trip-summary-superlatives">
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="trophy" size={20} color="#FFD700" />
              <Text style={styles.sectionTitle}>Group Superlatives & Awards</Text>
            </View>

            <View style={styles.superlativesList}>
              {summary.superlatives.map((award) => (
                <SuperlativeCard key={award.id} award={award} />
              ))}
            </View>
          </View>
        ) : null}

        {/* ================================================================= */}
        {/* 4. Top-Rated Moments (R14.2, R14.3) */}
        {/* ================================================================= */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="star" size={20} color="#F6C343" />
            <Text style={styles.sectionTitle}>Top-Rated Moments</Text>
          </View>

          {summary.topRated.length === 0 ? (
            <View testID="trip-summary-toprated-empty">
              <EmptyState
                icon="star-outline"
                title="No rated Experiences yet"
                body="Once Members rate the Experiences they completed on this trip, the highest-rated ones will shine here."
              />
            </View>
          ) : (
            <View style={styles.list} testID="trip-summary-toprated">
              {summary.topRated.map((exp, index) => {
                const rankColor =
                  index === 0
                    ? '#FFD700'
                    : index === 1
                      ? '#C0C0C0'
                      : index === 2
                        ? '#CD7F32'
                        : theme.color.surfaceAlt;
                const rankTextColor =
                  index < 3 ? '#2A0845' : theme.color.textSecondary;

                const parkAccentColor =
                  exp.park && exp.park in theme.parkAccent
                    ? theme.parkAccent[exp.park as Park]
                    : theme.color.primary;

                return (
                  <Card
                    key={exp.experienceId}
                    style={styles.rankCard}
                    testID={`trip-summary-toprated-${exp.experienceId}`}
                  >
                    <View
                      style={[
                        styles.rankBadge,
                        { backgroundColor: rankColor },
                      ]}
                    >
                      <Text
                        style={[styles.rankBadgeText, { color: rankTextColor }]}
                      >
                        #{index + 1}
                      </Text>
                    </View>

                    <ExperienceThumb
                      imageUrl={exp.imageUrl ?? null}
                      category={exp.category ?? null}
                    />

                    <View style={styles.rankBody}>
                      <Text style={styles.rankName} numberOfLines={1}>
                        {exp.experienceName}
                      </Text>
                      <View style={styles.rankMetaRow}>
                        {exp.park ? (
                          <Badge
                            label={exp.park}
                            color={parkAccentColor}
                          />
                        ) : null}
                        <Text style={styles.rankMeta}>
                          {exp.ratingCount === 1
                            ? '1 rating'
                            : `${exp.ratingCount} ratings`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.ratingPill}>
                      <Ionicons name="star" size={14} color="#F6C343" />
                      <Text style={styles.ratingPillText}>
                        {formatMeanRating(exp.meanRating)}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </View>

        {/* ================================================================= */}
        {/* 5. Adventures by Park (R14.9) */}
        {/* ================================================================= */}
        {summary.parkBreakdown && summary.parkBreakdown.length > 0 ? (
          <View style={styles.section} testID="trip-summary-parks">
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="map" size={20} color={theme.color.primary} />
              <Text style={styles.sectionTitle}>Adventures by Park</Text>
            </View>

            <View style={styles.parkGrid}>
              {summary.parkBreakdown.map((item) => {
                const parkColor =
                  item.park in theme.parkAccent
                    ? theme.parkAccent[item.park as Park]
                    : theme.color.primary;
                const maxCount = summary.parkBreakdown![0]?.count ?? 1;
                const parkPercent = Math.round((item.count / maxCount) * 100);

                return (
                  <Card
                    key={item.park}
                    style={styles.parkCard}
                    testID={`trip-summary-park-${item.park}`}
                  >
                    <View style={styles.parkCardHeader}>
                      <View style={styles.parkIconTitleRow}>
                        <View
                          style={[
                            styles.parkDot,
                            { backgroundColor: parkColor },
                          ]}
                        />
                        <Text style={styles.parkName} numberOfLines={1}>
                          {item.park}
                        </Text>
                      </View>
                      <View style={styles.parkCountBadge}>
                        <Text style={[styles.parkCountText, { color: parkColor }]}>
                          {item.count} {item.count === 1 ? 'ride' : 'rides'}
                        </Text>
                      </View>
                    </View>
                    <ProgressBar
                      percent={parkPercent}
                      color={parkColor}
                      height={6}
                      accessibilityLabel={`${item.count} rides in ${item.park}`}
                    />
                  </Card>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ================================================================= */}
        {/* 6. Member Contributions Hall of Fame (R14.4, R14.5, R14.12) */}
        {/* ================================================================= */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="people" size={20} color={theme.color.primary} />
            <Text style={styles.sectionTitle}>Member Contributions</Text>
          </View>

          {summary.perMember.length === 0 ? (
            <View testID="trip-summary-permember-empty">
              <EmptyState
                icon="people-outline"
                title="No contributions yet"
                body="Log entries and confirmed rode-with tags will show up here for each Member."
              />
            </View>
          ) : (
            <View style={styles.list} testID="trip-summary-permember">
              {summary.perMember.map((member) => {
                const totalMemb =
                  member.totalCompletedCount ??
                  member.logEntryCount + member.confirmedTagCount;

                return (
                  <Card
                    key={member.memberId}
                    style={styles.memberCard}
                    testID={`trip-summary-member-${member.memberId}`}
                  >
                    <View style={styles.memberHeaderRow}>
                      <MemberAvatar
                        name={member.displayName}
                        preset={member.avatarPreset}
                        size={42}
                      />
                      <View style={styles.memberIdentityCol}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {member.displayName}
                        </Text>
                        <Text style={styles.memberSummaryStat}>
                          {totalMemb} {totalMemb === 1 ? 'experience' : 'experiences'} logged & tagged
                        </Text>
                      </View>
                    </View>

                    <View style={styles.memberStatsRow}>
                      <View style={styles.memberStatBlock}>
                        <Text
                          style={styles.memberStatValue}
                          testID={`trip-summary-member-${member.memberId}-logs`}
                        >
                          {member.logEntryCount}
                        </Text>
                        <Text style={styles.memberStatLabel}>
                          {member.logEntryCount === 1 ? 'Log Entry' : 'Log Entries'}
                        </Text>
                      </View>

                      <View style={styles.memberStatDivider} />

                      <View style={styles.memberStatBlock}>
                        <Text
                          style={styles.memberStatValue}
                          testID={`trip-summary-member-${member.memberId}-tags`}
                        >
                          {member.confirmedTagCount}
                        </Text>
                        <Text style={styles.memberStatLabel}>
                          {member.confirmedTagCount === 1 ? 'Rode-With Tag' : 'Rode-With Tags'}
                        </Text>
                      </View>
                    </View>

                    {member.topRatedExperienceName && member.topRating ? (
                      <View
                        style={styles.memberFavoritePill}
                        testID={`trip-summary-member-${member.memberId}-top`}
                      >
                        <Ionicons name="heart" size={13} color="#FF2D55" />
                        <Text style={styles.memberFavoriteText} numberOfLines={1}>
                          Top Ride: {member.topRatedExperienceName} ({member.topRating} ★)
                        </Text>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </View>

        {/* ================================================================= */}
        {/* 7. Share Summary Button (R14.13) */}
        {/* ================================================================= */}
        <View style={styles.shareSection}>
          <PrimaryButton
            label="Share Vacation Highlights"
            icon="share-social-outline"
            onPress={() => {
              void handleShare(summary);
            }}
            testID="trip-summary-share-btn"
            style={styles.shareBtn}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

/** Superlative award card. */
function SuperlativeCard({ award }: { readonly award: TripSuperlativeDTO }): JSX.Element {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    trophy: 'trophy',
    compass: 'compass',
    people: 'people',
    star: 'star',
    sparkles: 'sparkles',
    map: 'map',
  };

  const ioniconName = iconMap[award.icon] ?? 'ribbon';

  return (
    <Card style={styles.superlativeCard} testID={`trip-summary-superlative-${award.id}`}>
      <View style={styles.superlativeHeader}>
        <View style={styles.superlativeIconDisc}>
          <Ionicons name={ioniconName} size={18} color="#FFD700" />
        </View>
        <View style={styles.superlativeTitleCol}>
          <Text style={styles.superlativeTitle}>{award.title}</Text>
          <Text style={styles.superlativeDesc}>{award.description}</Text>
        </View>
      </View>

      <View style={styles.superlativeWinnerRow}>
        <View style={styles.winnerIdentity}>
          <Ionicons name="medal" size={14} color="#F6C343" />
          <Text style={styles.winnerText} numberOfLines={1}>
            {award.memberDisplayName ?? award.experienceName ?? 'The Group'}
          </Text>
        </View>
        {award.value !== undefined ? (
          <View style={styles.winnerValuePill}>
            <Text style={styles.winnerValueText}>{String(award.value)}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Member avatar renderer with presets and fallback initials. */
function MemberAvatar({
  name,
  preset,
  size = 40,
}: {
  readonly name: string;
  readonly preset?: string | null | undefined;
  readonly size?: number;
}): JSX.Element {
  if (isAvatarPresetId(preset)) {
    return (
      <View
        style={[
          styles.avatarCircle,
          { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' },
        ]}
      >
        {renderAvatarPreset(preset, size)}
      </View>
    );
  }
  const initials = initialsOf(name);
  const bg = AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length]!;
  return (
    <View
      style={[
        styles.avatarCircle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>
        {initials}
      </Text>
    </View>
  );
}

/** Experience thumbnail image or category placeholder. */
function ExperienceThumb({
  imageUrl,
  category,
}: {
  readonly imageUrl: string | null;
  readonly category: string | null;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const visual =
    category !== null && category in theme.categoryVisual
      ? theme.categoryVisual[category as ExperienceCategory]
      : null;

  if (imageUrl !== null && imageUrl.length > 0 && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.experienceThumb}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.experienceThumb,
        styles.experienceThumbPlaceholder,
        { backgroundColor: visual?.tint ?? theme.color.surfaceAlt },
      ]}
    >
      <Ionicons
        name={
          (visual?.glyph as keyof typeof Ionicons.glyphMap | undefined) ??
          'sparkles'
        }
        size={18}
        color={theme.color.primary}
      />
    </View>
  );
}

/** Shared compact header with optional share trigger in top right. */
function SummaryHeader({
  onBack,
  onShare,
}: {
  readonly onBack: () => void;
  readonly onShare?: () => void;
}): JSX.Element {
  return (
    <GradientHeader
      title="Trip Summary"
      subtitle="Relive the magic of your Disney vacation."
      icon="ribbon"
      compact
      onBack={onBack}
      right={
        onShare ? (
          <TouchableOpacity
            onPress={onShare}
            style={styles.headerShareBtn}
            accessibilityRole="button"
            accessibilityLabel="Share Summary"
            testID="trip-summary-header-share"
          >
            <Ionicons name="share-social-outline" size={20} color={theme.color.textOnPrimary} />
          </TouchableOpacity>
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMeanRating(mean: number): string {
  if (!Number.isFinite(mean)) {
    return '—';
  }
  const rounded = Math.round(mean * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatSummaryShareText(summary: TripSummaryDTO): string {
  const lines: string[] = [
    '🏰 ✨ Disney World Trip Highlights ✨ 🏰',
    '',
    `🌟 Distinct Rides & Attractions: ${summary.distinctExperienceCount}`,
    `📋 Itinerary Completed: ${summary.plannedCompletedCount} of ${summary.plannedTotalCount}`,
  ];

  if (summary.superlatives && summary.superlatives.length > 0) {
    lines.push('', '🏆 Group Superlatives:');
    for (const sup of summary.superlatives) {
      const winner = sup.memberDisplayName ?? sup.experienceName ?? '';
      lines.push(`• ${sup.title}: ${winner}${sup.value ? ` (${sup.value})` : ''}`);
    }
  }

  if (summary.topRated.length > 0) {
    lines.push('', '⭐ Top Moments:');
    summary.topRated.slice(0, 3).forEach((exp, i) => {
      lines.push(`${i + 1}. ${exp.experienceName} — ${formatMeanRating(exp.meanRating)} ★`);
    });
  }

  lines.push('', 'Tracked with Disney World Tracker ✨');
  return lines.join('\n');
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function readErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  headerShareBtn: {
    padding: theme.spacing.xs,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.xl,
  },

  // 1. Hero Card
  heroCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    overflow: 'hidden',
    position: 'relative',
    ...theme.shadow.floating,
  },
  heroGlow: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(246, 195, 67, 0.15)',
  },
  heroHeader: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  heroBadgeText: {
    ...theme.typography.meta,
    color: '#FFD700',
    fontWeight: '700',
  },
  heroTitle: {
    ...theme.typography.heading,
    fontSize: 24,
    lineHeight: 28,
    color: theme.color.textOnPrimary,
  },
  heroSubtitle: {
    ...theme.typography.body,
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  heroRingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  heroCastleBadge: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  heroProgressTextCol: {
    flex: 1,
    gap: 2,
  },
  heroProgressNum: {
    ...theme.typography.heading,
    fontSize: 22,
    color: theme.color.textOnPrimary,
  },
  heroProgressLabel: {
    ...theme.typography.meta,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  heroEmptyPlannedNote: {
    ...theme.typography.meta,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  congratsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  congratsText: {
    ...theme.typography.meta,
    color: '#FFD700',
    fontWeight: '700',
    fontSize: 12,
  },

  // 2. Quick Stats Grid
  quickStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statGridCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  statIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statGridValue: {
    ...theme.typography.heading,
    fontSize: 24,
    color: theme.color.textPrimary,
  },
  statGridLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontSize: 12,
  },

  // Section Common
  section: {
    gap: theme.spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  list: {
    gap: theme.spacing.md,
  },

  // 3. Superlatives
  superlativesList: {
    gap: theme.spacing.md,
  },
  superlativeCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#F6C343',
  },
  superlativeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  superlativeIconDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(246, 195, 67, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  superlativeTitleCol: {
    flex: 1,
    gap: 2,
  },
  superlativeTitle: {
    ...theme.typography.subtitle,
    fontSize: 16,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  superlativeDesc: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  superlativeWinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  winnerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  winnerText: {
    ...theme.typography.subtitle,
    fontSize: 14,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  winnerValuePill: {
    backgroundColor: 'rgba(155, 81, 224, 0.15)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  winnerValueText: {
    ...theme.typography.meta,
    color: theme.color.primary,
    fontWeight: '700',
    fontSize: 12,
  },

  // 4. Top Rated
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    ...theme.typography.meta,
    fontWeight: '800',
    fontSize: 13,
  },
  rankBody: {
    flex: 1,
    gap: 4,
  },
  rankName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    fontSize: 15,
  },
  rankMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rankMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontSize: 12,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(246, 195, 67, 0.18)',
  },
  ratingPillText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  experienceThumb: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
  },
  experienceThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 5. Adventures by Park
  parkGrid: {
    gap: theme.spacing.sm,
  },
  parkCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  parkCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  parkIconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flex: 1,
  },
  parkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  parkName: {
    ...theme.typography.subtitle,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  parkCountBadge: {
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  parkCountText: {
    ...theme.typography.meta,
    fontWeight: '700',
    fontSize: 12,
  },

  // 6. Member Contributions
  memberCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  avatarCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  memberIdentityCol: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    ...theme.typography.subtitle,
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  memberSummaryStat: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontSize: 12,
  },
  memberStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
  },
  memberStatBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  memberStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.color.border,
  },
  memberStatValue: {
    ...theme.typography.heading,
    fontSize: 18,
    color: theme.color.textPrimary,
  },
  memberStatLabel: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  memberFavoritePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 45, 85, 0.08)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
  },
  memberFavoriteText: {
    ...theme.typography.meta,
    color: '#D81B60',
    fontWeight: '600',
    fontSize: 12,
    flex: 1,
  },

  // 7. Share Section
  shareSection: {
    marginTop: theme.spacing.md,
  },
  shareBtn: {
    alignSelf: 'stretch',
  },
});
