/**
 * PinCelebrationModal (R5.5, R23 fanfare) — the claim celebration.
 *
 * Shown when a pin is claimed (or, for older mutation call sites, when `newlyAwardedPinIds` is
 * returned): it presents the freshly claimed pin(s) at full size with celebratory copy, a
 * confetti burst, and a pop/scale-in on the art (Requirement 23.7). Pin metadata (name, tier) is
 * resolved from the shared catalog by id; unknown ids are skipped defensively. The modal renders
 * nothing when there is nothing to celebrate, so a caller can mount it unconditionally and just
 * pass the ids through.
 *
 * When celebrating as part of a multi-pin claim batch (`position.total > 1`), a "{index} of
 * {total}" line renders under the heading so the sequence is legible (Requirement 23.5); a
 * single-pin celebration (no `position`, or `total <= 1`) renders exactly as before.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PINS, type PinDTO } from '@dwt/shared';

import { PinView } from '../../components/pins/PinView';
import { TIER_COLOR, TIER_LABEL } from '../../components/pins/pinTierMeta';
import { theme } from '../../theme/theme';
import { Badge, PrimaryButton, SecondaryButton } from '../../theme/components';

export interface CelebrationPosition {
  /** 1-based position of the pin currently being celebrated within its claim batch. */
  readonly index: number;
  /** Total pins in the claim batch this celebration belongs to (fixed for the batch's duration). */
  readonly total: number;
}

export interface PinCelebrationModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Ids from a mutation's `newlyAwardedPinIds`, or a single just-claimed pin. */
  readonly pinIds: readonly string[];
  /**
   * Shown as a "View details" affordance when celebrating exactly one pin
   * (lore/criteria live in `PinDetailModal`, not repeated here). Closes the
   * celebration and hands the pin id off to the caller, which is expected to
   * open the detail modal for it.
   */
  readonly onViewDetails?: (pinId: string) => void;
  /** This celebration's position within a multi-pin claim batch (Requirement 23.5). */
  readonly position?: CelebrationPosition | null;
  /** Skip remaining celebrations in a batch and claim them all immediately (Requirement 23.8). */
  readonly onSkipAll?: () => void;
}

const CATALOG: ReadonlyMap<string, PinDTO> = new Map(PINS.map((p) => [p.id, p]));

const CONFETTI_COUNT = 16;
const CONFETTI_COLORS = [
  theme.color.primary,
  theme.color.accent,
  '#f2c14e',
  '#4ecdc4',
  '#ff6f91',
];

/** Deterministic-per-mount confetti particle geometry (seeded once, not per-frame-random). */
interface ConfettiSpec {
  readonly angle: number;
  readonly distance: number;
  readonly rotation: number;
  readonly color: string;
}

function makeConfettiSpecs(): ConfettiSpec[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    angle: (i / CONFETTI_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6,
    distance: 70 + Math.random() * 50,
    rotation: Math.random() * 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
  }));
}

/** A single outward-bursting confetti particle. */
function ConfettiParticle({ spec, testID }: { spec: ConfettiSpec; testID: string }): JSX.Element {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 700, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const dx = Math.cos(spec.angle) * spec.distance;
  const dy = Math.sin(spec.angle) * spec.distance;

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.confettiParticle,
        {
          backgroundColor: spec.color,
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', `${spec.rotation}deg`],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export default function PinCelebrationModal({
  visible,
  onClose,
  pinIds,
  onViewDetails,
  position,
  onSkipAll,
}: PinCelebrationModalProps): JSX.Element | null {
  const awarded = useMemo(
    () => pinIds.map((id) => CATALOG.get(id)).filter((p): p is PinDTO => p != null),
    [pinIds],
  );

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    try {
      const p = AccessibilityInfo?.isReduceMotionEnabled?.();
      if (p && typeof (p as Promise<boolean>).then === 'function') {
        (p as Promise<boolean>).then((v) => mounted && setReduceMotion(!!v)).catch(() => undefined);
      }
    } catch {
      // default false
    }
    return () => {
      mounted = false;
    };
  }, []);

  // Confetti specs + haptic pattern are (re-)seeded/fired whenever the modal opens for a new
  // celebration, not on every render.
  const confettiSpecs = useMemo(() => (reduceMotion ? [] : makeConfettiSpecs()), [visible, reduceMotion]);
  const pop = useRef(new Animated.Value(reduceMotion ? 1 : 0.6)).current;

  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      pop.setValue(1);
      return;
    }
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
    // The claim's "thunk-ding" haptic pattern (Requirement 23.7) fires from the claim mutation's
    // onSuccess in PinBoardScreen, where the claim actually lands — not here, so it fires exactly
    // once per claim regardless of when/whether the celebration modal happens to be mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  if (!visible || awarded.length === 0) return null;

  const heading = awarded.length === 1 ? 'Pin claimed!' : `${awarded.length} pins claimed!`;
  const showPosition = !!position && position.total > 1;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="pin-celebration-modal">
          <Text style={styles.heading} testID="pin-celebration-heading">
            {heading}
          </Text>
          {showPosition ? (
            <Text style={styles.position} testID="pin-celebration-position">
              {position!.index} of {position!.total}
            </Text>
          ) : null}
          <ScrollView
            horizontal={awarded.length > 1}
            contentContainerStyle={styles.pinsRow}
            showsHorizontalScrollIndicator={false}
          >
            {awarded.map((pin) => (
              <View key={pin.id} style={styles.pinCell} testID={`pin-celebration-${pin.id}`}>
                <View style={styles.artWrap}>
                  {confettiSpecs.map((spec, i) => (
                    <ConfettiParticle key={i} spec={spec} testID={`pin-celebration-confetti-${pin.id}-${i}`} />
                  ))}
                  <Animated.View style={{ transform: [{ scale: pop }] }}>
                    <PinView pinId={pin.id} tier={pin.tier} unlocked size={150} />
                  </Animated.View>
                </View>
                <Text style={styles.pinName}>{pin.name}</Text>
                <Badge label={TIER_LABEL[pin.tier]} color={TIER_COLOR[pin.tier]} />
              </View>
            ))}
          </ScrollView>
          <PrimaryButton label="Nice!" onPress={onClose} testID="pin-celebration-dismiss" />
          {onSkipAll && position && position.total > 1 && position.index < position.total ? (
            <View style={styles.skipAllWrap}>
              <SecondaryButton
                label="Skip all"
                onPress={onSkipAll}
                testID="pin-celebration-skip-all"
              />
            </View>
          ) : null}
          {onViewDetails && awarded.length === 1 ? (
            <View style={styles.viewDetailsWrap}>
              <SecondaryButton
                label="View details"
                onPress={() => onViewDetails(awarded[0]!.id)}
                testID="pin-celebration-view-details"
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,7,20,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    alignItems: 'center',
    maxWidth: 520,
    width: '100%',
  },
  heading: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  position: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  pinsRow: { alignItems: 'center', paddingHorizontal: theme.spacing.sm },
  viewDetailsWrap: { marginTop: theme.spacing.sm },
  skipAllWrap: { marginTop: theme.spacing.sm },
  pinCell: { alignItems: 'center', marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.lg },
  artWrap: { alignItems: 'center', justifyContent: 'center' },
  confettiParticle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  pinName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
});
