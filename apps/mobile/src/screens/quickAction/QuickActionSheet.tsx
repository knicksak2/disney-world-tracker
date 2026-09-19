/**
 * QuickActionSheet modal bottom sheet.
 * (Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, design.md Section 4)
 *
 * Renders the quick actions list via buildQuickActions(claimablePinCount).
 * Dispatches navigation / modal flows on action select and dismisses.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { PinBoardDTO, PlannedItemDTO, TripDTO, TripStatus } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { useClaimablePinsBadge } from '../../components/pins/useClaimablePinsBadge';
import { isReadyToClaim, pinBoardKey } from '../profile/PinBoardScreen';
import { tripsListKeys } from '../trips/TripsListScreen';
import { tripPlannedListKeys } from '../trips/TripPlannedListScreen';
import { getTodayWDW } from '../trips/TripScheduleScreen';
import { deriveTodaysPark } from '../home/deriveTodaysPark';
import { useLiveWaitsStore } from '../../state/liveWaitsStore';
import { resolveDefaultLiveWaitsPark } from '../liveWaits/defaultPark';
import {
  navigateToLiveWaits,
  navigateToPinBoard,
  navigateToTripSchedule,
  navigateToTripsList,
} from '../../navigation/navigationRef';
import { buildQuickActions, type QuickAction } from './quickActions';
import { theme } from '../../theme/theme';

type TripsListResponse = readonly { status: TripStatus; trips: readonly TripDTO[] }[];

export interface QuickActionSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onOpenExperiencePicker?: (tab: 'rides' | 'dining') => void;
}

export function QuickActionSheet({
  visible,
  onClose,
  onOpenExperiencePicker,
}: QuickActionSheetProps): JSX.Element | null {
  const { count: claimableCount } = useClaimablePinsBadge();
  const lastViewedPark = useLiveWaitsStore((state) => state.lastViewedPark);

  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    enabled: visible,
  });

  const pinBoardQuery = useQuery<PinBoardDTO, ApiError>({
    queryKey: pinBoardKey,
    queryFn: () => apiRequest<PinBoardDTO>('GET', '/me/pins'),
    enabled: visible && claimableCount > 0,
  });

  const activeGroup = tripsQuery.data?.find((g) => g.status === 'active');
  const activeTrip = activeGroup?.trips?.[0];

  const activePlannedItemsQuery = useQuery<readonly PlannedItemDTO[]>({
    queryKey: tripPlannedListKeys.items(activeTrip?.id ?? ''),
    queryFn: () =>
      apiRequest<readonly PlannedItemDTO[]>(
        'GET',
        `/trips/${encodeURIComponent(activeTrip?.id ?? '')}/planned-items`,
      ),
    enabled: visible && Boolean(activeTrip?.id),
    staleTime: 60 * 1000,
  });

  const todayStr = getTodayWDW();
  const activeTripPark = activeTrip
    ? deriveTodaysPark({
        activeTrip,
        plannedItems: activePlannedItemsQuery.data,
        todayStr,
      })
    : null;

  const claimablePinIds = (pinBoardQuery.data?.pins ?? [])
    .filter(isReadyToClaim)
    .map((p) => p.pinId);

  const actions = buildQuickActions(claimableCount);

  const handleActionPress = (action: QuickAction) => {
    onClose();

    switch (action.key) {
      case 'liveWaits': {
        const targetPark = resolveDefaultLiveWaitsPark(activeTripPark, lastViewedPark);
        navigateToLiveWaits(targetPark);
        break;
      }
      case 'logRide': {
        onOpenExperiencePicker?.('rides');
        break;
      }
      case 'logSnack': {
        onOpenExperiencePicker?.('dining');
        break;
      }
      case 'claimPins': {
        navigateToPinBoard(claimablePinIds);
        break;
      }
      case 'todaySchedule': {
        if (activeTrip) {
          navigateToTripSchedule({ tripId: activeTrip.id });
        } else {
          navigateToTripsList();
        }
        break;
      }
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="quick-action-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="quick-action-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.dragHandle} />
          <View style={styles.header}>
            <Text style={styles.title}>Quick Actions</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="quick-action-close-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.actionList}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && styles.actionItemPressed,
                ]}
                onPress={() => handleActionPress(action)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                testID={`quick-action-${action.key}`}
              >
                <View style={styles.iconCircle}>
                  <Ionicons name={action.icon} size={22} color={theme.color.primary} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.color.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  actionList: {
    gap: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  actionItemPressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.color.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
});

export default QuickActionSheet;
