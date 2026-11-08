import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MickeyDifficulty, MickeyListItemDTO, MickeyZone, Park } from '@dwt/shared';
import { PARKS } from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  useMickeyFind,
  useMickeyHint,
  useMickeyList,
  useMickeySummary,
  useMickeyUndoFind,
  type MickeyListFilters,
} from './api';
import {
  DIFFICULTY_DOTS_MAP,
  ZONE_ICON_MAP,
  formatAreaSubtitle,
  formatParkTabLabel,
  groupMickeysByVenue,
  resolveActiveAreaSummary,
} from './mickeyViewModel';
import { theme, withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'HiddenMickeys'>;
type ScreenRouteProp = RouteProp<RootStackParamList, 'HiddenMickeys'>;

export const ZONE_PILLS: ReadonlyArray<{
  label: string;
  value: MickeyZone | undefined;
  a11y: string;
}> = [
  { label: 'All', value: undefined, a11y: 'Filter by all zones' },
  { label: 'Queue', value: 'queue', a11y: 'Filter by Queue zone' },
  { label: 'Pre-show', value: 'pre_show', a11y: 'Filter by Pre-show zone' },
  { label: 'On ride', value: 'on_ride', a11y: 'Filter by On ride zone' },
  { label: 'Exit', value: 'exit', a11y: 'Filter by Exit zone' },
  { label: 'Exterior', value: 'exterior', a11y: 'Filter by Exterior zone' },
  { label: 'Interior', value: 'interior', a11y: 'Filter by Interior zone' },
  { label: 'Grounds', value: 'grounds', a11y: 'Filter by Grounds zone' },
];

export default function HiddenMickeysScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const styles = useStyles();
  const t = useAppTheme();

  // Filters state initialized from route params if present
  const [selectedParkTab, setSelectedParkTab] = useState<'All' | Park | 'Resort'>(
    route.params?.areaType === 'Resort' ? 'Resort' : (route.params?.park ?? 'All'),
  );
  const [selectedZone, setSelectedZone] = useState<MickeyZone | undefined>(route.params?.zone);
  const [selectedScope, setSelectedScope] = useState<'all' | 'official' | 'community'>(
    route.params?.scope ?? 'all',
  );
  const [selectedFound, setSelectedFound] = useState<'all' | 'found' | 'unfound'>(
    route.params?.found ?? 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'grouped'>('cards');
  const [unlockedHints, setUnlockedHints] = useState<Readonly<Record<string, string>>>({});
  const [openHints, setOpenHints] = useState<Readonly<Record<string, boolean>>>({});

  // Assemble filters for the API query
  const queryFilters: MickeyListFilters = {
    experienceId: route.params?.experienceId,
    park: selectedParkTab !== 'All' && selectedParkTab !== 'Resort' ? selectedParkTab : undefined,
    areaType: selectedParkTab === 'Resort' ? 'Resort' : undefined,
    zone: selectedZone,
    scope: selectedScope,
    found: selectedFound,
    q: searchQuery.trim().length >= 2 ? searchQuery.trim() : undefined,
  };

  const { data: summaryData } = useMickeySummary();
  const { data: listData, isLoading: isListLoading, refetch } = useMickeyList(queryFilters);
  const findMutation = useMickeyFind();
  const undoMutation = useMickeyUndoFind();
  const hintMutation = useMickeyHint();

  const items = listData?.items ?? [];
  const venueGroups = useMemo(() => groupMickeysByVenue(items), [items]);

  const activeAreaSummary = useMemo(
    () => resolveActiveAreaSummary(summaryData, selectedParkTab, selectedScope, items),
    [summaryData, selectedParkTab, selectedScope, items],
  );

  const officialTotalCount = summaryData?.overall.total ?? 220;
  const communityTotalCount =
    summaryData?.community.total ?? items.filter((i) => !i.official).length;

  const accentForPark = (park: Park | null): string => {
    if (park && t.parkAccent[park]) {
      return t.parkAccent[park];
    }
    return t.resortVisual.tint;
  };

  const difficultyTone = (difficulty: MickeyDifficulty) => {
    if (difficulty === 'easy') {
      return {
        bg: withAlpha(t.color.success, 0.15),
        fg: t.color.success,
      };
    }
    if (difficulty === 'hard') {
      return {
        bg: withAlpha(t.color.danger, 0.15),
        fg: t.color.danger,
      };
    }
    return {
      bg: t.color.warningSurface,
      fg: t.color.warningText,
    };
  };

  const handleToggleSpot = async (item: MickeyListItemDTO) => {
    try {
      if (item.found) {
        await undoMutation.mutateAsync({ mickeyId: item.id });
      } else {
        await findMutation.mutateAsync({ mickeyId: item.id });
      }
    } catch {
      Alert.alert('Error', 'Failed to update Hidden Mickey status. Please try again.');
    }
  };

  const handleToggleInlineHint = async (item: MickeyListItemDTO) => {
    const currentlyOpen = Boolean(openHints[item.id]);
    if (currentlyOpen) {
      setOpenHints((prev) => ({ ...prev, [item.id]: false }));
      return;
    }

    if (unlockedHints[item.id]) {
      setOpenHints((prev) => ({ ...prev, [item.id]: true }));
      return;
    }

    try {
      const response = (await hintMutation.mutateAsync({
        mickeyId: item.id,
        level: 2,
      })) as unknown as { clue2?: string };
      const clue2Text = response?.clue2;
      if (clue2Text) {
        setUnlockedHints((prev) => ({ ...prev, [item.id]: clue2Text }));
      }
      setOpenHints((prev) => ({ ...prev, [item.id]: true }));
    } catch {
      Alert.alert('Error', 'Failed to load hint. Please try again.');
    }
  };

  const renderMickeyBadgesRow = (
    item: MickeyListItemDTO,
    positionLabel?: string,
  ): JSX.Element => {
    const diffColors = difficultyTone(item.difficulty);
    const zoneIconName = (ZONE_ICON_MAP[item.zone] ?? 'location-outline') as keyof typeof Ionicons.glyphMap;

    return (
      <View style={styles.badgesRow}>
        {positionLabel ? (
          <View style={styles.positionBadge}>
            <Text style={styles.positionBadgeText}>{positionLabel}</Text>
          </View>
        ) : null}

        {/* Zone with semantic icon */}
        <View style={styles.badgePill}>
          <Ionicons name={zoneIconName} size={11} color={t.color.textSecondary} />
          <Text style={styles.badgePillText}>{item.zone.replace('_', ' ')}</Text>
        </View>

        {/* Difficulty with dots + semantic color */}
        <View style={[styles.badgePill, { backgroundColor: diffColors.bg }]}>
          <Text style={[styles.difficultyDots, { color: diffColors.fg }]}>
            {DIFFICULTY_DOTS_MAP[item.difficulty]}
          </Text>
          <Text style={[styles.badgePillText, { color: diffColors.fg, fontWeight: '700' }]}>
            {item.difficulty}
          </Text>
        </View>

        {/* Community badge */}
        {!item.official && (
          <View style={styles.communityBadge}>
            <Ionicons name="people" size={12} color={t.color.textSecondary} />
            <Text style={styles.communityBadgeText}>Community</Text>
          </View>
        )}

        {/* Community Verified badge */}
        {item.communityVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="shield-checkmark" size={12} color={t.color.primaryFg} />
            <Text style={styles.verifiedBadgeText}>Community verified</Text>
          </View>
        )}

        {/* Possibly removed badge */}
        {item.confidenceLabel === 'possibly_removed' && (
          <View style={styles.possiblyRemovedBadge} accessibilityLabel="Possibly removed">
            <Ionicons name="warning" size={12} color={t.color.warningText} />
            <Text style={styles.possiblyRemovedText}>Possibly removed</Text>
          </View>
        )}
      </View>
    );
  };

  const renderInlineHintBox = (item: MickeyListItemDTO): JSX.Element | null => {
    const isHintOpen = Boolean(openHints[item.id]);
    const clue2Text = unlockedHints[item.id];
    if (!isHintOpen || !clue2Text) return null;

    return (
      <View style={styles.inlineHintBox} testID={`inline-hint-box-${item.id}`}>
        <Text style={styles.inlineHintLabel}>Closer Hint</Text>
        <Text style={styles.inlineHintText}>{clue2Text}</Text>
      </View>
    );
  };

  const renderPeekHintButton = (item: MickeyListItemDTO): JSX.Element => {
    const isHintOpen = Boolean(openHints[item.id]);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Closer hint for ${item.experienceName}`}
        testID={`peek-hint-${item.id}`}
        style={styles.peekHintPill}
        onPress={() => void handleToggleInlineHint(item)}
      >
        <Ionicons name="bulb-outline" size={12} color={t.color.primaryFg} />
        <Text style={styles.peekHintText}>
          {isHintOpen ? 'Hide closer hint' : 'Need a closer hint?'}
        </Text>
      </Pressable>
    );
  };

  const renderSpotStampButton = (item: MickeyListItemDTO): JSX.Element => {
    if (item.found) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Found"
          testID={`spot-toggle-${item.id}`}
          style={styles.foundBadge}
          onPress={() => void handleToggleSpot(item)}
        >
          <Ionicons name="checkmark-circle" size={16} color={t.color.success} />
          <Text style={styles.foundText}>Found</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Spot Hidden Mickey at ${item.experienceName}`}
        testID={`spot-toggle-${item.id}`}
        style={styles.spotStampBtn}
        onPress={() => void handleToggleSpot(item)}
      >
        <Ionicons name="sparkles" size={13} color={t.color.primaryFg} />
        <Text style={styles.spotStampBtnText}>Spot</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={t.color.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Hidden Mickeys</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="My Submissions"
            onPress={() => navigation.navigate('MySubmissions')}
            style={styles.profileIconBtn}
          >
            <Ionicons name="person-outline" size={18} color={t.color.primaryFg} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit a Hidden Mickey"
            testID="header-add-mickey-btn"
            onPress={() => {
              if (route.params?.experienceId) {
                navigation.navigate('SubmitMickey', { experienceId: route.params.experienceId });
              } else {
                navigation.navigate('SubmitMickey');
              }
            }}
            style={styles.addPillButton}
          >
            <Ionicons name="add" size={15} color={t.color.textOnPrimary} />
            <Text style={styles.addPillButtonText}>+ Add</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={viewMode === 'cards' ? items : ([] as readonly MickeyListItemDTO[])}
        keyExtractor={(item) => item.id}
        extraData={t.scheme}
        refreshing={isListLoading}
        onRefresh={() => void refetch()}
        ListHeaderComponent={
          <View style={styles.listHeaderWrap}>
            {/* Visual Hunt Summary Card with Interactive Official / Community Scope Switcher */}
            <View style={styles.summaryCard} accessibilityRole="summary">
              <View style={styles.summaryRow}>
                <View style={styles.summaryLeftWrap}>
                  <View style={styles.percentRingBadge}>
                    <Ionicons name="sparkles" size={13} color={t.color.accent} />
                    <Text style={styles.percentRingText}>{activeAreaSummary.percent}%</Text>
                  </View>
                  <View style={styles.summaryTextCol}>
                    <Text style={styles.summaryLabel}>
                      {selectedScope === 'community' ? 'Community Hunt' : 'Official Hunt'}
                    </Text>
                    <Text style={styles.summaryValue}>
                      {`${activeAreaSummary.found} / ${activeAreaSummary.total}`}
                    </Text>
                    <Text style={styles.summarySubtext}>{activeAreaSummary.subtext}</Text>
                  </View>
                </View>

                <View style={styles.heroScopePillsCol}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Scope: official"
                    testID="hero-scope-official"
                    style={[
                      styles.heroScopePill,
                      (selectedScope === 'all' || selectedScope === 'official') &&
                        styles.heroScopePillActive,
                    ]}
                    onPress={() => setSelectedScope('official')}
                  >
                    <Ionicons
                      name="sparkles"
                      size={11}
                      color={
                        selectedScope === 'all' || selectedScope === 'official'
                          ? t.color.textOnPrimary
                          : t.color.accent
                      }
                    />
                    <Text
                      style={[
                        styles.heroScopePillText,
                        (selectedScope === 'all' || selectedScope === 'official') &&
                          styles.heroScopePillTextActive,
                      ]}
                    >
                      {`Official (${officialTotalCount})`}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Scope: community"
                    testID="hero-scope-community"
                    style={[
                      styles.heroScopePill,
                      selectedScope === 'community' && styles.heroScopePillActive,
                    ]}
                    onPress={() => setSelectedScope('community')}
                  >
                    <Ionicons
                      name="people"
                      size={12}
                      color={
                        selectedScope === 'community'
                          ? t.color.textOnPrimary
                          : t.color.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.heroScopePillText,
                        selectedScope === 'community' && styles.heroScopePillTextActive,
                      ]}
                    >
                      {`Community (${communityTotalCount})`}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.progressTrack} testID="hunt-progress-bar">
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(activeAreaSummary.total > 0 ? 4 : 0, activeAreaSummary.percent)}%`,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Park & Resorts Tabs with Progress Counts */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalTabsScroll}
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel="All Parks"
                style={[styles.parkTab, selectedParkTab === 'All' && styles.parkTabActive]}
                onPress={() => setSelectedParkTab('All')}
              >
                <Text
                  style={[
                    styles.parkTabText,
                    selectedParkTab === 'All' && styles.parkTabTextActive,
                  ]}
                >
                  {formatParkTabLabel(summaryData, 'All', selectedScope, items)}
                </Text>
              </Pressable>
              {PARKS.map((park) => (
                <Pressable
                  key={park}
                  accessibilityRole="tab"
                  accessibilityLabel={park}
                  style={[styles.parkTab, selectedParkTab === park && styles.parkTabActive]}
                  onPress={() => setSelectedParkTab(park)}
                >
                  <View
                    style={[
                      styles.parkDot,
                      {
                        backgroundColor:
                          selectedParkTab === park ? t.color.textOnPrimary : t.parkAccent[park],
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.parkTabText,
                      selectedParkTab === park && styles.parkTabTextActive,
                    ]}
                  >
                    {formatParkTabLabel(summaryData, park, selectedScope, items)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel="Resorts"
                style={[styles.parkTab, selectedParkTab === 'Resort' && styles.parkTabActive]}
                onPress={() => setSelectedParkTab('Resort')}
              >
                <View
                  style={[
                    styles.parkDot,
                    {
                      backgroundColor:
                        selectedParkTab === 'Resort'
                          ? t.color.textOnPrimary
                          : t.resortVisual.tint,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.parkTabText,
                    selectedParkTab === 'Resort' && styles.parkTabTextActive,
                  ]}
                >
                  {formatParkTabLabel(summaryData, 'Resort', selectedScope, items)}
                </Text>
              </Pressable>
            </ScrollView>

            {/* Compact Toolbar: Search + Found/Unfound Filter */}
            <View style={styles.compactToolbarRow}>
              <View style={styles.searchContainer}>
                <Ionicons
                  name="search"
                  size={16}
                  color={t.color.textSecondary}
                  style={styles.searchIcon}
                />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search ride, hotel, or clue..."
                  placeholderTextColor={t.color.textSecondary}
                  accessibilityLabel="Search Hidden Mickeys"
                  style={styles.searchInput}
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => setSearchQuery('')}
                    style={styles.clearSearchBtn}
                  >
                    <Ionicons name="close-circle" size={16} color={t.color.textSecondary} />
                  </Pressable>
                )}
              </View>

              <View style={styles.foundSegmentContainer}>
                {(['all', 'found', 'unfound'] as const).map((f) => (
                  <Pressable
                    key={f}
                    accessibilityRole="button"
                    accessibilityLabel={`Found filter: ${f}`}
                    style={[styles.segmentBtn, selectedFound === f && styles.segmentBtnActive]}
                    onPress={() => setSelectedFound(f)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        selectedFound === f && styles.segmentTextActive,
                      ]}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Zone filter pills with semantic icons */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalPillsScroll}
            >
              {ZONE_PILLS.map((pill) => {
                const isActive = selectedZone === pill.value;
                const pillIcon = pill.value
                  ? ((ZONE_ICON_MAP[pill.value] ?? 'location-outline') as keyof typeof Ionicons.glyphMap)
                  : undefined;
                return (
                  <Pressable
                    key={pill.label}
                    accessibilityRole="button"
                    accessibilityLabel={pill.a11y}
                    style={[styles.zonePill, isActive && styles.zonePillActive]}
                    onPress={() => setSelectedZone(pill.value)}
                  >
                    {pillIcon ? (
                      <Ionicons
                        name={pillIcon}
                        size={12}
                        color={isActive ? t.color.textOnPrimary : t.color.textSecondary}
                      />
                    ) : null}
                    <Text style={[styles.zonePillText, isActive && styles.zonePillTextActive]}>
                      {pill.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* In-Phone View Mode Switcher Bar: All Mickeys vs By Venue */}
            <View style={styles.viewSwitcherBar}>
              <Text style={styles.resultsCountText}>
                {viewMode === 'grouped'
                  ? `${venueGroups.length} ${venueGroups.length === 1 ? 'venue' : 'venues'} • ${items.length} ${items.length === 1 ? 'Mickey' : 'Mickeys'}`
                  : `${items.length} Hidden ${items.length === 1 ? 'Mickey' : 'Mickeys'}`}
              </Text>
              <View style={styles.viewToggleGroup}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View mode: All Mickeys"
                  style={[styles.viewToggleBtn, viewMode === 'cards' && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode('cards')}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      viewMode === 'cards' && styles.viewToggleTextActive,
                    ]}
                  >
                    All Mickeys
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View mode: By Venue"
                  style={[
                    styles.viewToggleBtn,
                    viewMode === 'grouped' && styles.viewToggleBtnActive,
                  ]}
                  onPress={() => setViewMode('grouped')}
                >
                  <Text
                    style={[
                      styles.viewToggleText,
                      viewMode === 'grouped' && styles.viewToggleTextActive,
                    ]}
                  >
                    By Venue
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Grouped By Venue Cards */}
            {viewMode === 'grouped' &&
              venueGroups.map((group) => (
                <View
                  key={group.experienceId}
                  style={styles.venueGroupCard}
                  testID={`venue-group-${group.experienceId}`}
                >
                  <View
                    style={[
                      styles.cardAccentStripe,
                      { backgroundColor: accentForPark(group.park) },
                    ]}
                  />
                  <View style={styles.venueGroupHeader}>
                    <View style={styles.cardTitleWrap}>
                      <Text style={styles.experienceName}>{group.experienceName}</Text>
                      <Text style={styles.parkName}>
                        {`${group.areaSubtitle} • ${group.totalCount} Hidden ${group.totalCount === 1 ? 'Mickey' : 'Mickeys'}`}
                      </Text>
                    </View>
                    <View style={styles.venueTallyPill}>
                      <Text style={styles.venueTallyText}>
                        {`${group.foundCount}/${group.totalCount} Spotted`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.venueSubcardsContainer}>
                    {group.items.map(({ item, mickeyPositionLabel }) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${mickeyPositionLabel}, ${item.clue1}, ${item.experienceName}`}
                        style={[styles.venueSubcard, item.found && styles.cardFoundBorder]}
                        onPress={() =>
                          navigation.navigate('HiddenMickeyDetail', { mickeyId: item.id })
                        }
                      >
                        <View style={styles.subcardTopRow}>
                          {renderMickeyBadgesRow(item, mickeyPositionLabel)}
                          {renderSpotStampButton(item)}
                        </View>

                        <Text style={styles.clueText}>{item.clue1}</Text>

                        {renderInlineHintBox(item)}

                        <View style={styles.subcardFooterRow}>
                          {renderPeekHintButton(item)}
                          <Text style={styles.fullGuideText}>Full guide →</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.clue1}, ${item.experienceName}`}
            style={[styles.card, item.found && styles.cardFoundBorder]}
            onPress={() => navigation.navigate('HiddenMickeyDetail', { mickeyId: item.id })}
          >
            <View
              style={[styles.cardAccentStripe, { backgroundColor: accentForPark(item.park) }]}
            />
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.experienceName}>{item.experienceName}</Text>
                <Text style={styles.parkName}>{formatAreaSubtitle(item)}</Text>
              </View>
              {renderSpotStampButton(item)}
            </View>

            <Text style={styles.clueText}>{item.clue1}</Text>

            {renderInlineHintBox(item)}

            <View style={styles.cardFooterRow}>
              {renderMickeyBadgesRow(item)}
              {renderPeekHintButton(item)}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          items.length === 0 ? (
            !isListLoading ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={40} color={t.color.textSecondary} />
                <Text style={styles.emptyTitle}>No Hidden Mickeys found</Text>
                <Text style={styles.emptySubtext}>Try adjusting your filters or search query.</Text>
              </View>
            ) : (
              <ActivityIndicator
                style={styles.emptyLoading}
                size="large"
                color={t.color.primary}
              />
            )
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerTitle: {
    ...theme.typography.heading,
    color: t.color.textPrimary,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  profileIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addPillButtonText: {
    ...theme.typography.meta,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  listHeaderWrap: {
    paddingBottom: theme.spacing.sm,
  },
  summaryCard: {
    margin: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  summaryLeftWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  percentRingBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 2,
    borderColor: t.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  percentRingText: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  summaryTextCol: {
    flex: 1,
  },
  heroScopePillsCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  heroScopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  heroScopePillActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  heroScopePillText: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  heroScopePillTextActive: {
    color: t.color.textOnPrimary,
  },
  summaryLabel: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryValue: {
    ...theme.typography.heading,
    color: t.color.primaryFg,
    fontWeight: '800',
    marginTop: 2,
  },
  summarySubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: t.color.primary,
  },
  horizontalTabsScroll: {
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
  },
  parkTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
  },
  parkTabActive: {
    backgroundColor: t.color.primary,
  },
  parkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  parkTabText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  parkTabTextActive: {
    color: t.color.textOnPrimary,
  },
  compactToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  foundSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 2,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  segmentBtn: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: theme.radius.sm,
  },
  segmentBtnActive: {
    backgroundColor: t.color.primary,
  },
  segmentText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: t.color.textOnPrimary,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: theme.spacing.sm,
  },
  searchIcon: {
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 7,
    color: t.color.textPrimary,
    ...theme.typography.meta,
  },
  clearSearchBtn: {
    padding: 4,
  },
  horizontalPillsScroll: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  zonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  zonePillActive: {
    backgroundColor: t.color.primaryFg,
    borderColor: t.color.primaryFg,
  },
  zonePillText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  zonePillTextActive: {
    color: t.color.textOnPrimary,
  },
  viewSwitcherBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  resultsCountText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  viewToggleGroup: {
    flexDirection: 'row',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  viewToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  viewToggleBtnActive: {
    backgroundColor: t.color.primary,
  },
  viewToggleText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '700',
  },
  viewToggleTextActive: {
    color: t.color.textOnPrimary,
  },
  card: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    paddingLeft: theme.spacing.md + 4,
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    overflow: 'hidden',
    position: 'relative',
  },
  cardFoundBorder: {
    borderColor: withAlpha(t.color.success, 0.55),
  },
  cardAccentStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
    gap: theme.spacing.xs,
  },
  cardTitleWrap: {
    flex: 1,
  },
  experienceName: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  parkName: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  foundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(t.color.success, 0.14),
    borderWidth: 1,
    borderColor: t.color.success,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  foundText: {
    ...theme.typography.meta,
    color: t.color.success,
    fontWeight: '700',
  },
  spotStampBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  spotStampBtnText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  clueText: {
    ...theme.typography.body,
    color: t.color.textPrimary,
    marginVertical: 6,
    lineHeight: 20,
    flex: 1,
  },
  inlineHintBox: {
    marginVertical: 6,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: t.color.accent,
    gap: 2,
  },
  inlineHintLabel: {
    ...theme.typography.meta,
    fontSize: 10.5,
    fontWeight: '800',
    color: t.color.primaryFg,
    textTransform: 'uppercase',
  },
  inlineHintText: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    lineHeight: 18,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  positionBadge: {
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
  },
  positionBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  difficultyDots: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgePillText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
    textTransform: 'capitalize',
  },
  peekHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  peekHintText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  venueGroupCard: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    overflow: 'hidden',
    position: 'relative',
  },
  venueGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    paddingLeft: theme.spacing.md + 4,
    backgroundColor: t.color.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    gap: theme.spacing.xs,
  },
  venueTallyPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  venueTallyText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  venueSubcardsContainer: {
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.sm + 4,
    gap: theme.spacing.sm,
  },
  venueSubcard: {
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.background,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  subcardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
    marginBottom: 4,
  },
  subcardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fullGuideText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  communityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  communityBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  possiblyRemovedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.warningSurface,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  possiblyRemovedText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.warningText,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
    gap: theme.spacing.xs,
  },
  emptyTitle: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  emptySubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  emptyLoading: {
    marginVertical: theme.spacing.xl,
  },
}));
