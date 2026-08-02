/**
 * Planned_List section — screen tests (task 17.11).
 *
 * Validates: Requirements 18.1, 9.1, 9.6, 9.9, 15.2
 *
 * The Planned_List screen reads `GET /trips/:id/planned-items` and renders each
 * entry's Experience name, Park, and adder display name (R9.9). Any Member can
 * add an Experience (`POST /trips/:id/planned-items`, R9.1) and remove an item
 * (`DELETE /trips/:id/planned-items/:itemId`, R9.6). Loading/error/empty states
 * mirror the other Trip screens; a membership failure collapses to a
 * non-disclosing error with Retry (R15.2).
 *
 * The screen consumes `navigation`/`route` from props, so it renders directly
 * with a stubbed navigation object; only `apiRequest` is mocked, dispatched by
 * method + path.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

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

import TripPlannedListScreen from '../TripPlannedListScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { PlannedItemDTO, TripFeedItemDTO, TripMemberDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';
// A valid UUID so the shared `plannedItemAddSchema` accepts the add body. This
// is the internal id the picker sends when its matching row is tapped — the
// User never sees or types it.
const EXPERIENCE_UUID = '99999999-9999-4999-8999-999999999999';

const OWN_USER_ID = '00000000-0000-4000-8000-000000000001';
const ARIEL_ID = '00000000-0000-4000-8000-000000000002';

const ITEM: PlannedItemDTO = {
  id: 'item-1',
  experienceId: 'exp-1',
  experienceName: 'Space Mountain',
  park: 'Magic Kingdom',
  addedByDisplayName: 'Ariel',
};

// A Planned_Item whose Experience has a matching completion in the feed below,
// so the derivation marks it `done` and places it in the Done_Section.
const DONE_ITEM: PlannedItemDTO = {
  id: 'item-done',
  experienceId: 'exp-done',
  experienceName: 'Big Thunder Mountain',
  park: 'Magic Kingdom',
  addedByDisplayName: 'Ariel',
};

// A Planned_Item with no matching completion, so it stays `not_done` and is
// rendered outside the Done_Section.
const TODO_ITEM: PlannedItemDTO = {
  id: 'item-todo',
  experienceId: 'exp-todo',
  experienceName: 'Peter Pan Flight',
  park: 'Magic Kingdom',
  addedByDisplayName: 'Belle',
};

const ME = { user: { id: OWN_USER_ID } };

const MEMBERS: TripMemberDTO[] = [
  { userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'organizer' },
  { userId: ARIEL_ID, displayName: 'Ariel', avatarPreset: null, role: 'member' },
];

// A Trip_Activity feed with a single completion for DONE_ITEM's Experience. The
// client builds the completed-Experience set from these `completion_logged`
// items' `metadata.experienceId`.
const FEED_WITH_DONE: TripFeedItemDTO[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'completion_logged',
    actorDisplayName: 'Ariel',
    actorAvatarPreset: null,
    createdAt: '2025-08-01T18:00:00.000Z',
    metadata: {
      experienceId: DONE_ITEM.experienceId,
      experienceName: DONE_ITEM.experienceName,
      park: DONE_ITEM.park,
      rating: 8,
    },
    reactions: [],
    comments: [],
  },
];

/** A Catalog search hit the picker renders as a tappable row. */
const SEARCH_HIT = {
  id: EXPERIENCE_UUID,
  name: 'Big Thunder Mountain',
  park: 'Magic Kingdom',
  category: 'Attraction',
  description: '',
  active: true,
  imageUrl: null,
  areaType: 'ThemePark',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Handlers {
  readonly items?: () => Promise<unknown>;
  readonly search?: (path: string) => Promise<unknown>;
  readonly mutate?: (method: string, path: string, body?: unknown) => Promise<unknown>;
  // The Trip_Activity feed that drives the derived completion state. Defaults to
  // an empty (loaded) feed; a handler that throws simulates a feed that could
  // not be loaded, forcing `completionAvailable === false` (R2.7).
  readonly feed?: () => Promise<unknown>;
}

function installApi(items: PlannedItemDTO[], handlers: Handlers = {}): void {
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return handlers.items ? await handlers.items() : items;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/feed`) {
        return handlers.feed ? await handlers.feed() : [];
      }
      if (method === 'GET' && path === '/me') {
        return ME;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) {
        return MEMBERS;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return handlers.search
          ? await handlers.search(path)
          : { experiences: [] };
      }
      if (handlers.mutate) {
        return handlers.mutate(method, path, body);
      }
      throw new Error(`unexpected apiRequest ${method} ${path}`);
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

function makeNavigation(): { navigate: jest.Mock; goBack: jest.Mock; canGoBack: jest.Mock } {
  return { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
}

function renderPlanned(
  navigation: ReturnType<typeof makeNavigation>,
): ReturnType<typeof render> {
  const props = {
    navigation,
    route: { key: 'TripPlannedList-1', name: 'TripPlannedList', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripPlannedListScreen>;

  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripPlannedListScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Planned_List screen', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R9.9: renders each Planned_Item with its Experience name, Park, and adder', async () => {
    installApi([ITEM]);

    renderPlanned(makeNavigation());

    expect(await screen.findByTestId(`planned-item-${ITEM.id}`)).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom')).toBeTruthy();
    expect(screen.getByText('Added by Ariel')).toBeTruthy();
  });

  test('shows the empty state with an add control when the list is empty', async () => {
    installApi([]);

    renderPlanned(makeNavigation());

    expect(await screen.findByTestId('planned-list-empty')).toBeTruthy();
    expect(screen.getByTestId('planned-list-empty-add')).toBeTruthy();
  });

  test('R9.1: searching and tapping an Experience posts its id to the planned-items endpoint', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    const search = jest.fn().mockResolvedValue({ experiences: [SEARCH_HIT] });
    installApi([ITEM], { mutate, search });

    renderPlanned(makeNavigation());
    fireEvent.press(await screen.findByTestId('planned-list-add-open'));

    // Typing a name (not a UUID) drives a catalog search; the debounced query
    // then hits `GET /catalog?q=...` and renders tappable results.
    fireEvent.changeText(
      await screen.findByTestId('planned-list-search'),
      'Thunder',
    );

    const row = await screen.findByTestId(
      `planned-list-result-${SEARCH_HIT.id}`,
    );
    fireEvent.press(row);

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/planned-items`,
        { experienceId: SEARCH_HIT.id },
      );
    });
    // The search request carried the trimmed, encoded query.
    expect(search).toHaveBeenCalledWith(
      expect.stringContaining('/catalog?q=Thunder'),
    );
  });

  test('an Experience already on the planned list is shown disabled, not addable', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    // The search hit shares ITEM's experienceId, so it should read as "Planned".
    const search = jest
      .fn()
      .mockResolvedValue({ experiences: [{ ...SEARCH_HIT, id: ITEM.experienceId }] });
    installApi([ITEM], { mutate, search });

    renderPlanned(makeNavigation());
    fireEvent.press(await screen.findByTestId('planned-list-add-open'));
    fireEvent.changeText(
      await screen.findByTestId('planned-list-search'),
      'Space',
    );

    const row = await screen.findByTestId(
      `planned-list-result-${ITEM.experienceId}`,
    );
    fireEvent.press(row);

    // Tapping an already-planned row is a no-op: no POST is issued.
    await waitFor(() => {
      expect(screen.getByText('Planned')).toBeTruthy();
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  test('R9.6: removing an item calls the delete endpoint', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi([ITEM], { mutate });

    renderPlanned(makeNavigation());
    fireEvent.press(await screen.findByTestId(`planned-item-remove-${ITEM.id}`));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/planned-items/${ITEM.id}`,
        undefined,
      );
    });
  });

  test('a remove authorization failure surfaces friendly copy', async () => {
    const mutate = jest.fn().mockRejectedValue(
      new ApiError({ code: 'trip_forbidden', message: 'forbidden', status: 403 }),
    );
    installApi([ITEM], { mutate });

    renderPlanned(makeNavigation());
    fireEvent.press(await screen.findByTestId(`planned-item-remove-${ITEM.id}`));

    expect(await screen.findByTestId('planned-list-action-error')).toBeTruthy();
  });

  test('R15.2: a failed read shows an error with a Retry control', async () => {
    installApi([], {
      items: async () => {
        throw new ApiError({ code: 'trip_forbidden', message: 'forbidden', status: 403 });
      },
    });

    renderPlanned(makeNavigation());

    expect(await screen.findByTestId('planned-list-error')).toBeTruthy();
    expect(screen.getByTestId('planned-list-retry')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Planned List Completion Sync — derived presentation
//
// Validates: Requirements 1.1, 1.2, 1.5, 2.7, 3.1, 4.1, 4.4
//
// The screen additionally reads `GET /trips/:id/feed` and runs the shared
// derivation to mark items `done`/`not_done`, group Completed_Planned_Items
// into the Done_Section with a visually distinct completed indicator, show the
// completed-of-total progress badge, and — when the feed could not be loaded —
// present a non-blocking "undetermined" indication with retry (never a `done`
// badge). The Planned_Item_Log_Control opens the reused pre-filled composer on
// every item, done or not.
// ---------------------------------------------------------------------------

describe('Planned_List completion sync presentation', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R2.1/R3.2: a completed Experience is grouped into the Done_Section, a not-done item is not', async () => {
    installApi([DONE_ITEM, TODO_ITEM], { feed: async () => FEED_WITH_DONE });

    renderPlanned(makeNavigation());

    // The Done_Section renders and contains the completed item.
    const doneSection = await screen.findByTestId('planned-list-done-section');
    expect(doneSection).toBeTruthy();
    expect(screen.getByTestId(`planned-item-${DONE_ITEM.id}`)).toBeTruthy();

    // R3.1: the completed item carries a visually distinct completed indicator;
    // the not-done item does not.
    expect(
      screen.getByTestId(`planned-item-completed-${DONE_ITEM.id}`),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`planned-item-completed-${TODO_ITEM.id}`),
    ).toBeNull();

    // The not-done item is still present (outside the Done_Section).
    expect(screen.getByTestId(`planned-item-${TODO_ITEM.id}`)).toBeTruthy();
  });

  test('R4.1: the progress badge shows the completed-of-total count', async () => {
    installApi([DONE_ITEM, TODO_ITEM], { feed: async () => FEED_WITH_DONE });

    renderPlanned(makeNavigation());

    expect(await screen.findByTestId('planned-list-progress')).toBeTruthy();
    // One of two Planned_Items is completed.
    expect(screen.getByText('1 of 2 completed')).toBeTruthy();
  });

  test('R4.4: an empty Planned_List shows `0 of 0` progress', async () => {
    installApi([], { feed: async () => [] });

    renderPlanned(makeNavigation());

    expect(await screen.findByTestId('planned-list-progress')).toBeTruthy();
    expect(screen.getByText('0 of 0 completed')).toBeTruthy();
  });

  test('R1.1/R1.5: the log control is present on both done and not-done items', async () => {
    installApi([DONE_ITEM, TODO_ITEM], { feed: async () => FEED_WITH_DONE });

    renderPlanned(makeNavigation());

    expect(
      await screen.findByTestId(`planned-item-log-${TODO_ITEM.id}`),
    ).toBeTruthy();
    expect(screen.getByTestId(`planned-item-log-${DONE_ITEM.id}`)).toBeTruthy();
  });

  test('R1.2: activating the log control opens the composer pre-filled with the item Experience', async () => {
    installApi([TODO_ITEM], { feed: async () => [] });

    renderPlanned(makeNavigation());

    fireEvent.press(
      await screen.findByTestId(`planned-item-log-${TODO_ITEM.id}`),
    );

    // The reused Log_Composer opens with the Planned_Item's Experience already
    // selected (the pre-filled selection row), so the Member does not re-search.
    expect(await screen.findByTestId('activity-log-composer')).toBeTruthy();
    const selected = await screen.findByTestId('activity-log-selected');
    // The pre-filled selection row shows the item's Experience name.
    expect(within(selected).getByText(TODO_ITEM.experienceName)).toBeTruthy();
  });

  test('R2.7: an unavailable feed shows the undetermined indication with retry and no done badge', async () => {
    let feedCalls = 0;
    installApi([DONE_ITEM, TODO_ITEM], {
      feed: async () => {
        feedCalls += 1;
        throw new ApiError({
          code: 'trip_forbidden',
          message: 'forbidden',
          status: 403,
        });
      },
    });

    renderPlanned(makeNavigation());

    // The Planned_List still renders from its own successful read, but the
    // completion state could not be determined.
    expect(
      await screen.findByTestId('planned-list-completion-undetermined'),
    ).toBeTruthy();
    // No item is shown as done from unavailable data.
    expect(
      screen.queryByTestId(`planned-item-completed-${DONE_ITEM.id}`),
    ).toBeNull();
    // Retry re-requests the feed.
    const callsBeforeRetry = feedCalls;
    fireEvent.press(screen.getByTestId('planned-list-completion-retry'));
    await waitFor(() => {
      expect(feedCalls).toBeGreaterThan(callsBeforeRetry);
    });
  });
});
