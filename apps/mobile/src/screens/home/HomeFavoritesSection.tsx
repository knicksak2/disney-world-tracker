/**
 * HomeFavoritesSection — Horizontal favorites radar carousel on the Home tab.
 *
 * Implements Task 10 (Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6).
 * Reads useFavoritedExperiences() and issues ['park-live', park] queries sharing
 * ParkWaitPulse's cache. Renders each favorited attraction with its live wait status,
 * sorted with active wait times first and closed/down attractions last.
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type {
  ExperienceDTO,
  Park,
  ParkLiveEntryDTO,
  ParkLiveSnapshotDTO,
} from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { EmptyState } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { useFavoritedExperiences } from '../catalog/useFavoritedExperiences';
import { HOME_FAVORITES } from './HomeFavoritesSection.palette';

export interface HomeFavoritesSectionProps {
  readonly onSelectExperience?: (experienceId: string) => void;
  readonly onSeeAll?: () => void;
}

/** The parks that carry their own accent on a favorite pill; others fall back to primary. */
const ACCENTED_PARKS: ReadonlySet<string> = new Set<string>([
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
]);

type FavoritesPalette = (typeof HOME_FAVORITES)['light'];

function getStatusBadgeConfig(
  liveEntry: ParkLiveEntryDTO,
  isClosedOrDown: boolean,
  pal: FavoritesPalette,
) {
  if (isClosedOrDown) {
    if (liveEntry.status === 'DOWN') {
      return {
        bg: pal.downBg,
        border: pal.downBorder,
        text: pal.downText,
        icon: 'alert-circle-outline' as const,
        label: 'Down',
      };
    }
    return {
      bg: pal.closedBg,
      border: pal.closedBorder,
      text: pal.closedText,
      icon: 'moon-outline' as const,
      label: 'Closed',
    };
  }

  const wait = liveEntry.waitMinutes ?? 0;
  if (wait === 0) {
    return {
      bg: pal.walkOnBg,
      border: pal.walkOnBorder,
      text: pal.walkOnText,
      icon: 'sparkles' as const,
      label: 'Walk-on',
    };
  }

  if (wait <= 25) {
    return {
      bg: pal.shortBg,
      border: pal.shortBorder,
      text: pal.shortText,
      icon: 'time-outline' as const,
      label: `${wait}m`,
    };
  }

  if (wait <= 50) {
    return {
      bg: pal.moderateBg,
      border: pal.moderateBorder,
      text: pal.moderateText,
      icon: 'time-outline' as const,
      label: `${wait}m`,
    };
  }

  return {
    bg: pal.heavyBg,
    border: pal.heavyBorder,
    text: pal.heavyText,
    icon: 'time-outline' as const,
    label: `${wait}m`,
  };
}

function FavoritePill({
  experience,
  liveEntry,
  onPress,
}: {
  readonly experience: ExperienceDTO;
  readonly liveEntry: ParkLiveEntryDTO;
  readonly onPress: () => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(HOME_FAVORITES);
  const isClosedOrDown =
    liveEntry.status === 'CLOSED' ||
    liveEntry.status === 'DOWN' ||
    liveEntry.status === 'REFURBISHMENT' ||
    liveEntry.waitMinutes === null;

  const parkColor =
    experience.park && ACCENTED_PARKS.has(experience.park)
      ? t.parkAccent[experience.park]
      : t.color.primaryFg;
  const statusConfig = getStatusBadgeConfig(liveEntry, isClosedOrDown, pal);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.pill,
        { borderTopColor: parkColor },
        pressed && styles.pillPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${experience.name}, ${statusConfig.label}, ${experience.park ?? ''}`}
      testID={`home-favorite-pill-${experience.id}`}
    >
      <View style={styles.pillTopRow}>
        <View style={[styles.parkBadge, { backgroundColor: parkColor + '18' }]}>
          <Text style={[styles.parkTag, { color: parkColor }]} numberOfLines={1}>
            {experience.park ?? ''}
          </Text>
        </View>
        <Ionicons name="heart" size={13} color={pal.pillHeart} style={styles.heartIcon} />
      </View>

      <Text style={styles.experienceName} numberOfLines={2}>
        {experience.name}
      </Text>

      <View style={styles.bottomRow}>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: statusConfig.bg, borderColor: statusConfig.border },
          ]}
        >
          <Ionicons
            name={statusConfig.icon}
            size={12}
            color={statusConfig.text}
            style={styles.badgeIcon}
          />
          <Text
            style={[styles.waitNum, { color: statusConfig.text }]}
            testID={`home-favorite-wait-${experience.id}`}
          >
            {statusConfig.label}
          </Text>
          {!isClosedOrDown && liveEntry.waitMinutes !== 0 && (
            <Text style={[styles.waitUnit, { color: statusConfig.text }]}> wait</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeFavoritesSection({
  onSelectExperience,
  onSeeAll,
}: HomeFavoritesSectionProps): JSX.Element {
  const styles = useStyles();
  const pal = usePalette(HOME_FAVORITES);
  const favoritedIds = useFavoritedExperiences();

  // All catalog experiences to map IDs to Experience metadata (park, name, category)
  const catalogQuery = useQuery<{ experiences: readonly ExperienceDTO[] }>({
    queryKey: ['catalog', 'all'],
    queryFn: () => apiRequest<{ experiences: readonly ExperienceDTO[] }>('GET', '/catalog'),
    staleTime: 3600 * 1000,
  });

  const favoritedExperiences = useMemo(() => {
    if (!catalogQuery.data?.experiences || favoritedIds.size === 0) {
      return [];
    }
    return catalogQuery.data.experiences.filter((exp) => favoritedIds.has(exp.id));
  }, [catalogQuery.data?.experiences, favoritedIds]);

  const distinctParks = useMemo(() => {
    const parks = new Set<Park>();
    for (const exp of favoritedExperiences) {
      if (exp.park) {
        parks.add(exp.park);
      }
    }
    return Array.from(parks);
  }, [favoritedExperiences]);

  // Live queries sharing the exact ['park-live', park] query key with ParkWaitPulse
  const mkQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Magic Kingdom'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Magic%20Kingdom/live'),
    enabled: distinctParks.includes('Magic Kingdom'),
    staleTime: 60 * 1000,
  });

  const epcotQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'EPCOT'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/EPCOT/live'),
    enabled: distinctParks.includes('EPCOT'),
    staleTime: 60 * 1000,
  });

  const hsQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Hollywood Studios'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Hollywood%20Studios/live'),
    enabled: distinctParks.includes('Hollywood Studios'),
    staleTime: 60 * 1000,
  });

  const akQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Animal Kingdom'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Animal%20Kingdom/live'),
    enabled: distinctParks.includes('Animal Kingdom'),
    staleTime: 60 * 1000,
  });

  const liveEntriesByExperienceId = useMemo(() => {
    const map = new Map<string, ParkLiveEntryDTO>();
    const snapshots = [mkQuery.data, epcotQuery.data, hsQuery.data, akQuery.data];
    for (const snap of snapshots) {
      if (snap?.entries) {
        for (const entry of snap.entries) {
          map.set(entry.experienceId, entry);
        }
      }
    }
    return map;
  }, [mkQuery.data, epcotQuery.data, hsQuery.data, akQuery.data]);

  const visibleFavorites = useMemo(() => {
    const list = favoritedExperiences
      .filter((exp) => liveEntriesByExperienceId.has(exp.id))
      .map((exp) => ({
        experience: exp,
        liveEntry: liveEntriesByExperienceId.get(exp.id)!,
      }));

    return list.sort((a, b) => {
      const aClosed =
        a.liveEntry.status === 'CLOSED' ||
        a.liveEntry.status === 'DOWN' ||
        a.liveEntry.status === 'REFURBISHMENT' ||
        a.liveEntry.waitMinutes === null;
      const bClosed =
        b.liveEntry.status === 'CLOSED' ||
        b.liveEntry.status === 'DOWN' ||
        b.liveEntry.status === 'REFURBISHMENT' ||
        b.liveEntry.waitMinutes === null;

      // 1. Open rides with active wait times first; closed/down rides last
      if (aClosed !== bClosed) {
        return aClosed ? 1 : -1;
      }

      // 2. Among open rides, sort ascending by waitMinutes (shortest lines first)
      if (!aClosed && !bClosed) {
        const waitA = a.liveEntry.waitMinutes ?? 0;
        const waitB = b.liveEntry.waitMinutes ?? 0;
        if (waitA !== waitB) {
          return waitA - waitB;
        }
      }

      // 3. Fallback: alphabetical by name
      return a.experience.name.localeCompare(b.experience.name);
    });
  }, [favoritedExperiences, liveEntriesByExperienceId]);

  return (
    <View style={styles.container} testID="home-favorites-section">
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="heart" size={17} color={pal.sectionHeart} style={styles.sectionIcon} />
          <Text style={styles.sectionTitle}>Your Favorites</Text>
        </View>
        {onSeeAll && (
          <Pressable
            onPress={onSeeAll}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="View all favorites in Live Waits"
            testID="home-favorites-see-all"
          >
            <Text style={styles.sectionLink}>See All ›</Text>
          </Pressable>
        )}
      </View>

      {visibleFavorites.length === 0 ? (
        <View style={styles.emptyContainer} testID="home-favorites-empty">
          <EmptyState
            icon="heart-outline"
            title="No favorites with live waits"
            body="Heart attractions in Explore or Live Waits to track them here."
          />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          testID="home-favorites-scroll"
        >
          {visibleFavorites.map(({ experience, liveEntry }) => (
            <FavoritePill
              key={experience.id}
              experience={experience}
              liveEntry={liveEntry}
              onPress={() => onSelectExperience?.(experience.id)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginTop: t.spacing.md,
    marginBottom: t.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionIcon: {
    marginRight: 2,
  },
  sectionTitle: {
    ...t.typography.heading,
    fontSize: 17,
    color: t.color.textPrimary,
    fontWeight: '800',
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  scrollContent: {
    paddingHorizontal: t.spacing.lg,
    gap: 12,
    paddingBottom: 6,
  },
  emptyContainer: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xs,
  },
  pill: {
    width: 178,
    backgroundColor: t.color.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: HOME_FAVORITES[t.scheme].pillBorder,
    borderTopWidth: 3.5,
    justifyContent: 'space-between',
    minHeight: 122,
    shadowColor: t.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  pillPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  pillTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  parkBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    maxWidth: 130,
  },
  parkTag: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heartIcon: {
    opacity: 0.85,
  },
  experienceName: {
    ...t.typography.body,
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.textPrimary,
    lineHeight: 17.5,
    marginBottom: 8,
    flex: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3.5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeIcon: {
    marginRight: 4,
  },
  waitNum: {
    fontSize: 13,
    fontWeight: '800',
  },
  waitUnit: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.9,
  },
}));
