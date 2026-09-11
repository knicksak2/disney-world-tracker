/**
 * PinDetailModal (R5.4) — the full-size pin viewer.
 *
 * Presents one pin's artwork at large size, its name, tier/track badges, its lore (the catalog
 * `description`), and either the unlock date (when unlocked) or a criteria progress bar with the
 * current/target counts (when locked). Driven by the board: it receives the static catalog entry
 * plus the user's per-pin progress projection.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PinDTO, UserPinProgressDTO } from '@dwt/shared';

import { PinView } from '../../components/pins/PinView';
import { TIER_COLOR, TIER_LABEL, TRACK_LABEL } from '../../components/pins/pinTierMeta';
import { theme } from '../../theme/theme';
import { Badge, SecondaryButton } from '../../theme/components';

export interface PinDetailModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The static catalog entry (name, tier, track, lore). */
  readonly pin: PinDTO | null;
  /** The user's projection for this pin (unlocked / progress). */
  readonly progress: UserPinProgressDTO | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PinDetailModal({
  visible,
  onClose,
  pin,
  progress,
}: PinDetailModalProps): JSX.Element | null {
  if (!pin) return null;
  const unlocked = progress?.unlocked ?? false;
  const pct = progress?.percentComplete ?? 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} testID="pin-detail-modal">
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <View style={styles.artWrap}>
            <PinView pinId={pin.id} tier={pin.tier} unlocked={unlocked} size={184} testID="pin-detail-art" />
          </View>

          <Text style={styles.name} testID="pin-detail-name">
            {pin.name}
          </Text>

          <View style={styles.badgeRow}>
            <View style={styles.badgeSpacer}>
              <Badge label={TIER_LABEL[pin.tier]} color={TIER_COLOR[pin.tier]} />
            </View>
            <Badge label={TRACK_LABEL[pin.track]} color={theme.color.primary} />
          </View>

          <Text style={styles.lore}>{pin.description}</Text>

          {unlocked ? (
            <Text style={styles.unlockedAt} testID="pin-detail-unlocked">
              {progress?.awardedAt ? `Unlocked ${formatDate(progress.awardedAt)}` : 'Unlocked'}
            </Text>
          ) : (
            <View style={styles.progressWrap} testID="pin-detail-progress">
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(99, pct))}%` }]} />
              </View>
              <Text style={styles.progressLabel}>
                {progress?.currentValue != null && progress?.targetValue != null
                  ? `${progress.currentValue} / ${progress.targetValue} · ${pct}%`
                  : `${pct}% complete`}
              </Text>
            </View>
          )}

          <SecondaryButton label="Close" onPress={onClose} testID="pin-detail-close" />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,7,20,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '86%',
  },
  sheetContent: { padding: theme.spacing.xl, alignItems: 'center' },
  artWrap: { marginBottom: theme.spacing.lg },
  name: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  badgeRow: { flexDirection: 'row', marginBottom: theme.spacing.lg },
  badgeSpacer: { marginRight: theme.spacing.sm },
  lore: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  unlockedAt: {
    ...theme.typography.body,
    color: theme.color.primary,
    fontWeight: '700',
    marginBottom: theme.spacing.lg,
  },
  progressWrap: { width: '100%', marginBottom: theme.spacing.lg },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.color.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: theme.color.primary },
  progressLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
});
