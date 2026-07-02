// Feature: restaurant-menu-display, Property 9: Item price is rendered verbatim exactly when non-empty
//
// Validates: Requirements 5.6, 5.7
//
// Property 9 (from design.md):
//   For any menu item, the Menu_Screen renders the item's price string exactly
//   as provided together with the item name when the price is a non-empty
//   string, and renders the item name with no price when the price is absent or
//   an empty string.
//
// Test strategy:
//   - Generate an arbitrary `MenuDTO[]` via the shared `menuArb` generators.
//     Item `price` spans the four upstream shapes — absent, `null`, empty
//     string, and a non-empty string — so both the "present" and "absent"
//     branches are exercised across the 100 runs.
//   - Mount the real `MenuScreen` inside a native stack + `QueryClientProvider`
//     with `apiRequest` stubbed to serve `GET /catalog/:id` as the restaurant
//     detail carrying the generated `menus`, mirroring how the detail screen
//     primes the shared `['experience', id]` cache entry (same setup as the
//     Property 7 completeness and Property 8 cuisine tests).
//   - The screen surfaces an item's price as a dedicated `Text`
//     (`menu-item-price-{i}-{g}-{it}`) only when `item.price` is a non-empty
//     string, rendered verbatim; the item row (`menu-item-{i}-{g}-{it}`) is
//     always rendered and always carries the item name. So for each item:
//       * ALWAYS: the item row exists and carries the item name.
//       * IFF the price is a non-empty string: the price node exists and
//         carries that exact string (R5.6).
//       * OTHERWISE (absent / null / empty): no price node is rendered (R5.7).
//     Asserting this equivalence in both directions proves the price is
//     rendered verbatim exactly when non-empty (R5.6) and omitted otherwise
//     (R5.7).
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

const EXPERIENCE_ID = 'exp-menu-screen-prop9';

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

describe('Property 9: Item price is rendered verbatim exactly when non-empty (R5.6, R5.7)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('price renders verbatim with the name iff it is a non-empty string, else the name alone', async () => {
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

            menu.groups.forEach((group, g) => {
              group.items.forEach((item, it) => {
                // The item row is ALWAYS rendered and carries the item name.
                const itemRow = view.getByTestId(`menu-item-${i}-${g}-${it}`);
                expect(
                  within(itemRow).queryAllByText(item.name).length,
                ).toBeGreaterThanOrEqual(1);

                // "Present" == a non-null, non-empty price string. Absent,
                // null, and empty string all count as "no price" (R5.7).
                const hasPrice =
                  typeof item.price === 'string' && item.price.length > 0;

                const priceNode = view.queryByTestId(
                  `menu-item-price-${i}-${g}-${it}`,
                );

                if (hasPrice) {
                  // R5.6: price rendered together with the name, verbatim.
                  expect(priceNode).not.toBeNull();
                  expect(
                    within(priceNode as ReturnType<typeof view.getByTestId>)
                      .queryAllByText(item.price as string).length,
                  ).toBeGreaterThanOrEqual(1);
                } else {
                  // R5.7: name alone, no price node.
                  expect(priceNode).toBeNull();
                }
              });
            });
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
