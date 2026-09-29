/**
 * ExplorationPromptCard — Vacation context prompt hero shown when the guest has no active or upcoming trips.
 *
 * Implements Task 15.4 / Requirement 2.1:
 * "A Vacation Context hero: an Upcoming Vacation countdown card displaying days remaining,
 *  trip name, date range, and metrics when the user has an upcoming Trip; or the active
 *  in-park day card when a Trip is active; or an exploration prompt when no trips exist."
 *
 * Prompts the user to plan their next adventure, with 1-tap navigation into the Trips tab.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { navigateToTripsList } from '../../navigation/navigationRef';
import { theme } from '../../theme/theme';

export interface ExplorationPromptCardProps {
  readonly testID?: string;
  readonly onPress?: () => void;
}

export default function ExplorationPromptCard({
  testID = 'home-exploration-prompt-card',
  onPress,
}: ExplorationPromptCardProps): JSX.Element {
  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      navigateToTripsList();
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Plan your next adventure. Explore parks, build itineraries, and invite your crew."
      testID={testID}
    >
      <LinearGradient
        colors={['#7e57c2', '#5b2a86']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconTile}
      >
        <Ionicons name="sparkles" size={22} color="#f6c343" />
      </LinearGradient>

      <View style={styles.info}>
        <Text style={styles.tag}>PLAN A VACATION</Text>
        <Text style={styles.title} numberOfLines={1}>
          Plan Your Next Adventure
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          Explore parks, build itineraries & invite crew
        </Text>
      </View>

      <View style={styles.arrowWrap}>
        <Ionicons name="arrow-forward" size={18} color={theme.color.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#ebdff8',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    marginHorizontal: theme.spacing.md,
    marginTop: 12,
    marginBottom: 12,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  tag: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#7e57c2',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  meta: {
    fontSize: 11.5,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  arrowWrap: {
    paddingLeft: 4,
  },
});
