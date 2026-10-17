/**
 * Booking Settings Modal for Organizers (Task 11.4).
 *
 * Validates: Requirements 6.8, 6.14
 */

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  checkInOverrideRange,
  isCheckInOverrideValid,
  type BookingSettingsUpdateInput,
  type LightningLaneTiming,
  type StayType,
} from '@dwt/shared';

import { DatePickerField } from '../../components/DatePickerField';
import { PrimaryButton, SecondaryButton, SectionLabel } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { BOOKING_SETTINGS_MODAL } from './BookingSettingsModal.palette';
import {
  checkInRangeText,
  pickChangedSettings,
  type SettingsFormValues,
} from './bookingTimelineView';

export interface BookingSettingsModalProps {
  readonly visible: boolean;
  readonly tripStart: string;
  readonly initialSettings: SettingsFormValues;
  readonly onConfirm: (changes: BookingSettingsUpdateInput) => void;
  readonly onCancel: () => void;
}

const STAY_TYPE_OPTIONS: readonly { readonly label: string; readonly value: StayType | null }[] = [
  { label: 'Automatic', value: null },
  { label: 'Resort', value: 'resort' },
  { label: 'Partner hotel', value: 'partner_hotel' },
  { label: 'Off-site', value: 'offsite' },
];

const TIMING_OPTIONS: readonly {
  readonly label: string;
  readonly value: LightningLaneTiming | null;
}[] = [
  { label: 'Automatic', value: null },
  { label: '7 days before check-in', value: 'seven_day' },
  { label: '3 days before (whole trip)', value: 'three_day' },
  { label: '3 days before (each day)', value: 'three_day_daily' },
];

export function BookingSettingsModal({
  visible,
  tripStart,
  initialSettings,
  onConfirm,
  onCancel,
}: BookingSettingsModalProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(BOOKING_SETTINGS_MODAL);

  const [stayType, setStayType] = useState<StayType | null>(initialSettings.stayType);
  const [lightningLaneTiming, setLightningLaneTiming] = useState<LightningLaneTiming | null>(
    initialSettings.lightningLaneTiming,
  );
  const [checkInOverride, setCheckInOverride] = useState<string | null>(
    initialSettings.checkInOverride,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStayType(initialSettings.stayType);
      setLightningLaneTiming(initialSettings.lightningLaneTiming);
      setCheckInOverride(initialSettings.checkInOverride);
      setErrorMessage(null);
    }
  }, [visible, initialSettings]);

  const range = checkInOverrideRange(tripStart);
  const rangeText = checkInRangeText(tripStart);

  const handleConfirm = () => {
    if (checkInOverride !== null && !isCheckInOverrideValid(checkInOverride, tripStart)) {
      setErrorMessage(rangeText);
      return;
    }
    setErrorMessage(null);
    const changes = pickChangedSettings(initialSettings, {
      stayType,
      lightningLaneTiming,
      checkInOverride,
    });
    onConfirm(changes);
  };

  const handleDateChange = (val: string) => {
    if (!val) {
      setCheckInOverride(null);
      setErrorMessage(null);
      return;
    }
    if (!isCheckInOverrideValid(val, tripStart)) {
      setErrorMessage(rangeText);
    } else {
      setErrorMessage(null);
    }
    setCheckInOverride(val);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalOverlay, { backgroundColor: pal.overlayBg }]}
      >
        <View style={styles.modalContent} testID="booking-settings-modal">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Booking Settings</Text>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              testID="close-booking-settings-modal"
            >
              <Ionicons name="close" size={24} color={t.color.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} keyboardShouldPersistTaps="handled">
            {errorMessage ? (
              <View
                style={[styles.errorBox, { backgroundColor: pal.errorBg }]}
                testID="booking-settings-error"
              >
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Stay Type Radios */}
            <View style={styles.section}>
              <SectionLabel>LODGING TYPE</SectionLabel>
              <Text style={styles.sectionSubtitle}>
                Controls when Advance Dining and Lightning Lane windows open.
              </Text>
              {STAY_TYPE_OPTIONS.map((opt) => {
                const isSelected = stayType === opt.value;
                const optId = `stay-type-${opt.label.toLowerCase().replace(/\s+/g, '-')}`;
                return (
                  <Pressable
                    key={opt.label}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={opt.label}
                    onPress={() => setStayType(opt.value)}
                    style={[styles.radioRow, isSelected && styles.radioRowSelected]}
                    testID={optId}
                  >
                    <View
                      style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}
                    >
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text
                      style={[styles.radioLabel, isSelected && styles.radioLabelSelected]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Lightning Lane Timing Radios */}
            <View style={styles.section}>
              <SectionLabel>LIGHTNING LANE TIMING</SectionLabel>
              <Text style={styles.sectionSubtitle}>
                Override the booking lead time for Lightning Lane selections.
              </Text>
              {TIMING_OPTIONS.map((opt) => {
                const isSelected = lightningLaneTiming === opt.value;
                const optId = `ll-timing-${opt.label.toLowerCase().replace(/\s+/g, '-')}`;
                return (
                  <Pressable
                    key={opt.label}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={opt.label}
                    onPress={() => setLightningLaneTiming(opt.value)}
                    style={[styles.radioRow, isSelected && styles.radioRowSelected]}
                    testID={optId}
                  >
                    <View
                      style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}
                    >
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text
                      style={[styles.radioLabel, isSelected && styles.radioLabelSelected]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Check-In Date Override */}
            <View style={styles.section}>
              <SectionLabel>CHECK-IN OVERRIDE DATE</SectionLabel>
              <Text style={styles.rangeText} testID="check-in-range-text">
                {rangeText}
              </Text>
              <DatePickerField
                value={checkInOverride ?? ''}
                onChange={handleDateChange}
                minimumDate={range.min}
                maximumDate={range.max}
                placeholder="No override (use trip start)"
                accessibilityLabel="Check-in override date"
                testID="check-in-override-picker"
              />
              {checkInOverride !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear check-in override"
                  onPress={() => {
                    setCheckInOverride(null);
                    setErrorMessage(null);
                  }}
                  style={styles.clearButton}
                  testID="clear-check-in-override"
                >
                  <Text style={styles.clearButtonText}>Clear override</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footerRow}>
            <View style={styles.buttonHalf}>
              <SecondaryButton
                label="Cancel"
                onPress={onCancel}
                testID="cancel-booking-settings"
              />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton
                label="Confirm"
                onPress={handleConfirm}
                testID="confirm-booking-settings"
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  headerTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionSubtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: 10,
    marginTop: 2,
  },
  rangeText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: 8,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  radioRowSelected: {
    backgroundColor: t.color.surfaceAlt,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: t.color.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  radioCircleSelected: {
    borderColor: t.color.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.color.primary,
  },
  radioLabel: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  radioLabelSelected: {
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  clearButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearButtonText: {
    ...t.typography.meta,
    color: t.color.primary,
  },
  errorBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
  },
  footerRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  buttonHalf: {
    flex: 1,
  },
}));
