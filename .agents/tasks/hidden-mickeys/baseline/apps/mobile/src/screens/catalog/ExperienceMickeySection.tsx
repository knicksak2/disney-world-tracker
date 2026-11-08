import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useMickeyConfig, useMickeyList } from '../mickeys/api';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export interface ExperienceMickeySectionProps {
  readonly experienceId: string;
}

export default function ExperienceMickeySection({
  experienceId,
}: ExperienceMickeySectionProps): JSX.Element | null {
  const navigation = useNavigation<NavigationProp>();
  const styles = useStyles();
  const t = useAppTheme();

  const { data: config } = useMickeyConfig();
  const { data: listData, isLoading } = useMickeyList({ experienceId, limit: 100 });

  // Gated on MICKEYS_ENABLED (Requirement 13.9)
  if (config?.enabled === false) {
    return null;
  }

  if (isLoading || !listData?.items || !Array.isArray(listData.items)) {
    return null;
  }

  const items = listData.items;
  const total = items.length;
  const found = items.filter((i) => i.found).length;

  if (total > 0) {
    const label = `${total} Hidden Mickey${total === 1 ? '' : 's'} here · you've found ${found}`;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="experience-mickeys-card"
        style={styles.card}
        onPress={() => navigation.navigate('HiddenMickeys', { experienceId })}
      >
        <View style={styles.cardContent}>
          <View style={styles.iconCircle}>
            <Ionicons name="sparkles" size={18} color={t.color.primaryFg} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.titleText}>{label}</Text>
            <Text style={styles.subText}>Tap to explore the hunt</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.color.textSecondary} />
        </View>
      </Pressable>
    );
  }

  // When 0 Mickeys, render quiet link (Requirement 13.2)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Know one? Add it"
      testID="experience-mickeys-quiet-link"
      style={styles.quietLink}
      onPress={() => navigation.navigate('SubmitMickey', { experienceId })}
    >
      <Ionicons name="add-circle-outline" size={16} color={t.color.primaryFg} />
      <Text style={styles.quietLinkText}>Know one? Add it</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color.surface,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    marginHorizontal: t.spacing.md,
    marginBottom: t.spacing.sm,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  titleText: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  subText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  quietLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginHorizontal: theme.spacing.md,
  },
  quietLinkText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
}));
