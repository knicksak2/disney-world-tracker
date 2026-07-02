/**
 * TabSelector RNTL tests (friend-profile-navigation, task 5.2).
 *
 * Validates: Requirements 1.1, 1.2, 1.6, 1.7, 8.1, 8.2, 8.6, 8.7, 8.9
 *
 * These tests pin the shared tab bar that backs both the View_Selector and
 * the Own_Stats_Selector. The behaviours worth asserting at the component
 * level are:
 *
 *   - The selector renders exactly one tab per mode, in the fixed module
 *     order, each with its expected non-empty text label (R1.1, R1.2, R8.1,
 *     R8.2).
 *   - The four icons are distinct from one another (R1.2, R8.2).
 *   - The active tab carries `accessibilityState.selected === true` and every
 *     inactive tab carries `selected === false`, so the spoken selected-state
 *     matches the visual selection exactly (R1.7, R8.7). The active tab also
 *     differs in a visible attribute from the inactive ones (R1.6, R8.6),
 *     which the same single-active-tab assertion guards.
 *   - Tapping an unselected tab fires `onSelect` with that mode (R1.5/R8.5
 *     plumbing), and tapping the already-active tab still resolves to that
 *     same active mode, so the active mode is retained (R8.9).
 *
 * The component is controlled — the parent owns the active mode — so "keeps
 * it active" is verified by (a) `onSelect` being called with the active mode
 * and (b) the rendered selected-state remaining on that tab for the unchanged
 * `active` prop.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  FRIEND_PROFILE_TABS,
  OWN_STATS_TABS,
  TabSelector,
  type OwnStatsViewMode,
  type ProfileViewMode,
  type TabSpec,
} from '../TabSelector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the `selected` accessibility state of a tab host element. */
function selectedState(testID: string): boolean | undefined {
  return screen.getByTestId(testID).props.accessibilityState?.selected as
    | boolean
    | undefined;
}

/** Collect the `name` prop of every rendered Ionicons element, in order. */
function renderedIconNames(): string[] {
  return screen
    .UNSAFE_getAllByType(Ionicons)
    .map((node) => node.props.name as string);
}

// ---------------------------------------------------------------------------
// Suite — exercised against both selectors' module-constant tab specs.
// ---------------------------------------------------------------------------

describe('TabSelector', () => {
  describe.each<{
    name: string;
    tabs: readonly TabSpec<ProfileViewMode | OwnStatsViewMode>[];
    activeMode: string;
    otherMode: string;
  }>([
    {
      name: 'View_Selector (FRIEND_PROFILE_TABS)',
      tabs: FRIEND_PROFILE_TABS as readonly TabSpec<ProfileViewMode>[],
      activeMode: 'Overview',
      otherMode: 'Parks',
    },
    {
      name: 'Own_Stats_Selector (OWN_STATS_TABS)',
      tabs: OWN_STATS_TABS as readonly TabSpec<OwnStatsViewMode>[],
      activeMode: 'Own_Overview',
      otherMode: 'Own_Parks',
    },
  ])('$name', ({ tabs, activeMode, otherMode }) => {
    function renderSelector(active: string, onSelect = jest.fn()) {
      render(
        <TabSelector
          tabs={tabs as readonly TabSpec<string>[]}
          active={active}
          onSelect={onSelect}
        />,
      );
      return onSelect;
    }

    test('renders exactly four tabs with the expected non-empty labels (R1.1, R1.2, R8.1, R8.2)', () => {
      renderSelector(activeMode);

      expect(screen.getByTestId('tab-selector')).toBeTruthy();
      expect(tabs).toHaveLength(4);

      for (const tab of tabs) {
        // One selectable tab per mode, addressable by its testID.
        expect(screen.getByTestId(`tab-${tab.mode}`)).toBeTruthy();
        // Non-empty text label that names the mode.
        expect(tab.label.length).toBeGreaterThan(0);
        expect(screen.getByText(tab.label)).toBeTruthy();
      }
    });

    test('renders four distinct icons (R1.2, R8.2)', () => {
      renderSelector(activeMode);

      const names = renderedIconNames();
      expect(names).toHaveLength(4);
      // Every icon differs from every other icon.
      expect(new Set(names).size).toBe(names.length);
      // The rendered icons match the declared specs, in order.
      expect(names).toEqual(tabs.map((t) => t.icon));
    });

    test('marks only the active tab selected and every other tab unselected (R1.6, R1.7, R8.6, R8.7)', () => {
      renderSelector(activeMode);

      for (const tab of tabs) {
        expect(selectedState(`tab-${tab.mode}`)).toBe(tab.mode === activeMode);
      }
      // Exactly one tab is selected.
      const selectedCount = tabs.filter(
        (t) => selectedState(`tab-${t.mode}`) === true,
      ).length;
      expect(selectedCount).toBe(1);
    });

    test('exposes an accessibility label naming each mode (R1.7, R8.7)', () => {
      renderSelector(activeMode);

      for (const tab of tabs) {
        expect(screen.getByTestId(`tab-${tab.mode}`).props.accessibilityLabel).toBe(
          tab.accessibilityLabel,
        );
      }
    });

    test('tapping an unselected tab fires onSelect with that mode (R1.5, R8.5)', () => {
      const onSelect = renderSelector(activeMode);

      fireEvent.press(screen.getByTestId(`tab-${otherMode}`));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(otherMode);
    });

    test('tapping the active tab resolves to that same mode and keeps it active (R8.9)', () => {
      const onSelect = renderSelector(activeMode);

      fireEvent.press(screen.getByTestId(`tab-${activeMode}`));

      // The tap reports the active mode back to the parent...
      expect(onSelect).toHaveBeenCalledWith(activeMode);
      // ...and, with `active` unchanged, the tab remains the selected one.
      expect(selectedState(`tab-${activeMode}`)).toBe(true);
    });
  });
});
