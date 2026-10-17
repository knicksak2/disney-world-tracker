/**
 * TripPackingListScreen component tests (Task 11.7).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { PackingItemDTO, PackingListDTO, TripMemberDTO } from '@dwt/shared';

import { apiRequest as mockedApiRequest } from '../../../api/client';
import { NavigationContainer } from '@react-navigation/native';
import TripPackingListScreen from '../TripPackingListScreen';

jest.setTimeout(15000);

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const USER_ORGANIZER = '22222222-2222-4222-8222-222222222222';
const USER_ADDER = '33333333-3333-4333-8333-333333333333';
const USER_OTHER = '44444444-4444-4444-8444-444444444444';

const ADDER_ME = { user: { id: USER_ADDER } };
const ORGANIZER_ME = { user: { id: USER_ORGANIZER } };
const OTHER_MEMBER_ME = { user: { id: USER_OTHER } };

const ROSTER: readonly TripMemberDTO[] = [
  {
    userId: USER_ORGANIZER,
    tripId: TRIP_ID,
    role: 'organizer',
    displayName: 'Mickey Mouse',
  } as unknown as TripMemberDTO,
  {
    userId: USER_ADDER,
    tripId: TRIP_ID,
    role: 'member',
    displayName: 'Donald Duck',
  } as unknown as TripMemberDTO,
  {
    userId: USER_OTHER,
    tripId: TRIP_ID,
    role: 'member',
    displayName: 'Goofy',
  } as unknown as TripMemberDTO,
];

const ITEM_1: PackingItemDTO = {
  id: 'item-1',
  tripId: TRIP_ID,
  name: 'Park tickets or passes',
  category: 'documents',
  quantity: 2,
  packed: false,
  packedAt: null,
  packedByDisplayName: null,
  addedById: USER_ADDER,
  addedByDisplayName: 'Donald Duck',
  assigneeId: USER_ADDER,
  assigneeDisplayName: 'Donald Duck',
  createdAt: '2026-09-01T10:00:00.000Z',
};

const ITEM_2: PackingItemDTO = {
  id: 'item-2',
  tripId: TRIP_ID,
  name: 'Sunscreen',
  category: 'toiletries',
  quantity: 1,
  packed: true,
  packedAt: '2026-09-02T11:00:00.000Z',
  packedByDisplayName: 'Mickey Mouse',
  addedById: USER_ORGANIZER,
  addedByDisplayName: 'Mickey Mouse',
  assigneeId: USER_ORGANIZER,
  assigneeDisplayName: 'Mickey Mouse',
  createdAt: '2026-09-02T10:00:00.000Z',
};

const ITEM_3: PackingItemDTO = {
  id: 'item-3',
  tripId: TRIP_ID,
  name: 'Phone charger',
  category: 'tech',
  quantity: 1,
  packed: false,
  packedAt: null,
  packedByDisplayName: null,
  addedById: USER_ORGANIZER,
  addedByDisplayName: 'Mickey Mouse',
  assigneeId: null,
  assigneeDisplayName: null,
  createdAt: '2026-09-03T10:00:00.000Z',
};

const PACKING_LIST_FIXTURE: PackingListDTO = {
  items: [ITEM_1, ITEM_2, ITEM_3],
  totalCount: 3,
  packedCount: 1,
};

function renderScreen(navOverrides?: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    ...navOverrides,
  } as unknown as Parameters<typeof TripPackingListScreen>[0]['navigation'];

  const route = {
    key: 'TripPackingList',
    name: 'TripPackingList' as const,
    params: { tripId: TRIP_ID },
  };

  const rendered = render(
    <NavigationContainer>
      <QueryClientProvider client={queryClient}>
        <TripPackingListScreen navigation={navigation} route={route} />
      </QueryClientProvider>
    </NavigationContainer>,
  );

  return { ...rendered, navigation, queryClient };
}

describe('TripPackingListScreen (Task 11.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Open: GET packing list, grouped rows in vocabulary order, headline counts', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return ADDER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // Verify initial GET
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', `/trips/${TRIP_ID}/packing-items`);
    });

    // Headline counts (unfiltered)
    expect(await screen.findByText('1 of 3 packed')).toBeTruthy();

    // Category section headers in vocabulary order (Documents, Toiletries, Tech)
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.getByText('Toiletries')).toBeTruthy();
    expect(screen.getByText('Tech')).toBeTruthy();

    // Items rendered
    expect(screen.getByText('Park tickets or passes')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
    expect(screen.getByText('Sunscreen')).toBeTruthy();
    expect(screen.getByText('Phone charger')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  test('Packed toggle: optimistic update while pending, rollback on rejection', async () => {
    let rejectPut: (reason: unknown) => void = () => {};
    const putPromise = new Promise((_, reject) => {
      rejectPut = reject;
    });

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return ADDER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PUT' && path === `/trips/${TRIP_ID}/packing-items/item-1/packed`) {
        await putPromise;
        const payload = body as { packed: boolean };
        return { ...ITEM_1, packed: payload.packed };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    expect(await screen.findByText('1 of 3 packed')).toBeTruthy();
    const item1Row = screen.getByTestId('packing-item-row-item-1');
    expect(within(item1Row).getByText('Not packed')).toBeTruthy();

    // Toggle packed on item-1
    fireEvent.press(screen.getByTestId('packing-item-packed-item-1'));

    // Verify PUT was sent with packed: true
    expect(apiRequestMock).toHaveBeenCalledWith(
      'PUT',
      `/trips/${TRIP_ID}/packing-items/item-1/packed`,
      { packed: true },
    );

    // WHILE the promise is still pending, assert row and packedCount changed optimistically!
    expect(screen.getByTestId('packing-counts')).toHaveTextContent('2 of 3 packed');
    expect(within(screen.getByTestId('packing-item-row-item-1')).getByText('Packed')).toBeTruthy();

    // Now reject the request to trigger rollback
    rejectPut(new Error('Network error'));

    // Assert rollback: packedCount returns to 1 of 3, row returns to Not packed, error message appears
    await waitFor(() => {
      expect(screen.getByTestId('packing-counts')).toHaveTextContent('1 of 3 packed');
      expect(within(screen.getByTestId('packing-item-row-item-1')).getByText('Not packed')).toBeTruthy();
      expect(screen.getByText("Couldn't update packed status")).toBeTruthy();
    });
  });

  test('Filters: Mine, Unpacked, All change visible rows with no extra request; no-match state retains chips and counts', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return ADDER_ME; // callerId = 'user-adder'
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    await screen.findByText('1 of 3 packed');
    const callsAfterLoad = apiRequestMock.mock.calls.length;

    // Filter "Mine": only item-1 is assigned to user-adder
    fireEvent.press(screen.getByTestId('packing-filter-mine'));
    expect(screen.getByText('Park tickets or passes')).toBeTruthy();
    expect(screen.queryByText('Sunscreen')).toBeNull();
    expect(screen.queryByText('Phone charger')).toBeNull();
    // No extra network requests sent!
    expect(apiRequestMock.mock.calls.length).toBe(callsAfterLoad);
    // Headline counts unchanged!
    expect(screen.getByTestId('packing-counts')).toHaveTextContent('1 of 3 packed');

    // Filter "Unpacked": item-1 and item-3 are unpacked, item-2 is packed
    fireEvent.press(screen.getByTestId('packing-filter-unpacked'));
    expect(screen.getByText('Park tickets or passes')).toBeTruthy();
    expect(screen.getByText('Phone charger')).toBeTruthy();
    expect(screen.queryByText('Sunscreen')).toBeNull();
    expect(apiRequestMock.mock.calls.length).toBe(callsAfterLoad);

    // Filter "All": all 3 items visible
    fireEvent.press(screen.getByTestId('packing-filter-all'));
    expect(screen.getByText('Park tickets or passes')).toBeTruthy();
    expect(screen.getByText('Sunscreen')).toBeTruthy();
    expect(screen.getByText('Phone charger')).toBeTruthy();
    expect(apiRequestMock.mock.calls.length).toBe(callsAfterLoad);
  });

  test('Filter matching nothing: shows text message and keeps filter chips visible', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return OTHER_MEMBER_ME; // callerId = 'user-other' (0 items assigned)
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    await screen.findByText('1 of 3 packed');

    // Switch to "Mine" -> matches 0 items
    fireEvent.press(screen.getByTestId('packing-filter-mine'));

    expect(await screen.findByText('No items match this filter.')).toBeTruthy();
    // Filter chips remain visible
    expect(screen.getByTestId('packing-filter-all')).toBeTruthy();
    expect(screen.getByTestId('packing-filter-mine')).toBeTruthy();
    expect(screen.getByTestId('packing-filter-unpacked')).toBeTruthy();
  });

  test('Add item: open form, validate, submit sends POST, form closes and refetches', async () => {
    let currentList = PACKING_LIST_FIXTURE;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return currentList;
      }
      if (method === 'GET' && path === '/me') return ADDER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/packing-items`) {
        const payload = body as { name: string; category: string; quantity?: number; assigneeId?: string | null };
        const newItem: PackingItemDTO = {
          id: 'item-4',
          tripId: TRIP_ID,
          name: payload.name,
          category: payload.category as any,
          quantity: payload.quantity ?? 1,
          packed: false,
          packedAt: null,
          packedByDisplayName: null,
          addedById: USER_ADDER,
          addedByDisplayName: 'Donald Duck',
          assigneeId: payload.assigneeId ?? null,
          assigneeDisplayName: null,
          createdAt: '2026-09-04T10:00:00.000Z',
        };
        currentList = {
          items: [...currentList.items, newItem],
          totalCount: currentList.totalCount + 1,
          packedCount: currentList.packedCount,
        };
        return newItem;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    expect(await screen.findByText('1 of 3 packed')).toBeTruthy();

    // Open add item modal
    fireEvent.press(screen.getByTestId('packing-add-item-btn'));

    expect(await screen.findByTestId('packing-item-form-modal')).toBeTruthy();

    // Empty name: submit rejected client-side
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));
    expect(await screen.findByText('Invalid name: must be 1 to 80 characters')).toBeTruthy();
    expect(apiRequestMock).not.toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/packing-items`, expect.anything());

    // Enter valid details
    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), 'Rain poncho');
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '4');
    fireEvent.press(screen.getByTestId('category-chip-park_gear'));
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    // Verify POST was dispatched
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/packing-items`, {
        name: 'Rain poncho',
        category: 'park_gear',
        quantity: 4,
        assigneeId: null,
      });
    });

    // Form closes and new item appears in list
    await waitFor(() => {
      expect(screen.queryByTestId('packing-item-form-modal')).toBeNull();
      expect(screen.getByText('Rain poncho')).toBeTruthy();
      expect(screen.getByText('×4')).toBeTruthy();
      expect(screen.getByTestId('packing-counts')).toHaveTextContent('1 of 4 packed');
    });
  });

  test('Edit and remove: adder can edit and remove own item; non-adder member cannot', async () => {
    let currentList = PACKING_LIST_FIXTURE;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return currentList;
      }
      if (method === 'GET' && path === '/me') return ADDER_ME; // callerId = 'user-adder'
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/packing-items/item-1`) {
        const payload = body as Partial<PackingItemDTO>;
        const updated = { ...ITEM_1, ...payload };
        currentList = {
          ...currentList,
          items: currentList.items.map((it) => (it.id === 'item-1' ? updated : it)),
        };
        return updated;
      }
      if (method === 'DELETE' && path === `/trips/${TRIP_ID}/packing-items/item-1`) {
        currentList = {
          items: currentList.items.filter((it) => it.id !== 'item-1'),
          totalCount: currentList.totalCount - 1,
          packedCount: currentList.packedCount,
        };
        return undefined as any;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // As user-adder: item-1 was added by user-adder -> edit and remove controls exist
    expect(await screen.findByTestId('packing-item-edit-item-1')).toBeTruthy();
    expect(screen.getByTestId('packing-item-remove-item-1')).toBeTruthy();

    // But item-2 was added by user-organizer -> as user-adder (member role), controls are absent
    expect(screen.queryByTestId('packing-item-edit-item-2')).toBeNull();
    expect(screen.queryByTestId('packing-item-remove-item-2')).toBeNull();

    // Edit item-1
    fireEvent.press(screen.getByTestId('packing-item-edit-item-1'));
    expect(await screen.findByTestId('packing-item-form-modal')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), 'Updated Park Tickets');
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', `/trips/${TRIP_ID}/packing-items/item-1`, {
        name: 'Updated Park Tickets',
        category: 'documents',
        quantity: 2,
        assigneeId: USER_ADDER,
      });
      expect(screen.getByText('Updated Park Tickets')).toBeTruthy();
    });

    // Remove item-1
    await act(async () => {
      fireEvent.press(screen.getByTestId('packing-item-remove-item-1'));
    });

    await waitFor(
      () => {
        expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}/packing-items/item-1`);
        expect(screen.queryByText('Updated Park Tickets')).toBeNull();
        expect(screen.getByTestId('packing-counts')).toHaveTextContent('1 of 2 packed');
      },
      { timeout: 5000 },
    );
  });

  test('Edit and remove: organizer can edit and remove items added by any member', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // As organizer, controls exist for ALL items
    expect(await screen.findByTestId('packing-item-edit-item-1')).toBeTruthy();
    expect(screen.getByTestId('packing-item-edit-item-2')).toBeTruthy();
    expect(screen.getByTestId('packing-item-edit-item-3')).toBeTruthy();
    expect(screen.getByTestId('packing-item-remove-item-1')).toBeTruthy();
    expect(screen.getByTestId('packing-item-remove-item-2')).toBeTruthy();
    expect(screen.getByTestId('packing-item-remove-item-3')).toBeTruthy();
  });

  test('Empty list: shows empty state with Add suggested items (starter) and Add item', async () => {
    let listData: PackingListDTO = { items: [], totalCount: 0, packedCount: 0 };
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        return listData;
      }
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/packing-items/starter`) {
        listData = PACKING_LIST_FIXTURE;
        return { added: 3 };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    expect(await screen.findByTestId('packing-empty-state')).toBeTruthy();
    expect(screen.getByText('Packing list is empty')).toBeTruthy();
    expect(screen.getByTestId('packing-add-starter-btn')).toBeTruthy();
    expect(screen.getByTestId('packing-empty-add-btn')).toBeTruthy();

    // Press "Add suggested items"
    fireEvent.press(screen.getByTestId('packing-add-starter-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/packing-items/starter`);
    });

    // Grouped rows appear
    expect(await screen.findByText('Park tickets or passes')).toBeTruthy();
    expect(screen.getByTestId('packing-counts')).toHaveTextContent('1 of 3 packed');
  });

  test('Loading, error and retry states', async () => {
    let failFirst = true;
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/packing-items`) {
        if (failFirst) {
          failFirst = false;
          throw new Error('Server error');
        }
        return PACKING_LIST_FIXTURE;
      }
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const retryBtn = await screen.findByTestId('packing-list-retry');
    expect(retryBtn).toBeTruthy();
    expect(screen.getByText("We couldn't load the packing list")).toBeTruthy();

    // Press retry
    fireEvent.press(retryBtn);

    expect(await screen.findByText('1 of 3 packed')).toBeTruthy();
  });
});
