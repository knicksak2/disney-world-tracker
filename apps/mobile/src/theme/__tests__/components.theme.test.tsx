/**
 * Dark-mode retrofit — the shared kit (`theme/components.tsx`) renders with
 * the Active theme's tokens (Property 16) and a mounted tree repaints live
 * without a remount (Property 17).
 *
 * Renders the real components; only the OS colour scheme is mocked (the
 * descriptor-copy `useColorScheme` mock from `useActiveTheme.test.tsx`) and
 * AsyncStorage (the global automatic mock).
 *
 * Validates: Requirements 7.5, 8.2, 9.1, 9.3
 */

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  descriptors.useColorScheme = {
    value: jest.fn(() => 'light'),
    writable: true,
    enumerable: true,
    configurable: true,
  };
  return Object.defineProperties({}, descriptors);
});

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import fc from 'fast-check';

import { useThemeStore } from '../../state/themeStore';
import { resetTestScheme, setTestOsScheme, setTestScheme } from '../../test/themeTestUtils';
import { resolveActiveTheme, type AppearancePreference } from '../appearance';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  SectionLabel,
} from '../components';
import { DANGER_BUTTON, HEADER } from '../components.palette';
import { themes, withAlpha } from '../theme';

type Scheme = 'light' | 'dark';

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
const iconColors = (): string[] =>
  screen.UNSAFE_getAllByType(Ionicons).map((n) => n.props.color as string);
const gradientColors = (): unknown[] =>
  screen.UNSAFE_getAllByType(LinearGradient).map((n) => n.props.colors as unknown);

/** One kit primitive: render it, then assert its colours against `themes[s]`. */
type Case = { readonly name: string; readonly check: (s: Scheme) => void };

const CASES: readonly Case[] = [
  {
    name: 'ScreenContainer',
    check: (s) => {
      render(<ScreenContainer testID="screen"><Text>x</Text></ScreenContainer>);
      expect(flat(screen.getByTestId('screen')).backgroundColor).toBe(themes[s].color.background);
    },
  },
  {
    name: 'Card',
    check: (s) => {
      render(<Card testID="card"><Text>x</Text></Card>);
      const style = flat(screen.getByTestId('card'));
      expect(style.backgroundColor).toBe(themes[s].color.surface);
      expect(style.shadowColor).toBe(themes[s].shadow.card.shadowColor);
      if (s === 'dark') {
        expect(style.borderColor).toBe(themes.dark.color.border);
        expect(style.borderWidth).toBe(StyleSheet.hairlineWidth);
      } else {
        // Light explicitly zeroes the border (draws nothing) so a live
        // dark→light switch clears the dark hairline on Android.
        expect(style.borderWidth).toBe(0);
        expect(style.borderColor).toBeUndefined();
      }
    },
  },
  {
    name: 'Chip (idle)',
    check: (s) => {
      render(<Chip label="Ride" active={false} onPress={() => {}} testID="chip" />);
      const style = flat(screen.getByTestId('chip'));
      expect(style.backgroundColor).toBe(themes[s].color.surfaceAlt);
      expect(style.borderColor).toBe(themes[s].color.border);
      expect(flat(screen.getByText('Ride')).color).toBe(themes[s].color.textSecondary);
    },
  },
  {
    name: 'Chip (active)',
    check: (s) => {
      render(<Chip label="Ride" active onPress={() => {}} testID="chip" />);
      const style = flat(screen.getByTestId('chip'));
      expect(style.backgroundColor).toBe(themes[s].color.primary);
      expect(style.borderColor).toBe(themes[s].color.primary);
      expect(flat(screen.getByText('Ride')).color).toBe(themes[s].color.textOnPrimary);
    },
  },
  {
    name: 'SecondaryButton (neutral)',
    check: (s) => {
      render(<SecondaryButton label="Open" icon="open-outline" onPress={() => {}} testID="btn" />);
      const style = flat(screen.getByTestId('btn'));
      expect(style.backgroundColor).toBe(themes[s].color.surfaceAlt);
      expect(style.borderColor).toBe(themes[s].color.borderStrong);
      expect(flat(screen.getByText('Open')).color).toBe(themes[s].color.primaryFg);
      expect(iconColors()).toEqual([themes[s].color.primaryFg]);
    },
  },
  {
    name: 'SecondaryButton (danger)',
    check: (s) => {
      render(
        <SecondaryButton label="Decline" icon="close" tone="danger" onPress={() => {}} testID="btn" />,
      );
      const style = flat(screen.getByTestId('btn'));
      expect(style.backgroundColor).toBe(DANGER_BUTTON[s].bg);
      expect(style.borderColor).toBe(DANGER_BUTTON[s].border);
      expect(flat(screen.getByText('Decline')).color).toBe(themes[s].color.danger);
      expect(iconColors()).toEqual([themes[s].color.danger]);
    },
  },
  {
    name: 'PrimaryButton',
    check: (s) => {
      render(<PrimaryButton label="Accept" icon="checkmark" onPress={() => {}} />);
      expect(gradientColors()).toEqual([themes[s].gradient.header]);
      expect(flat(screen.getByText('Accept')).color).toBe(themes[s].color.textOnPrimary);
      expect(iconColors()).toEqual([themes[s].color.textOnPrimary]);
    },
  },
  {
    name: 'Badge (default colour)',
    check: (s) => {
      render(<Badge label="Fantasyland" icon="map" testID="badge" />);
      const fg = themes[s].color.primaryFg;
      expect(flat(screen.getByText('Fantasyland')).color).toBe(fg);
      expect(flat(screen.getByTestId('badge')).backgroundColor).toBe(withAlpha(fg, 0.14));
      expect(iconColors()).toEqual([fg]);
    },
  },
  {
    name: 'GradientHeader',
    check: (s) => {
      render(<GradientHeader title="Trips" subtitle="Plan" eyebrow="Hello" icon="map" onBack={() => {}} />);
      expect(gradientColors()).toEqual([themes[s].gradient.headerVivid]);
      expect(flat(screen.getByText('Trips')).color).toBe(themes[s].color.textOnPrimary);
      expect(flat(screen.getByText('Hello')).color).toBe(HEADER[s].eyebrowText);
      // sparkles, star, back arrow, title icon
      expect(iconColors()).toEqual([
        'rgba(255,255,255,0.35)',
        'rgba(255,255,255,0.25)',
        themes[s].color.textOnPrimary,
        themes[s].color.accent,
      ]);
    },
  },
  {
    name: 'SectionLabel',
    check: (s) => {
      render(<SectionLabel>Upcoming</SectionLabel>);
      expect(flat(screen.getByText('Upcoming')).color).toBe(themes[s].color.textPrimary);
    },
  },
  {
    name: 'EmptyState',
    check: (s) => {
      render(<EmptyState title="Nothing yet" body="Add one" testID="empty" />);
      expect(flat(screen.getByText('Nothing yet')).color).toBe(themes[s].color.textPrimary);
      expect(flat(screen.getByText('Add one')).color).toBe(themes[s].color.textSecondary);
      expect(iconColors()).toEqual([themes[s].color.primaryFg]);
      const circle = screen.getByTestId('empty').children[0] as { props: { style?: unknown } };
      expect(flat(circle).backgroundColor).toBe(themes[s].color.surfaceAlt);
    },
  },
];

afterEach(resetTestScheme);

describe('Property 16: kit primitives render with the active theme tokens', () => {
  // Feature: dark-mode, Property 16: kit primitives render with the active theme's tokens
  it('every primitive × scheme renders the token-mapping table', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CASES),
        fc.constantFrom<Scheme>('light', 'dark'),
        (c, s) => {
          setTestScheme(s);
          try {
            c.check(s);
          } finally {
            screen.unmount();
            resetTestScheme();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('light renders exactly the pre-retrofit literal values', () => {
    render(
      <>
        <Card testID="card"><Text>x</Text></Card>
        <Badge label="B" testID="badge" />
        <SecondaryButton label="No" tone="danger" onPress={() => {}} testID="danger" />
        <SecondaryButton label="Yes" onPress={() => {}} />
        <PrimaryButton label="Go" onPress={() => {}} />
        <GradientHeader title="T" eyebrow="E" />
      </>,
    );
    const card = flat(screen.getByTestId('card'));
    expect(card.backgroundColor).toBe('#ffffff');
    expect(card.shadowColor).toBe('#3d1c5c');
    expect(card.borderWidth).toBe(0); // zero width = visually no border, as before
    expect(flat(screen.getByTestId('badge')).backgroundColor).toBe('rgba(91, 42, 134, 0.14)');
    expect(flat(screen.getByText('B')).color).toBe('#5b2a86');
    expect(flat(screen.getByTestId('danger')).backgroundColor).toBe('#fdebf2');
    expect(flat(screen.getByTestId('danger')).borderColor).toBe('#f3b6cf');
    expect(flat(screen.getByText('Yes')).color).toBe('#5b2a86');
    expect(flat(screen.getByText('E')).color).toBe('#ffd54f');
    expect(gradientColors()).toEqual([
      ['#5b2a86', '#3d1c5c'],
      ['#7e57c2', '#5b2a86', '#3d1c5c'],
    ]);
  });

  it('a custom Badge colour is used verbatim for text and its 14% tint in both schemes', () => {
    for (const s of ['light', 'dark'] as const) {
      setTestScheme(s);
      render(<Badge label="EPCOT" color="#5aa2ff" testID="badge" />);
      expect(flat(screen.getByText('EPCOT')).color).toBe('#5aa2ff');
      expect(flat(screen.getByTestId('badge')).backgroundColor).toBe('rgba(90, 162, 255, 0.14)');
      screen.unmount();
    }
  });
});

describe('Property 17: a mounted tree repaints live without remount', () => {
  function Tree(): JSX.Element {
    return (
      <ScreenContainer testID="screen">
        <Card testID="card">
          <Chip label="Ride" active onPress={() => {}} testID="chip" />
        </Card>
      </ScreenContainer>
    );
  }

  // Feature: dark-mode, Property 17: a mounted tree repaints live without remount
  it('the same host instances report the resolved theme colours after every preference change', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<AppearancePreference>('system', 'light', 'dark'), {
          minLength: 1,
          maxLength: 10,
        }),
        (prefs) => {
          setTestOsScheme('dark');
          act(() => {
            useThemeStore.setState({ preference: 'light' });
          });
          render(<Tree />);
          const screenNode = screen.getByTestId('screen');
          const cardNode = screen.getByTestId('card');
          const chipNode = screen.getByTestId('chip');
          const label = screen.getByText('Ride');
          try {
            for (const pref of prefs) {
              act(() => {
                useThemeStore.setState({ preference: pref });
              });
              const t = themes[resolveActiveTheme(pref, 'dark')];
              expect(screen.getByTestId('screen')).toBe(screenNode);
              expect(screen.getByTestId('card')).toBe(cardNode);
              expect(screen.getByTestId('chip')).toBe(chipNode);
              expect(screen.getByText('Ride')).toBe(label);
              expect(flat(screenNode).backgroundColor).toBe(t.color.background);
              expect(flat(cardNode).backgroundColor).toBe(t.color.surface);
              expect(flat(chipNode).backgroundColor).toBe(t.color.primary);
              expect(flat(label).color).toBe(t.color.textOnPrimary);
            }
          } finally {
            screen.unmount();
            resetTestScheme();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Regression (spec task 11 screenshot pass): after a live dark→light switch
  // the mounted Card must carry an explicit `borderWidth: 0`. When light's
  // outline was `{}` the key simply vanished from the style, Android never
  // reset the native border, and `overflow: 'hidden'` cards (You & Crew's
  // Shared Items tiles) rendered blank with rectangular elevation halos.
  it('a live dark→light switch explicitly clears the dark card hairline', () => {
    setTestOsScheme('light');
    act(() => {
      useThemeStore.setState({ preference: 'dark' });
    });
    render(<Tree />);
    const cardNode = screen.getByTestId('card');
    try {
      expect(flat(cardNode).borderWidth).toBe(StyleSheet.hairlineWidth);
      expect(flat(cardNode).borderColor).toBe(themes.dark.color.border);
      act(() => {
        useThemeStore.setState({ preference: 'light' });
      });
      expect(screen.getByTestId('card')).toBe(cardNode);
      expect(flat(cardNode).borderWidth).toBe(0);
    } finally {
      screen.unmount();
      resetTestScheme();
    }
  });
});
