// Feature: dark-mode visual-verify pass (Requirement 9.12) — LensSwitcher active segment.
//
// Found on emulator-5554: in dark the active segment was `surface` (#1e1430) on the
// `surfaceAlt` (#2a1d42) track, so the selected pill read as a darker hole. It now uses
// `borderStrong`, lighter than the track, exactly like the Expenses tab switcher (Fix 3).

import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import LensSwitcher, { type LensMode } from '../LensSwitcher';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { contrastRatio } from '../../../theme/contrast';
import { darkTheme } from '../../../theme/theme';

const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};

/** Holds the active lens so a press really moves the selection. */
function Harness(): JSX.Element {
  const [lens, setLens] = useState<LensMode>('today');
  return <LensSwitcher activeLens={lens} onChangeLens={setLens} />;
}

describe('LensSwitcher in dark', () => {
  afterEach(resetTestScheme);

  it('raises the active segment above the track and moves it on press', () => {
    setTestScheme('dark');
    render(<Harness />);

    const track = flat(screen.getByTestId('lens-switcher')).backgroundColor as string;
    expect(track).toBe(darkTheme.color.surfaceAlt);

    const today = flat(screen.getByTestId('lens-tab-today'));
    expect(today.backgroundColor).toBe(darkTheme.color.borderStrong);
    expect(today.backgroundColor).not.toBe(darkTheme.color.surface);
    // Lighter than the track (it was darker before the fix).
    expect(contrastRatio(today.backgroundColor as string, '#000000')).toBeGreaterThan(
      contrastRatio(track, '#000000'),
    );
    expect(flat(screen.getByTestId('lens-tab-passport')).backgroundColor).toBeUndefined();
    // The active label stays legible on the raised segment.
    expect(flat(screen.getByText('Today in Park')).color).toBe(darkTheme.color.primaryFg);
    expect(
      contrastRatio(darkTheme.color.primaryFg, today.backgroundColor as string),
    ).toBeGreaterThanOrEqual(4.5);

    fireEvent.press(screen.getByTestId('lens-tab-passport'));
    expect(flat(screen.getByTestId('lens-tab-passport')).backgroundColor).toBe(
      darkTheme.color.borderStrong,
    );
    expect(flat(screen.getByTestId('lens-tab-today')).backgroundColor).toBeUndefined();
    expect(flat(screen.getByText('My Passport & Lore')).color).toBe(darkTheme.color.primaryFg);
    expect(flat(screen.getByText('Today in Park')).color).toBe(darkTheme.color.textSecondary);
  });

  it('keeps today\'s white active segment in light, including after a live dark→light switch', () => {
    setTestScheme('dark');
    render(<Harness />);
    expect(flat(screen.getByTestId('lens-tab-today')).backgroundColor).toBe(
      darkTheme.color.borderStrong,
    );

    setTestScheme('light');
    expect(flat(screen.getByTestId('lens-tab-today')).backgroundColor).toBe('#ffffff');
    expect(flat(screen.getByText('Today in Park')).color).toBe('#5b2a86');
    expect(flat(screen.getByText('My Passport & Lore')).color).toBe('#655d78');
  });
});
