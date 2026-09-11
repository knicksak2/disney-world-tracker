/**
 * PinShowcaseScreen — Freeform display board for favorite collectible pins
 * (pin-collection Requirement 24, Task 16.8).
 *
 * Renders a physical-feeling cork board with a wood-frame border where users
 * arrange their favorite claimed pins. Pins can be freely dragged and positioned
 * (persisted as 0.0-1.0 fractions). Non-overlap is enforced client-side via
 * instant spring snap-back, and server-side in `placePin`.
 *
 * In Owner mode:
 *   - Live drag-and-drop via React Native's built-in Animated & PanResponder.
 *   - Overlap check with `overlapsAnyOtherPin` against other placed pins.
 *   - Unplaced pins tray along the bottom for claimed but unplaced pins.
 *   - Remove affordance returning pins to tray via DELETE /me/pin-showcase/:pinId.
 *   - Capacity indicator (X/24).
 *   - "Share my Showcase" entry point opening ShareComposer with { kind: 'pinShowcase' }.
 *
 * In Friend / readOnly mode:
 *   - Identical cork-board layout with static non-interactive Views (no PanResponder, no tray).
 *   - Zero-placements friend empty state (Requirement 24.9).
 *   - profile_forbidden deny handling ("Profile unavailable").
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ImageBackground,
  ImageSourcePropType,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PINS,
  SHOWCASE_MAX_PINS,
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_PIN_SIZE,
  SHOWCASE_REFERENCE_SIZE,
  overlapsAnyOtherPin,
  type PinDTO,
  type PinShowcaseDTO,
  type PinShowcasePlacementDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { PinView } from '../../components/pins/PinView';
import { theme } from '../../theme/theme';
import {
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corkTexture: ImageSourcePropType = require('../../../assets/cork.png');

/** Static catalog lookup. */
const CATALOG: ReadonlyMap<string, PinDTO> = new Map(PINS.map((p) => [p.id, p]));

export interface PinShowcaseScreenProps {
  readonly navigation?: any;
  readonly route?: {
    readonly params?: {
      readonly userId?: string | undefined;
      readonly readOnly?: boolean | undefined;
    };
  } | undefined;
  readonly userId?: string | undefined;
  readonly readOnly?: boolean | undefined;
}

/** True when the query failed with the owner-or-friend `profile_forbidden` denial. */
function isForbidden(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.code === 'profile_forbidden') ||
    (typeof error === 'object' && error !== null && (error as any).code === 'profile_forbidden')
  );
}

// ---------------------------------------------------------------------------
// Placed Pin Component (Owner Mode - Draggable / Friend Mode - Static)
// ---------------------------------------------------------------------------

interface PlacedPinItemProps {
  readonly placement: PinShowcasePlacementDTO;
  readonly allPlacements: readonly PinShowcasePlacementDTO[];
  readonly boardSize: { readonly width: number; readonly height: number };
  readonly boardOffset: { readonly x: number; readonly y: number };
  readonly isReadOnly: boolean;
  readonly onMove: (pinId: string, posX: number, posY: number) => void;
  readonly onRemove: (pinId: string) => void;
}

function PlacedPinItem({
  placement,
  allPlacements,
  boardSize,
  boardOffset,
  isReadOnly,
  onMove,
  onRemove,
}: PlacedPinItemProps): React.ReactElement {
  const pan = useRef(new Animated.ValueXY()).current;
  const [isDragging, setIsDragging] = useState(false);
  const pin = CATALOG.get(placement.pinId);

  const baseX = placement.posX * boardSize.width;
  const baseY = placement.posY * boardSize.height;

  const stateRef = useRef({
    baseX,
    baseY,
    placement,
    allPlacements,
    boardSize,
    boardOffset,
    isReadOnly,
    onMove,
  });
  stateRef.current = {
    baseX,
    baseY,
    placement,
    allPlacements,
    boardSize,
    boardOffset,
    isReadOnly,
    onMove,
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !stateRef.current.isReadOnly,
      onMoveShouldSetPanResponder: () => !stateRef.current.isReadOnly,
      onPanResponderGrant: () => {
        setIsDragging(true);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, gestureState) => {
        setIsDragging(false);
        const {
          baseX: currentBaseX,
          baseY: currentBaseY,
          placement: currentPlacement,
          allPlacements: currentAllPlacements,
          boardSize: currentBoardSize,
          isReadOnly: currentReadOnly,
          onMove: currentOnMove,
        } = stateRef.current;

        if (currentReadOnly) return;

        // If tap without significant drag, keep pin in place
        if (Math.abs(gestureState.dx) < 2 && Math.abs(gestureState.dy) < 2) {
          pan.setValue({ x: 0, y: 0 });
          return;
        }

        // Compute candidate center in board px from current live baseX/baseY
        const finalCenterX = currentBaseX + gestureState.dx;
        const finalCenterY = currentBaseY + gestureState.dy;

        // Convert to reference space for exact clearance test
        const candRef = {
          pinId: currentPlacement.pinId,
          x: (finalCenterX / currentBoardSize.width) * SHOWCASE_REFERENCE_SIZE.width,
          y: (finalCenterY / currentBoardSize.height) * SHOWCASE_REFERENCE_SIZE.height,
        };
        const othersRef = currentAllPlacements
          .filter((o) => o.pinId !== currentPlacement.pinId)
          .map((o) => ({
            pinId: o.pinId,
            x: o.posX * SHOWCASE_REFERENCE_SIZE.width,
            y: o.posY * SHOWCASE_REFERENCE_SIZE.height,
          }));

        const hasOverlap = overlapsAnyOtherPin(candRef, othersRef, SHOWCASE_MIN_PIN_CLEARANCE);

        if (hasOverlap) {
          // Snap back with spring animation without firing PUT
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        } else {
          const newPosX = Math.max(0, Math.min(1, finalCenterX / currentBoardSize.width));
          const newPosY = Math.max(0, Math.min(1, finalCenterY / currentBoardSize.height));
          pan.setValue({ x: 0, y: 0 });
          currentOnMove(currentPlacement.pinId, newPosX, newPosY);
        }
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  const left = Math.max(
    0,
    Math.min(boardSize.width - SHOWCASE_PIN_SIZE, baseX - SHOWCASE_PIN_SIZE / 2),
  );
  const top = Math.max(
    0,
    Math.min(boardSize.height - SHOWCASE_PIN_SIZE, baseY - SHOWCASE_PIN_SIZE / 2),
  );

  if (isReadOnly) {
    return (
      <View
        testID={`pin-showcase-placed-${placement.pinId}`}
        style={[
          styles.placedPin,
          {
            left,
            top,
            zIndex: placement.zIndex,
          },
        ]}
      >
        <View style={styles.shadowWrapper}>
          <PinView
            pinId={placement.pinId}
            tier={pin?.tier ?? 'bronze'}
            unlocked={true}
            size={SHOWCASE_PIN_SIZE}
          />
        </View>
      </View>
    );
  }

  return (
    <Animated.View
      testID={`pin-showcase-placed-${placement.pinId}`}
      {...panResponder.panHandlers}
      style={[
        styles.placedPin,
        {
          left,
          top,
          zIndex: isDragging ? 1000 : placement.zIndex,
          elevation: isDragging ? 1000 : placement.zIndex,
          transform: pan.getTranslateTransform(),
        },
      ]}
    >
      <View style={styles.shadowWrapper}>
        <PinView
          pinId={placement.pinId}
          tier={pin?.tier ?? 'bronze'}
          unlocked={true}
          size={SHOWCASE_PIN_SIZE}
        />
      </View>
      <Pressable
        testID={`pin-showcase-remove-${placement.pinId}`}
        onPress={() => onRemove(placement.pinId)}
        style={styles.removeBadge}
        accessibilityRole="button"
        accessibilityLabel={`Remove pin ${pin?.name ?? placement.pinId}`}
        hitSlop={8}
      >
        <Ionicons name="close-circle" size={22} color={theme.color.danger} />
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Tray Pin Component (Unplaced Claimed Pins)
// ---------------------------------------------------------------------------

interface TrayPinItemProps {
  readonly pinId: string;
  readonly allPlacements: readonly PinShowcasePlacementDTO[];
  readonly boardSize: { readonly width: number; readonly height: number };
  readonly boardOffset: { readonly x: number; readonly y: number };
  readonly containerOffset: { readonly x: number; readonly y: number };
  readonly onPlace: (pinId: string, posX: number, posY: number) => void;
  readonly onDragStart: (dragState: {
    pinId: string;
    pan: Animated.ValueXY;
    startX: number;
    startY: number;
  }) => void;
  readonly onDragEnd: () => void;
  readonly isDragging: boolean;
}

function TrayPinItem({
  pinId,
  allPlacements,
  boardSize,
  boardOffset,
  containerOffset,
  onPlace,
  onDragStart,
  onDragEnd,
  isDragging,
}: TrayPinItemProps): React.ReactElement {
  const pan = useRef(new Animated.ValueXY()).current;
  const pin = CATALOG.get(pinId);

  const stateRef = useRef({
    pinId,
    allPlacements,
    boardSize,
    boardOffset,
    containerOffset,
    onPlace,
    onDragStart,
    onDragEnd,
  });
  stateRef.current = {
    pinId,
    allPlacements,
    boardSize,
    boardOffset,
    containerOffset,
    onPlace,
    onDragStart,
    onDragEnd,
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        pan.setValue({ x: 0, y: 0 });

        const touchX =
          gestureState.x0 ||
          evt.nativeEvent?.touches?.[0]?.pageX ||
          evt.nativeEvent?.changedTouches?.[0]?.pageX ||
          evt.nativeEvent?.pageX ||
          0;

        const touchY =
          gestureState.y0 ||
          evt.nativeEvent?.touches?.[0]?.pageY ||
          evt.nativeEvent?.changedTouches?.[0]?.pageY ||
          evt.nativeEvent?.pageY ||
          0;

        const startX = touchX - stateRef.current.containerOffset.x - SHOWCASE_PIN_SIZE / 2;
        const startY = touchY - stateRef.current.containerOffset.y - SHOWCASE_PIN_SIZE / 2;

        stateRef.current.onDragStart({
          pinId: stateRef.current.pinId,
          pan,
          startX,
          startY,
        });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, gestureState) => {
        const {
          pinId: currentPinId,
          allPlacements: currentAllPlacements,
          boardSize: currentBoardSize,
          boardOffset: currentBoardOffset,
          onPlace: currentOnPlace,
          onDragEnd: currentOnDragEnd,
        } = stateRef.current;

        let dropX = currentBoardSize.width / 2;
        let dropY = currentBoardSize.height / 2;

        if (gestureState.moveX !== undefined && gestureState.moveX > 0) {
          dropX = gestureState.moveX - currentBoardOffset.x;
          dropY = gestureState.moveY - currentBoardOffset.y;
        } else if (gestureState.dx !== 0 || gestureState.dy !== 0) {
          dropX = currentBoardSize.width / 2 + gestureState.dx;
          dropY = currentBoardSize.height / 2 + gestureState.dy;
        }

        // Check clearance in reference space
        const candRef = {
          pinId: currentPinId,
          x: (dropX / currentBoardSize.width) * SHOWCASE_REFERENCE_SIZE.width,
          y: (dropY / currentBoardSize.height) * SHOWCASE_REFERENCE_SIZE.height,
        };
        const existingRef = currentAllPlacements.map((o) => ({
          pinId: o.pinId,
          x: o.posX * SHOWCASE_REFERENCE_SIZE.width,
          y: o.posY * SHOWCASE_REFERENCE_SIZE.height,
        }));

        const hasOverlap = overlapsAnyOtherPin(candRef, existingRef, SHOWCASE_MIN_PIN_CLEARANCE);

        if (hasOverlap) {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start(() => {
            currentOnDragEnd();
          });
        } else {
          const newPosX = Math.max(0, Math.min(1, dropX / currentBoardSize.width));
          const newPosY = Math.max(0, Math.min(1, dropY / currentBoardSize.height));
          pan.setValue({ x: 0, y: 0 });
          currentOnDragEnd();
          currentOnPlace(currentPinId, newPosX, newPosY);
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start(() => {
          stateRef.current.onDragEnd();
        });
      },
    }),
  ).current;

  return (
    <View
      testID={`pin-showcase-tray-pin-${pinId}`}
      {...panResponder.panHandlers}
      style={[
        styles.trayPinItem,
        isDragging && styles.trayPinDragging,
      ]}
    >
      <PinView pinId={pinId} tier={pin?.tier ?? 'bronze'} unlocked={true} size={56} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen Component
// ---------------------------------------------------------------------------

export default function PinShowcaseScreen(props: PinShowcaseScreenProps): React.ReactElement {
  let hookNav: ReturnType<typeof useNavigation> | null = null;
  try {
    hookNav = useNavigation();
  } catch {
    hookNav = null;
  }
  const nav = props.navigation ?? hookNav;
  let routeParams: { readonly userId?: string; readonly readOnly?: boolean } | undefined;
  try {
    const route = useRoute<any>();
    routeParams = route.params;
  } catch {
    routeParams = undefined;
  }

  const isReadOnly = Boolean(props.readOnly ?? routeParams?.readOnly);
  const targetUserId = props.userId ?? routeParams?.userId;

  const queryClient = useQueryClient();
  const containerRef = useRef<View>(null);
  const boardRef = useRef<View>(null);

  // Board layout state
  const [boardSize, setBoardSize] = useState<{ width: number; height: number }>({
    width: SHOWCASE_REFERENCE_SIZE.width,
    height: SHOWCASE_REFERENCE_SIZE.height,
  });
  const [boardOffset, setBoardOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [containerOffset, setContainerOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Floating drag overlay state for tray pins
  const [draggingTrayPin, setDraggingTrayPin] = useState<{
    pinId: string;
    pan: Animated.ValueXY;
    startX: number;
    startY: number;
  } | null>(null);

  const handleDragStart = useCallback(
    (dragState: {
      pinId: string;
      pan: Animated.ValueXY;
      startX: number;
      startY: number;
    }) => {
      setDraggingTrayPin(dragState);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingTrayPin(null);
  }, []);

  const onContainerLayout = useCallback(() => {
    const el = containerRef.current as any;
    if (typeof el?.measureInWindow === 'function') {
      el.measureInWindow((pageX: number, pageY: number) => {
        if (pageX !== undefined && pageY !== undefined) {
          setContainerOffset({ x: pageX, y: pageY });
        }
      });
    }
  }, []);

  const onBoardLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setBoardSize({ width, height });
    }
    const el = boardRef.current as any;
    if (typeof el?.measureInWindow === 'function') {
      el.measureInWindow((pageX: number, pageY: number) => {
        if (pageX !== undefined && pageY !== undefined) {
          setBoardOffset({ x: pageX, y: pageY });
        }
      });
    } else if (typeof el?.measure === 'function') {
      el.measure((_x: number, _y: number, _w: number, _h: number, pageX: number, pageY: number) => {
        if (pageX !== undefined && pageY !== undefined) {
          setBoardOffset({ x: pageX, y: pageY });
        }
      });
    }
  }, []);

  // Query showcase data
  const showcaseKey = useMemo(
    () => (isReadOnly && targetUserId ? ['users', targetUserId, 'pin-showcase'] : ['me', 'pin-showcase']),
    [isReadOnly, targetUserId],
  );

  const showcaseQuery = useQuery<PinShowcaseDTO, ApiError>({
    queryKey: showcaseKey,
    queryFn: () =>
      isReadOnly && targetUserId
        ? apiRequest<PinShowcaseDTO>('GET', `/users/${targetUserId}/pin-showcase`)
        : apiRequest<PinShowcaseDTO>('GET', '/me/pin-showcase'),
  });

  // Mutations with optimistic updates for instant, smooth drag-and-drop feedback
  const placePinMutation = useMutation<
    PinShowcasePlacementDTO,
    ApiError,
    { pinId: string; posX: number; posY: number },
    { previous: PinShowcaseDTO | undefined }
  >({
    mutationFn: ({ pinId, posX, posY }) =>
      apiRequest<PinShowcasePlacementDTO>('PUT', `/me/pin-showcase/${pinId}`, { posX, posY }),
    onMutate: async ({ pinId, posX, posY }) => {
      await queryClient.cancelQueries({ queryKey: ['me', 'pin-showcase'] });
      const previous = queryClient.getQueryData<PinShowcaseDTO>(['me', 'pin-showcase']);
      if (previous) {
        const existing = previous.placements.find((p) => p.pinId === pinId);
        const maxZ = previous.placements.reduce((max, p) => Math.max(max, p.zIndex), -1);
        const nextZ = existing ? existing.zIndex : maxZ + 1;
        const updatedPlacements = existing
          ? previous.placements.map((p) =>
              p.pinId === pinId ? { ...p, posX, posY } : p,
            )
          : [
              ...previous.placements,
              { pinId, posX, posY, zIndex: nextZ },
            ];
        queryClient.setQueryData<PinShowcaseDTO>(['me', 'pin-showcase'], {
          ownerId: previous.ownerId,
          placements: updatedPlacements,
          ...(previous.unplaced
            ? { unplaced: previous.unplaced.filter((id) => id !== pinId) }
            : {}),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['me', 'pin-showcase'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'pin-showcase'] });
    },
  });

  const removePinMutation = useMutation<
    { ok: boolean },
    ApiError,
    string,
    { previous: PinShowcaseDTO | undefined }
  >({
    mutationFn: (pinId) => apiRequest<{ ok: boolean }>('DELETE', `/me/pin-showcase/${pinId}`),
    onMutate: async (pinId) => {
      await queryClient.cancelQueries({ queryKey: ['me', 'pin-showcase'] });
      const previous = queryClient.getQueryData<PinShowcaseDTO>(['me', 'pin-showcase']);
      if (previous) {
        queryClient.setQueryData<PinShowcaseDTO>(['me', 'pin-showcase'], {
          ownerId: previous.ownerId,
          placements: previous.placements.filter((p) => p.pinId !== pinId),
          ...(previous.unplaced
            ? { unplaced: [...previous.unplaced, pinId] }
            : {}),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['me', 'pin-showcase'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'pin-showcase'] });
    },
  });

  const handleMovePin = useCallback(
    (pinId: string, posX: number, posY: number) => {
      placePinMutation.mutate({ pinId, posX, posY });
    },
    [placePinMutation],
  );

  const handleRemovePin = useCallback(
    (pinId: string) => {
      removePinMutation.mutate(pinId);
    },
    [removePinMutation],
  );

  const handlePlaceTrayPin = useCallback(
    (pinId: string, posX: number, posY: number) => {
      placePinMutation.mutate({ pinId, posX, posY });
    },
    [placePinMutation],
  );

  const handleShare = useCallback(() => {
    (nav as any)?.navigate?.('ShareComposer', { kind: 'pinShowcase' });
  }, [nav]);

  const placements = showcaseQuery.data?.placements ?? [];
  const unplaced = showcaseQuery.data?.unplaced ?? [];

  const headerNavProps = nav ? { onBack: () => (nav as any).goBack() } : {};
  const headerActionProps = !isReadOnly
    ? {
        right: (
          <View style={styles.headerControls}>
            <Text testID="pin-showcase-capacity" style={styles.capacityText}>
              {placements.length}/{SHOWCASE_MAX_PINS}
            </Text>
            <Pressable
              testID="pin-showcase-share-button"
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share my Showcase"
              style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
            >
              <Ionicons name="share-social" size={18} color={theme.color.textOnPrimary} />
              <Text style={styles.shareBtnText}>Share</Text>
            </Pressable>
          </View>
        ),
      }
    : {};

  // Deny state (Friend viewing non-friend profile)
  if (isForbidden(showcaseQuery.error)) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Pin Showcase"
          icon="shield-outline"
          compact
          {...headerNavProps}
        />
        <View style={styles.center} testID="pin-showcase-unavailable">
          <EmptyState
            icon="lock-closed-outline"
            title="Profile unavailable"
            body="This friend’s profile is no longer available to view."
          />
        </View>
      </ScreenContainer>
    );
  }

  // Generic Error State
  if (showcaseQuery.isError) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Pin Showcase"
          icon="shield-outline"
          compact
          {...headerNavProps}
        />
        <View style={styles.center} testID="pin-showcase-error">
          <EmptyState
            icon="alert-circle-outline"
            title="Unable to load showcase"
            body="We couldn’t load this pin showcase. Please try again."
          />
        </View>
      </ScreenContainer>
    );
  }

  // Loading State
  if (showcaseQuery.isPending) {
    return (
      <ScreenContainer>
        <GradientHeader
          title={isReadOnly ? 'Pin Showcase' : 'My Showcase'}
          icon="shield-outline"
          compact
          {...headerNavProps}
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.color.accent} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View
        ref={containerRef}
        onLayout={onContainerLayout}
        style={styles.rootContainer}
        collapsable={false}
      >
        <GradientHeader
          title={isReadOnly ? 'Pin Showcase' : 'My Showcase'}
          icon="shield-outline"
          compact
          {...headerNavProps}
          {...headerActionProps}
        />

        {isReadOnly && placements.length === 0 ? (
          <View style={styles.center} testID="pin-showcase-friend-empty">
            <EmptyState
              icon="images-outline"
              title="No pins on display"
              body="This friend hasn’t placed any pins yet."
            />
          </View>
        ) : (
          <View style={styles.boardOuter}>
            <View style={styles.boardFrame} ref={boardRef} onLayout={onBoardLayout}>
              <ImageBackground
                source={corkTexture}
                resizeMode="repeat"
                style={styles.corkBoard}
                testID="pin-showcase-board"
              >
                {placements.map((p) => (
                  <PlacedPinItem
                    key={p.pinId}
                    placement={p}
                    allPlacements={placements}
                    boardSize={boardSize}
                    boardOffset={boardOffset}
                    isReadOnly={isReadOnly}
                    onMove={handleMovePin}
                    onRemove={handleRemovePin}
                  />
                ))}
              </ImageBackground>
            </View>
          </View>
        )}

        {/* Unplaced Pins Tray (Owner mode only) */}
        {!isReadOnly && (
          <View style={styles.trayContainer} testID="pin-showcase-tray">
            <View style={styles.trayHeader}>
              <Text style={styles.trayTitle}>Unplaced Pins</Text>
              <Text style={styles.trayCount}>{unplaced.length} available</Text>
            </View>
            {unplaced.length === 0 ? (
              <Text style={styles.trayEmptyText}>All claimed pins are currently on your board.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.trayScrollContent}
              >
                {unplaced.map((pinId) => (
                  <TrayPinItem
                    key={pinId}
                    pinId={pinId}
                    allPlacements={placements}
                    boardSize={boardSize}
                    boardOffset={boardOffset}
                    containerOffset={containerOffset}
                    onPlace={handlePlaceTrayPin}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    isDragging={draggingTrayPin?.pinId === pinId}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Floating drag overlay: renders above board and tray when dragging a new pin */}
        {draggingTrayPin && (
          <Animated.View
            testID="pin-showcase-dragging-overlay"
            pointerEvents="none"
            style={[
              styles.dragOverlay,
              {
                left: draggingTrayPin.startX,
                top: draggingTrayPin.startY,
                transform: draggingTrayPin.pan.getTranslateTransform(),
              },
            ]}
          >
            <View style={styles.shadowWrapper}>
              <PinView
                pinId={draggingTrayPin.pinId}
                tier={CATALOG.get(draggingTrayPin.pinId)?.tier ?? 'bronze'}
                unlocked={true}
                size={SHOWCASE_PIN_SIZE}
              />
            </View>
          </Animated.View>
        )}
      </View>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    position: 'relative',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  capacityText: {
    ...theme.typography.meta,
    color: theme.color.textOnPrimary,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  shareBtnPressed: {
    opacity: 0.7,
  },
  shareBtnText: {
    ...theme.typography.meta,
    color: theme.color.textOnPrimary,
    fontWeight: '600',
  },
  boardOuter: {
    flex: 1,
    padding: theme.spacing.md,
  },
  boardFrame: {
    flex: 1,
    borderWidth: 8,
    borderColor: '#5D3A1A',
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    backgroundColor: '#c49a6c',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  corkBoard: {
    flex: 1,
    position: 'relative',
  },
  placedPin: {
    position: 'absolute',
    width: SHOWCASE_PIN_SIZE,
    height: SHOWCASE_PIN_SIZE,
  },
  shadowWrapper: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 5,
    elevation: 6,
  },
  dragOverlay: {
    position: 'absolute',
    width: SHOWCASE_PIN_SIZE,
    height: SHOWCASE_PIN_SIZE,
    zIndex: 99999,
    elevation: 99999,
  },
  removeBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ffffff',
    borderRadius: 12,
  },
  trayContainer: {
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  trayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  trayTitle: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '700',
  },
  trayCount: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  trayEmptyText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    paddingVertical: theme.spacing.sm,
    fontStyle: 'italic',
  },
  trayScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.md,
  },
  trayPinItem: {
    width: 56,
    height: 56,
  },
  trayPinDragging: {
    opacity: 0.25,
  },
});
