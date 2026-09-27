// Feature: experience-detail-redesign, Task 18.2 — DiningReservationCard
//
// Validates: Requirements 14.1
//
// Today_In_Park_Lens card for Restaurant experiences, showing reservation availability
// and the existing Reservation_Action.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LiveDetailDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { formatParkTime } from './live/parkTime';

export interface DiningReservationCardProps {
  readonly experienceName: string;
  readonly diningUrl?: string | null | undefined;
  readonly liveDetail?: LiveDetailDTO | undefined;
  readonly isQuickService?: boolean | undefined;
  readonly onReserve: (url: string) => void;
  readonly reservationFailed?: boolean | undefined;
  readonly onLogFoodItem?: (() => void) | undefined;
  readonly onMyLoggedItems?: (() => void) | undefined;
  readonly loggedDishesCount?: number | undefined;
}

export default function DiningReservationCard({
  experienceName,
  diningUrl,
  liveDetail,
  isQuickService,
  onReserve,
  reservationFailed,
  onLogFoodItem,
  onMyLoggedItems,
  loggedDishesCount,
}: DiningReservationCardProps): JSX.Element {
  const hasDiningUrl =
    typeof diningUrl === 'string' && diningUrl.trim().length > 0 && !isQuickService;

  let availabilityText = isQuickService
    ? 'Counter Service & Mobile Order'
    : 'Reservations Available';
  let waitInfo: string | null = null;

  if (liveDetail?.diningAvailability && liveDetail.diningAvailability.length > 0) {
    const first = liveDetail.diningAvailability[0];
    if (first?.status) {
      availabilityText = first.status;
    }
    if (first?.estimatedWaitMinutes !== undefined) {
      waitInfo = `~${first.estimatedWaitMinutes} min walk-up wait`;
    }
  } else if (liveDetail?.operatingHours && liveDetail.operatingHours.length > 0) {
    const firstHour = liveDetail.operatingHours[0];
    if (firstHour) {
      waitInfo = `Opens ${formatParkTime(firstHour.open)}`;
    }
  }

  const isClosed = liveDetail?.status === 'Closed';
  const statusLabel = isClosed ? 'Closed' : 'Open Today';

  return (
    <View style={styles.card} testID="dining-reservation-card">
      {/* Header: icon + title + pulse status badge */}
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <Ionicons name="restaurant" size={17} color="#5b2a86" />
          <Text style={styles.title}>
            {isQuickService ? 'Quick Service & Dishes' : 'Reservations & Dishes'}
          </Text>
        </View>
        <View style={[styles.pulseBadge, isClosed && styles.pulseBadgeClosed]}>
          <View style={[styles.pulseDot, isClosed && styles.pulseDotClosed]} />
          <Text style={[styles.pulseText, isClosed && styles.pulseTextClosed]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Wait & Status Info Box when available */}
      {waitInfo || availabilityText !== 'Reservations Available' ? (
        <View style={styles.statusBox}>
          <View style={styles.statusLeft}>
            <Ionicons name="restaurant" size={18} color="#5b2a86" />
            <View>
              <Text style={styles.statusTitle}>{availabilityText}</Text>
              {waitInfo ? <Text style={styles.statusSub}>{waitInfo}</Text> : null}
            </View>
          </View>
        </View>
      ) : null}

      {/* Reserve on Disney's Site Button (Golden Amber) */}
      {hasDiningUrl ? (
        <View style={styles.actionWrap}>
          <Pressable
            style={({ pressed }) => [
              styles.reserveButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => onReserve(diningUrl!.trim())}
            accessibilityRole="button"
            accessibilityLabel={`Reserve a table at ${experienceName} on Disney's site`}
            testID="experience-reserve-action"
          >
            <Ionicons name="calendar-outline" size={17} color="#ffffff" />
            <Text style={styles.reserveButtonText}>Reserve on Disney&apos;s Site</Text>
          </Pressable>
          {reservationFailed ? (
            <Text style={styles.errorText} testID="experience-reservation-error">
              Couldn&apos;t open the reservation page. Please try again.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Dashed Separator & Dish Action Buttons */}
      <View style={styles.dishSeparator} />
      <View style={styles.dishActionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.logDishButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={onLogFoodItem}
          accessibilityRole="button"
          accessibilityLabel={`Log a dish at ${experienceName}`}
          testID="dining-card-log-dish-btn"
        >
          <Ionicons name="restaurant" size={15} color="#ffffff" />
          <Text style={styles.logDishButtonText}>Log a Dish</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.myDishesButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={onMyLoggedItems}
          accessibilityRole="button"
          accessibilityLabel={`View my logged dishes at ${experienceName}`}
          testID="dining-card-my-dishes-btn"
        >
          <Ionicons name="time-outline" size={15} color="#5b2a86" />
          <Text style={styles.myDishesButtonText}>
            My Dishes{typeof loggedDishesCount === 'number' && loggedDishesCount > 0 ? ` (${loggedDishesCount})` : ''} →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    padding: 16,
    marginHorizontal: 0,
    marginTop: 8,
    marginBottom: 4,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
    letterSpacing: -0.2,
  },
  pulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(22, 163, 74, 0.25)',
  },
  pulseBadgeClosed: {
    backgroundColor: '#fef2f2',
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#16a34a',
  },
  pulseDotClosed: {
    backgroundColor: '#ef4444',
  },
  pulseText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16a34a',
  },
  pulseTextClosed: {
    color: '#ef4444',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fbf9fe',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ede6f6',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
  },
  statusSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#655d78',
    marginTop: 2,
  },
  actionWrap: {
    marginTop: 2,
    gap: 6,
  },
  reserveButton: {
    backgroundColor: '#d97706',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  reserveButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  errorText: {
    fontSize: 12,
    color: theme.color.danger,
    marginTop: 4,
    textAlign: 'center',
  },
  dishSeparator: {
    height: 1,
    borderTopWidth: 1,
    borderTopColor: '#e2d9f3',
    borderStyle: 'dashed',
    marginTop: 12,
    marginBottom: 10,
  },
  dishActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  logDishButton: {
    flex: 1,
    backgroundColor: '#5b2a86',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  logDishButtonText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  myDishesButton: {
    flex: 1,
    backgroundColor: '#fbf9fe',
    borderWidth: 1.5,
    borderColor: '#dcd1ed',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  myDishesButtonText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#5b2a86',
  },
});
