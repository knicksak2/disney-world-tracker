// Feature: restaurant-menu-display, Task 6.5 — Menu_Screen back control + theme usage example tests
//
// Validates: Requirements 5.8, 5.9
//
// These example (non-property) tests confirm the two non-universally-quantified
// criteria for the dedicated Menu_Screen:
//
//   - R5.8: the screen provides a control to return to the Experience detail
//     screen. We assert a back control renders and that activating it invokes
//     `navigation.goBack`. `useNavigation` is mocked so `goBack` is a spy, and
//     the shared `GradientHeader` is mocked to surface the `onBack` callback the
//     screen wires to it as a pressable back control.
//   - R5.9: the screen renders using the shared "Magical / Whimsical" theme
//     primitives (`GradientHeader`, `Card`, `SectionLabel`, `Badge`) that the
//     other detail sections use. The whole `theme/components` module is mocked
//     with spy components, so asserting each primitive was invoked when a
//     restaurant carries menus proves the screen composes the shared primitives
//     rather than re-deriving its own layout.
//
// Both criteria are structural/interaction facts (not properties over arbitrary
// inputs), so a single representative restaurant detail carrying two menus — one
// with a cuisine type, one without — is sufficient.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { MenuDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = 'exp-menu-back-control';

// Navigation spy. `mock`-prefixed so the jest.mock factory may reference it
// despite hoisting.
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Mock the navigation hooks so `goBack` is a spy and the route params are
// supplied without a NavigationContainer.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({ params: { experienceId: EXPERIENCE_ID } }),
  };
});

// Stub `apiRequest` so the shared `['experience', id]` query resolves with the
// restaurant detail carrying our fixture menus.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// Mock the shared theme primitives with spy components. Each renders just
// enough (children / labels / a pressable back control) for the screen to
// mount, while recording that the screen composed it.
jest.mock('../../../theme/components', () => {
  const ReactLocal = require('react');
  const { Text, View, Pressable } = require('react-native');

  const ScreenContainer = jest.fn(({ children }: any) =>
    ReactLocal.createElement(View, null, children),
  );
  const GradientHeader = jest.fn(({ title, onBack }: any) =>
    ReactLocal.createElement(
      View,
      { testID: 'mock-gradient-header' },
      ReactLocal.createElement(Text, null, title),
      onBack
        ? ReactLocal.createElement(
            Pressable,
            {
              testID: 'menu-back-control',
              accessibilityRole: 'button',
              accessibilityLabel: 'Go back',
              onPress: onBack,
            },
            ReactLocal.createElement(Text, null, 'Back'),
          )
        : null,
    ),
  );
  const Card = jest.fn(({ children, testID }: any) =>
    ReactLocal.createElement(View, { testID }, children),
  );
  const SectionLabel = jest.fn(({ children }: any) =>
    ReactLocal.createElement(Text, null, children),
  );
  const Badge = jest.fn(({ label, testID }: any) =>
    ReactLocal.createElement(Text, { testID }, label),
  );
  const EmptyState = jest.fn(({ title, testID }: any) =>
    ReactLocal.createElement(Text, { testID }, title),
  );

  return {
    __esModule: true,
    ScreenContainer,
    GradientHeader,
    Card,
    SectionLabel,
    Badge,
    EmptyState,
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import MenuScreen from '../MenuScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import {
  Badge as MockBadge,
  Card as MockCard,
  GradientHeader as MockGradientHeader,
  SectionLabel as MockSectionLabel,
} from '../../../theme/components';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/** Two menus: one carries a cuisine type, one does not. */
const MENUS: readonly MenuDTO[] = [
  {
    menuType: 'Breakfast',
    cuisineType: 'American',
    groups: [{ name: 'Mains', items: [{ name: 'Pancakes', price: '$12' }] }],
  },
  {
    menuType: 'Dinner',
    cuisineType: null,
    groups: [{ name: 'Entrees', items: [{ name: 'Steak', price: '' }] }],
  },
];

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderMenuScreen(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MenuScreen />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MenuScreen back control and theme usage (R5.8, R5.9)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockGoBack.mockReset();
    mockNavigate.mockReset();
    (MockGradientHeader as jest.Mock).mockClear();
    (MockCard as jest.Mock).mockClear();
    (MockSectionLabel as jest.Mock).mockClear();
    (MockBadge as jest.Mock).mockClear();

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return { id: EXPERIENCE_ID, name: 'Test Kitchen', menus: MENUS };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  // -------------------------------------------------------------------------
  // R5.8 — a back control exists and invokes navigation.goBack
  // -------------------------------------------------------------------------
  test('R5.8: a back control exists and activating it invokes navigation.goBack', async () => {
    const view = renderMenuScreen();

    // The screen body mounts once the detail query settles.
    await waitFor(() => {
      expect(view.queryByTestId('menu-screen')).not.toBeNull();
    });

    // A back control is rendered (the header receives an onBack callback).
    const backControl = view.getByTestId('menu-back-control');
    expect(backControl).not.toBeNull();
    // It is also discoverable by its accessible role/label.
    expect(view.getByLabelText('Go back')).not.toBeNull();

    // Activating it returns to the previous screen.
    expect(mockGoBack).not.toHaveBeenCalled();
    fireEvent.press(backControl);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R5.9 — renders using the shared theme primitives
  // -------------------------------------------------------------------------
  test('R5.9: renders using the shared GradientHeader/Card/SectionLabel/Badge primitives when menus are present', async () => {
    const view = renderMenuScreen();

    await waitFor(() => {
      expect(view.queryByTestId('menu-screen')).not.toBeNull();
    });

    // The signature header primitive is used, carrying the restaurant name and
    // a back callback (R5.8, R5.9).
    // The header renders first in the loading state ("Menu") and then in the
    // loaded state ("Test Kitchen"); assert against the settled render.
    expect(MockGradientHeader as jest.Mock).toHaveBeenCalled();
    const headerCalls = (MockGradientHeader as jest.Mock).mock.calls;
    const headerProps = headerCalls[headerCalls.length - 1][0];
    expect(headerProps.title).toBe('Test Kitchen');
    expect(typeof headerProps.onBack).toBe('function');

    // The selected menu is a themed Card labelled by a SectionLabel and
    // carrying at least one Badge (R5.9).
    expect(MockCard as jest.Mock).toHaveBeenCalled();
    expect(MockSectionLabel as jest.Mock).toHaveBeenCalled();
    expect(MockBadge as jest.Mock).toHaveBeenCalled();

    // Tabbed layout: with more than one menu a tab bar renders one tab per
    // menu type (in order), and only the selected menu's block is mounted.
    expect(view.getByTestId('menu-tabs')).not.toBeNull();
    expect(view.getByTestId('menu-tab-0')).not.toBeNull();
    expect(view.getByTestId('menu-tab-1')).not.toBeNull();
    expect(view.queryByTestId(`menu-tab-${MENUS.length}`)).toBeNull();

    // Each MenuBlock render emits one Card and one matching SectionLabel, and
    // the active menu (which carries a cuisine) contributes both a menu-type
    // and a cuisine Badge — so badges outnumber cards regardless of how many
    // times React re-renders.
    const cardCount = (MockCard as jest.Mock).mock.calls.length;
    const sectionCount = (MockSectionLabel as jest.Mock).mock.calls.length;
    const badgeCount = (MockBadge as jest.Mock).mock.calls.length;
    expect(cardCount).toBe(sectionCount);
    expect(cardCount).toBeGreaterThan(0);
    expect(badgeCount).toBeGreaterThan(cardCount);
  });
});
