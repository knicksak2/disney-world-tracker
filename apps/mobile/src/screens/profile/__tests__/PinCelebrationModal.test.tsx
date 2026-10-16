/**
 * Component tests for PinCelebrationModal (task 14.11, Requirement 23.5, 23.7).
 *
 * `PinBoardScreen.test.tsx` already drives this modal through real claim flows (heading/button
 * copy, position text, chaining). These tests isolate the modal itself to assert:
 *  - confetti particles render on a normal claim and are suppressed under reduce-motion;
 *  - the "{index} of {total}" position line is absent for a single/non-batched claim and present
 *    (with the right numbers) when `position.total > 1`.
 */
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { PINS } from '@dwt/shared';

import { TIER_COLOR, TIER_LABEL } from '../../../components/pins/pinTierMeta';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';
import PinCelebrationModal from '../PinCelebrationModal';
import { CONFETTI, PIN_CELEBRATION } from '../PinCelebrationModal.palette';
import { TIER_TEXT } from '../tierText.palette';

const pin = PINS[0]!;

afterEach(() => jest.restoreAllMocks());

describe('PinCelebrationModal', () => {
  it('renders confetti particle views on a normal (non-reduced-motion) claim celebration', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[pin.id]} />);

    await waitFor(() => {
      expect(screen.getByTestId(`pin-celebration-confetti-${pin.id}-0`)).toBeTruthy();
    });
  });

  it('renders no confetti particle views when reduce-motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[pin.id]} />);

    // Give the async reduce-motion check a tick to resolve.
    await waitFor(
      () => {
        expect(screen.queryByTestId(`pin-celebration-confetti-${pin.id}-0`)).toBeNull();
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId(`pin-celebration-${pin.id}`)).toBeTruthy();
  });

  it('renders no position line when `position` is omitted (single, non-batched claim)', () => {
    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[pin.id]} />);
    expect(screen.queryByTestId('pin-celebration-position')).toBeNull();
  });

  it('renders no position line when `position.total` is 1', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 1, total: 1 }}
      />,
    );
    expect(screen.queryByTestId('pin-celebration-position')).toBeNull();
  });

  it('renders the exact "{index} of {total}" position line when total > 1', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 2, total: 5 }}
      />,
    );
    expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('2 of 5');
  });

  it('renders a "Skip all" button when in a multi-pin batch with remaining pins and calls onSkipAll when pressed (Requirement 23.8)', () => {
    const onSkipAll = jest.fn();
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 1, total: 3 }}
        onSkipAll={onSkipAll}
      />,
    );

    const skipAllButton = screen.getByTestId('pin-celebration-skip-all');
    expect(skipAllButton).toHaveTextContent('Skip all');
    fireEvent.press(skipAllButton);
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });

  it('does not render "Skip all" on the final pin of a batch (index === total)', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 3, total: 3 }}
        onSkipAll={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('pin-celebration-skip-all')).toBeNull();
  });

  it('does not render "Skip all" when position is omitted or total <= 1', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        onSkipAll={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('pin-celebration-skip-all')).toBeNull();
  });

  it('renders "Awesome!" on the primary button for a single/non-batched claim', () => {
    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[pin.id]} />);
    expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Awesome!');
  });

  it('renders "Next" on the primary button when more pins remain in the queue (index < total)', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 1, total: 3 }}
      />,
    );
    expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Next');
  });

  it('renders "Awesome!" on the primary button on the final pin of a batch (index === total)', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        position={{ index: 3, total: 3 }}
      />,
    );
    expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Awesome!');
  });

  it('honors a custom dismissLabel prop if provided', () => {
    render(
      <PinCelebrationModal
        visible
        onClose={jest.fn()}
        pinIds={[pin.id]}
        dismissLabel="Continue"
      />,
    );
    expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Continue');
  });
});

describe('PinCelebrationModal — dark mode', () => {
  afterEach(resetTestScheme);

  const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
  const amethystPin = PINS.find((p) => p.tier === 'amethyst')!;

  /** Nearest host ancestor (exclusive) whose flattened style paints a backgroundColor. */
  function backdropOf(node: ReactTestInstance): unknown {
    let cur: ReactTestInstance | null = node.parent;
    while (cur !== null) {
      if (typeof cur.type === 'string' && flat(cur).backgroundColor !== undefined) {
        return flat(cur).backgroundColor;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  it('(a)(b)(c) sheet, heading, tier Badge text and confetti use dark values', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    setTestScheme('dark');
    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[amethystPin.id]} />);

    // (a) the modal sheet paints the dark surface, with the dark-only outline.
    const sheet = screen.getByTestId('pin-celebration-modal');
    expect(flat(sheet).backgroundColor).toBe(darkTheme.color.surface);
    expect(flat(sheet).borderColor).toBe(darkTheme.color.border);
    expect(backdropOf(sheet)).toBe(PIN_CELEBRATION.dark.backdrop);
    // (b) primary text.
    expect(flat(screen.getByTestId('pin-celebration-heading')).color).toBe(darkTheme.color.textPrimary);
    // (c) rule 7: the tier Badge text uses the legible dark tier text colour.
    const cell = screen.getByTestId(`pin-celebration-${amethystPin.id}`);
    expect(flat(within(cell).getByText(TIER_LABEL.amethyst)).color).toBe(TIER_TEXT.dark.amethyst);
    expect(TIER_TEXT.dark.amethyst).not.toBe(TIER_COLOR.amethyst);
    // Confetti hues resolve at render time: index 0 = primary, index 2 = the art gold.
    await waitFor(() => {
      expect(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-0`)).toBeTruthy();
    });
    expect(
      flat(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-0`)).backgroundColor,
    ).toBe(darkTheme.color.primary);
    expect(
      flat(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-2`)).backgroundColor,
    ).toBe(CONFETTI.dark.gold);
  });

  it('keeps the pre-retrofit light values under light', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    render(<PinCelebrationModal visible onClose={jest.fn()} pinIds={[amethystPin.id]} />);

    const sheet = screen.getByTestId('pin-celebration-modal');
    expect(flat(sheet).backgroundColor).toBe('#ffffff');
    expect(flat(sheet).borderWidth).toBe(0); // zero-width light outline (no visible border)
    expect(backdropOf(sheet)).toBe('rgba(10,7,20,0.72)');
    const cell = screen.getByTestId(`pin-celebration-${amethystPin.id}`);
    expect(flat(within(cell).getByText(TIER_LABEL.amethyst)).color).toBe(TIER_COLOR.amethyst);
    await waitFor(() => {
      expect(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-0`)).toBeTruthy();
    });
    expect(
      flat(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-0`)).backgroundColor,
    ).toBe('#5b2a86');
    expect(
      flat(screen.getByTestId(`pin-celebration-confetti-${amethystPin.id}-1`)).backgroundColor,
    ).toBe('#f6c343');
  });
});

