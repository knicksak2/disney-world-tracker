// Feature: restaurant-menu-display, Property 8: Cuisine type is rendered exactly when present
//
// Validates: Requirements 5.4, 5.5
//
// Property 8 (from design.md):
//   For any menu, the Menu_Screen renders the cuisine type alongside the menu
//   type when the menu has a non-null cuisine type, and renders the menu type
//   without a cuisine type when it has none.
//
// Test strategy:
//   - Generate an arbitrary `MenuDTO[]` via the shared `menuArb` generators.
//     `cuisineType` spans the four upstream shapes — absent, `null`, empty
//     string, and a non-empty string — so the "present" and "absent" branches
//     are both exercised across the 100 runs.
//   - Mount the real `MenuScreen` inside a native stack + `QueryClientProvider`
//     with `apiRequest` stubbed to serve `GET /catalog/:id` as the restaurant
//     detail carrying the generated `menus`, mirroring how the detail screen
//     primes the shared `['experience', id]` cache entry (same setup as the
//     Property 7 completeness test).
//   - The screen surfaces a menu's cuisine as a *second* `Badge`
//     (`menu-cuisine-{i}`) only when `menu.cuisineType` is a non-empty string;
//     the menu-type `Badge` (`menu-type-{i}`) is always rendered. So for each
//     menu i:
//       * ALWAYS: the menu type badge exists and carries `menus[i].menuType`.
//       * IFF the cuisine type is a non-empty string: the cuisine badge exists
//         and carries that exact string.
//       * OTHERWISE (absent / null / empty): no cuisine badge is rendered.
//     Asserting this equivalence in both directions proves the cuisine type is
//     rendered exactly when present (R5.4) and omitted otherwise (R5.5).
//   - `unmount()` between samples so the 100 React trees do not accumulate.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import fc from 'fast-check';

import type { MenuDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import MenuScreen from '../MenuScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { menuListArb } from '../__testSupport__/menuScreenArbitraries';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

type MenuStackParamList = {
  Menu: { experienceId: string };
};

const EXPERIENCE_ID = 'exp-menu-screen-prop8';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderMenuScreen(): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<MenuStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Menu"
            component={MenuScreen}
            initialParams={{ experienceId: EXPERIENCE_ID }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 8: Cuisine type is rendered exactly when present (R5.4, R5.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('cuisine renders alongside the menu type iff it is a non-empty string, else the menu type alone', async () => {
    await fc.assert(
      fc.asyncProperty(menuListArb, async (menus: MenuDTO[]) => {
        // Serve the restaurant detail (with the generated menus) for the
        // shared `['experience', id]` query the screen reads.
        apiRequestMock.mockImplementation(async (_method, path) => {
          if (path === `/catalog/${EXPERIENCE_ID}`) {
            return { id: EXPERIENCE_ID, name: 'Test Kitchen', menus };
          }
          throw new Error(`unexpected call to ${String(path)}`);
        });

        const view = renderMenuScreen();
        try {
          // Wait until the detail query settles and the screen body mounts.
          await waitFor(() => {
            expect(view.queryByTestId('menu-screen')).not.toBeNull();
          });

          menus.forEach((menu, i) => {
            // Tabbed layout: select tab i so its menu block is mounted (a
            // single-menu restaurant shows no tab bar).
            if (menus.length > 1) {
              fireEvent.press(view.getByTestId(`menu-tab-${i}`));
            }

            // The menu type badge is ALWAYS rendered and carries the menu type.
            const typeBadge = view.getByTestId(`menu-type-${i}`);
            expect(
              within(typeBadge).queryAllByText(menu.menuType).length,
            ).toBeGreaterThanOrEqual(1);

            // "Present" == a non-null, non-empty cuisine string. Absent, null,
            // and empty string all count as "no cuisine type" (R5.5).
            const hasCuisine =
              typeof menu.cuisineType === 'string' &&
              menu.cuisineType.length > 0;

            const cuisineBadge = view.queryByTestId(`menu-cuisine-${i}`);

            if (hasCuisine) {
              // R5.4: cuisine rendered alongside the menu type, verbatim.
              expect(cuisineBadge).not.toBeNull();
              expect(
                within(cuisineBadge as ReturnType<typeof view.getByTestId>)
                  .queryAllByText(menu.cuisineType as string).length,
              ).toBeGreaterThanOrEqual(1);
            } else {
              // R5.5: menu type alone, no cuisine badge.
              expect(cuisineBadge).toBeNull();
            }
          });
        } finally {
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
    // Mounting 100 full screens (navigation container + query client) is well
    // beyond jest's 5s default, so give the property run a generous budget.
  }, 120000);
});
