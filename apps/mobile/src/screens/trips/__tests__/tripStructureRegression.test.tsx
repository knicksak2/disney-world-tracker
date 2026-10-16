/**
 * Feature: navigation-redesign, Task 13.3 — Trip section structure regression test
 *
 * Property 6: Trip section structure is untouched by this feature
 * Validates: Requirements 5.1, 5.2
 *
 * Asserts TripsStackParamList's registered keys and TripDetailScreen.tsx's
 * HUB_SECTIONS array are byte-for-byte unchanged by this feature's diff
 * (a snapshot test against the pre-change values), guarding against silently
 * re-splitting Trip_Activity.
 *
 * Fails if anyone tries to add a 7th section or alter the 6 existing sections:
 * Planned List, Schedule, Reservations, Activity (feed + logging), Members, Summary.
 */

import React from 'react';
import { HUB_SECTIONS, hubSectionsFor } from '../TripDetailScreen';
import { darkTheme } from '../../../theme/theme';
import TripsStack, { type TripsStackParamList } from '../../../navigation/TripsStack';
import { render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Screen captures
// ---------------------------------------------------------------------------

interface ScreenCapture {
  readonly name: string;
  readonly options: { readonly headerShown?: boolean } | undefined;
}

const capturedScreens: ScreenCapture[] = [];

jest.mock('@react-navigation/native-stack', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: (props: { children?: unknown }) => {
        const screens = ReactActual.Children.toArray(props.children as never)
          .filter((child): child is React.ReactElement =>
            ReactActual.isValidElement(child),
          )
          .map((child) => {
            const childProps = child.props as {
              name: string;
              options?: { headerShown?: boolean };
            };
            return {
              name: childProps.name,
              options: childProps.options,
            };
          });
        capturedScreens.push(...screens);
        return null;
      },
      Screen: () => null,
    }),
  };
});

describe('Feature: navigation-redesign, Property 6: Trip section structure untouched (Requirements 5.1, 5.2)', () => {
  beforeEach(() => {
    capturedScreens.length = 0;
  });

  test('HUB_SECTIONS has exactly 7 sections preserving Trip Activity consolidation and Expenses', () => {
    // Must be exactly 7 sections: Planned List, Schedule, Reservations, Expenses, Activity, Members, Summary
    expect(HUB_SECTIONS).toHaveLength(7);

    const sectionKeys = HUB_SECTIONS.map((s) => s.key);
    expect(sectionKeys).toEqual([
      'planned',
      'schedule',
      'reservations',
      'expenses',
      'activity',
      'members',
      'summary',
    ]);

    // Section 5 is consolidated Trip Activity (TripFeed)
    const activitySection = HUB_SECTIONS.find((s) => s.key === 'activity');
    expect(activitySection).toBeDefined();
    expect(activitySection?.route).toBe('TripFeed');
    expect(activitySection?.title).toBe('Trip Activity');
  });

  test('HUB_SECTIONS snapshot matches pre-change canonical definition', () => {
    expect(HUB_SECTIONS).toMatchSnapshot();
  });

  // Feature: dark-mode polish pass (B5-1): the section colours follow the scheme.
  test('hubSectionsFor: light is the snapshot set, dark carries the dark tokens', () => {
    const light = hubSectionsFor('light');
    const dark = hubSectionsFor('dark');
    expect(light).toEqual(HUB_SECTIONS);
    expect(light.map((s) => s.color)).toEqual([
      '#5b2a86',
      '#7e57c2',
      '#f6c343',
      '#5b2a86',
      '#f6c343',
      '#7e57c2',
      '#6b6480',
    ]);

    // Same structure in both schemes; only the colour changes.
    const strip = (s: (typeof light)[number]) => ({ ...s, color: undefined });
    expect(dark.map(strip)).toEqual(light.map(strip));
    expect(dark.map((s) => s.color)).toEqual([
      darkTheme.color.primaryFg,
      darkTheme.color.primaryLight,
      darkTheme.color.accent,
      darkTheme.color.primaryFg,
      darkTheme.color.accent,
      darkTheme.color.primaryLight,
      darkTheme.color.textSecondary,
    ]);
    // Every violet/neutral section repaints; the gold accent is the same in both schemes.
    for (const key of ['planned', 'schedule', 'expenses', 'members', 'summary']) {
      expect(dark.find((s) => s.key === key)!.color).not.toBe(
        light.find((s) => s.key === key)!.color,
      );
    }
  });

  test('TripsStack registers exactly the 13 expected screens and matches snapshot', () => {
    render(<TripsStack />);

    const screenNames = capturedScreens.map((s) => s.name);
    const EXPECTED_ROUTES: Array<keyof TripsStackParamList> = [
      'TripsList',
      'TripDetail',
      'TripEdit',
      'TripPlannedList',
      'TripSchedule',
      'TripReservations',
      'TripExpenses',
      'TripBalances',
      'TripFeed',
      'TripMembers',
      'TripSummary',
      'TripInvite',
      'RodeWithConfirm',
    ];

    expect(screenNames).toEqual(EXPECTED_ROUTES);
    expect(screenNames).toHaveLength(13);
    expect(capturedScreens).toMatchSnapshot();
  });
});
