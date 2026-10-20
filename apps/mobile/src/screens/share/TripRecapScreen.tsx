/**
 * TripRecapScreen — read-only Trip recap opened from a `tripSummary` Share
 * (photo-uploads task 22.4, Requirements 15.8, 15.13, 15.15, 16.8).
 *
 * Loads `GET /me/inbox/:shareId/trip-recap` and renders:
 *   - the live recap figures from `recap`, or, when `recap` is `null`, only the
 *     text "This recap is no longer available" (R15.15);
 *   - when `photos.access` is `granted`, the shared `TripPhotosSection` in
 *     `recipient` mode (highlights strip and viewer; no album, add, edit or
 *     delete control; Report and "Block uploader" carry the `shareId`);
 *   - an explanation for `not_included` and `unavailable`.
 *
 * There is no "Stop sharing" control (decision D22) and no link or token (R15.7).
 * The collapsed `validation_failed` the route answers for a deleted share or an
 * unfriended sender (R15.14, decision D25) reads exactly like a `recap: null`
 * answer, so a recipient learns nothing about which condition failed.
 */

import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TripRecapDTO, TripRecapFiguresDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { TripPhotosSection } from '../../photos/TripPhotosSection';
import { makeStyles } from '../../theme/makeStyles';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { SUMMARY_MISC } from '../trips/TripSummaryScreen.palette';
import { SummaryAwardCard } from '../trips/summary/SummaryAwardCard';
import { SummaryHeroCard } from '../trips/summary/SummaryHeroCard';
import { SummarySectionHeader } from '../trips/summary/SummarySectionHeader';
import { SummaryStatTiles } from '../trips/summary/SummaryStatTiles';
import { TopRatedMomentRow } from '../trips/summary/TopRatedMomentRow';

// ---------------------------------------------------------------------------
// Copy (exported so tests assert the exact strings)
// ---------------------------------------------------------------------------

export const RECAP_UNAVAILABLE_COPY = 'This recap is no longer available';
export const RECAP_PHOTOS_NOT_INCLUDED_COPY =
  'The sender chose not to include trip photos in this recap.';
export const RECAP_PHOTOS_UNAVAILABLE_COPY =
  'Trip photos are not available for this recap right now.';

/** Friendly hero line when the sharer's trip has no planned itinerary (no ring is shown). */
export const RECAP_NO_PLAN_COPY = 'No planned itinerary on this trip.';

export const tripRecapKeys = {
  recap: (shareId: string) => ['share', 'trip-recap', shareId] as const,
};

type Props = NativeStackScreenProps<YouAndCrewStackParamList, 'TripRecap'>;

export default function TripRecapScreen({ navigation, route }: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const { shareId } = route.params;

  const recapQuery = useQuery<TripRecapDTO, ApiError>({
    queryKey: tripRecapKeys.recap(shareId),
    queryFn: () =>
      apiRequest<TripRecapDTO>(
        'GET',
        `/me/inbox/${encodeURIComponent(shareId)}/trip-recap`,
      ),
    retry: false,
  });

  const goBack = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  if (recapQuery.isLoading && recapQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Trip recap" icon="ribbon" compact onBack={goBack} />
        <View style={styles.center} accessibilityRole="progressbar" testID="trip-recap-loading">
          <ActivityIndicator color={t.color.primaryFg} />
        </View>
      </ScreenContainer>
    );
  }

  if (recapQuery.isError && recapQuery.data === undefined) {
    // The route's collapsed answer (deleted share, unfriended sender, not a
    // recipient) reads as "no longer available", never as a failure to retry.
    const collapsed = recapQuery.error.code === 'validation_failed';
    return (
      <ScreenContainer>
        <GradientHeader title="Trip recap" icon="ribbon" compact onBack={goBack} />
        <View style={styles.center}>
          {collapsed ? (
            <Text
              style={styles.unavailableText}
              accessibilityRole="alert"
              testID="trip-recap-unavailable"
            >
              {RECAP_UNAVAILABLE_COPY}
            </Text>
          ) : (
            <View testID="trip-recap-error">
              <EmptyState
                icon="cloud-offline-outline"
                title="We couldn't load this recap"
                body="Check your connection and try again."
              />
              <PrimaryButton
                label="Retry"
                icon="refresh-outline"
                onPress={() => {
                  void recapQuery.refetch();
                }}
                testID="trip-recap-retry"
                style={styles.retryBtn}
              />
            </View>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const data = recapQuery.data;
  if (data === undefined) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <GradientHeader
        title="Trip recap"
        // The hero pill already says "Shared by <name>"; the header repeats it only when there
        // is no hero (an unavailable recap).
        {...(data.recap === null
          ? { subtitle: `${data.sharerDisplayName} shared this recap` }
          : {})}
        icon="ribbon"
        compact
        onBack={goBack}
      />
      <ScrollView contentContainerStyle={styles.content} testID="trip-recap">
        {data.recap === null ? (
          <>
            <Text style={styles.tripName} accessibilityRole="header" testID="trip-recap-trip-name">
              {data.tripName}
            </Text>
            <Text
              style={styles.unavailableText}
              accessibilityRole="alert"
              testID="trip-recap-unavailable"
            >
              {RECAP_UNAVAILABLE_COPY}
            </Text>
          </>
        ) : (
          <>
            <RecapFigures
              recap={data.recap}
              tripName={data.tripName}
              sharerDisplayName={data.sharerDisplayName}
            />
            {data.photos.access === 'granted' ? (
              <TripPhotosSection
                mode="recipient"
                photos={data.photos.photos}
                shareId={shareId}
                onViewAll={() =>
                  navigation.navigate('TripRecapAlbum', {
                    shareId,
                    ...(data.tripName ? { tripName: data.tripName } : {}),
                  })
                }
              />
            ) : (
              <Text
                style={styles.photosNote}
                testID={`trip-recap-photos-${data.photos.access}`}
              >
                {data.photos.access === 'not_included'
                  ? RECAP_PHOTOS_NOT_INCLUDED_COPY
                  : RECAP_PHOTOS_UNAVAILABLE_COPY}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

function RecapFigures({
  recap,
  tripName,
  sharerDisplayName,
}: {
  readonly recap: TripRecapFiguresDTO;
  readonly tripName: string;
  readonly sharerDisplayName: string;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const misc = usePalette(SUMMARY_MISC);
  return (
    <>
      <SummaryHeroCard
        title={tripName}
        titleIsHeader
        titleTestID="trip-recap-trip-name"
        badgeLabel={
          sharerDisplayName.length > 0 ? `Shared by ${sharerDisplayName}` : 'Shared recap'
        }
        badgeIcon="people"
        plannedCompletedCount={recap.plannedCompletedCount}
        plannedTotalCount={recap.plannedTotalCount}
        emptyPlannedLine={RECAP_NO_PLAN_COPY}
        testID="trip-recap-hero"
        plannedTestID="trip-recap-planned"
        plannedCountTestID="trip-recap-planned-count"
      />

      <SummaryStatTiles
        distinctExperienceCount={recap.distinctExperienceCount}
        totalCompletionsCount={recap.totalCompletionsCount}
        totalRatingsCount={recap.totalRatingsCount}
        parksExploredCount={recap.parksExploredCount}
        testIDPrefix="trip-recap"
        testID="trip-recap-stats"
      />

      {recap.superlatives.length > 0 ? (
        <View style={styles.section} testID="trip-recap-superlatives">
          <SummarySectionHeader
            icon="trophy"
            iconColor={misc.trophy}
            title="Group Superlatives & Awards"
          />
          <View style={styles.list}>
            {recap.superlatives.map((award) => (
              <SummaryAwardCard
                key={award.id}
                award={award}
                testID={`trip-recap-superlative-${award.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      {recap.topRated.length > 0 ? (
        <View style={styles.section} testID="trip-recap-top-rated">
          <SummarySectionHeader icon="star" iconColor={t.color.accent} title="Top-Rated Moments" />
          <View style={styles.list}>
            {recap.topRated.slice(0, 3).map((row, index) => (
              <TopRatedMomentRow
                key={`${index}-${row.experienceName}`}
                rank={index}
                name={row.experienceName}
                meanRating={row.meanRating}
                ratingCount={row.ratingCount}
                park={row.park}
                category={row.category}
                imageUrl={row.imageUrl}
                testID={`trip-recap-top-rated-${row.experienceName}`}
              />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((t) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
  },
  content: {
    padding: t.spacing.lg,
    gap: t.spacing.xl,
    paddingBottom: t.spacing.xxl,
  },
  tripName: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
  unavailableText: {
    ...t.typography.subtitle,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  photosNote: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  retryBtn: {
    marginTop: t.spacing.md,
  },
  section: {
    gap: t.spacing.md,
  },
  list: {
    gap: t.spacing.md,
  },
}));
