// Feature: photo-uploads, Task 22.7 — section header row (icon + title) shared by the
// Trip Summary and the Trip Recap screens (Requirement 15.23).

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../../theme/theme';
import { makeStyles } from '../../../theme/makeStyles';

export interface SummarySectionHeaderProps {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly iconColor: string;
  readonly title: string;
  readonly testID?: string | undefined;
}

export function SummarySectionHeader({
  icon,
  iconColor,
  title,
  testID,
}: SummarySectionHeaderProps): JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeaderRow} {...(testID !== undefined ? { testID } : {})}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
}));
