/**
 * MagicFab — Elevated center bottom-tab button for quick actions.
 * (Task 8.6, Requirements 1.1, 1.2, 4.1, design.md Section 4)
 *
 * Sits as the custom center slot between Explore and Trips in the bottom tab bar.
 * Tapping opens QuickActionSheet as a modal overlay without navigating to a new screen.
 */

import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { ExperienceDTO, FoodItemDTO } from '@dwt/shared';

import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { ExperiencePicker } from '../trips/ExperiencePicker';
import LogVisitModal from '../catalog/LogVisitModal';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import LogFoodItemModal from '../catalog/LogFoodItemModal';
import { QuickActionSheet } from './QuickActionSheet';

export interface MagicFabProps {
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

export function MagicFab({
  onPress,
  style,
  testID = 'magic-fab',
  accessibilityLabel = 'Quick actions',
}: MagicFabProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Quick Action / Experience Logging modal flow state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTab, setPickerTab] = useState<'rides' | 'dining'>('rides');
  const [selectedRideExperience, setSelectedRideExperience] = useState<ExperienceDTO | null>(null);
  const [selectedDiningExperience, setSelectedDiningExperience] = useState<ExperienceDTO | null>(null);
  const [foodPickerVisible, setFoodPickerVisible] = useState(false);
  const [selectedFoodItem, setSelectedFoodItem] = useState<FoodItemDTO | null>(null);
  const [logFoodModalVisible, setLogFoodModalVisible] = useState(false);

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      setSheetVisible(true);
    }
  };

  const handleSelectExperience = useCallback((exp: ExperienceDTO) => {
    setPickerVisible(false);
    if (pickerTab === 'rides') {
      setSelectedRideExperience(exp);
    } else {
      setSelectedDiningExperience(exp);
      setFoodPickerVisible(true);
    }
  }, [pickerTab]);

  return (
    <>
      <View style={[styles.container, style]} pointerEvents="box-none">
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          style={({ pressed }) => [
            styles.pressable,
            pressed && styles.pressed,
          ]}
        >
          {/* Subtle magical halo ring */}
          <View style={styles.halo}>
            <LinearGradient
              colors={t.gradient.fab}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientCircle}
            >
              <Ionicons name="sparkles" size={24} color={t.color.textOnPrimary} />
            </LinearGradient>
          </View>
        </Pressable>
      </View>

      <QuickActionSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onOpenExperiencePicker={(tab) => {
          setPickerTab(tab);
          setPickerVisible(true);
        }}
      />

      {/* Experience Picker Modal for Log Ride / Log Food */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerVisible(false)}
        testID="fab-experience-picker-modal"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} testID="fab-picker-title">
                {pickerTab === 'rides' ? 'Select Attraction to Log' : 'Select Restaurant to Log Food'}
              </Text>
              <Pressable
                onPress={() => setPickerVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close picker"
                testID="fab-picker-close-btn"
              >
                <Ionicons name="close" size={24} color={t.color.textSecondary} />
              </Pressable>
            </View>
            <ExperiencePicker
              enabled={pickerVisible}
              defaultTab={pickerTab === 'rides' ? 'attractions' : 'dining'}
              showTabs={true}
              showParkFilter={true}
              fillContainer={true}
              testIDPrefix="fab-picker"
              onSelect={handleSelectExperience}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Log Visit Modal for selected ride */}
      {selectedRideExperience && (
        <LogVisitModal
          experienceId={selectedRideExperience.id}
          visible={selectedRideExperience !== null}
          onClose={() => setSelectedRideExperience(null)}
          onLogged={() => {
            setSelectedRideExperience(null);
            void queryClient.invalidateQueries();
          }}
        />
      )}

      {/* Food Item Picker Modal for selected dining experience */}
      {selectedDiningExperience && (
        <FoodItemPickerModal
          experienceId={selectedDiningExperience.id}
          visible={foodPickerVisible}
          onClose={() => {
            setFoodPickerVisible(false);
            setSelectedDiningExperience(null);
          }}
          onSelectFoodItem={(item) => {
            setSelectedFoodItem(item);
            setFoodPickerVisible(false);
            setLogFoodModalVisible(true);
          }}
        />
      )}

      {/* Log Food Item Modal */}
      {selectedFoodItem && (
        <LogFoodItemModal
          foodItem={selectedFoodItem}
          visible={logFoodModalVisible}
          onClose={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItem(null);
            setSelectedDiningExperience(null);
          }}
          onLogged={() => {
            setLogFoodModalVisible(false);
            setSelectedFoodItem(null);
            setSelectedDiningExperience(null);
            void queryClient.invalidateQueries();
          }}
        />
      )}
    </>
  );
}

export default MagicFab;

const useStyles = makeStyles((t) => ({
  container: {
    top: -14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressable: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
  halo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: t.color.surface,
    padding: 3,
    ...t.shadow.card,
    ...t.outline.card,
    elevation: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
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
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    marginBottom: t.spacing.xs,
  },
  modalTitle: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
}));
