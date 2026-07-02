// Feature: restaurant-menu-display, Task 5.3 — MenuSummaryCard theme structure test
//
// Validates: Requirements 4.7
//
// R4.7 requires the Menu_Summary_Card to render using the shared Magical /
// Whimsical theme primitives (Card, SectionLabel, Badge) used by the other
// detail sections, rather than re-deriving its own surfaces/labels/chips.
//
// A render-only assertion (querying testIDs) cannot distinguish "used the
// shared `Card`" from "rendered a raw `View` that happens to carry the same
// testID". So this structure test mocks the shared `theme/components` module,
// wrapping the real `Card`, `SectionLabel`, and `Badge` implementations in
// `jest.fn` spies that still delegate to the genuine components (so the render
// is unchanged) while recording every invocation. Rendering the card in its
// menus-present state and asserting each spy was called proves the component
// composes the shared primitives.
//
// Every other export of `theme/components` is preserved via `requireActual`
// so `EmptyState`, `GradientHeader`, etc. keep their genuine behavior.

import React from 'react';
import { render } from '@testing-library/react-native';

import type { ExperienceCategory, MenuDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mock the shared theme primitives with delegating spies.
//
// `Card`, `SectionLabel`, and `Badge` are replaced with `jest.fn` wrappers that
// call straight through to the real implementations, so the card renders
// exactly as in production while every use of a shared primitive is recorded.
// ---------------------------------------------------------------------------

jest.mock('../../../theme/components', () => {
  const actual =
    jest.requireActual('../../../theme/components') as typeof import('../../../theme/components');
  return {
    __esModule: true,
    ...actual,
    Card: jest.fn(actual.Card),
    SectionLabel: jest.fn(actual.SectionLabel),
    Badge: jest.fn(actual.Badge),
  };
});

// Imported after the mock is registered so these bindings are the spies.
import { Badge, Card, SectionLabel } from '../../../theme/components';
import MenuSummaryCard from '../MenuSummaryCard';

type MenuSummaryCardProps = React.ComponentProps<typeof MenuSummaryCard>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = 'exp-restaurant-1';

/** Two menus carrying distinct menu types so multiple Badges are expected. */
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

function renderMenusPresent(): void {
  const props: MenuSummaryCardProps = {
    category: 'Restaurant' as ExperienceCategory,
    menus: MENUS,
    isLoading: false,
    isError: false,
    experienceId: EXPERIENCE_ID,
    // The card only reads `navigation.navigate`; the structure test never taps.
    navigation: { navigate: jest.fn() } as unknown as MenuSummaryCardProps['navigation'],
  };
  render(<MenuSummaryCard {...props} />);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MenuSummaryCard theme structure (R4.7)', () => {
  beforeEach(() => {
    (Card as unknown as jest.Mock).mockClear();
    (SectionLabel as unknown as jest.Mock).mockClear();
    (Badge as unknown as jest.Mock).mockClear();
  });

  test('R4.7: the menus-present card is composed from the shared Card, SectionLabel, and Badge primitives', () => {
    renderMenusPresent();

    // The shared surface, section label, and chip primitives are all used.
    expect(Card as unknown as jest.Mock).toHaveBeenCalled();
    expect(SectionLabel as unknown as jest.Mock).toHaveBeenCalled();
    expect(Badge as unknown as jest.Mock).toHaveBeenCalled();
  });

  test('R4.7: one shared Badge primitive is rendered per menu type', () => {
    renderMenusPresent();

    // The card renders a Badge for each menu's menu type (two here), proving the
    // menu-type chips are the shared primitive, not a bespoke pill.
    expect((Badge as unknown as jest.Mock).mock.calls.length).toBe(MENUS.length);
  });
});
