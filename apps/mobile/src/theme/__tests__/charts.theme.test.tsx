/**
 * Dark-mode retrofit — the chart primitives (`theme/charts.tsx`) render with
 * the Active theme's tokens (Property 16, chart rows), including the
 * iteration-3 non-text-graphics changes: `RatingHistogram` bars use
 * `gradient.chartBar`, `ProgressBar`'s default fill and `ProgressRing`'s
 * default arc end use `primaryFg`. Light deep-equals today's literals.
 *
 * Validates: Requirements 7.5, 9.1, 9.3
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Circle, Stop } from 'react-native-svg';
import fc from 'fast-check';

import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import {
  CompleteBadge,
  ProgressBar,
  ProgressRing,
  RatingDial,
  RatingHistogram,
  type RatingDistribution,
} from '../charts';
import { themes } from '../theme';

type Scheme = 'light' | 'dark';

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
const gradients = (): unknown[] =>
  screen.UNSAFE_getAllByType(LinearGradient).map((n) => n.props.colors as unknown);

const DIST: RatingDistribution = { 1: 0, 2: 1, 3: 0, 4: 2, 5: 0, 6: 0, 7: 3, 8: 6, 9: 2, 10: 1 };

type Case = { readonly name: string; readonly check: (s: Scheme) => void };

const CASES: readonly Case[] = [
  {
    name: 'ProgressRing (default)',
    check: (s) => {
      const t = themes[s];
      render(
        <ProgressRing percent={42} centerLabel="42%" centerSubLabel="4 / 10" accessibilityLabel="ring" />,
      );
      const circles = screen.UNSAFE_getAllByType(Circle);
      expect(circles[0]!.props.stroke).toBe(t.color.surfaceAlt);
      expect(screen.UNSAFE_getAllByType(Stop).map((n) => n.props.stopColor)).toEqual([
        t.color.primaryLight,
        t.color.primaryFg,
      ]);
      expect(flat(screen.getByText('42%')).color).toBe(t.color.primaryFg);
      expect(flat(screen.getByText('4 / 10')).color).toBe(t.color.textSecondary);
    },
  },
  {
    name: 'ProgressRing (complete)',
    check: (s) => {
      render(<ProgressRing percent={100} complete accessibilityLabel="ring" />);
      expect(screen.UNSAFE_getAllByType(Stop).map((n) => n.props.stopColor)).toEqual([
        ...themes[s].gradient.gold,
      ]);
    },
  },
  {
    name: 'ProgressBar (default)',
    check: (s) => {
      render(<ProgressBar percent={30} accessibilityLabel="bar" testID="bar" />);
      const track = screen.getByTestId('bar');
      expect(flat(track).backgroundColor).toBe(themes[s].color.surfaceAlt);
      const fill = track.children[0] as { props: { style?: unknown } };
      expect(flat(fill).backgroundColor).toBe(themes[s].color.primaryFg);
    },
  },
  {
    name: 'ProgressBar (complete)',
    check: (s) => {
      render(<ProgressBar percent={100} complete accessibilityLabel="bar" />);
      expect(gradients()).toEqual([themes[s].gradient.gold]);
    },
  },
  {
    name: 'RatingHistogram',
    check: (s) => {
      const t = themes[s];
      render(<RatingHistogram distribution={DIST} accessibilityLabel="hist" />);
      const colors = gradients();
      expect(colors).toHaveLength(10);
      // Bin 8 (index 7) is the tallest → gold; every other bar is chartBar.
      colors.forEach((c, i) => expect(c).toEqual(i === 7 ? t.gradient.gold : t.gradient.chartBar));
      expect(flat(screen.getByText('1')).color).toBe(t.color.textSecondary);
    },
  },
  {
    name: 'RatingDial',
    check: (s) => {
      const t = themes[s];
      render(<RatingDial average={7.4} accessibilityLabel="dial" />);
      expect(flat(screen.getByText('7.4')).color).toBe(t.color.primaryFg);
      expect(flat(screen.getByText('/10')).color).toBe(t.color.textSecondary);
      const stars = screen.UNSAFE_getAllByType(Ionicons).map((n) => n.props.color);
      expect(stars).toHaveLength(10);
      expect(new Set(stars)).toEqual(new Set([t.color.accent]));
    },
  },
  {
    name: 'CompleteBadge',
    check: (s) => {
      const t = themes[s];
      render(<CompleteBadge />);
      expect(gradients()).toEqual([t.gradient.gold]);
      expect(flat(screen.getByText('Complete!')).color).toBe(t.color.textOnAccent);
      expect(screen.UNSAFE_getByType(Ionicons).props.color).toBe(t.color.textOnAccent);
    },
  },
];

afterEach(resetTestScheme);

describe('Property 16 (charts): chart primitives render with the active theme tokens', () => {
  // Feature: dark-mode, Property 16: kit primitives render with the active theme's tokens
  it('every chart primitive × scheme renders the token-mapping table', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CASES), fc.constantFrom<Scheme>('light', 'dark'), (c, s) => {
        setTestScheme(s);
        try {
          c.check(s);
        } finally {
          screen.unmount();
          resetTestScheme();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("light chart colours deep-equal today's literal values", () => {
    render(
      <>
        <RatingHistogram distribution={DIST} accessibilityLabel="hist" />
        <ProgressBar percent={30} accessibilityLabel="bar" testID="bar" />
        <ProgressRing percent={50} accessibilityLabel="ring" />
      </>,
    );
    expect(gradients()[0]).toEqual(['#7e57c2', '#5b2a86', '#3d1c5c']);
    const fill = screen.getByTestId('bar').children[0] as { props: { style?: unknown } };
    expect(flat(fill).backgroundColor).toBe('#5b2a86');
    expect(screen.UNSAFE_getAllByType(Stop).map((n) => n.props.stopColor)).toEqual([
      '#7e57c2',
      '#5b2a86',
    ]);
  });

  it('dark chart bars and progress marks use the iteration-3 values', () => {
    setTestScheme('dark');
    render(
      <>
        <RatingHistogram distribution={DIST} accessibilityLabel="hist" />
        <ProgressBar percent={30} accessibilityLabel="bar" testID="bar" />
      </>,
    );
    expect(gradients()[0]).toEqual(['#c4a3ff', '#9d7ae0', '#7e57c2']);
    const fill = screen.getByTestId('bar').children[0] as { props: { style?: unknown } };
    expect(flat(fill).backgroundColor).toBe('#c4a3ff');
  });
});
