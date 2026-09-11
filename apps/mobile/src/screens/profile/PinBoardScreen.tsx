/**
 * PinBoardScreen (R5.1–R5.3, R20 manual claim, R23 claim reveal/bulk/fanfare) — the collectible
 * Pin Board.
 *
 * Fetches the whole board once (`GET /me/pins`) and renders it as a grid of pin thumbnails. Tier
 * pill filters and track tabs narrow the grid client-side, while the progress header (overall
 * percent + per-tier summary) always reflects the entire collection — computed server-side from
 * `awarded_at`, never from `claimedAt` (Requirement 20.5) — so the counts do not move as the grid
 * is filtered (R5.3) or as pins get claimed.
 *
 * A pin is **ready to claim** (Requirement 20.2) when it is unlocked (awarded) but not yet
 * claimed. A ready-to-claim tile renders with the same locked/dimmed art as a truly locked pin
 * (Requirement 23.1) — claiming it, not merely earning it, is what reveals the art (23.2).
 * Tapping a ready-to-claim tile claims it directly from the grid (Requirement 20.3) and shows
 * `PinCelebrationModal`; tapping any other tile opens `PinDetailModal` as before. A grid tap, the
 * "Claim all" bulk action (Requirement 23.4), and arriving with `celebratePinIds` (a mutation's
 * `newlyAwardedPinIds`) all feed the same claim queue, so multiple ready-to-claim pins are claimed
 * and celebrated one after another — each shown with its position in the batch (Requirement
 * 23.5) and paced with a brief delay between them (Requirement 23.6) — without leaving the board
 * (Requirement 20.6).
 *
 * Ready-to-claim pins sort ahead of every other pin in the grid, and an Unlocked/Locked filter
 * combines with tier/track, so a User with several claimable pins never has to scroll to find
 * them (Requirement 22.1, 22.2). `isReadyToClaim` is exported so `useClaimablePinsBadge` — the
 * Profile-tab badge surfacing the same claimable count from anywhere in the App — shares this
 * exact predicate rather than a second, potentially drifting one (Requirement 22.3, 22.4).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  PINS,
  PIN_TIERS,
  PIN_TRACKS,
  type PinBoardDTO,
  type PinDTO,
  type PinTier,
  type PinTrack,
  type UserPinProgressDTO,
} from '@dwt/shared';

import type { ProfileStackParamList } from '../../navigation/ProfileStack';
import { ApiError, apiRequest } from '../../api/client';
import { PinView } from '../../components/pins/PinView';
import { TIER_COLOR, TIER_LABEL, TRACK_LABEL } from '../../components/pins/pinTierMeta';
import { theme } from '../../theme/theme';
import {
  Chip,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import PinDetailModal from './PinDetailModal';
import PinCelebrationModal, { type CelebrationPosition } from './PinCelebrationModal';

type Props = NativeStackScreenProps<ProfileStackParamList, 'PinBoard'>;

/** Board read query key (shared cache). */
export const pinBoardKey = ['me', 'pins'] as const;

/** Static catalog lookup + stable display order (by catalog index). */
const CATALOG: ReadonlyMap<string, PinDTO> = new Map(PINS.map((p) => [p.id, p]));
const ORDER: ReadonlyMap<string, number> = new Map(PINS.map((p, i) => [p.id, i]));

const NUM_COLUMNS = 3;

type TierFilter = PinTier | 'all';
type TrackFilter = PinTrack | 'all';

interface ClaimResponse {
  readonly pinId: string;
  readonly claimedAt: string;
}

type OwnershipFilter = 'all' | 'unlocked' | 'locked';

/** Delay between one queued celebration dismissing and the next claim firing (R23.6). */
const PACE_MS = 40;

/**
 * Awarded but not yet claimed (Requirement 20.2) — the tap target for claiming. Exported so
 * `useClaimablePinsBadge` (Requirement 22.3) shares this exact predicate rather than duplicating
 * it against a second, potentially drifting, definition.
 */
export function isReadyToClaim(p: UserPinProgressDTO): boolean {
  return p.unlocked && p.claimedAt === null;
}

/**
 * Sort ready-to-claim pins ahead of every other pin (Requirement 22.1, Property 16); within the
 * "ready" group and within the "not ready" group, catalog display order is preserved unchanged.
 */
function claimableFirstComparator(a: UserPinProgressDTO, b: UserPinProgressDTO): number {
  const aReady = isReadyToClaim(a) ? 0 : 1;
  const bReady = isReadyToClaim(b) ? 0 : 1;
  if (aReady !== bReady) return aReady - bReady;
  return (ORDER.get(a.pinId) ?? 0) - (ORDER.get(b.pinId) ?? 0);
}

export default function PinBoardScreen({ navigation, route }: Props): JSX.Element {
  const [tier, setTier] = useState<TierFilter>('all');
  const [track, setTrack] = useState<TrackFilter>('all');
  const [ownership, setOwnership] = useState<OwnershipFilter>('all');
  const [selected, setSelected] = useState<UserPinProgressDTO | null>(null);
  const queryClient = useQueryClient();

  const board = useQuery<PinBoardDTO, ApiError>({
    queryKey: pinBoardKey,
    queryFn: () => apiRequest<PinBoardDTO>('GET', '/me/pins'),
  });

  // -------------------------------------------------------------------------
  // Claim queue (Requirement 20.6, extended by R23.4-23.6): a grid tap on a
  // ready-to-claim pin, the "Claim all" bulk action, and arriving with
  // `celebratePinIds` all enqueue ids into the same queue. Each queued id is
  // claimed via the mutation (never just shown unclaimed — R20 makes
  // claiming, not awarding, the gate for the full celebration) and then its
  // celebration is shown; dismissing advances to the next queued id after a
  // brief pace delay (R23.6). `queueTotal` is captured once a batch begins
  // and does not shrink as the queue drains, so a "2 of 5" celebration stays
  // "of 5" throughout that batch (R23.5).
  // -------------------------------------------------------------------------
  const initialQueue = [...(route.params?.celebratePinIds ?? [])];
  const [queue, setQueue] = useState<string[]>(initialQueue);
  const [queueTotal, setQueueTotal] = useState<number>(initialQueue.length);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const [celebratingIndex, setCelebratingIndex] = useState<number>(0);
  const claimingRef = useRef(false);
  const pacingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True for a brief window after dismissing a celebration that still has more queued behind it
  // (Requirement 23.6) — blocks the drain effect from immediately firing the next claim.
  const [pacing, setPacing] = useState(false);

  const claimMutation = useMutation<ClaimResponse, ApiError, string>({
    mutationFn: (pinId) => apiRequest<ClaimResponse>('POST', `/me/pins/${pinId}/claim`),
    onSuccess: (result) => {
      // Optimistically reflect the claim in the cached board so the tile's
      // ready-to-claim state clears immediately, without a refetch.
      queryClient.setQueryData<PinBoardDTO | undefined>(pinBoardKey, (prev) =>
        prev
          ? {
              ...prev,
              pins: prev.pins.map((p) =>
                p.pinId === result.pinId ? { ...p, claimedAt: result.claimedAt } : p,
              ),
            }
          : prev,
      );
      // The claim landed — this is the celebratory moment (R20, R23.7): a
      // heavier impact immediately, then a success notification shortly
      // after, distinct from a single flat haptic.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }, 120);
    },
  });

  // Drain the queue: claim the head id, then celebrate it. One at a time,
  // paced so consecutive celebrations in a batch are visibly sequential.
  useEffect(() => {
    if (celebratingId !== null || queue.length === 0 || claimingRef.current || pacing) return;
    const nextId = queue[0]!;
    const nextIndex = queueTotal - queue.length + 1;
    claimingRef.current = true;
    claimMutation.mutate(nextId, {
      onSettled: () => {
        claimingRef.current = false;
        setCelebratingId(nextId);
        setCelebratingIndex(nextIndex);
        setQueue((q) => q.slice(1));
      },
    });
    // claimMutation is intentionally omitted: it is stable across renders and
    // including it would re-run this effect on every mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, celebratingId, queueTotal, pacing]);

  useEffect(() => {
    return () => {
      if (pacingRef.current) clearTimeout(pacingRef.current);
    };
  }, []);

  function enqueueClaim(pinId: string): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQueue((q) => {
      if (q.includes(pinId)) return q;
      const next = [...q, pinId];
      // Starting a fresh batch (queue was empty and nothing is celebrating):
      // this id's batch total is 1 unless more are added in the same tick.
      if (q.length === 0 && celebratingId === null) setQueueTotal(1);
      else setQueueTotal((t) => t + 1);
      return next;
    });
  }

  /** "Claim all" (Requirement 23.4): enqueue every ready-to-claim id as one batch. */
  function enqueueAll(pinIds: readonly string[]): void {
    if (pinIds.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQueue((q) => {
      const additions = pinIds.filter((id) => !q.includes(id));
      if (additions.length === 0) return q;
      setQueueTotal((t) => (q.length === 0 && celebratingId === null ? additions.length : t + additions.length));
      return [...q, ...additions];
    });
  }

  function dismissCelebration(): void {
    setCelebratingId(null);
    if (queue.length > 0) {
      // More celebrations are queued behind this one: pace the advance so
      // consecutive celebrations in a batch are visibly sequential (R23.6)
      // rather than the next one appearing the instant this one closes.
      setPacing(true);
      pacingRef.current = setTimeout(() => setPacing(false), PACE_MS);
    } else {
      // Batch finished — reset the total so the next fresh batch starts clean.
      setQueueTotal(0);
    }
  }

  function openDetailsFromCelebration(pinId: string): void {
    setCelebratingId(null);
    const progress = board.data?.pins.find((p) => p.pinId === pinId) ?? null;
    if (progress) setSelected(progress);
  }

  /**
   * "Skip all" (Requirement 23.8): dismiss the modal immediately, claim all remaining queued
   * pins in the background, and reflect them optimistically on the board.
   */
  function handleSkipAll(): void {
    const remaining = [...queue];
    if (pacingRef.current) clearTimeout(pacingRef.current);
    setPacing(false);
    setQueue([]);
    setQueueTotal(0);
    setCelebratingId(null);

    if (remaining.length === 0) return;

    // Optimistically reflect all remaining claims in the cached board so tiles clear immediately (Requirement 23.8)
    const now = new Date().toISOString();
    queryClient.setQueryData<PinBoardDTO | undefined>(pinBoardKey, (prev) =>
      prev
        ? {
            ...prev,
            pins: prev.pins.map((p) =>
              remaining.includes(p.pinId) ? { ...p, claimedAt: p.claimedAt ?? now } : p,
            ),
          }
        : prev,
    );

    // Celebratory haptic feedback for the bulk skip
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 120);

    // Fire claims in parallel on the server in the background
    void Promise.allSettled(
      remaining.map((pinId) => apiRequest<ClaimResponse>('POST', `/me/pins/${pinId}/claim`)),
    ).then((results) => {
      queryClient.setQueryData<PinBoardDTO | undefined>(pinBoardKey, (prev) => {
        if (!prev) return prev;
        const claimedMap = new Map<string, string>();
        for (const res of results) {
          if (res.status === 'fulfilled') {
            claimedMap.set(res.value.pinId, res.value.claimedAt);
          }
        }
        return {
          ...prev,
          pins: prev.pins.map((p) =>
            claimedMap.has(p.pinId) ? { ...p, claimedAt: claimedMap.get(p.pinId)! } : p,
          ),
        };
      });
    });
  }

  const tileSize = Math.floor(
    (Dimensions.get('window').width - theme.spacing.lg * 2 - theme.spacing.md * (NUM_COLUMNS - 1)) /
      NUM_COLUMNS,
  );

  const visible = useMemo(() => {
    const pins = board.data?.pins ?? [];
    return pins
      .filter((p) => {
        const meta = CATALOG.get(p.pinId);
        if (!meta) return false;
        if (tier !== 'all' && meta.tier !== tier) return false;
        if (track !== 'all' && meta.track !== track) return false;
        if (ownership === 'unlocked' && !p.unlocked) return false;
        if (ownership === 'locked' && p.unlocked) return false;
        return true;
      })
      .slice()
      .sort(claimableFirstComparator);
  }, [board.data, tier, track, ownership]);

  const summary = board.data;
  const selectedPin = selected ? CATALOG.get(selected.pinId) ?? null : null;

  /** Every pin currently ready to claim, in claimable-first catalog order (Requirement 23.4). */
  const readyIds = useMemo(
    () =>
      (board.data?.pins ?? [])
        .filter(isReadyToClaim)
        .slice()
        .sort((a, b) => (ORDER.get(a.pinId) ?? 0) - (ORDER.get(b.pinId) ?? 0))
        .map((p) => p.pinId),
    [board.data],
  );

  const celebrationPosition: CelebrationPosition | null =
    celebratingId !== null && queueTotal > 1 ? { index: celebratingIndex, total: queueTotal } : null;

  const header = (
    <View>
      {summary ? (
        <View style={styles.summary} testID="pin-board-summary">
          <Text style={styles.summaryPct} testID="pin-board-overall">
            {summary.overallPercent}%
          </Text>
          <Text style={styles.summaryCount}>
            {summary.totalUnlocked} of {summary.totalPins} pins collected
          </Text>
          {readyIds.length >= 2 ? (
            <View style={styles.claimAllWrap}>
              <SecondaryButton
                label={`Claim all (${readyIds.length})`}
                onPress={() => enqueueAll(readyIds)}
                testID="pin-board-claim-all"
              />
            </View>
          ) : null}
          <View style={styles.tierSummaryRow}>
            {summary.tierSummary.map((t) => (
              <View key={t.tier} style={styles.tierSummaryChip} testID={`tier-summary-${t.tier}`}>
                <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[t.tier] }]} />
                <Text style={styles.tierSummaryText}>
                  {t.unlocked}/{t.total}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <SectionLabel>Tier</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {(['all', ...PIN_TIERS] as TierFilter[]).map((item) => (
          <View key={item} style={styles.filterChip}>
            <Chip
              label={item === 'all' ? 'All' : TIER_LABEL[item]}
              active={tier === item}
              onPress={() => setTier(item)}
              testID={`tier-pill-${item}`}
            />
          </View>
        ))}
      </ScrollView>

      <SectionLabel>Track</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {(['all', ...PIN_TRACKS] as TrackFilter[]).map((item) => (
          <View key={item} style={styles.filterChip}>
            <Chip
              label={item === 'all' ? 'All' : TRACK_LABEL[item]}
              active={track === item}
              onPress={() => setTrack(item)}
              testID={`track-tab-${item}`}
            />
          </View>
        ))}
      </ScrollView>

      <SectionLabel>Ownership</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {(['all', 'unlocked', 'locked'] as OwnershipFilter[]).map((item) => (
          <View key={item} style={styles.filterChip}>
            <Chip
              label={item === 'all' ? 'All' : item === 'unlocked' ? 'Unlocked' : 'Locked'}
              active={ownership === item}
              onPress={() => setOwnership(item)}
              testID={`ownership-pill-${item}`}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <ScreenContainer>
      <GradientHeader
        title="Pin Collection"
        {...(summary ? { subtitle: `${summary.totalUnlocked}/${summary.totalPins} collected` } : {})}
        icon="ribbon"
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
            <SecondaryButton
              label="Showcase"
              icon="images-outline"
              onPress={() => navigation.navigate('PinShowcase')}
              testID="pin-board-showcase"
            />
            <SecondaryButton
              label="Credits"
              icon="information-circle-outline"
              onPress={() => navigation.navigate('PinAttribution')}
              testID="pin-board-credits"
            />
          </View>
        }
      />

      {board.isLoading ? (
        <View style={styles.center} testID="pin-board-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : board.isError ? (
        <View style={styles.center}>
          <EmptyState icon="alert-circle-outline" title="Couldn't load your pins" body="Pull to try again." />
        </View>
      ) : (
        <FlatList
          testID="pin-board"
          data={visible}
          key={NUM_COLUMNS}
          numColumns={NUM_COLUMNS}
          keyExtractor={(p) => p.pinId}
          ListHeaderComponent={header}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={
            <EmptyState icon="ribbon-outline" title="No pins here yet" body="Try a different tier or track." />
          }
          renderItem={({ item }) => {
            const meta = CATALOG.get(item.pinId);
            if (!meta) return null;
            const readyToClaim = isReadyToClaim(item);
            return (
              <PinCell
                item={item}
                meta={meta}
                size={tileSize}
                readyToClaim={readyToClaim}
                onTap={() => (readyToClaim ? enqueueClaim(item.pinId) : setSelected(item))}
              />
            );
          }}
        />
      )}

      <PinDetailModal
        visible={selected !== null}
        onClose={() => setSelected(null)}
        pin={selectedPin}
        progress={selected}
      />
      <PinCelebrationModal
        visible={celebratingId !== null}
        onClose={dismissCelebration}
        pinIds={celebratingId ? [celebratingId] : []}
        onViewDetails={openDetailsFromCelebration}
        position={celebrationPosition}
        onSkipAll={handleSkipAll}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Grid cell
// ---------------------------------------------------------------------------

interface PinCellProps {
  readonly item: UserPinProgressDTO;
  readonly meta: PinDTO;
  readonly size: number;
  readonly readyToClaim: boolean;
  readonly onTap: () => void;
}

/**
 * One grid tile. A ready-to-claim pin (Requirement 20.7) renders through the
 * SAME locked/dimmed treatment as a truly locked pin (Requirement 23.1) —
 * distinguished only by the "tap to claim" badge and glowing ring — so
 * claiming it is the moment its art is actually revealed (23.2) rather than
 * a redundant confirmation of art already visible on the board. Tapping one
 * plays a quick scale-pop before the claim fires, and once the claim
 * resolves (readyToClaim flips to false) the art cross-fades from its
 * locked to its unlocked rendering.
 */
function PinCell({ item, meta, size, readyToClaim, onTap }: PinCellProps): JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;

  // A pin renders unlocked art only once it is both earned AND claimed (Requirement 23.1);
  // ready-to-claim pins render through PinView's locked branch until the claim resolves.
  const cellUnlocked = item.unlocked && !readyToClaim;

  // Cross-fade the locked -> unlocked transition (Requirement 23.2): render both the locked and
  // unlocked art stacked, fading the locked one out as the unlocked one fades in, rather than an
  // instant prop swap. `crossfading` stays true only for the duration of the transition so a
  // steady-state cell (never transitions) renders a single PinView, matching today's structure.
  const unlockedOpacity = useRef(new Animated.Value(cellUnlocked ? 1 : 0)).current;
  const wasUnlocked = useRef(cellUnlocked);
  const [crossfading, setCrossfading] = useState(false);

  useEffect(() => {
    if (cellUnlocked !== wasUnlocked.current) {
      wasUnlocked.current = cellUnlocked;
      setCrossfading(true);
      Animated.timing(unlockedOpacity, {
        toValue: cellUnlocked ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => setCrossfading(false));
    }
  }, [cellUnlocked, unlockedOpacity]);

  function handlePress(): void {
    if (readyToClaim) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.18, duration: 90, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
      ]).start();
    }
    onTap();
  }

  const accessibilityLabel = `${meta.name}, ${TIER_LABEL[meta.tier]}${
    cellUnlocked ? '' : readyToClaim ? ', ready to claim' : ', locked'
  }`;

  return (
    <View style={styles.cell}>
      <Animated.View style={readyToClaim ? [styles.readyRing, { transform: [{ scale }] }] : undefined}>
        {crossfading ? (
          <Pressable
            style={{ width: size, height: size }}
            onPress={handlePress}
            testID={`pin-cell-${item.pinId}`}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
          >
            <Animated.View
              style={[styles.crossfadeLayer, { opacity: Animated.subtract(1, unlockedOpacity) }]}
            >
              <PinView pinId={item.pinId} tier={meta.tier} unlocked={false} size={size} motion={false} />
            </Animated.View>
            <Animated.View style={[styles.crossfadeLayer, { opacity: unlockedOpacity }]}>
              <PinView pinId={item.pinId} tier={meta.tier} unlocked size={size} motion={false} />
            </Animated.View>
          </Pressable>
        ) : (
          <PinView
            pinId={item.pinId}
            tier={meta.tier}
            unlocked={cellUnlocked}
            size={size}
            motion={false}
            onPress={handlePress}
            testID={`pin-cell-${item.pinId}`}
            accessibilityLabel={accessibilityLabel}
          />
        )}
      </Animated.View>
      {readyToClaim ? (
        <View style={styles.readyBadge} testID={`pin-cell-ready-${item.pinId}`}>
          <Text style={styles.readyBadgeText}>Tap to claim</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  summary: { alignItems: 'center', paddingVertical: theme.spacing.lg },
  summaryPct: { ...theme.typography.display, color: theme.color.primary },
  summaryCount: { ...theme.typography.subtitle, color: theme.color.textSecondary, marginTop: theme.spacing.xs },
  tierSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: theme.spacing.md,
  },
  tierSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs,
  },
  tierDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
  tierSummaryText: { ...theme.typography.meta, color: theme.color.textSecondary },
  claimAllWrap: { marginTop: theme.spacing.md },
  crossfadeLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  filterRow: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  filterChip: { marginRight: theme.spacing.sm },
  grid: { padding: theme.spacing.lg },
  gridRow: { justifyContent: 'space-between', marginBottom: theme.spacing.md },
  cell: { alignItems: 'center' },
  readyRing: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: theme.color.primary,
    shadowColor: theme.color.primary,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  readyBadge: {
    marginTop: theme.spacing.xs,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  readyBadgeText: {
    ...theme.typography.meta,
    color: '#fff',
    fontWeight: '700',
  },
});
