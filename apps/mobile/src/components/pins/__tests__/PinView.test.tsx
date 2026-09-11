/**
 * Component tests for PinView (task 7.3 render coverage).
 *
 * PinView renders the baked catalogue SVG (from `pinArt.ts`) via `react-native-svg`'s `SvgXml`,
 * and applies the locked treatment + rarity glow at render time. The pure tier/rim invariants
 * (Properties 5, 6, 10) are asserted separately in `pinRenderModel.prop.test.ts`. These tests
 * assert real, observable behaviour: every tier's baked art renders, the locked state overlays a
 * padlock and dims the art, the glow loop starts only for the rarest tiers and is suppressed by
 * reduce-motion, and onPress fires without duplicating the testID.
 */
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { PINS, type PinTier } from '@dwt/shared';

import { PinView } from '../PinView';
import { PIN_ART } from '../pinArt';

/** One representative pin id per tier, taken from the shared catalog. */
function pinIdForTier(tier: PinTier): string {
  const pin = PINS.find((p) => p.tier === tier);
  if (!pin) throw new Error(`no catalog pin for tier ${tier}`);
  return pin.id;
}

const ALL_TIERS: PinTier[] = ['bronze', 'silver', 'gold', 'amethyst', 'pearl', 'prism', 'mythic'];

function tree(el: React.ReactElement): string {
  return JSON.stringify(render(el).toJSON());
}

afterEach(() => jest.restoreAllMocks());

describe('PinView', () => {
  it('renders baked artwork for a pin of every tier', () => {
    for (const tier of ALL_TIERS) {
      const id = pinIdForTier(tier);
      expect(PIN_ART[id]).toBeDefined();
      const s = tree(<PinView pinId={id} tier={tier} unlocked motion={false} testID={`pin-${tier}`} />);
      // the baked SVG reached the canvas
      expect(s).toContain('RNSVGSvgView');
    }
  });

  it('locked pins overlay a padlock and dim the art; unlocked pins do neither', () => {
    const id = pinIdForTier('gold');
    const locked = tree(<PinView pinId={id} tier="gold" unlocked={false} motion={false} testID="p" />);
    const unlocked = tree(<PinView pinId={id} tier="gold" unlocked motion={false} testID="p" />);
    // padlock badge geometry present only when locked
    expect(locked).toContain('M256 60');
    expect(unlocked).not.toContain('M256 60');
    // dimmed opacity only when locked
    expect(locked).toContain('"opacity":0.18');
    expect(unlocked).not.toContain('"opacity":0.18');
  });

  it('falls back to a placeholder when no art is found (never happens for real pins)', () => {
    const { getByTestId } = render(<PinView pinId="__does_not_exist__" tier="bronze" unlocked testID="fb" />);
    expect(getByTestId('fb')).toBeTruthy();
  });

  it('starts the glow loop for prism, but not for bronze', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    render(<PinView pinId={pinIdForTier('prism')} tier="prism" unlocked />);
    await waitFor(() => expect(loopSpy).toHaveBeenCalledTimes(1));

    loopSpy.mockClear();
    render(<PinView pinId={pinIdForTier('bronze')} tier="bronze" unlocked />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it('suppresses the glow entirely when reduce-motion is enabled', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    render(<PinView pinId={pinIdForTier('pearl')} tier="pearl" unlocked />);
    // flush the async reduce-motion query (resolves true) inside act, then assert no loop started
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it('does not animate when motion is disabled (dense grids)', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    render(<PinView pinId={pinIdForTier('prism')} tier="prism" unlocked motion={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it('fires onPress when interactive, without duplicating the testID', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <PinView pinId={pinIdForTier('gold')} tier="gold" unlocked onPress={onPress} testID="tap" />,
    );
    fireEvent.press(getByTestId('tap'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
