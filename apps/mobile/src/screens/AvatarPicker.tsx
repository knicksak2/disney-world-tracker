/**
 * AvatarPicker — choose a Profile avatar from the fixed preset set.
 *
 * Replaces the former upload flow: avatars are now a bundled set of original
 * Disney-themed illustrations (see `avatars/AvatarPresets`), so the user picks
 * one from a grid rather than uploading an image. Selecting a tile calls
 * `PUT /me/profile/avatar` with the chosen preset id (or `null` to clear) via
 * `setAvatarPreset`, and hands the updated `ProfileDTO` back to the parent so
 * the header avatar re-renders immediately.
 *
 * Used by `ProfileScreen` in self-mode.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AVATAR_PRESET_IDS, type AvatarPresetId, type ProfileDTO } from '@dwt/shared';

import { ApiError, setAvatarPreset } from '../api/client';
import {
  AVATAR_PRESET_COMPONENTS,
  AVATAR_PRESET_LABELS,
} from '../avatars/AvatarPresets';
import { theme } from '../theme/theme';
import { SecondaryButton } from '../theme/components';

const TILE_SIZE = 64;

export interface AvatarPickerProps {
  /** The user's currently-selected preset, or `null` when none is set. */
  readonly currentPreset: AvatarPresetId | null;
  /**
   * Called with the updated `ProfileDTO` after the server accepts a new
   * selection so the parent can update its cached Profile without a refetch.
   */
  readonly onChanged: (profile: ProfileDTO) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving'; target: AvatarPresetId | null }
  | { kind: 'error'; message: string };

export default function AvatarPicker({
  currentPreset,
  onChanged,
}: AvatarPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function choose(preset: AvatarPresetId | null): Promise<void> {
    // No-op if the user re-taps their current selection.
    if (preset === currentPreset) {
      setOpen(false);
      return;
    }
    setStatus({ kind: 'saving', target: preset });
    try {
      const profile = await setAvatarPreset(preset);
      onChanged(profile);
      setStatus({ kind: 'idle' });
      setOpen(false);
    } catch (err) {
      const message =
        err instanceof ApiError && err.message.length > 0
          ? err.message
          : 'Could not update your avatar. Please try again.';
      setStatus({ kind: 'error', message });
    }
  }

  const saving = status.kind === 'saving';

  return (
    <View style={styles.container}>
      <SecondaryButton
        label={open ? 'Done' : currentPreset !== null ? 'Change avatar' : 'Choose an avatar'}
        icon={open ? 'checkmark-outline' : 'color-palette-outline'}
        onPress={() => setOpen((v) => !v)}
      />

      {open ? (
        <View style={styles.grid} accessibilityRole="radiogroup">
          {AVATAR_PRESET_IDS.map((preset) => {
            const Art = AVATAR_PRESET_COMPONENTS[preset];
            const selected = preset === currentPreset;
            const targeted = status.kind === 'saving' && status.target === preset;
            return (
              <Pressable
                key={preset}
                onPress={() => {
                  void choose(preset);
                }}
                disabled={saving}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: saving }}
                accessibilityLabel={AVATAR_PRESET_LABELS[preset]}
                style={[
                  styles.tile,
                  selected && styles.tileSelected,
                  targeted && styles.tileTargeted,
                ]}
              >
                <Art size={TILE_SIZE} />
              </Pressable>
            );
          })}

          {/* Clear-to-placeholder option. */}
          <Pressable
            onPress={() => {
              void choose(null);
            }}
            disabled={saving}
            accessibilityRole="radio"
            accessibilityState={{ selected: currentPreset === null, disabled: saving }}
            accessibilityLabel="No avatar"
            style={[
              styles.tile,
              styles.noneTile,
              currentPreset === null && styles.tileSelected,
            ]}
          >
            <Text style={styles.noneText}>None</Text>
          </Pressable>
        </View>
      ) : null}

      {status.kind === 'error' ? (
        <Text style={styles.error} accessibilityRole="alert">
          {status.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: theme.spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  tile: {
    width: TILE_SIZE + 12,
    height: TILE_SIZE + 12,
    borderRadius: (TILE_SIZE + 12) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: theme.color.surfaceAlt,
  },
  tileSelected: {
    borderColor: theme.color.primary,
  },
  tileTargeted: {
    opacity: 0.5,
  },
  noneTile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  noneText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  error: {
    ...theme.typography.meta,
    color: theme.color.danger,
    textAlign: 'center',
  },
});
