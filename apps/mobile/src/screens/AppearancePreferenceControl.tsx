// Feature: dark-mode — Appearance preference control for the Profile screen.
//
// Self-contained, following `PushNotificationPreferenceControl.tsx`'s exact
// placement pattern (a standalone component the parent `ProfileScreen`
// renders inside its own titled `Card`, owning its own state/behavior) and
// reusing the existing `Chip` primitive from `theme/components.tsx` for the
// three options — `Chip` already implements `accessibilityRole="button"`,
// `accessibilityState={{ selected }}`, and a spoken label describing the
// option name plus its selection state, satisfying Requirement 5's
// accessibility criteria by construction.

import React from 'react';
import { Text, View } from 'react-native';

import { makeStyles } from '../theme/makeStyles';
import { Chip } from '../theme/components';
import { useThemeStore } from '../state/themeStore';
import type { AppearancePreference } from '../theme/appearance';

const OPTIONS: ReadonlyArray<{ readonly value: AppearancePreference; readonly label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearancePreferenceControl(): JSX.Element {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const styles = useStyles();

  return (
    <View style={styles.container} testID="appearance-preference-control">
      <Text style={styles.title}>Appearance</Text>
      <Text style={styles.description}>
        Choose how the app looks, or follow your device&apos;s setting.
      </Text>
      <View style={styles.row}>
        {OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={preference === option.value}
            onPress={() => {
              void setPreference(option.value);
            }}
            testID={`appearance-option-${option.value}`}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.sm },
  title: { ...t.typography.subtitle, color: t.color.textPrimary },
  description: { ...t.typography.meta, color: t.color.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: 2 },
}));
