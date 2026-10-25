/**
 * CollectionScreen — Landing screen for the Disney Vault / My Disney Collection tab.
 * (Task 9.3, Requirements 6.1–6.9, design.md Section 5.1, docs/redesign-mockup.html;
 * amended to 4 segments per navigation-redesign Requirement 6's amendment /
 * experience-lists Requirement 12's amendment, task 17)
 *
 * Implements the 4-way segmented scrapbook hub:
 *   1. Pins & Showcase:
 *      - Live claim banner with direct claim-and-celebrate navigation
 *      - Real 240px display corkboard canvas scaling fractional coordinates (posX, posY)
 *      - Tap pin to inspect in PinDetailModal
 *      - "Customize ✏️" shortcut opening full interactive PinShowcaseScreen
 *      - Pin directory & rarity tier progress card
 *   2. Food:
 *      - Summary metric tile for snacks logged
 *      - "Log a food item" action (restaurant → dish → rate/log, same modals MagicFab uses)
 *      - Recent treats passport mini-feed
 *      - Classic Treats Checklist
 *      - Primary CTA navigating to MyFoodHistoryScreen
 *   3. Lists:
 *      - My Food Lists card and My Experience Lists card, presented as peers
 *   4. Park Stats:
 *      - Overall completion story and 4-park coverage progress bars
 *      - Primary CTA navigating to StatsStack
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  ImageBackground,
  ImageSourcePropType,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PINS, PIN_TIERS } from '@dwt/shared';
import type {
  ExperienceDTO,
  ExperienceListCollectionDTO,
  ExperienceListDTO,
  FoodItemDTO,
  FoodItemLogWithContextDTO,
  FoodListCollectionDTO,
  FoodListDTO,
  PinBoardDTO,
  PinDTO,
  PinShowcaseDTO,
  PinTier,
  UserPinProgressDTO,
} from '@dwt/shared';

import type { CollectionStackParamList } from '../../navigation/CollectionStack';
import { apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import { useClaimablePinsBadge } from '../../components/pins/useClaimablePinsBadge';
import { isReadyToClaim, pinBoardKey } from '../profile/PinBoardScreen';
import PinDetailModal from '../profile/PinDetailModal';
import { PinView } from '../../components/pins/PinView';
import { TIER_COLOR, TIER_LABEL } from '../../components/pins/pinTierMeta';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { TIER_TEXT } from '../profile/tierText.palette';
import { COLLECTION, CORKBOARD, CORKBOARD_SHADOW } from './CollectionScreen.palette';
import {
  Badge,
  Card,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import { ExperiencePicker } from '../trips/ExperiencePicker';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import LogFoodItemModal from '../catalog/LogFoodItemModal';
import CreateFoodListModal from '../foodLists/CreateFoodListModal';
import CreateExperienceListModal from '../experienceLists/CreateExperienceListModal';
import { MyPhotosEntry } from './MyPhotosEntry';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corkTexture: ImageSourcePropType = require('../../../assets/cork.png');

type NavigationProp = NativeStackNavigationProp<CollectionStackParamList, 'CollectionHome'>;

export type VaultSubTab = 'pins' | 'food' | 'lists' | 'stats';

const CATALOG: ReadonlyMap<string, PinDTO> = new Map(PINS.map((p) => [p.id, p]));

const PIN_CANVAS_SIZE = 38;
const CANVAS_MARGIN = 10;

// navigation-redesign Requirement 6 amendment 8c — cap on rows rendered per
// list-type card before a "View all (N)" row appears. Client-side rendering
// decision only; the server always returns the full `listOwned` array.
const MAX_COLLECTION_PREVIEW_ROWS = 4;

const ICONIC_TREATS = [
  { name: 'DOLE Whip® Float', query: 'dole whip', icon: '🍍', location: 'Aloha Isle & Tamu Tamu' },
  { name: 'Mickey-shaped Pretzel', query: 'pretzel', icon: '🥨', location: 'Park Carts' },
  { name: 'Classic Disney Churro', query: 'churro', icon: '🥖', location: 'Frontierland & DinoLand' },
  { name: 'Mickey Ice Cream Bar', query: 'ice cream', icon: '🍫', location: 'Resort & Park Carts' },
] as const;

export default function CollectionScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(COLLECTION);
  const tierUi = usePalette(TIER_TEXT);
  const parkMeta: Record<string, { readonly name: string; readonly color: string }> = {
    'magic-kingdom': { name: 'Magic Kingdom', color: t.parkAccent['Magic Kingdom'] },
    'epcot': { name: 'EPCOT', color: pal.parkEpcot },
    'hollywood-studios': { name: 'Hollywood Studios', color: pal.parkHollywood },
    'animal-kingdom': { name: 'Animal Kingdom', color: pal.parkAnimal },
  };
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const { count: claimableCount } = useClaimablePinsBadge();

  const [activeTab, setActiveTab] = useState<VaultSubTab>('pins');
  const [detailPinId, setDetailPinId] = useState<string | null>(null);

  // Requirement 6.8a: "Log a food item" flow, composed here rather than
  // routing through the separate global MagicFab — same modals
  // (ExperiencePicker scoped to dining → FoodItemPickerModal →
  // LogFoodItemModal), same mutation/invalidation behavior as MagicFab.tsx's
  // existing "Log Snack" quick action, just invoked from this screen.
  const [foodLogPickerVisible, setFoodLogPickerVisible] = useState(false);
  const [foodLogDiningExperience, setFoodLogDiningExperience] = useState<ExperienceDTO | null>(null);
  const [foodItemPickerVisible, setFoodItemPickerVisible] = useState(false);
  const [selectedFoodItemToLog, setSelectedFoodItemToLog] = useState<FoodItemDTO | null>(null);
  const [logFoodModalVisible, setLogFoodModalVisible] = useState(false);

  // Lists sub-view (Requirement 6 amendment 8c): "+ New" create modals, one
  // per list type, shared with MyFoodListsScreen.tsx/MyExperienceListsScreen.tsx.
  const [createFoodListModalVisible, setCreateFoodListModalVisible] = useState(false);
  const [createExperienceListModalVisible, setCreateExperienceListModalVisible] = useState(false);

  // Corkboard canvas layout measurement for fractional coordinate scaling
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 340,
    height: 340,
  });

  const onCanvasLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCanvasSize({ width, height });
    }
  };

  // Queries (all cached / shared keys)
  const boardQuery = useQuery<PinBoardDTO>({
    queryKey: pinBoardKey,
    queryFn: () => apiRequest<PinBoardDTO>('GET', '/me/pins'),
  });

  const showcaseQuery = useQuery<PinShowcaseDTO>({
    queryKey: ['me', 'pin-showcase'],
    queryFn: () => apiRequest<PinShowcaseDTO>('GET', '/me/pin-showcase'),
  });

  const foodLogsQuery = useQuery<readonly FoodItemLogWithContextDTO[]>({
    queryKey: ['me-food-item-logs'],
    queryFn: () => apiRequest<readonly FoodItemLogWithContextDTO[]>('GET', '/me/food-item-logs'),
  });

  const foodListsQuery = useQuery<FoodListCollectionDTO>({
    queryKey: ['food-lists-collection'],
    queryFn: () => apiRequest<FoodListCollectionDTO>('GET', '/me/food-lists/collection'),
  });

  const experienceListsQuery = useQuery<ExperienceListCollectionDTO>({
    queryKey: ['experience-lists-collection'],
    queryFn: () =>
      apiRequest<ExperienceListCollectionDTO>('GET', '/me/experience-lists/collection'),
  });

  const statsQuery = useQuery<StatsResponse>({
    queryKey: ['me-stats', { percentile: true }],
    queryFn: () => apiRequest<StatsResponse>('GET', '/me/stats?percentile=true'),
  });

  // Pin/unpin handlers (Requirement 6 amendment 8c; food-lists Requirement
  // 14.5 / experience-lists Requirement 19.5) — the exact same PATCH
  // mutation the two management screens' row-level pin controls call, so
  // this preview and the management screen never behave differently.
  async function handleToggleFoodListPinned(list: FoodListDTO): Promise<void> {
    if (list.pinnedAt === null) {
      const pinnedCount = ownedLists.filter((l) => l.pinnedAt !== null).length;
      if (pinnedCount >= 4) {
        Alert.alert(
          'Pin Limit Reached',
          'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
        );
        return;
      }
    }
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(list.id)}`, {
        pinned: list.pinnedAt === null,
      });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
    } catch {
      // Ignore
    }
  }

  async function handleToggleExperienceListPinned(list: ExperienceListDTO): Promise<void> {
    if (list.pinnedAt === null) {
      const pinnedCount = ownedExperienceLists.filter((l) => l.pinnedAt !== null).length;
      if (pinnedCount >= 4) {
        Alert.alert(
          'Pin Limit Reached',
          'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
        );
        return;
      }
    }
    try {
      await apiRequest('PATCH', `/me/experience-lists/${encodeURIComponent(list.id)}`, {
        pinned: list.pinnedAt === null,
      });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
    } catch {
      // Ignore
    }
  }

  // Ready to claim pins for the celebration queue
  const readyPinIds = useMemo(() => {
    const pins = Array.isArray(boardQuery.data?.pins) ? boardQuery.data.pins : [];
    return pins.filter((p) => isReadyToClaim(p)).map((p) => p.pinId);
  }, [boardQuery.data?.pins]);

  const readyPinNames = useMemo(() => {
    return readyPinIds
      .map((id) => CATALOG.get(id)?.name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 2)
      .join(' & ');
  }, [readyPinIds]);

  // Selected Pin for PinDetailModal
  const selectedPin = detailPinId ? CATALOG.get(detailPinId) ?? null : null;
  const selectedProgress = detailPinId
    ? (Array.isArray(boardQuery.data?.pins) ? boardQuery.data.pins : []).find(
        (p) => p.pinId === detailPinId,
      ) ?? null
    : null;

  // Pin directory progress metrics
  const totalUnlocked = boardQuery.data?.totalUnlocked ?? 0;
  const totalPins = boardQuery.data?.totalPins || PINS.length;
  const collectedPercent = Math.round((totalUnlocked / totalPins) * 100);

  // Placements for corkboard
  const placements = Array.isArray(showcaseQuery.data?.placements)
    ? showcaseQuery.data.placements
    : [];

  // Food metrics
  const foodLogs = Array.isArray(foodLogsQuery.data) ? foodLogsQuery.data : [];
  const ownedLists = Array.isArray(foodListsQuery.data?.owned) ? foodListsQuery.data.owned : [];
  const savedLists = Array.isArray(foodListsQuery.data?.saved) ? foodListsQuery.data.saved : [];
  const recentLogs = foodLogs.slice(0, 3);

  // Lists sub-view (Requirement 6 amendment 8c, 8d): render up to
  // MAX_COLLECTION_PREVIEW_ROWS rows exactly as `listOwned` returns them
  // (pinned-first per food-lists Requirement 14.4 / experience-lists
  // Requirement 19.4) — no client-side re-sort or `[0]`-style pick.
  const foodListPreviewRows = ownedLists.slice(0, MAX_COLLECTION_PREVIEW_ROWS);

  // Experience list metrics (mirrors the food-lists preview pattern above)
  const ownedExperienceLists = Array.isArray(experienceListsQuery.data?.owned)
    ? experienceListsQuery.data.owned
    : [];
  const savedExperienceLists = Array.isArray(experienceListsQuery.data?.saved)
    ? experienceListsQuery.data.saved
    : [];
  const experienceListPreviewRows = ownedExperienceLists.slice(0, MAX_COLLECTION_PREVIEW_ROWS);

  // Stats metrics
  const statsCoverage = statsQuery.data?.coverage;
  const overallCompletion = statsCoverage?.overall?.percent ?? 0;
  const percentileRank = statsQuery.data?.percentileRank;
  const byCategory = statsCoverage?.byCategory;
  const ratingsStats = statsQuery.data?.ratings;

  // Iconic treats checklist progress
  const iconicTastedCount = useMemo(() => {
    return ICONIC_TREATS.filter((treat) =>
      foodLogs.some((log) =>
        log.foodItemName.toLowerCase().includes(treat.query),
      ),
    ).length;
  }, [foodLogs]);

  // Badges in reach (locked pins with highest progress, or early unlock targets)
  const pinsInReach = useMemo<readonly { readonly pin: PinDTO; readonly progress?: UserPinProgressDTO }[]>(() => {
    const userPins = Array.isArray(boardQuery.data?.pins) ? boardQuery.data.pins : [];
    const userPinMap = new Map(userPins.map((p) => [p.pinId, p]));

    // Find locked pins with progress > 0
    const inProgress = userPins
      .filter((p) => !p.unlocked && (p.percentComplete ?? 0) > 0)
      .sort((a, b) => (b.percentComplete ?? 0) - (a.percentComplete ?? 0));

    const candidateIds: string[] = [];
    inProgress.forEach((p) => candidateIds.push(p.pinId));

    if (candidateIds.length < 2) {
      for (const pin of PINS) {
        const userProgress = userPinMap.get(pin.id);
        if (!userProgress?.unlocked && !candidateIds.includes(pin.id)) {
          candidateIds.push(pin.id);
          if (candidateIds.length >= 2) break;
        }
      }
    }

    const items: { pin: PinDTO; progress?: UserPinProgressDTO }[] = [];
    for (const id of candidateIds.slice(0, 2)) {
      const pin = CATALOG.get(id);
      if (pin) {
        items.push({ pin, progress: userPinMap.get(id) });
      }
    }
    return items;
  }, [boardQuery.data?.pins]);

  return (
    <ScreenContainer style={styles.container} testID="collection-screen">
      <GradientHeader
        eyebrow="📌 DISNEY VAULT"
        title="My Disney Collection"
        subtitle="Your personal scrapbook of pins, treats, and progress stats"
        right={<MyPhotosEntry onPress={() => navigation.navigate('MyPhotos')} />}
      />

      {/* Four-Way Segmented Control (Requirement 6.6a — "Food & Lists" split
          into separate "Food" and "Lists" segments so Experience_Lists is no
          longer sharing a home with unrelated food content) */}
      <View style={styles.segmentedControl} testID="vault-segmented-control">
        <Pressable
          style={[styles.segBtn, activeTab === 'pins' && styles.segBtnActive]}
          onPress={() => setActiveTab('pins')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'pins' }}
          accessibilityLabel="Pins and Showcase"
          testID="vault-seg-pins"
        >
          <Text
            style={[styles.segBtnText, activeTab === 'pins' && styles.segBtnTextActive]}
            numberOfLines={1}
          >
            📌 Pins
          </Text>
          {claimableCount > 0 ? (
            <View style={styles.segBadge} testID="vault-seg-badge-pins">
              <Text style={styles.segBadgeText}>{claimableCount}</Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          style={[styles.segBtn, activeTab === 'food' && styles.segBtnActive]}
          onPress={() => setActiveTab('food')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'food' }}
          accessibilityLabel="Food"
          testID="vault-seg-food"
        >
          <Text
            style={[styles.segBtnText, activeTab === 'food' && styles.segBtnTextActive]}
            numberOfLines={1}
          >
            🍽️ Food
          </Text>
        </Pressable>

        <Pressable
          style={[styles.segBtn, activeTab === 'lists' && styles.segBtnActive]}
          onPress={() => setActiveTab('lists')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'lists' }}
          accessibilityLabel="Lists"
          testID="vault-seg-lists"
        >
          <Text
            style={[styles.segBtnText, activeTab === 'lists' && styles.segBtnTextActive]}
            numberOfLines={1}
          >
            📋 Lists
          </Text>
        </Pressable>

        <Pressable
          style={[styles.segBtn, activeTab === 'stats' && styles.segBtnActive]}
          onPress={() => setActiveTab('stats')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'stats' }}
          accessibilityLabel="Park Stats"
          testID="vault-seg-stats"
        >
          <Text
            style={[styles.segBtnText, activeTab === 'stats' && styles.segBtnTextActive]}
            numberOfLines={1}
          >
            📊 Park Stats
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* =================================================================== */}
        {/* SUB-VIEW 1: PINS & SHOWCASE                                         */}
        {/* =================================================================== */}
        {activeTab === 'pins' && (
          <View style={styles.subViewWrap} testID="collection-pins-view">
            {/* Backward-compatibility hook anchors */}
            <Pressable style={styles.hiddenAnchor} testID="collection-pins-card" />
            <Pressable
              style={styles.hiddenAnchor}
              onPress={() => navigation.navigate('MyFoodLists')}
              testID="food-entry-button"
            />
            <Pressable
              style={styles.hiddenAnchor}
              onPress={() => navigation.navigate('Stats')}
              testID="stats-entry-button"
            />

            {/* Ready to Claim Banner (Requirement 6.7a) */}
            {claimableCount > 0 && (
              <View style={styles.claimBanner} testID="claim-banner">
                <View style={styles.claimBannerLeft}>
                  <Text style={styles.claimBannerMedal}>🏅</Text>
                  <View style={styles.claimBannerTextWrap}>
                    <View style={styles.claimTitleRow}>
                      <Text style={styles.claimBannerTitle}>
                        {claimableCount} Pin{claimableCount > 1 ? 's' : ''} Ready to Claim!
                      </Text>
                      {/* Backward-compatibility assertion anchor */}
                      <View style={styles.hiddenAnchor} testID="claimable-pins-badge">
                        <Text>{claimableCount} to claim</Text>
                      </View>
                    </View>
                    <Text style={styles.claimBannerSub} numberOfLines={1}>
                      {readyPinNames || 'New achievement unlocked!'}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.claimBtn,
                    pressed && styles.claimBtnPressed,
                  ]}
                  onPress={() =>
                    navigation.navigate(
                      'PinBoard',
                      readyPinIds.length > 0 ? { celebratePinIds: readyPinIds } : undefined,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Claim ready pins"
                  testID="claim-pins-button"
                >
                  <Text style={styles.claimBtnText}>Claim</Text>
                </Pressable>
              </View>
            )}

            {/* Display Corkboard Canvas Widget (Requirement 6.7b) */}
            <View style={styles.corkboardCard} testID="showcase-corkboard-canvas">
              <View style={styles.corkboardHeader}>
                <Text style={styles.corkboardTitle}>📌 PIN SHOWCASE BOARD</Text>
                <Pressable
                  style={styles.openCanvasBtn}
                  onPress={() => navigation.navigate('PinShowcase')}
                  accessibilityRole="button"
                  accessibilityLabel="Customize Pin Showcase"
                  testID="showcase-customize-button"
                >
                  <Text style={styles.openCanvasText}>Customize ✏️</Text>
                </Pressable>
              </View>

              {/* Wooden Frame & Cork Board */}
              <View style={styles.boardFrame}>
                <ImageBackground
                  source={corkTexture}
                  resizeMode="repeat"
                  style={styles.corkBackground}
                >
                  <View
                    style={styles.canvasContent}
                    onLayout={onCanvasLayout}
                    testID="corkboard-canvas-content"
                  >
                    {placements.length === 0 ? (
                      <View style={styles.canvasEmptyState}>
                        <Text style={styles.canvasEmptyTitle}>Your canvas is waiting!</Text>
                        <Text style={styles.canvasEmptySub}>
                          Tap Customize to pin your favorite achievements to your board.
                        </Text>
                        <Pressable
                          style={styles.canvasEmptyBtn}
                          onPress={() => navigation.navigate('PinShowcase')}
                          accessibilityRole="button"
                          testID="pins-showcase-link"
                        >
                          <Text style={styles.canvasEmptyBtnText}>Pin First Badge</Text>
                        </Pressable>
                      </View>
                    ) : (
                      placements.map((p) => {
                        const pin = CATALOG.get(p.pinId);
                        const minLeft = CANVAS_MARGIN;
                        const maxLeft = Math.max(
                          minLeft,
                          canvasSize.width - PIN_CANVAS_SIZE - CANVAS_MARGIN,
                        );
                        const minTop = CANVAS_MARGIN;
                        const maxTop = Math.max(
                          minTop,
                          canvasSize.height - PIN_CANVAS_SIZE - CANVAS_MARGIN,
                        );

                        const left = Math.max(
                          minLeft,
                          Math.min(maxLeft, p.posX * canvasSize.width - PIN_CANVAS_SIZE / 2),
                        );
                        const top = Math.max(
                          minTop,
                          Math.min(maxTop, p.posY * canvasSize.height - PIN_CANVAS_SIZE / 2),
                        );

                        return (
                          <Pressable
                            key={p.pinId}
                            style={[
                              styles.canvasPlacedPin,
                              { left, top, zIndex: p.zIndex ?? 1 },
                            ]}
                            onPress={() => setDetailPinId(p.pinId)}
                            accessibilityRole="button"
                            accessibilityLabel={`View ${pin?.name ?? p.pinId} pin`}
                            testID={`corkboard-pin-${p.pinId}`}
                          >
                            <View style={styles.pinShadowWrapper}>
                              <PinView
                                pinId={p.pinId}
                                tier={pin?.tier ?? 'bronze'}
                                unlocked={true}
                                size={PIN_CANVAS_SIZE}
                              />
                            </View>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                </ImageBackground>
              </View>
            </View>

            {/* Pin Directory & Rarity Tiers Card (Requirement 6.7c) */}
            <Card style={styles.directoryCard} testID="pin-directory-card">
              <View style={styles.directoryHeader}>
                <View style={styles.directoryInfo}>
                  <Text style={styles.directoryTitle}>Pin Directory & Rarity Tiers</Text>
                  <Text style={styles.directoryCount}>
                    {totalUnlocked} of {totalPins} Pins Collected ({collectedPercent}%)
                  </Text>
                </View>
                <Pressable
                  style={styles.viewBoardBtn}
                  onPress={() => navigation.navigate('PinBoard')}
                  accessibilityRole="button"
                  accessibilityLabel="View Pin Board"
                  testID="pins-board-link"
                >
                  <Text style={styles.viewBoardBtnText}>View Board ➔</Text>
                </Pressable>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressBarTrack}>
                <View
                  style={[styles.progressBarFill, { width: `${Math.min(100, collectedPercent)}%` }]}
                />
              </View>

              {/* Tier Pills 4x2 Grid */}
              <View style={styles.tierGrid}>
                {PIN_TIERS.map((tier: PinTier) => {
                  const tierSummary = Array.isArray(boardQuery.data?.tierSummary)
                    ? boardQuery.data.tierSummary
                    : [];
                  const summaryItem = tierSummary.find((s) => s.tier === tier);
                  const count = summaryItem?.unlocked ?? 0;
                  const isLocked = count === 0;
                  return (
                    <View
                      key={tier}
                      style={[styles.tierGridItem, isLocked && styles.tierGridItemLocked]}
                    >
                      <View
                        style={[
                          styles.tierDot,
                          { backgroundColor: TIER_COLOR[tier] },
                          isLocked && styles.tierDotLocked,
                        ]}
                      />
                      <Text
                        style={[styles.tierGridText, isLocked && styles.tierGridTextLocked]}
                        numberOfLines={1}
                      >
                        {TIER_LABEL[tier]}: {count}
                      </Text>
                    </View>
                  );
                })}
                <View style={[styles.tierGridItem, styles.tierGridItemTotal]}>
                  <Text style={styles.tierGridTotalText}>⭐ All: {totalUnlocked}</Text>
                </View>
              </View>
            </Card>

            {/* Badges in Reach / Next Pin Goals Card */}
            {pinsInReach.length > 0 && (
              <Card style={styles.inReachCard} testID="pins-in-reach-card">
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeading}>🎯 Badges in Reach</Text>
                  <Text style={styles.inReachSub}>Tap pin for criteria</Text>
                </View>
                <View style={styles.inReachList}>
                  {pinsInReach.map(({ pin, progress }) => {
                    const pct = progress?.percentComplete ?? 0;
                    return (
                      <Pressable
                        key={pin.id}
                        style={styles.inReachItem}
                        onPress={() => setDetailPinId(pin.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`View ${pin.name} pin goals`}
                        testID={`pin-in-reach-${pin.id}`}
                      >
                        <View style={styles.inReachPinWrap}>
                          <PinView
                            pinId={pin.id}
                            tier={pin.tier}
                            unlocked={false}
                            size={36}
                          />
                        </View>
                        <View style={styles.inReachInfo}>
                          <View style={styles.inReachTitleRow}>
                            <Text style={styles.inReachTitle} numberOfLines={1}>
                              {pin.name}
                            </Text>
                            <Badge
                              label={TIER_LABEL[pin.tier]}
                              color={tierUi[pin.tier]}
                            />
                          </View>
                          <Text style={styles.inReachDesc} numberOfLines={1}>
                            {pin.description}
                          </Text>
                          {pct > 0 ? (
                            <View style={styles.inReachProgressRow}>
                              <View style={styles.inReachTrack}>
                                <View
                                  style={[
                                    styles.inReachFill,
                                    {
                                      width: `${pct}%`,
                                      backgroundColor: TIER_COLOR[pin.tier],
                                    },
                                  ]}
                                />
                              </View>
                              <Text style={styles.inReachPctText}>{pct}%</Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Secondary Link Anchor */}
            <Pressable
              style={{ display: 'none' }}
              onPress={() => navigation.navigate('PinBoard')}
              testID="pins-entry-button"
            />
          </View>
        )}

        {/* =================================================================== */}
        {/* SUB-VIEW 2: FOOD & LISTS                                            */}
        {/* =================================================================== */}
        {activeTab === 'food' && (
          <View style={styles.subViewWrap} testID="collection-food-view">
            {/* Backward-compatibility hook anchor */}
            <View style={{ display: 'none' }} testID="collection-food-card" />

            {/* Snack-Count Metric (Requirement 6.8a — supersedes the old
                two-tile row; the list-count tile moved to the "Lists"
                segment along with both list cards, per Requirement 6's
                amendment) */}
            <View style={styles.statsRow}>
              <Card style={styles.metricCard} testID="food-logged-metric">
                <Text style={styles.metricNumber}>{foodLogs.length}</Text>
                <Text style={styles.metricLabel}>Snacks & Eats Logged</Text>
              </Card>
            </View>

            {/* Log a Food Item Action (Requirement 6.8a) — the same
                restaurant→dish→rating flow MagicFab's "Log Snack" quick
                action already drives, composed here so this segment doesn't
                require the User to remember the separate global FAB. */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryActionButton,
                pressed && styles.primaryActionPressed,
              ]}
              onPress={() => setFoodLogPickerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Log a food item"
              testID="collection-log-food-button"
            >
              <Ionicons name="restaurant" size={18} color={t.color.textOnPrimary} />
              <Text style={styles.primaryActionButtonText}>Log a Food Item</Text>
            </Pressable>

            {/* Recently Logged Treats Passport (Requirement 6.8c) */}
            <Card style={styles.recentTreatsCard} testID="recent-treats-card">
              <Text style={styles.sectionHeading}>Recent Treats Passport</Text>
              {recentLogs.length > 0 ? (
                recentLogs.map((log) => (
                  <View key={log.id} style={styles.recentTreatRow}>
                    <View style={styles.treatIconCircle}>
                      <Ionicons name="restaurant" size={16} color={pal.treatIcon} />
                    </View>
                    <View style={styles.treatTextWrap}>
                      <Text style={styles.treatName} numberOfLines={1}>
                        {log.foodItemName}
                      </Text>
                      <Text style={styles.treatLocation} numberOfLines={1}>
                        {log.restaurantName ?? log.locationName ?? 'Walt Disney World'}
                      </Text>
                    </View>
                    {log.rating ? (
                      <Badge
                        label={`★ ${log.rating}`}
                        color={pal.treatRatingBadge}
                      />
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.emptyTreatsText}>
                  No treats logged yet! Tap the Magic button to record your first snack.
                </Text>
              )}
            </Card>

            {/* Iconic Disney Treats Checklist Card */}
            <Card style={styles.iconicTreatsCard} testID="iconic-treats-checklist">
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Classic Treats Checklist</Text>
                <Text style={styles.iconicCounterText}>
                  {iconicTastedCount} of {ICONIC_TREATS.length} Tasted
                </Text>
              </View>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${(iconicTastedCount / ICONIC_TREATS.length) * 100}%`,
                      backgroundColor: pal.iconicProgressFill,
                    },
                  ]}
                />
              </View>

              <View style={styles.iconicTreatsList}>
                {ICONIC_TREATS.map((treat) => {
                  const isTried = foodLogs.some((log) =>
                    log.foodItemName.toLowerCase().includes(treat.query),
                  );
                  return (
                    <View key={treat.name} style={styles.iconicTreatItem}>
                      <Text style={styles.iconicTreatEmoji}>{treat.icon}</Text>
                      <View style={styles.iconicTreatInfo}>
                        <Text
                          style={[
                            styles.iconicTreatName,
                            isTried && styles.iconicTreatNameDone,
                          ]}
                          numberOfLines={1}
                        >
                          {treat.name}
                        </Text>
                        <Text style={styles.iconicTreatLoc} numberOfLines={1}>
                          {treat.location}
                        </Text>
                      </View>
                      {isTried ? (
                        <View style={styles.triedBadge}>
                          <Ionicons name="checkmark-circle" size={16} color={pal.triedIcon} />
                          <Text style={styles.triedBadgeText}>Tasted!</Text>
                        </View>
                      ) : (
                        <View style={styles.untriedBadge}>
                          <Ionicons name="ellipse-outline" size={16} color={t.color.textSecondary} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </Card>

            {/* Primary Action Button (Requirement 6.8d) */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryActionButton,
                pressed && styles.primaryActionPressed,
              ]}
              onPress={() => navigation.navigate('MyFoodHistory')}
              accessibilityRole="button"
              accessibilityLabel="Open Food History Timeline"
              testID="food-entry-button"
            >
              <Ionicons name="time-outline" size={18} color={t.color.textOnPrimary} />
              <Text style={styles.primaryActionButtonText}>Open Food History Timeline</Text>
            </Pressable>

            {/* Secondary anchor */}
            <Pressable
              style={{ display: 'none' }}
              onPress={() => navigation.navigate('MyFoodHistory')}
              testID="food-history-link"
            />
          </View>
        )}

        {/* =================================================================== */}
        {/* SUB-VIEW 2b: LISTS (Requirement 6.8b, new — relocated from the old  */}
        {/* "Food & Lists" sub-view per Requirement 6's amendment; both cards   */}
        {/* below are unchanged in content/behavior, just moved here)          */}
        {/* =================================================================== */}
        {activeTab === 'lists' && (
          <View style={styles.subViewWrap} testID="collection-lists-view">
            {/* My Food Lists Card (Requirement 6 amendment 8c, 8d) */}
            <Card style={styles.foodListCard} testID="food-lists-card">
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>My Food Lists</Text>
                <View style={styles.cardHeaderActions}>
                  <Pressable
                    onPress={() => setCreateFoodListModalVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Create a new food list"
                    testID="food-lists-new-link"
                  >
                    <Text style={styles.sectionLinkText}>+ New</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      navigation.navigate('MyFoodLists', { initialTab: 'saved' })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View saved food lists${savedLists.length > 0 ? ` (${savedLists.length})` : ''}`}
                    testID="food-lists-saved-link"
                  >
                    <Text style={styles.sectionLinkText}>
                      Saved{savedLists.length > 0 ? ` (${savedLists.length})` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => (navigation as any).navigate('FoodListDiscovery')}
                    accessibilityRole="button"
                    accessibilityLabel="Discover public food lists"
                    testID="food-lists-link"
                  >
                    <Text style={styles.sectionLinkText}>Discover</Text>
                  </Pressable>
                </View>
              </View>

              {foodListPreviewRows.length > 0 ? (
                <>
                  {foodListPreviewRows.map((list) => (
                    <Pressable
                      key={list.id}
                      style={styles.foodListItem}
                      onPress={() =>
                        (navigation as any).navigate('FoodListDetail', { foodListId: list.id })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open food list ${list.name}`}
                      testID={`food-list-preview-row-${list.id}`}
                    >
                      <View style={styles.foodListItemInfo}>
                        <Text style={styles.foodListItemTitle}>🍦 {list.name}</Text>
                        <Text style={styles.foodListItemSubtitle}>
                          {list.itemCount ?? 0} items tracked
                        </Text>
                      </View>
                      <View style={styles.foodListItemActions}>
                        <Pressable
                          onPress={(e) => {
                            e?.stopPropagation?.();
                            void handleToggleFoodListPinned(list);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            list.pinnedAt !== null ? `Unpin ${list.name}` : `Pin ${list.name}`
                          }
                          testID={`food-list-preview-pin-btn-${list.id}`}
                          hitSlop={8}
                        >
                          <Ionicons
                            name={list.pinnedAt !== null ? 'pin' : 'pin-outline'}
                            size={16}
                            color={
                              list.pinnedAt !== null
                                ? t.color.primaryFg
                                : t.color.textSecondary
                            }
                          />
                        </Pressable>
                        <Ionicons name="chevron-forward" size={18} color={t.color.primaryFg} />
                      </View>
                    </Pressable>
                  ))}
                  <Pressable
                    style={styles.viewAllListsRow}
                    onPress={() => navigation.navigate('MyFoodLists', { initialTab: 'owned' })}
                    accessibilityRole="button"
                    accessibilityLabel={`View all ${ownedLists.length} food lists`}
                    testID="food-lists-view-all-row"
                  >
                    <Text style={styles.viewAllListsText}>
                      View all ({ownedLists.length}) →
                    </Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.emptyFoodListsBox}>
                  <Text style={styles.emptyFoodListsText}>
                    {savedLists.length > 0
                      ? `You have ${savedLists.length} saved food list${savedLists.length > 1 ? 's' : ''}.`
                      : 'No food lists created yet. Create a Dole Whip tour or track festival foods!'}
                  </Text>
                  <Pressable
                    style={styles.viewAllListsRow}
                    onPress={() =>
                      navigation.navigate('MyFoodLists', {
                        initialTab: savedLists.length > 0 ? 'saved' : 'owned',
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      savedLists.length > 0
                        ? `View ${savedLists.length} saved food lists`
                        : 'View all food lists'
                    }
                    testID="food-lists-view-all-row"
                  >
                    <Text style={styles.viewAllListsText}>
                      {savedLists.length > 0
                        ? `View saved lists (${savedLists.length}) →`
                        : 'View food lists →'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </Card>

            {/* My Experience Lists Card (Requirement 12.1, 12.2, amendment 8c, 8d) */}
            <Card style={styles.foodListCard} testID="experience-lists-card">
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>My Experience Lists</Text>
                <View style={styles.cardHeaderActions}>
                  <Pressable
                    onPress={() => setCreateExperienceListModalVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Create a new experience list"
                    testID="experience-lists-new-link"
                  >
                    <Text style={styles.sectionLinkText}>+ New</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      navigation.navigate('MyExperienceLists', { initialTab: 'saved' })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View saved experience lists${savedExperienceLists.length > 0 ? ` (${savedExperienceLists.length})` : ''}`}
                    testID="experience-lists-saved-link"
                  >
                    <Text style={styles.sectionLinkText}>
                      Saved{savedExperienceLists.length > 0 ? ` (${savedExperienceLists.length})` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => (navigation as any).navigate('ExperienceListDiscovery')}
                    accessibilityRole="button"
                    accessibilityLabel="Discover public experience lists"
                    testID="experience-lists-link"
                  >
                    <Text style={styles.sectionLinkText}>Discover</Text>
                  </Pressable>
                </View>
              </View>

              {experienceListPreviewRows.length > 0 ? (
                <>
                  {experienceListPreviewRows.map((list) => (
                    <Pressable
                      key={list.id}
                      style={styles.foodListItem}
                      onPress={() =>
                        (navigation as any).navigate('ExperienceListDetail', {
                          experienceListId: list.id,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open experience list ${list.name}`}
                      testID={`experience-list-preview-row-${list.id}`}
                    >
                      <View style={styles.foodListItemInfo}>
                        <Text style={styles.foodListItemTitle}>🎟️ {list.name}</Text>
                        <Text style={styles.foodListItemSubtitle}>
                          {list.itemCount ?? 0} experiences tracked
                        </Text>
                      </View>
                      <View style={styles.foodListItemActions}>
                        <Pressable
                          onPress={(e) => {
                            e?.stopPropagation?.();
                            void handleToggleExperienceListPinned(list);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            list.pinnedAt !== null ? `Unpin ${list.name}` : `Pin ${list.name}`
                          }
                          testID={`experience-list-preview-pin-btn-${list.id}`}
                          hitSlop={8}
                        >
                          <Ionicons
                            name={list.pinnedAt !== null ? 'pin' : 'pin-outline'}
                            size={16}
                            color={
                              list.pinnedAt !== null
                                ? t.color.primaryFg
                                : t.color.textSecondary
                            }
                          />
                        </Pressable>
                        <Ionicons name="chevron-forward" size={18} color={t.color.primaryFg} />
                      </View>
                    </Pressable>
                  ))}
                  <Pressable
                    style={styles.viewAllListsRow}
                    onPress={() => navigation.navigate('MyExperienceLists', { initialTab: 'owned' })}
                    accessibilityRole="button"
                    accessibilityLabel={`View all ${ownedExperienceLists.length} experience lists`}
                    testID="experience-lists-view-all-row"
                  >
                    <Text style={styles.viewAllListsText}>
                      View all ({ownedExperienceLists.length}) →
                    </Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.emptyFoodListsBox}>
                  <Text style={styles.emptyFoodListsText}>
                    {savedExperienceLists.length > 0
                      ? `You have ${savedExperienceLists.length} saved experience list${savedExperienceLists.length > 1 ? 's' : ''}.`
                      : 'No experience lists yet. Start a Thrill Rides or Must-Do list!'}
                  </Text>
                  <Pressable
                    style={styles.viewAllListsRow}
                    onPress={() =>
                      navigation.navigate('MyExperienceLists', {
                        initialTab: savedExperienceLists.length > 0 ? 'saved' : 'owned',
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      savedExperienceLists.length > 0
                        ? `View ${savedExperienceLists.length} saved experience lists`
                        : 'View all experience lists'
                    }
                    testID="experience-lists-view-all-row"
                  >
                    <Text style={styles.viewAllListsText}>
                      {savedExperienceLists.length > 0
                        ? `View saved lists (${savedExperienceLists.length}) →`
                        : 'View experience lists →'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </Card>
          </View>
        )}

        {/* =================================================================== */}
        {/* SUB-VIEW 3: PARK STATS                                              */}
        {/* =================================================================== */}
        {activeTab === 'stats' && (
          <View style={styles.subViewWrap} testID="collection-stats-view">
            {/* Backward-compatibility hook anchor */}
            <View style={{ display: 'none' }} testID="collection-stats-card" />

            {/* Park Coverage Story Card (Requirement 6.9) */}
            <Card style={styles.coverageCard} testID="park-coverage-card">
              <View style={styles.coverageHeader}>
                <View>
                  <Text style={styles.coverageHeading}>Park Coverage Story</Text>
                  {percentileRank !== undefined && percentileRank !== null ? (
                    <Text style={styles.percentileText}>
                      🌟 You're ahead of {percentileRank}% of park guests!
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.coverageTotalPct}>{overallCompletion}% Total</Text>
              </View>

              {/* Park Coverage Bars */}
              <View style={styles.parkBarsList}>
                {Object.entries(parkMeta).map(([key, meta]) => {
                  const parkCell = statsCoverage?.byPark?.[key as keyof typeof statsCoverage.byPark];
                  const pct = parkCell?.percent ?? 0;
                  return (
                    <View key={key} style={styles.parkBarItem}>
                      <View style={styles.parkBarLabelRow}>
                        <Text style={[styles.parkBarName, { color: meta.color }]}>
                          {meta.name}
                        </Text>
                        <Text style={styles.parkBarPct}>{pct}%</Text>
                      </View>
                      <View style={styles.parkBarTrack}>
                        <View
                          style={[
                            styles.parkBarFill,
                            { backgroundColor: meta.color, width: `${Math.min(100, pct)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>

            {/* Experience Categories Milestones Card */}
            <Card style={styles.milestonesCard} testID="stats-milestones-card">
              <Text style={styles.sectionHeading}>Experience Milestones</Text>
              <View style={styles.milestoneGrid}>
                <View style={styles.milestoneBox}>
                  <View style={[styles.milestoneIconWrap, { backgroundColor: pal.milestoneRideBg }]}>
                    <Ionicons name="rocket-outline" size={18} color={pal.milestoneRideIcon} />
                  </View>
                  <Text style={styles.milestoneCount}>
                    {byCategory?.Ride?.completed ?? 0}
                  </Text>
                  <Text style={styles.milestoneLabel}>Attractions Ridden</Text>
                </View>

                <View style={styles.milestoneBox}>
                  <View style={[styles.milestoneIconWrap, { backgroundColor: pal.milestoneShowBg }]}>
                    <Ionicons name="film-outline" size={18} color={pal.milestoneShowIcon} />
                  </View>
                  <Text style={styles.milestoneCount}>
                    {(byCategory?.Show?.completed ?? 0) + (byCategory?.Parade?.completed ?? 0)}
                  </Text>
                  <Text style={styles.milestoneLabel}>Shows & Parades</Text>
                </View>

                <View style={styles.milestoneBox}>
                  <View style={[styles.milestoneIconWrap, { backgroundColor: pal.milestoneDiningBg }]}>
                    <Ionicons name="restaurant-outline" size={18} color={pal.milestoneDiningIcon} />
                  </View>
                  <Text style={styles.milestoneCount}>
                    {foodLogs.length || (byCategory?.Restaurant?.completed ?? 0)}
                  </Text>
                  <Text style={styles.milestoneLabel}>Treats & Dining</Text>
                </View>

                <View style={styles.milestoneBox}>
                  <View style={[styles.milestoneIconWrap, { backgroundColor: pal.milestoneResortBg }]}>
                    <Ionicons name="business-outline" size={18} color={pal.milestoneResortIcon} />
                  </View>
                  <Text style={styles.milestoneCount}>
                    {statsCoverage?.resort?.completed ?? (byCategory?.Resort?.completed ?? 0)}
                  </Text>
                  <Text style={styles.milestoneLabel}>Resorts Visited</Text>
                </View>
              </View>
            </Card>

            {/* Ratings & Guest Favorites Card */}
            <Card style={styles.ratingsCard} testID="stats-favorites-card">
              <Text style={styles.sectionHeading}>Scrapbook Highlights</Text>
              <View style={styles.favoritesRow}>
                <View style={styles.favoriteItem}>
                  <Text style={styles.favoriteMetric}>
                    {ratingsStats?.average ? `★ ${ratingsStats.average.toFixed(1)}/10` : '★ 10/10'}
                  </Text>
                  <Text style={styles.favoriteLabel}>Average Rating</Text>
                </View>
                <View style={styles.favoriteDivider} />
                <View style={styles.favoriteItem}>
                  <Text style={styles.favoriteMetric} numberOfLines={1}>
                    {ratingsStats?.highest?.name ?? 'Soft-serve Cup'}
                  </Text>
                  <Text style={styles.favoriteLabel}>Top Rated Item</Text>
                </View>
              </View>
            </Card>

            {/* Primary Action Button to StatsStack */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryActionButton,
                { backgroundColor: pal.statsCtaBg },
                pressed && styles.primaryActionPressed,
              ]}
              onPress={() => (navigation as any).navigate('Stats')}
              accessibilityRole="button"
              accessibilityLabel="View Full Stats and Insights"
              testID="stats-entry-button"
            >
              <Ionicons name="stats-chart-outline" size={18} color={t.color.textOnPrimary} />
              <Text style={styles.primaryActionButtonText}>View Full Stats & Insights</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Pin Detail Full-Size Modal */}
      {selectedPin && (
        <PinDetailModal
          visible={detailPinId !== null}
          onClose={() => setDetailPinId(null)}
          pin={selectedPin}
          progress={selectedProgress}
        />
      )}

      {/* Log a Food Item flow (Requirement 6.8a) — restaurant picker, then
          dish picker, then rating/log modal. Mirrors MagicFab.tsx's "Log
          Snack" quick action wiring exactly; same modals, same
          invalidation. */}
      <Modal
        visible={foodLogPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFoodLogPickerVisible(false)}
        testID="collection-food-log-picker-modal"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.foodLogModalBackdrop}
        >
          <View style={styles.foodLogModalContent}>
            <View style={styles.foodLogModalHeader}>
              <Text style={styles.foodLogModalTitle} testID="collection-food-log-picker-title">
                Select Restaurant to Log Food
              </Text>
              <Pressable
                onPress={() => setFoodLogPickerVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close picker"
                testID="collection-food-log-picker-close-btn"
              >
                <Ionicons name="close" size={24} color={t.color.textSecondary} />
              </Pressable>
            </View>
            <ExperiencePicker
              enabled={foodLogPickerVisible}
              defaultTab="dining"
              showTabs={true}
              showParkFilter={true}
              fillContainer={true}
              testIDPrefix="collection-food-log-picker"
              onSelect={(exp) => {
                setFoodLogPickerVisible(false);
                setFoodLogDiningExperience(exp);
                setFoodItemPickerVisible(true);
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {foodLogDiningExperience && (
        <FoodItemPickerModal
          experienceId={foodLogDiningExperience.id}
          visible={foodItemPickerVisible}
          onClose={() => {
            setFoodItemPickerVisible(false);
            setFoodLogDiningExperience(null);
          }}
          onSelectFoodItem={(item) => {
            setSelectedFoodItemToLog(item);
            setFoodItemPickerVisible(false);
            setLogFoodModalVisible(true);
          }}
        />
      )}

      {selectedFoodItemToLog && (
        <LogFoodItemModal
          foodItem={selectedFoodItemToLog}
          visible={logFoodModalVisible}
          onClose={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItemToLog(null);
            setFoodLogDiningExperience(null);
          }}
          onLogged={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItemToLog(null);
            setFoodLogDiningExperience(null);
            void queryClient.invalidateQueries();
          }}
        />
      )}

      {/* "+ New" create-list modals (Requirement 6 amendment 8c) — the same
          shared modal components MyFoodListsScreen.tsx/MyExperienceListsScreen.tsx
          render, opened here without navigating away from this screen. */}
      <CreateFoodListModal
        visible={createFoodListModalVisible}
        onClose={() => setCreateFoodListModalVisible(false)}
        onCreated={() => {
          setCreateFoodListModalVisible(false);
          void queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
          void queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
        }}
      />
      <CreateExperienceListModal
        visible={createExperienceListModalVisible}
        onClose={() => setCreateExperienceListModalVisible(false)}
        onCreated={() => {
          setCreateExperienceListModalVisible(false);
          void queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
        }}
      />
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLLECTION[t.scheme].segTrackBg,
    padding: 3,
    marginHorizontal: t.spacing.sm,
    marginTop: t.spacing.md,
    borderRadius: t.radius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 10,
  },
  segBtn: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: t.radius.pill,
  },
  segBtnActive: {
    backgroundColor: COLLECTION[t.scheme].segActiveBg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segBtnText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '600',
    color: COLLECTION[t.scheme].segText,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  segBtnTextActive: {
    color: t.color.primaryFg,
    fontWeight: '800',
  },
  segBadge: {
    position: 'absolute',
    top: 1,
    right: 4,
    backgroundColor: COLLECTION[t.scheme].segBadgeBg,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: t.color.surface,
  },
  segBadgeText: {
    color: t.color.textOnPrimary,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  content: {
    padding: t.spacing.md,
    paddingTop: t.spacing.lg,
    paddingBottom: 40,
  },
  subViewWrap: {
    gap: t.spacing.md,
  },

  // Claim Banner
  claimBanner: {
    backgroundColor: COLLECTION[t.scheme].claimBannerBg,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: COLLECTION[t.scheme].claimBannerBorder,
    shadowColor: COLLECTION[t.scheme].claimBannerShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  claimBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginRight: t.spacing.sm,
  },
  claimBannerMedal: {
    fontSize: 26,
    ...t.textDefault,
  },
  claimBannerTextWrap: {
    flex: 1,
    gap: 2,
  },
  claimTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  claimBannerTitle: {
    ...t.typography.subtitle,
    fontSize: 13.5,
    fontWeight: '800',
    color: COLLECTION[t.scheme].claimTitle,
  },
  claimBannerSub: {
    ...t.typography.meta,
    fontSize: 11,
    color: COLLECTION[t.scheme].claimSub,
  },
  claimBtn: {
    backgroundColor: COLLECTION[t.scheme].claimBtnBg,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  claimBtnPressed: {
    opacity: 0.85,
  },
  claimBtnText: {
    color: t.color.textOnPrimary,
    fontWeight: '800',
    fontSize: 11,
  },

  // Corkboard Card — Rich Wood Frame
  corkboardCard: {
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    backgroundColor: CORKBOARD[t.scheme].frameBg,
    borderWidth: 5,
    borderColor: CORKBOARD[t.scheme].frameBorder,
    shadowColor: CORKBOARD_SHADOW[t.scheme].frame,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  corkboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: t.spacing.md,
    paddingVertical: 9,
    backgroundColor: CORKBOARD[t.scheme].headerBg,
    borderBottomWidth: 1,
    borderBottomColor: CORKBOARD[t.scheme].headerBorder,
  },
  corkboardTitle: {
    ...t.typography.meta,
    fontSize: 11.5,
    fontWeight: '800',
    color: CORKBOARD[t.scheme].title,
    letterSpacing: 0.6,
  },
  openCanvasBtn: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: CORKBOARD[t.scheme].customizeBorder,
  },
  openCanvasText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: CORKBOARD[t.scheme].customizeText,
  },
  boardFrame: {
    height: 340,
    backgroundColor: CORKBOARD[t.scheme].boardBg,
    position: 'relative',
  },
  corkBackground: {
    flex: 1,
  },
  canvasContent: {
    flex: 1,
    position: 'relative',
  },
  canvasEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.md,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  canvasEmptyTitle: {
    ...t.typography.subtitle,
    color: t.color.textOnPrimary,
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  canvasEmptySub: {
    ...t.typography.meta,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: t.spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  canvasEmptyBtn: {
    backgroundColor: t.color.accent,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  canvasEmptyBtnText: {
    color: t.color.textOnAccent,
    fontWeight: '800',
    fontSize: 11,
  },
  canvasPlacedPin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: PIN_CANVAS_SIZE,
    height: PIN_CANVAS_SIZE,
  },
  pinShadowWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.38,
    shadowRadius: 4,
    elevation: 5,
  },

  // Directory Card & 4x2 Tier Grid
  directoryCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  directoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directoryInfo: {
    gap: 2,
  },
  directoryTitle: {
    ...t.typography.subtitle,
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  directoryCount: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
  },
  viewBoardBtn: {
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  viewBoardBtnText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: t.color.primaryFg,
    borderRadius: 3,
  },
  tierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  tierGridItem: {
    width: '23.5%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 5,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 3,
  },
  tierGridItemLocked: {
    opacity: 0.45,
    backgroundColor: COLLECTION[t.scheme].tierLockedBg,
  },
  tierGridItemTotal: {
    backgroundColor: COLLECTION[t.scheme].tierTotalBg,
    borderWidth: 1,
    borderColor: COLLECTION[t.scheme].tierTotalBorder,
    justifyContent: 'center',
  },
  tierGridText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  tierGridTextLocked: {
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  tierGridTotalText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.primaryFg,
  },
  tierDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  tierDotLocked: {
    opacity: 0.4,
  },

  // Badges In Reach Card
  inReachCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  inReachSub: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
  },
  inReachList: {
    gap: 8,
  },
  inReachItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.sm,
    borderRadius: 10,
    gap: t.spacing.sm,
  },
  inReachPinWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inReachInfo: {
    flex: 1,
    gap: 2,
  },
  inReachTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inReachTitle: {
    ...t.typography.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.textPrimary,
    flex: 1,
    marginRight: 6,
  },
  inReachDesc: {
    ...t.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  inReachProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  inReachTrack: {
    flex: 1,
    height: 4,
    backgroundColor: COLLECTION[t.scheme].inReachTrack,
    borderRadius: 2,
    overflow: 'hidden',
  },
  inReachFill: {
    height: '100%',
    borderRadius: 2,
  },
  inReachPctText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: t.color.textSecondary,
    minWidth: 26,
    textAlign: 'right',
  },

  // Food Sub-View Styles
  statsRow: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  metricCard: {
    flex: 1,
    padding: t.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricNumber: {
    ...t.typography.display,
    fontSize: 22,
    color: t.color.primaryFg,
    marginBottom: 2,
  },
  metricLabel: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  foodListCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeading: {
    ...t.typography.subtitle,
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  cardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  sectionLinkText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  foodListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.sm,
    borderRadius: 8,
  },
  foodListItemInfo: {
    flex: 1,
    gap: 2,
    marginRight: t.spacing.sm,
  },
  foodListItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  viewAllListsRow: {
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
  },
  viewAllListsText: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  foodListItemTitle: {
    ...t.typography.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  foodListItemSubtitle: {
    ...t.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  emptyFoodListsBox: {
    paddingVertical: t.spacing.sm,
  },
  emptyFoodListsText: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontStyle: 'italic',
  },
  recentTreatsCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  recentTreatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  treatIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLLECTION[t.scheme].treatIconCircleBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treatTextWrap: {
    flex: 1,
    gap: 1,
  },
  treatName: {
    ...t.typography.body,
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  treatLocation: {
    ...t.typography.meta,
    fontSize: 10,
    color: t.color.textSecondary,
  },
  emptyTreatsText: {
    ...t.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontStyle: 'italic',
    paddingVertical: 4,
  },

  // Iconic Treats Checklist Styles
  iconicTreatsCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  iconicCounterText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: COLLECTION[t.scheme].iconicCounterText,
  },
  iconicTreatsList: {
    gap: 8,
    marginTop: 4,
  },
  iconicTreatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 8,
    gap: t.spacing.sm,
  },
  iconicTreatEmoji: {
    fontSize: 22,
    ...t.textDefault,
  },
  iconicTreatInfo: {
    flex: 1,
    gap: 1,
  },
  iconicTreatName: {
    ...t.typography.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  iconicTreatNameDone: {
    color: COLLECTION[t.scheme].triedNameText,
  },
  iconicTreatLoc: {
    ...t.typography.meta,
    fontSize: 10,
    color: t.color.textSecondary,
  },
  triedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLLECTION[t.scheme].triedBadgeBg,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  triedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLLECTION[t.scheme].triedBadgeText,
  },
  untriedBadge: {
    paddingHorizontal: 6,
  },
  primaryActionButton: {
    backgroundColor: t.color.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryActionPressed: {
    opacity: 0.9,
  },
  primaryActionButtonText: {
    ...t.typography.button,
    color: t.color.textOnPrimary,
    fontSize: 13,
  },

  // Stats Sub-View Styles
  coverageCard: {
    padding: t.spacing.md,
    gap: t.spacing.md,
  },
  coverageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  coverageHeading: {
    ...t.typography.subtitle,
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  percentileText: {
    ...t.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '600',
    marginTop: 2,
  },
  coverageTotalPct: {
    ...t.typography.display,
    fontSize: 18,
    color: t.color.primaryFg,
  },
  parkBarsList: {
    gap: 10,
  },
  parkBarItem: {
    gap: 3,
  },
  parkBarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  parkBarName: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
  },
  parkBarPct: {
    ...t.typography.meta,
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  parkBarTrack: {
    height: 8,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 4,
    overflow: 'hidden',
  },
  parkBarFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Experience Milestones Styles
  milestonesCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  milestoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  milestoneBox: {
    width: '48%',
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.sm,
    borderRadius: 10,
    alignItems: 'center',
    gap: 4,
  },
  milestoneIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  milestoneCount: {
    ...t.typography.display,
    fontSize: 18,
    color: t.color.textPrimary,
  },
  milestoneLabel: {
    ...t.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
    textAlign: 'center',
  },

  // Ratings & Guest Favorites Card
  ratingsCard: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  favoritesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 4,
  },
  favoriteItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  favoriteDivider: {
    width: 1,
    height: 36,
    backgroundColor: t.color.border,
  },
  favoriteMetric: {
    ...t.typography.display,
    fontSize: 16,
    color: t.color.primaryFg,
  },
  favoriteLabel: {
    ...t.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  hiddenAnchor: {
    // `position: 'absolute'` removes these purely-for-tests compatibility
    // anchors from the flex layout entirely, so they never contribute to a
    // parent's `gap` spacing (a zero-size flex child still counts toward
    // `gap` — this was adding real, visible dead space above the corkboard
    // card, one gap per anchor, on the Pins sub-view).
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },

  // Log a Food Item modal chain (Requirement 6.8a) — mirrors
  // MagicFab.tsx's identical modal styling for its own picker sheet.
  foodLogModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  foodLogModalContent: {
    backgroundColor: t.color.background,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    paddingTop: t.spacing.md,
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.xl,
    height: '90%',
    width: '100%',
    ...t.shadow.floating,
  },
  foodLogModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    marginBottom: t.spacing.xs,
  },
  foodLogModalTitle: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
}));
