// Feature: restaurant-menu-display, Property 7: The Menu_Screen renders every menu, group, and item in order
//
// Validates: Requirements 5.1, 5.2, 5.3
//
// Property 7 (from design.md):
//   For any menu list, the Menu_Screen renders every menu (each as a distinct
//   block labelled by its menu type), every group within each menu, and every
//   item within each group, preserving the provided order of menus, of groups
//   within each menu, and of items within each group.
//
// Test strategy:
//   - Generate an arbitrary `MenuDTO[]` via the shared `menuArb` generators
//     (menu types / group names / item names are non-empty so they can be
//     located by text; cuisine and price span null/empty/non-empty edge cases,
//     and menus / groups / items may be empty arrays).
//   - Mount the real `MenuScreen` inside a native stack + `QueryClientProvider`
//     with `apiRequest` stubbed to serve `GET /catalog/:id` as the restaurant
//     detail carrying the generated `menus`, mirroring how the detail screen
//     primes the shared `['experience', id]` cache entry.
//   - COMPLETENESS: assert every index-addressed testID exists — one
//     `menu-block-{i}` per menu, one `menu-group-{i}-{g}` per group, and one
//     `menu-item-{i}-{g}-{it}` per item — and that no block/group/item exists
//     one-past-the-end (nothing extra rendered, nothing dropped).
//   - ORDER: the component renders position `i` from `menus[i]` (and likewise
//     for nested groups/items), so asserting the content at each addressed node
//     equals the input at that same index proves order is preserved by
//     construction: within `menu-type-{i}` the text equals `menus[i].menuType`,
//     within `menu-group-{i}-{g}` the text includes that group's name, and
//     within `menu-item-{i}-{g}-{it}` the text includes that item's name.
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

const EXPERIENCE_ID = 'exp-menu-screen-prop7';

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

describe('Property 7: Menu_Screen renders every menu, group, and item in order (R5.1, R5.2, R5.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('every menu, group, and item renders preserving provided order', async () => {
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

          // -----------------------------------------------------------------
          // COMPLETENESS + ORDER over menus.
          // -----------------------------------------------------------------
          menus.forEach((menu, i) => {
            // Tabbed layout: only the selected menu is mounted at a time, so
            // select tab i before asserting its block. A single-menu
            // restaurant shows no tab bar (menu 0 is rendered directly).
            if (menus.length > 1) {
              fireEvent.press(view.getByTestId(`menu-tab-${i}`));
            }

            // Each menu is a distinct labelled block (R5.1, R5.3).
            const block = view.getByTestId(`menu-block-${i}`);
            expect(block).not.toBeNull();

            // Order: block i carries menus[i]'s menu type (R5.2, R5.3).
            const typeBadge = view.getByTestId(`menu-type-${i}`);
            expect(
              within(typeBadge).queryAllByText(menu.menuType).length,
            ).toBeGreaterThanOrEqual(1);

            // -----------------------------------------------------------------
            // COMPLETENESS + ORDER over groups within this menu.
            // -----------------------------------------------------------------
            menu.groups.forEach((group, g) => {
              const groupNode = view.getByTestId(`menu-group-${i}-${g}`);
              expect(groupNode).not.toBeNull();
              // Order: group g of block i carries menus[i].groups[g]'s name.
              expect(
                within(groupNode).queryAllByText(group.name).length,
              ).toBeGreaterThanOrEqual(1);

              // -------------------------------------------------------------
              // COMPLETENESS + ORDER over items within this group.
              // -------------------------------------------------------------
              group.items.forEach((item, it) => {
                const itemNode = view.getByTestId(`menu-item-${i}-${g}-${it}`);
                expect(itemNode).not.toBeNull();
                // Order: item it carries menus[i].groups[g].items[it]'s name.
                expect(
                  within(itemNode).queryAllByText(item.name).length,
                ).toBeGreaterThanOrEqual(1);
              });

              // Nothing rendered past the last item in this group.
              expect(
                view.queryByTestId(
                  `menu-item-${i}-${g}-${group.items.length}`,
                ),
              ).toBeNull();
            });

            // Nothing rendered past the last group in this menu.
            expect(
              view.queryByTestId(`menu-group-${i}-${menu.groups.length}`),
            ).toBeNull();
          });

          // Nothing rendered past the last menu.
          expect(view.queryByTestId(`menu-block-${menus.length}`)).toBeNull();
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
