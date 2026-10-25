import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { usePhotoConfig } from '../../photos/api';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

export interface MyPhotosEntryProps {
  readonly onPress: () => void;
}

export function MyPhotosEntry({ onPress }: MyPhotosEntryProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const { data } = usePhotoConfig();

  if (data?.enabled !== true) {
    return null;
  }

  return (
    <Pressable
      testID="vault-my-photos-entry"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="My Photos"
      style={styles.button}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="images-outline" size={24} color={t.color.textOnPrimary} />
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

