/**
 * Trip edit form — screen tests (Task 22).
 *
 * Validates: Requirements 3.1, 3.4, 3.5, 3.6, 3.8, 21.1, 21.5
 *
 * The edit form reads `GET /trips/:id` to pre-fill and `GET /resorts` for the
 * "where you stayed" picker, then submits `PATCH /trips/:id` with the full
 * editable field set including `resortIds` (a wholesale replace, R21.5). It
 * maps the Organizer-gated `trip_forbidden` rejection to friendly copy (R3.8).
 *
 * The screen consumes `navigation`/`route` from props, so it renders directly
 * with a stubbed navigation object; only `apiRequest` is mocked.
 */

import React from 'react';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

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

import TripEditScreen from '../TripEditScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { ResortDTO, TripDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';

// Resort ids are UUIDs (validated by the shared `uuidSchema`), so the fixtures
// use UUID-format ids — a `PATCH` with a non-UUID id fails client validation
// before the request.
const POLY_ID = '11111111-1111-4111-8111-111111111111';
const CONTEMPORARY_ID = '22222222-2222-4222-8222-222222222222';

const TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Spring Break at WDW',
  description: 'A magical week.',
  startDate: '2024-05-01',
  endDate: '2024-05-05',
  status: 'active',
  createdAt: '2024-04-01T12:00:00Z',
  resorts: [{ id: POLY_ID, name: 'Polynesian Village' }],
  foodLists: [],
};

function resort(id: string, name: string): ResortDTO {
  return {
    id,
    name,
    description: null,
    imageUrl: null,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    representingExperienceId: null,
  };
}

const RESORTS: readonly ResortDTO[] = [
  resort(POLY_ID, 'Polynesian Village'),
  resort(CONTEMPORARY_ID, 'Contemporary'),
];

/** A path-keyed apiRequest mock covering the reads the edit form performs. */
function mockReads(): void {
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP;
      if (method === 'GET' && path === '/resorts') return { resorts: RESORTS };
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
        // Echo an updated Trip; the screen only uses it to warm the cache.
        return { ...TRIP, ...(body as object) };
      }
      if (method === 'DELETE' && path === `/trips/${TRIP_ID}`) {
        return undefined;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  );
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): { navigate: jest.Mock; goBack: jest.Mock } {
  return { navigate: jest.fn(), goBack: jest.fn() };
}

function renderEdit(
  navigation: ReturnType<typeof makeNavigation>,
  queryClient: QueryClient = makeQueryClient(),
): ReturnType<typeof render> {
  const props = {
    navigation,
    route: { key: 'TripEdit-1', name: 'TripEdit', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripEditScreen>;

  return render(
    <QueryClientProvider client={queryClient}>
      <TripEditScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip edit form (R3.1, R3.8, R21.1, R21.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    jest.restoreAllMocks();
  });

  test('pre-fills the form from the loaded Trip and its recorded Resort stay', async () => {
    mockReads();

    renderEdit(makeNavigation());

    expect(await screen.findByTestId('trip-edit-form')).toBeTruthy();
    expect(screen.getByTestId('trip-edit-name').props.value).toBe(TRIP.name);
    expect(screen.getByTestId('trip-edit-description').props.value).toBe(
      TRIP.description,
    );
    // The pre-selected resort reflects the Trip's recorded stay.
    expect(
      screen.getByTestId('trip-edit-resort-11111111-1111-4111-8111-111111111111').props
        .accessibilityState.checked,
    ).toBe(true);
    expect(
      screen.getByTestId('trip-edit-resort-22222222-2222-4222-8222-222222222222').props
        .accessibilityState.checked,
    ).toBe(false);
  });

  test('the search box filters the resort list while keeping the selected chip visible', async () => {
    mockReads();

    renderEdit(makeNavigation());
    await screen.findByTestId('trip-edit-form');
    await waitFor(() => {
      expect(screen.getByTestId(`trip-edit-resort-${CONTEMPORARY_ID}`)).toBeTruthy();
    });

    // Filter to "contemporary": only the matching resort remains in the list.
    fireEvent.changeText(screen.getByTestId('trip-edit-search'), 'contemporary');

    await waitFor(() => {
      expect(screen.queryByTestId(`trip-edit-resort-${POLY_ID}`)).toBeNull();
    });
    expect(screen.getByTestId(`trip-edit-resort-${CONTEMPORARY_ID}`)).toBeTruthy();
    // The pre-selected Polynesian is filtered out of the list but remains
    // visible (and removable) as a selected chip.
    expect(screen.getByTestId(`trip-edit-chip-${POLY_ID}`)).toBeTruthy();

    // A query that matches nothing shows the empty state.
    fireEvent.changeText(screen.getByTestId('trip-edit-search'), 'zzzzz');
    expect(await screen.findByTestId('trip-edit-resorts-empty')).toBeTruthy();
  });

  test('R21.5: submitting sends PATCH with the edited resortIds (wholesale replace) and pops back', async () => {
    mockReads();
    const navigation = makeNavigation();

    renderEdit(navigation);
    await screen.findByTestId('trip-edit-form');
    // Wait until the draft is initialized from the Trip (poly pre-selected)
    // before toggling, so presses act on the initialized selection.
    await waitFor(() => {
      expect(
        screen.getByTestId('trip-edit-resort-11111111-1111-4111-8111-111111111111').props
          .accessibilityState.checked,
      ).toBe(true);
    });

    // Add Contemporary to the existing Polynesian stay.
    fireEvent.press(screen.getByTestId('trip-edit-resort-22222222-2222-4222-8222-222222222222'));
    await waitFor(() => {
      expect(
        screen.getByTestId('trip-edit-resort-22222222-2222-4222-8222-222222222222').props
          .accessibilityState.checked,
      ).toBe(true);
    });

    fireEvent.press(screen.getByTestId('trip-edit-submit'));

    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalled();
    });

    // The PATCH carries exactly the current selection (wholesale replace):
    // both the pre-existing Polynesian and the newly-added Contemporary.
    const patchCall = apiRequestMock.mock.calls.find(
      (call) => call[0] === 'PATCH' && call[1] === `/trips/${TRIP_ID}`,
    );
    expect(patchCall).toBeDefined();
    const body = patchCall?.[2] as { resortIds: readonly string[] };
    expect([...body.resortIds].sort()).toEqual(
      [CONTEMPORARY_ID, POLY_ID].sort(),
    );
  });

  test('R21.5: clearing the selection sends an empty resortIds to clear the stay', async () => {
    mockReads();
    const navigation = makeNavigation();

    renderEdit(navigation);
    await screen.findByTestId('trip-edit-form');
    await waitFor(() => {
      expect(
        screen.getByTestId('trip-edit-resort-11111111-1111-4111-8111-111111111111').props
          .accessibilityState.checked,
      ).toBe(true);
    });

    // Remove the only pre-selected resort.
    fireEvent.press(screen.getByTestId('trip-edit-resort-11111111-1111-4111-8111-111111111111'));
    await waitFor(() => {
      expect(
        screen.getByTestId('trip-edit-resort-11111111-1111-4111-8111-111111111111').props
          .accessibilityState.checked,
      ).toBe(false);
    });
    fireEvent.press(screen.getByTestId('trip-edit-submit'));

    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalled();
    });

    const patchCall = apiRequestMock.mock.calls.find(
      (call) => call[0] === 'PATCH' && call[1] === `/trips/${TRIP_ID}`,
    );
    const body = patchCall?.[2] as { resortIds: readonly string[] };
    expect(body.resortIds).toEqual([]);
  });

  test('R3.8: a trip_forbidden PATCH shows friendly copy and does not navigate away', async () => {
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP;
      if (method === 'GET' && path === '/resorts') return { resorts: RESORTS };
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
        throw new ApiError({
          code: 'trip_forbidden',
          message: 'forbidden',
          status: 403,
        });
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const navigation = makeNavigation();

    renderEdit(navigation);
    await screen.findByTestId('trip-edit-form');

    fireEvent.press(screen.getByTestId('trip-edit-submit'));

    expect(await screen.findByTestId('trip-edit-error-message')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  test('R3.11: renders the Delete Trip button in the danger zone', async () => {
    mockReads();
    renderEdit(makeNavigation());

    expect(await screen.findByTestId('trip-edit-delete-btn')).toBeTruthy();
    expect(screen.getByText('Delete trip')).toBeTruthy();
  });

  test('R3.11: pressing Delete Trip prompts Alert.alert confirmation with cancel and delete buttons', async () => {
    mockReads();
    const alertSpy = jest.spyOn(Alert, 'alert');
    renderEdit(makeNavigation());

    const deleteBtn = await screen.findByTestId('trip-edit-delete-btn');
    fireEvent.press(deleteBtn);

    expect(alertSpy).toHaveBeenCalledWith(
      `Delete "${TRIP.name}"?`,
      'Are you sure you want to delete this trip? All plans, reservations, and shared activity will be permanently removed. This cannot be undone.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete', style: 'destructive' }),
      ]),
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}`);
  });

  test('R3.11: cancelling in the Alert confirmation does not send DELETE request', async () => {
    mockReads();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const cancelButton = buttons?.find((b) => b.text === 'Cancel');
      cancelButton?.onPress?.();
    });
    const navigation = makeNavigation();
    renderEdit(navigation);

    const deleteBtn = await screen.findByTestId('trip-edit-delete-btn');
    fireEvent.press(deleteBtn);

    expect(apiRequestMock).not.toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}`);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('R3.7, R3.11: confirming deletion sends DELETE /trips/:id, prunes cache, invalidates list, and navigates to TripsList', async () => {
    mockReads();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find((b) => b.text === 'Delete');
      confirmButton?.onPress?.();
    });
    const navigation = makeNavigation();
    const client = makeQueryClient();
    const removeQueriesSpy = jest.spyOn(client, 'removeQueries');
    const invalidateQueriesSpy = jest.spyOn(client, 'invalidateQueries');

    renderEdit(navigation, client);

    const deleteBtn = await screen.findByTestId('trip-edit-delete-btn');
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}`);
    });

    await waitFor(() => {
      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey: ['trips', TRIP_ID] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['trips', 'list'] });
      expect(navigation.navigate).toHaveBeenCalledWith('TripsList');
    });
  });

  test('R3.11: mutual busy state disables Save when deleting and vice versa', async () => {
    let resolveDelete!: () => void;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP;
      if (method === 'GET' && path === '/resorts') return { resorts: RESORTS };
      if (method === 'DELETE' && path === `/trips/${TRIP_ID}`) {
        await deletePromise;
        return undefined;
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find((b) => b.text === 'Delete');
      confirmButton?.onPress?.();
    });

    const navigation = makeNavigation();
    renderEdit(navigation);

    const deleteBtn = await screen.findByTestId('trip-edit-delete-btn');
    const submitBtn = screen.getByTestId('trip-edit-submit');

    // Initially neither is busy
    expect(submitBtn.props.accessibilityState?.disabled ?? false).toBe(false);
    expect(deleteBtn.props.accessibilityState?.disabled ?? false).toBe(false);

    // Trigger delete
    fireEvent.press(deleteBtn);

    // While deleting: delete button shows Deleting... and both are disabled
    await waitFor(() => {
      expect(screen.getByText('Deleting\u2026')).toBeTruthy();
      expect(submitBtn.props.accessibilityState?.disabled).toBe(true);
      expect(deleteBtn.props.accessibilityState?.disabled).toBe(true);
      expect(screen.getByTestId('trip-edit-name').props.editable).toBe(false);
    });

    // Resolve deletion
    resolveDelete();
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('TripsList');
    });
  });

  test('R3.8, R3.11: a trip_forbidden DELETE shows friendly copy and does not navigate away', async () => {
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP;
      if (method === 'GET' && path === '/resorts') return { resorts: RESORTS };
      if (method === 'DELETE' && path === `/trips/${TRIP_ID}`) {
        throw new ApiError({
          code: 'trip_forbidden',
          message: 'forbidden',
          status: 403,
        });
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find((b) => b.text === 'Delete');
      confirmButton?.onPress?.();
    });

    const navigation = makeNavigation();
    renderEdit(navigation);
    await screen.findByTestId('trip-edit-form');

    fireEvent.press(screen.getByTestId('trip-edit-delete-btn'));

    expect(await screen.findByTestId('trip-edit-error-message')).toBeTruthy();
    expect(
      screen.getByText('This trip is no longer available, or you can no longer edit it.'),
    ).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
