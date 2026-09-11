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
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PINS } from '@dwt/shared';

import PinCelebrationModal from '../PinCelebrationModal';

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
    await waitFor(() => {
      expect(screen.queryByTestId(`pin-celebration-confetti-${pin.id}-0`)).toBeNull();
    });
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
});
