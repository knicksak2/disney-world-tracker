// Feature: unified-experience-logging, Task 6.2 — App-root log toast host
//
// Validates: Requirements 7.1, 7.3, 7.4, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 14.2, 14.3

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FoodItemDTO } from '@dwt/shared';

import { navigateToTripFeed } from '../../navigation/navigationRef';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { TOAST } from '../foodLists/MarkGottenUndoToast.palette';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import LogFoodItemModal from '../catalog/LogFoodItemModal';
import { useLogToastStore } from './logToastStore';

export default function LogToastHost(): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const current = useLogToastStore((s) => s.current);
  const dismiss = useLogToastStore((s) => s.dismiss);

  const [pickerExperienceId, setPickerExperienceId] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<FoodItemDTO | null>(null);
  const [isDishLogVisible, setIsDishLogVisible] = useState(false);

  function handleViewInTrip(): void {
    if (current?.tripId) {
      navigateToTripFeed({ tripId: current.tripId });
      dismiss();
    }
  }

  function handleLogWhatYouAte(): void {
    if (current) {
      const expId = current.experienceId;
      dismiss();
      setPickerExperienceId(expId);
    }
  }

  function handlePickerClose(): void {
    setPickerExperienceId(null);
  }

  function handleSelectFoodItem(item: FoodItemDTO): void {
    setSelectedDish(item);
    setPickerExperienceId(null);
    setIsDishLogVisible(true);
  }

  function handleDishLogClose(): void {
    setIsDishLogVisible(false);
    setSelectedDish(null);
  }

  const isPickerVisible = pickerExperienceId !== null;

  return (
    <>
      {current !== null && (
        <View
          style={styles.container}
          pointerEvents="box-none"
          testID="log-toast-wrapper"
        >
          <View
            style={styles.toast}
            testID="log-toast"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <View style={styles.topRow}>
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={t.color.success}
              />
              <Text
                style={styles.message}
                numberOfLines={2}
                testID="log-toast-message"
              >
                {current.message}
              </Text>
            </View>

            {(current.tripId !== null || current.offerDishPrompt) && (
              <View style={styles.actionsRow}>
                {current.tripId !== null && (
                  <Pressable
                    onPress={handleViewInTrip}
                    accessibilityRole="button"
                    accessibilityLabel="View in trip"
                    style={styles.actionBtn}
                    testID="log-toast-view-in-trip"
                  >
                    <Text style={styles.actionBtnText}>View in trip</Text>
                  </Pressable>
                )}

                {current.offerDishPrompt && (
                  <Pressable
                    onPress={handleLogWhatYouAte}
                    accessibilityRole="button"
                    accessibilityLabel="Log what you ate"
                    style={styles.actionBtn}
                    testID="log-toast-dish-prompt"
                  >
                    <Text style={styles.actionBtnText}>Log what you ate</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      )}

      {isPickerVisible && (
        <FoodItemPickerModal
          visible={isPickerVisible}
          experienceId={pickerExperienceId}
          mode="log"
          onClose={handlePickerClose}
          onSelectFoodItem={handleSelectFoodItem}
        />
      )}

      {isDishLogVisible && selectedDish !== null && (
        <LogFoodItemModal
          visible={isDishLogVisible}
          foodItem={selectedDish}
          onClose={handleDishLogClose}
          onLogged={handleDishLogClose}
        />
      )}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    position: 'absolute',
    bottom: 84,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    backgroundColor: TOAST[t.scheme].bg,
    ...t.outline.card,
    borderRadius: t.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: t.color.textOnPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingTop: 2,
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.accent,
  },
}));

