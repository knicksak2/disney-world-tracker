// Feature: experience-lists, Requirement 18 — AddToTripPickerSheet
//
// Validates: Requirements 18.1, 18.4, 18.5
//
// Lists the User's active/upcoming Trips so adding an Experience to a Trip
// is always an explicit choice — never a silent pick — matching how the
// Experience_List picker (AddToExperienceListsSheet, Requirement 9.2) is
// likewise always shown even for a User who owns exactly one list. Row
// styling mirrors ActiveTripShortcut.tsx's existing ActiveTripChooser (name
// + date range, Card row with a chevron) rather than inventing new visuals
// for the same "pick a Trip from a list" presentation problem.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TripDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Badge, Card, PrimaryButton } from '../../theme/components';

/**
 * Status label/color, matching `TripsListScreen.tsx`'s `STATUS_META` mapping
 * exactly (`active` -> success green, `upcoming` -> primary purple) so a
 * Trip's status reads identically here as it does on the Trips list itself.
 */
const STATUS_META: Record<'active' | 'upcoming', { readonly label: string; readonly color: string }> = {
  active: { label: 'Active', color: theme.color.success },
  upcoming: { label: 'Upcoming', color: theme.color.primary },
};

export interface AddToTripPickerSheetProps {
  readonly visible: boolean;
  readonly trips: readonly TripDTO[];
  readonly onSelect: (tripId: string) => void;
  readonly onClose: () => void;
}

export default function AddToTripPickerSheet({
  visible,
  trips,
  onSelect,
  onClose,
}: AddToTripPickerSheetProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="add-to-trip-picker-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="add-to-trip-picker-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Add to which trip?</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="add-to-trip-picker-close-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.tripList}>
            {trips.map((trip) => (
              <Card
                key={trip.id}
                style={styles.tripRow}
                onPress={() => onSelect(trip.id)}
                testID={`add-to-trip-picker-${trip.id}`}
              >
                <View style={styles.tripRowInner}>
                  <View style={styles.tripRowText}>
                    <View style={styles.tripNameRow}>
                      <Text style={styles.tripName} numberOfLines={1}>
                        {trip.name}
                      </Text>
                      {trip.status === 'active' || trip.status === 'upcoming' ? (
                        <Badge
                          label={STATUS_META[trip.status].label}
                          color={STATUS_META[trip.status].color}
                          testID={`add-to-trip-picker-status-${trip.id}`}
                        />
                      ) : null}
                    </View>
                    <Text style={styles.tripDates} numberOfLines={1}>
                      {formatDateRange(trip)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
                </View>
              </Card>
            ))}
          </View>

          <PrimaryButton
            label="Cancel"
            onPress={onClose}
            testID="add-to-trip-picker-cancel"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Render a Trip's date range; collapses a single-day Trip to one date. */
function formatDateRange(trip: TripDTO): string {
  return trip.startDate === trip.endDate
    ? trip.startDate
    : `${trip.startDate} \u2013 ${trip.endDate}`;
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
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  tripList: {
    gap: 8,
    maxHeight: 320,
  },
  tripRow: {
    padding: 0,
  },
  tripRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  tripRowText: {
    flex: 1,
    marginRight: 8,
  },
  tripNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  tripName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  tripDates: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
});
