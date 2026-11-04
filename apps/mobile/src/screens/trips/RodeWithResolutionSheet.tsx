// Feature: unified-experience-logging, Requirement 15.3 — Rode With Duplicate Resolution Sheet
//
// Validates: Requirements 15.3, 15.4, 15.6

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

export interface RodeWithResolutionSheetProps {
  readonly visible: boolean;
  readonly experienceName: string;
  readonly existingLogLoggedAt?: string | null | undefined;
  readonly isSubmitting?: boolean | undefined;
  readonly onClose: () => void;
  readonly onConfirm: (resolution: 'link' | 'new_log') => void;
}

function formatLoggedAt(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function RodeWithResolutionSheet({
  visible,
  experienceName,
  existingLogLoggedAt,
  isSubmitting = false,
  onClose,
  onConfirm,
}: RodeWithResolutionSheetProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const [selectedResolution, setSelectedResolution] = useState<'link' | 'new_log'>('link');

  if (!visible) return null;

  const formattedTime = formatLoggedAt(existingLogLoggedAt);
  const promptText = formattedTime
    ? `You previously logged this today at ${formattedTime}. Was this the same ride, or did you ride again?`
    : `You previously logged this attraction today. Was this the same ride, or did you ride again?`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="rode-with-resolution-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={isSubmitting ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close resolution sheet"
        />
        <View style={styles.sheetContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {experienceName}
          </Text>
          <Text style={styles.prompt}>{promptText}</Text>

          {/* Option: Same ride (link) */}
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedResolution === 'link' }}
            accessibilityLabel="Same ride, combine them"
            onPress={() => setSelectedResolution('link')}
            style={[
              styles.optionCard,
              selectedResolution === 'link' && styles.optionCardSelected,
            ]}
            testID="resolution-option-link"
          >
            <View style={styles.radioRow}>
              <Ionicons
                name={selectedResolution === 'link' ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selectedResolution === 'link' ? t.color.primary : t.color.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionHeading}>Same ride (combine them)</Text>
                <Text style={styles.optionDescription}>
                  Links you to the group post so you do not get duplicate ride counts or feed cards.
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Option: Rode again (new_log) */}
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedResolution === 'new_log' }}
            accessibilityLabel="We rode it again"
            onPress={() => setSelectedResolution('new_log')}
            style={[
              styles.optionCard,
              selectedResolution === 'new_log' && styles.optionCardSelected,
            ]}
            testID="resolution-option-new-log"
          >
            <View style={styles.radioRow}>
              <Ionicons
                name={selectedResolution === 'new_log' ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selectedResolution === 'new_log' ? t.color.primary : t.color.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionHeading}>We rode it again!</Text>
                <Text style={styles.optionDescription}>
                  Records this as an additional ride on {experienceName} today.
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <SecondaryButton
              label="Cancel"
              onPress={onClose}
              disabled={isSubmitting}
              testID="resolution-cancel-btn"
            />
            <PrimaryButton
              label={isSubmitting ? 'Confirming\u2026' : 'Confirm'}
              onPress={() => onConfirm(selectedResolution)}
              disabled={isSubmitting}
              testID="resolution-confirm-btn"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.xl,
    gap: t.spacing.md,
  },
  title: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
  prompt: {
    ...t.typography.body,
    color: t.color.textSecondary,
    marginBottom: t.spacing.xs,
  },
  optionCard: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: t.spacing.md,
  },
  optionCardSelected: {
    borderColor: t.color.primary,
    backgroundColor: t.color.surface,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.sm,
  },
  optionContent: {
    flex: 1,
    gap: 2,
  },
  optionHeading: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  optionDescription: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.md,
    marginTop: t.spacing.sm,
  },
}));
