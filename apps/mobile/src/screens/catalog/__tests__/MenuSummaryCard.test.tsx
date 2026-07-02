// Feature: restaurant-menu-display, Task 5.2 — MenuSummaryCard interaction/state example tests
//
// Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6
//
// These example (non-property) tests mount the real `MenuSummaryCard` in
// isolation with a stub `navigation` object (a `jest.fn()` `navigate`) and
// assert its render-state matrix and the single navigation interaction:
//
//   - non-restaurant category      → renders nothing (R4.6)
//   - restaurant + isLoading       → a loading indicator, no card content (R4.3)
//   - restaurant + isError         → renders nothing (R4.5)
//   - restaurant + no menus        → empty state, not pressable / no navigate (R4.4)
//   - restaurant + menus present   → tapping the card navigates to the
//                                    Menu_Screen with { experienceId } (R4.2)
//
// The card is a pure function of its props (category / menus / isLoading /
// isError), so it is rendered directly rather than through the full detail
// screen + navigation container — the stub navigation captures the single
// `navigate('Menu', { experienceId })` call the card can make.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type { ExperienceCategory, MenuDTO } from '@dwt/shared';

import MenuSummaryCard from '../MenuSummaryCard';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = 'exp-restaurant-1';

/** A representative two-menu list carrying distinct menu types. */
const MENUS: readonly MenuDTO[] = [
  {
    menuType: 'Breakfast',
    cuisineType: 'American',
    groups: [{ name: 'Mains', items: [{ name: 'Pancakes', price: '$12' }] }],
  },
  {
    menuType: 'Dinner',
    cuisineType: null,
    groups: [{ name: 'Entrees', items: [{ name: 'Steak', price: '$40' }] }],
  },
];

/**
 * A stub navigation prop exposing only the `navigate` spy the card uses.
 * Cast through `unknown` to the prop type the card expects; the card only ever
 * reads `navigation.navigate`, so nothing else needs to be modelled.
 */
function makeNavigation(): {
  navigation: MenuSummaryCardProps['navigation'];
  navigate: jest.Mock;
} {
  const navigate = jest.fn();
  return {
    navigate,
    navigation: { navigate } as unknown as MenuSummaryCardProps['navigation'],
  };
}

type MenuSummaryCardProps = React.ComponentProps<typeof MenuSummaryCard>;

function renderCard(
  overrides: Partial<MenuSummaryCardProps> = {},
): {
  view: ReturnType<typeof render>;
  navigate: jest.Mock;
} {
  const { navigation, navigate } = makeNavigation();
  const props: MenuSummaryCardProps = {
    category: 'Restaurant' as ExperienceCategory,
    menus: MENUS,
    isLoading: false,
    isError: false,
    experienceId: EXPERIENCE_ID,
    navigation,
    ...overrides,
  };
  return { view: render(<MenuSummaryCard {...props} />), navigate };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MenuSummaryCard interactions and states (R4.2-R4.6)', () => {
  // -------------------------------------------------------------------------
  // R4.6 — non-restaurant renders nothing and offers no navigation
  // -------------------------------------------------------------------------
  test('R4.6: a non-restaurant category renders no card and no navigation target', () => {
    const { view, navigate } = renderCard({
      category: 'Ride' as ExperienceCategory,
      menus: MENUS,
    });

    // No card, loading, or empty node is rendered for a non-restaurant.
    expect(view.queryByTestId('menu-summary-card')).toBeNull();
    expect(view.queryByTestId('menu-summary-loading')).toBeNull();
    expect(view.queryByTestId('menu-summary-empty')).toBeNull();
    expect(view.toJSON()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R4.3 — loading shows an indicator in place of the card, no card content
  // -------------------------------------------------------------------------
  test('R4.3: while the detail is loading the card slot shows a loading indicator only', () => {
    const { view, navigate } = renderCard({
      isLoading: true,
      // menus are undefined while the detail is still loading.
      menus: undefined,
    });

    // The loading slot is present...
    expect(view.queryByTestId('menu-summary-loading')).not.toBeNull();
    // ...and no summary card content nor empty state is rendered.
    expect(view.queryByTestId('menu-summary-card')).toBeNull();
    expect(view.queryByTestId('menu-summary-count')).toBeNull();
    expect(view.queryByTestId('menu-summary-empty')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R4.5 — a detail load error renders no card (screen shows top-level error)
  // -------------------------------------------------------------------------
  test('R4.5: a detail load error renders no card content', () => {
    const { view, navigate } = renderCard({
      isError: true,
      menus: undefined,
    });

    expect(view.toJSON()).toBeNull();
    expect(view.queryByTestId('menu-summary-card')).toBeNull();
    expect(view.queryByTestId('menu-summary-loading')).toBeNull();
    expect(view.queryByTestId('menu-summary-empty')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R4.4 — a restaurant with no menus renders an empty state, not pressable
  // -------------------------------------------------------------------------
  test('R4.4: a restaurant with no menus renders an empty state with no navigation', () => {
    const { view, navigate } = renderCard({ menus: [] });

    // The empty state is rendered...
    expect(view.queryByTestId('menu-summary-empty')).not.toBeNull();
    expect(view.queryByTestId('menu-summary-empty-state')).not.toBeNull();
    expect(view.queryByText('No menu available')).not.toBeNull();

    // ...and there is no pressable summary card / no navigation target.
    expect(view.queryByTestId('menu-summary-card')).toBeNull();

    // The empty node carries no press behavior: pressing it navigates nowhere.
    fireEvent.press(view.getByTestId('menu-summary-empty'));
    expect(navigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R4.2 — a restaurant with menus renders a pressable card that navigates
  // -------------------------------------------------------------------------
  test('R4.2: tapping the summary card navigates to the Menu screen with the experienceId', () => {
    const { view, navigate } = renderCard({ menus: MENUS });

    const card = view.getByTestId('menu-summary-card');
    expect(card).not.toBeNull();

    // The summary content reflects the available menus.
    expect(view.getByTestId('menu-summary-count')).not.toBeNull();
    expect(view.getByTestId('menu-summary-type-0')).not.toBeNull();
    expect(view.getByTestId('menu-summary-type-1')).not.toBeNull();

    fireEvent.press(card);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Menu', {
      experienceId: EXPERIENCE_ID,
    });
  });
});
