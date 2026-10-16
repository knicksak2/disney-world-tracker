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
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { navigateToTripsList } from '../../navigation/navigationRef';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { EXPLORATION_PROMPT } from './ExplorationPromptCard.palette';

export interface ExplorationPromptCardProps {
  readonly testID?: string;
  readonly onPress?: () => void;
}

export default function ExplorationPromptCard({
  testID = 'home-exploration-prompt-card',
  onPress,
}: ExplorationPromptCardProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(EXPLORATION_PROMPT);
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
        colors={[pal.iconTileStart, t.color.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconTile}
      >
        <Ionicons name="sparkles" size={22} color={t.color.accent} />
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
        <Ionicons name="arrow-forward" size={18} color={t.color.primaryFg} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color.surface,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: EXPLORATION_PROMPT[t.scheme].cardBorder,
    shadowColor: EXPLORATION_PROMPT[t.scheme].cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    marginHorizontal: t.spacing.md,
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
    shadowColor: EXPLORATION_PROMPT[t.scheme].iconTileShadow,
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
    color: t.color.primaryLight,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  meta: {
    fontSize: 11.5,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  arrowWrap: {
    paddingLeft: 4,
  },
}));
