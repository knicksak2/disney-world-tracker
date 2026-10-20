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

import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import type { Park, TripDTO, TripSummaryDTO } from '@dwt/shared';
import { isAvatarPresetId } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { TripPhotosSection } from '../../photos/TripPhotosSection';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { ProgressBar } from '../../theme/charts';
import { SUMMARY_AVATAR, SUMMARY_MISC } from './TripSummaryScreen.palette';
import { tripDetailKeys } from './tripDetailQueryKeys';
import { SummaryAwardCard } from './summary/SummaryAwardCard';
import { SummaryHeroCard } from './summary/SummaryHeroCard';
import { SummarySectionHeader } from './summary/SummarySectionHeader';
import { SummaryStatTiles } from './summary/SummaryStatTiles';
import { TopRatedMomentRow } from './summary/TopRatedMomentRow';
import { formatMeanRating } from './summary/summaryFormat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Composite navigation: the Trips stack plus the root stack, because the
 * "Send to friends" action opens the root-level `ShareComposer` (the same
 * bubbling the Stats hub uses; photo-uploads task 22.5).
 */
type Props = {
  readonly navigation: CompositeNavigationProp<
    NativeStackNavigationProp<TripsStackParamList, 'TripSummary'>,
    NativeStackNavigationProp<RootStackParamList>
  >;
  readonly route: RouteProp<TripsStackParamList, 'TripSummary'>;
};

/** Note beside the text share (photo-uploads R26.3). */
export const TRIP_SUMMARY_TEXT_SHARE_NOTE =
  "Photos can't go in a text share. Use Send to friends to share the recap with photos.";

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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripSummaryScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const misc = usePalette(SUMMARY_MISC);
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

  // The Trip name feeds only the composer's read-only preview (R15.8): the
  // server composes the stored payload itself. Shares the hub's cache entry.
  const tripQuery = useQuery<TripDTO, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
    staleTime: 30 * 1000,
  });

  // Opens the `tripSummary` Share composer (photo-uploads R15.1, R15.8).
  const handleSendToFriends = (): void => {
    navigation.navigate('ShareComposer', {
      kind: 'tripSummary',
      tripId,
      tripName: tripQuery.data?.name ?? 'Trip',
    });
  };

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
          <ActivityIndicator color={t.color.primaryFg} />
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

  return (
    <ScreenContainer>
      <SummaryHeader
        onBack={backToHub}
        onShare={() => {
          void handleShare(summary);
        }}
      />
      <ScrollView contentContainerStyle={styles.content} testID="trip-summary" keyboardShouldPersistTaps="handled">
        {/* ================================================================= */}
        {/* 1. Celebratory Hero Card */}
        {/* ================================================================= */}
        <SummaryHeroCard
          title="A Magical Adventure!"
          badgeLabel="Vacation Wrap-Up"
          subtitle="Look back at all the memories, thrills, and milestones your party shared together."
          plannedCompletedCount={summary.plannedCompletedCount}
          plannedTotalCount={summary.plannedTotalCount}
          testID="trip-summary-hero"
          plannedTestID="trip-summary-planned"
          plannedCountTestID="trip-summary-planned-count"
        />

        {/* ================================================================= */}
        {/* 2. Quick Stats Grid */}
        {/* ================================================================= */}
        <SummaryStatTiles
          distinctExperienceCount={summary.distinctExperienceCount}
          totalCompletionsCount={totalCompletions}
          totalRatingsCount={summary.totalRatingsCount ?? 0}
          parksExploredCount={summary.parkBreakdown?.length ?? 0}
          testIDPrefix="trip-summary"
        />

        {/* ================================================================= */}
        {/* 3. Group Superlatives & Awards (R14.11) */}
        {/* ================================================================= */}
        {summary.superlatives && summary.superlatives.length > 0 ? (
          <View style={styles.section} testID="trip-summary-superlatives">
            <SummarySectionHeader
              icon="trophy"
              iconColor={misc.trophy}
              title="Group Superlatives & Awards"
            />

            <View style={styles.superlativesList}>
              {summary.superlatives.map((award) => (
                <SummaryAwardCard
                  key={award.id}
                  award={award}
                  testID={`trip-summary-superlative-${award.id}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* ================================================================= */}
        {/* 4. Top-Rated Moments (R14.2, R14.3) */}
        {/* ================================================================= */}
        <View style={styles.section}>
          <SummarySectionHeader icon="star" iconColor={t.color.accent} title="Top-Rated Moments" />

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
              {summary.topRated.map((exp, index) => (
                <TopRatedMomentRow
                  key={exp.experienceId}
                  rank={index}
                  name={exp.experienceName}
                  meanRating={exp.meanRating}
                  ratingCount={exp.ratingCount}
                  park={exp.park}
                  category={exp.category}
                  imageUrl={exp.imageUrl}
                  testID={`trip-summary-toprated-${exp.experienceId}`}
                />
              ))}
            </View>
          )}
        </View>

        {/* ================================================================= */}
        {/* 5. Adventures by Park (R14.9) */}
        {/* ================================================================= */}
        {summary.parkBreakdown && summary.parkBreakdown.length > 0 ? (
          <View style={styles.section} testID="trip-summary-parks">
            <SummarySectionHeader
              icon="map"
              iconColor={t.color.primaryFg}
              title="Adventures by Park"
            />

            <View style={styles.parkGrid}>
              {summary.parkBreakdown.map((item) => {
                const parkColor =
                  item.park in t.parkAccent
                    ? t.parkAccent[item.park as Park]
                    : t.color.primaryFg;
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
          <SummarySectionHeader
            icon="people"
            iconColor={t.color.primaryFg}
            title="Member Contributions"
          />

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
                        <Ionicons name="heart" size={13} color={misc.favoriteHeart} />
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
        {/* 6.5 Trip Photos Highlights (R26.1) */}
        {/* ================================================================= */}
        <TripPhotosSection
          mode="member"
          tripId={tripId}
          onNavigateToAlbum={() => navigation.navigate('TripAlbum', { tripId })}
        />

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
          <Text style={styles.shareNote} testID="trip-summary-text-share-note">
            {TRIP_SUMMARY_TEXT_SHARE_NOTE}
          </Text>
          <PrimaryButton
            label="Send to friends"
            icon="people-outline"
            onPress={handleSendToFriends}
            accessibilityLabel="Send trip recap to friends"
            testID="trip-summary-send-to-friends-btn"
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
  const styles = useStyles();
  const avatar = usePalette(SUMMARY_AVATAR);
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
  const avatarColors = [
    avatar.a0,
    avatar.a1,
    avatar.a2,
    avatar.a3,
    avatar.a4,
    avatar.a5,
    avatar.a6,
    avatar.a7,
  ];
  const bg = avatarColors[hashString(name) % avatarColors.length]!;
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

/** Shared compact header with optional share trigger in top right. */
function SummaryHeader({
  onBack,
  onShare,
}: {
  readonly onBack: () => void;
  readonly onShare?: () => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
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
            <Ionicons name="share-social-outline" size={20} color={t.color.textOnPrimary} />
          </TouchableOpacity>
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const useStyles = makeStyles((t) => ({
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

  // Section Common
  section: {
    gap: theme.spacing.md,
  },
  list: {
    gap: theme.spacing.md,
  },

  // 3. Superlatives
  superlativesList: {
    gap: theme.spacing.md,
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
    color: t.color.textPrimary,
  },
  parkCountBadge: {
    backgroundColor: t.color.surfaceAlt,
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
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  memberIdentityCol: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    ...theme.typography.subtitle,
    fontSize: 16,
    color: t.color.textPrimary,
  },
  memberSummaryStat: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
  },
  memberStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
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
    backgroundColor: t.color.border,
  },
  memberStatValue: {
    ...theme.typography.heading,
    fontSize: 18,
    color: t.color.textPrimary,
  },
  memberStatLabel: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
  },
  memberFavoritePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SUMMARY_MISC[t.scheme].favoriteBg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
  },
  memberFavoriteText: {
    ...theme.typography.meta,
    color: SUMMARY_MISC[t.scheme].favoriteText,
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
  shareNote: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginVertical: theme.spacing.sm,
  },
}));
