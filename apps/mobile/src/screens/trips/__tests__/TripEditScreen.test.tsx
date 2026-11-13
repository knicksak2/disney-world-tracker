/**
 * Trip edit form — screen tests (Task 22).
 *
 * Validates: Requirements 3.1, 3.4, 3.5, 3.6, 3.8, 21.1, 21.5
 *
 * The edit form reads `GET /trips/:id` to pre-fill and submits `PATCH /trips/:id` with name, description and dates
 * (no longer `resortIds`). Lodging is edited in "Where you're staying" (trip-lodging-stays R7.4 to R7.6): the Stay
 * sheet saves the whole list with `PUT /trips/:id/stays`. It maps the Organizer-gated `trip_forbidden` rejection to
 * friendly copy (R3.8). A Member never reaches this screen: the hub hides its Edit control
 * (`TripDetailScreen.test.tsx`, "R3.8: a plain Member does not see the Edit control").
 *
 * The screen consumes `navigation`/`route` from props, so it renders directly
 * with a stubbed navigation object; only `apiRequest` is mocked.
 */

import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

import { darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import TripEditScreen from '../TripEditScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type {
  ResortDTO,
  TripDTO,
  TripGuestDTO,
  TripMemberDTO,
  TripStayDTO,
  TripStayInput,
} from '@dwt/shared';

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

const POLY_STAY_ID = '33333333-3333-4333-8333-333333333333';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TIMMY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const POLY_STAY: TripStayDTO = {
  id: POLY_STAY_ID,
  position: 0,
  lodgingKind: 'resort',
  resortId: POLY_ID,
  placeName: null,
  displayName: 'Polynesian Village',
  checkIn: '2024-05-01',
  checkOut: '2024-05-03',
  nights: 2,
  partyKeys: null,
};

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
  experienceLists: [],
  stays: [POLY_STAY],
  stayWarnings: [],
};

const MEMBERS: readonly TripMemberDTO[] = [
  { userId: ALICE, displayName: 'Alice', avatarPreset: null, role: 'organizer' },
  { userId: BOB, displayName: 'Bob', avatarPreset: null, role: 'member' },
];
const GUESTS = [{ id: TIMMY, tripId: TRIP_ID, sponsorMemberId: BOB, name: 'Timmy' }] as unknown as TripGuestDTO[];

/**
 * The fake server's Stays. `PUT /trips/:id/stays` replaces them the way the real route does (named ids kept, new ones
 * created, position = index), so a refetch of the Trip after the mutation sees the saved list.
 */
const server: { stays: TripStayDTO[]; puts: { stays: TripStayInput[] }[]; created: number } = {
  stays: [POLY_STAY],
  puts: [],
  created: 0,
};

function putBodies(): { stays: TripStayInput[] }[] {
  return server.puts;
}

function toDto(s: TripStayInput, i: number): TripStayDTO {
  server.created += 1;
  const nights =
    s.checkIn != null && s.checkOut != null
      ? Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 86_400_000)
      : null;
  const resortName = RESORTS.find((r) => r.id === s.resortId)?.name ?? '';
  return {
    id: s.id ?? `new-stay-${server.created}`,
    position: i,
    lodgingKind: s.lodgingKind,
    resortId: s.lodgingKind === 'resort' ? (s.resortId ?? null) : null,
    placeName: s.lodgingKind === 'resort' ? null : (s.placeName ?? null),
    displayName: s.lodgingKind === 'resort' ? resortName : (s.placeName ?? ''),
    checkIn: s.checkIn ?? null,
    checkOut: s.checkOut ?? null,
    nights,
    partyKeys: s.partyKeys ?? null,
  };
}

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

/** A path-keyed apiRequest mock covering the reads the edit form performs, plus the Stays PUT. */
function mockReads(options: { putError?: string } = {}): void {
  server.stays = [POLY_STAY];
  server.puts = [];
  server.created = 0;
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return { ...TRIP, stays: server.stays };
      if (method === 'GET' && path === '/resorts') return { resorts: RESORTS };
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS;
      if (method === 'PUT' && path === `/trips/${TRIP_ID}/stays`) {
        const sent = body as { stays: TripStayInput[] };
        server.puts.push(sent);
        if (options.putError !== undefined) {
          throw new ApiError({ code: 'trip_validation_failed', message: options.putError, status: 400, field: 'stays[1]' });
        }
        server.stays = sent.stays.map(toDto);
        return { stays: server.stays, stayWarnings: [] };
      }
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

  test('pre-fills the form and lists the recorded stays; the old resort multi-select is gone', async () => {
    mockReads();

    renderEdit(makeNavigation());

    expect(await screen.findByTestId('trip-edit-form')).toBeTruthy();
    expect(screen.getByTestId('trip-edit-name').props.value).toBe(TRIP.name);
    expect(screen.getByTestId('trip-edit-description').props.value).toBe(
      TRIP.description,
    );
    const row = await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);
    expect(within(row).getByText('Polynesian Village')).toBeTruthy();
    expect(within(row).getByText('May 1 to May 3 \u00b7 2 nights')).toBeTruthy();
    expect(within(row).getByText('Disney Resort')).toBeTruthy();
    expect(screen.queryByTestId('trip-edit-resorts')).toBeNull();
  });

  test('saving the Trip sends PATCH without the legacy resortIds and pops back', async () => {
    mockReads();
    const navigation = makeNavigation();

    renderEdit(navigation);
    await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);
    fireEvent.press(screen.getByTestId('trip-edit-submit'));

    await waitFor(() => {
      expect(navigation.goBack).toHaveBeenCalled();
    });
    const patchCall = apiRequestMock.mock.calls.find(
      (call) => call[0] === 'PATCH' && call[1] === `/trips/${TRIP_ID}`,
    );
    expect(patchCall).toBeDefined();
    expect(patchCall?.[2]).toEqual({
      name: TRIP.name,
      description: TRIP.description,
      startDate: TRIP.startDate,
      endDate: TRIP.endDate,
    });
    expect(Object.keys(patchCall?.[2] as object)).not.toContain('resortIds');
  });

  describe('Where you\u2019re staying (trip-lodging-stays R7.4 to R7.6)', () => {
    test('adds a Disney Resort stay: dates default to the previous check-out and the Trip end, then PUT /stays', async () => {
      mockReads();
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      fireEvent.press(screen.getByTestId('trip-stays-add'));
      expect(await screen.findByTestId('trip-stay-sheet')).toBeTruthy();
      // R7.6: check-in = the previous stay's check-out (May 3), check-out = the Trip end (May 5).
      expect(within(screen.getByTestId('trip-stay-check-in')).getByText('May 3, 2024')).toBeTruthy();
      expect(within(screen.getByTestId('trip-stay-check-out')).getByText('May 5, 2024')).toBeTruthy();

      fireEvent.changeText(screen.getByTestId('trip-stay-search'), 'contemp');
      await waitFor(() => expect(screen.queryByTestId(`trip-stay-resort-${POLY_ID}`)).toBeNull());
      fireEvent.press(screen.getByTestId(`trip-stay-resort-${CONTEMPORARY_ID}`));
      expect(
        screen.getByTestId(`trip-stay-resort-${CONTEMPORARY_ID}`).props.accessibilityState.checked,
      ).toBe(true);
      fireEvent.press(screen.getByTestId('trip-stay-save'));

      await waitFor(() => expect(putBodies()).toHaveLength(1));
      expect(screen.queryByTestId('trip-stay-sheet-error')?.props.children).toBeUndefined();
      await waitFor(() => expect(screen.queryByTestId('trip-stay-sheet')).toBeNull());
      expect(putBodies()).toEqual([
        {
          stays: [
            { id: POLY_STAY_ID, lodgingKind: 'resort', resortId: POLY_ID, checkIn: '2024-05-01', checkOut: '2024-05-03', partyKeys: null },
            { lodgingKind: 'resort', resortId: CONTEMPORARY_ID, checkIn: '2024-05-03', checkOut: '2024-05-05', partyKeys: null },
          ],
        },
      ]);
      expect(await screen.findByText('Contemporary')).toBeTruthy();
    });

    test('adds an off-site stay by name; an empty name is refused without a request', async () => {
      mockReads();
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      fireEvent.press(screen.getByTestId('trip-stays-add'));
      fireEvent.press(await screen.findByTestId('trip-stay-kind-offsite'));
      expect(screen.queryByTestId('trip-stay-search')).toBeNull();
      fireEvent.press(screen.getByTestId('trip-stay-save'));
      expect(screen.getByTestId('trip-stay-sheet-error').props.children).toBe(
        'Enter the name of the place you are staying.',
      );
      expect(putBodies()).toEqual([]);

      fireEvent.changeText(screen.getByTestId('trip-stay-place-name'), '  Aunt May  ');
      fireEvent.press(screen.getByTestId('trip-stay-save'));

      await waitFor(() => expect(putBodies()).toHaveLength(1));
      expect(putBodies()[0]?.stays[1]).toEqual({
        lodgingKind: 'offsite',
        placeName: 'Aunt May',
        checkIn: '2024-05-03',
        checkOut: '2024-05-05',
        partyKeys: null,
      });
      expect(await screen.findByText('Aunt May')).toBeTruthy();
    });

    test('edits the dates of a stay, keeping its id', async () => {
      mockReads();
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      fireEvent.press(screen.getByTestId(`trip-stay-edit-${POLY_STAY_ID}`));
      expect(await screen.findByText('Edit stay')).toBeTruthy();
      fireEvent.press(screen.getByTestId('trip-stay-check-out'));
      fireEvent.press(within(screen.getByTestId('trip-stay-check-out-calendar')).getByText('4'));
      expect(within(screen.getByTestId('trip-stay-check-out')).getByText('May 4, 2024')).toBeTruthy();
      fireEvent.press(screen.getByTestId('trip-stay-save'));

      await waitFor(() => expect(putBodies()).toHaveLength(1));
      expect(putBodies()[0]).toEqual({
        stays: [
          { id: POLY_STAY_ID, lodgingKind: 'resort', resortId: POLY_ID, checkIn: '2024-05-01', checkOut: '2024-05-04', partyKeys: null },
        ],
      });
      const row = await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);
      await waitFor(() => expect(within(row).getByText('May 1 to May 4 \u00b7 3 nights')).toBeTruthy());
    });

    test('removes a stay after confirming, and keeps it when cancelled', async () => {
      mockReads();
      const alertSpy = jest.spyOn(Alert, 'alert');
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      alertSpy.mockImplementationOnce((_t, _m, buttons) => {
        buttons?.find((b) => b.style === 'cancel')?.onPress?.();
      });
      fireEvent.press(screen.getByTestId(`trip-stay-remove-${POLY_STAY_ID}`));
      expect(putBodies()).toEqual([]);

      alertSpy.mockImplementationOnce((_t, _m, buttons) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });
      fireEvent.press(screen.getByTestId(`trip-stay-remove-${POLY_STAY_ID}`));

      await waitFor(() => expect(putBodies()).toEqual([{ stays: [] }]));
      expect(await screen.findByTestId('trip-stays-empty')).toBeTruthy();
    });

    test('"Who\u2019s staying": unchecking Everyone shows the checklist, and the checked people become partyKeys', async () => {
      mockReads();
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      fireEvent.press(screen.getByTestId('trip-stays-add'));
      fireEvent.press(await screen.findByTestId(`trip-stay-resort-${CONTEMPORARY_ID}`));
      const everyone = screen.getByTestId('trip-stay-everyone');
      expect(everyone.props.accessibilityState.checked).toBe(true);
      expect(screen.queryByTestId(`trip-stay-person-m:${ALICE}`)).toBeNull();

      fireEvent.press(everyone);
      await waitFor(() => expect(screen.getByTestId(`trip-stay-person-m:${ALICE}`)).toBeTruthy());
      expect(screen.getByTestId(`trip-stay-person-m:${BOB}`).props.accessibilityState.checked).toBe(true);
      expect(screen.getByTestId(`trip-stay-person-g:${TIMMY}`).props.accessibilityState.checked).toBe(true);
      fireEvent.press(screen.getByTestId(`trip-stay-person-m:${BOB}`));
      expect(screen.getByTestId(`trip-stay-person-m:${BOB}`).props.accessibilityState.checked).toBe(false);
      fireEvent.press(screen.getByTestId('trip-stay-save'));

      await waitFor(() => expect(putBodies()).toHaveLength(1));
      expect(putBodies()[0]?.stays[1]?.partyKeys).toEqual([`m:${ALICE}`, `g:${TIMMY}`]);
      // The card counts the named people against everyone on the Trip.
      await waitFor(() => expect(screen.getByText('2 of 3 people')).toBeTruthy());
    });

    test('a failed save keeps the sheet open with the server message and changes nothing', async () => {
      mockReads({ putError: 'Two stays share a night.' });
      renderEdit(makeNavigation());
      await screen.findByTestId(`trip-stay-row-${POLY_STAY_ID}`);

      fireEvent.press(screen.getByTestId('trip-stays-add'));
      fireEvent.press(await screen.findByTestId(`trip-stay-resort-${CONTEMPORARY_ID}`));
      fireEvent.press(screen.getByTestId('trip-stay-save'));

      expect(await screen.findByTestId('trip-stay-sheet-error')).toBeTruthy();
      expect(screen.getByTestId('trip-stay-sheet-error').props.children).toBe('Two stays share a night.');
      expect(screen.getByTestId('trip-stay-sheet')).toBeTruthy();
      expect(screen.getByTestId('trip-stay-save').props.accessibilityState?.disabled ?? false).toBe(false);
      // The card still holds only the original stay.
      expect(screen.getAllByTestId(/^trip-stay-row-/u).map((r) => r.props.testID)).toEqual([
        `trip-stay-row-${POLY_STAY_ID}`,
      ]);
      expect(server.stays).toHaveLength(1);
    });
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

  // Feature: dark-mode — the edit form repaints with the Twilight palette.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    /** The screen root: the host View that `ScreenContainer` paints. */
    function rootContainer(): ReactTestInstance {
      const container = screen.UNSAFE_getAllByType(ScreenContainer)[0]!;
      return container.children[0] as ReactTestInstance;
    }

    test('(a)(b)(c) paints the root, input text and themed TextInput props dark', async () => {
      mockReads();
      setTestScheme('dark');
      renderEdit(makeNavigation());

      await screen.findByTestId('trip-edit-form');
      // (a) root container.
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
      // (b) primary text — the Trip name input.
      const name = screen.getByTestId('trip-edit-name');
      expect(flat(name).color).toBe(darkTheme.color.textPrimary);
      // (c) converted TextInput props and field surface.
      expect(flat(name).backgroundColor).toBe(darkTheme.color.surface);
      expect(flat(name).borderColor).toBe(darkTheme.color.border);
      expect(name.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
      expect(name.props.keyboardAppearance).toBe('dark');
      expect(screen.getByTestId('trip-edit-description').props.keyboardAppearance).toBe('dark');
      expect(flat(screen.getByText('Trip name')).color).toBe(darkTheme.color.textSecondary);
    });

    test('keeps the pre-retrofit light values under light', async () => {
      mockReads();
      renderEdit(makeNavigation());

      await screen.findByTestId('trip-edit-form');
      const name = screen.getByTestId('trip-edit-name');
      expect(flat(name).color).toBe('#1f1235');
      expect(flat(name).backgroundColor).toBe('#ffffff');
      expect(name.props.placeholderTextColor).toBe('#6b6480');
      expect(name.props.keyboardAppearance).toBe('light');
    });
  });
});
