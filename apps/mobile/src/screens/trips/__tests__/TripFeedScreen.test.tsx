/**
 * Trip_Activity screen tests (task 19.4).
 *
 * Validates: Requirements 20.1–20.5, 10, 13.4
 *
 * The consolidated Trip_Activity surface (the `TripFeed` route) reads
 * `GET /trips/:id/feed` for the mixed stream, `GET /me` + `GET /trips/:id/members`
 * for the log + rode-with picker, and posts `POST /trips/:id/log-entries` for a
 * logged Completion. It renders completion items with the Experience, rating,
 * and rode-with tag states folded into the feed item metadata, offers an
 * All / Completions filter, and toggles reactions on any item.
 *
 * Only `apiRequest` is mocked, dispatched by method + path.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import TripFeedScreen from '../TripFeedScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripFeedItemDTO, TripMemberDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';
const OWN_USER_ID = '00000000-0000-4000-8000-000000000001';
const ARIEL_ID = '00000000-0000-4000-8000-000000000002';
const EXPERIENCE_UUID = '99999999-9999-4999-8999-999999999999';
const COMPLETION_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const JOIN_ITEM_ID = '22222222-2222-4222-8222-222222222222';

const ME = { user: { id: OWN_USER_ID } };

const MEMBERS: TripMemberDTO[] = [
  { userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'organizer' },
  { userId: ARIEL_ID, displayName: 'Ariel', avatarPreset: null, role: 'member' },
];

const FEED: TripFeedItemDTO[] = [
  {
    id: COMPLETION_ITEM_ID,
    type: 'completion_logged',
    actorDisplayName: 'Me',
    createdAt: '2025-08-01T18:00:00.000Z',
    metadata: {
      experienceId: EXPERIENCE_UUID,
      experienceName: 'Big Thunder Mountain',
      park: 'Magic Kingdom',
      rating: 8,
      rodeWithCount: 1,
      rodeWith: [
        { taggedMemberId: ARIEL_ID, displayName: 'Ariel', state: 'confirmed' },
      ],
    },
    reactions: [],
    comments: [],
  },
  {
    id: JOIN_ITEM_ID,
    type: 'member_joined',
    actorDisplayName: 'Ariel',
    createdAt: '2025-08-01T17:00:00.000Z',
    metadata: {},
    reactions: [],
    comments: [],
  },
];

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
  readonly feed?: () => Promise<unknown>;
  readonly search?: (path: string) => Promise<unknown>;
  readonly mutate?: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

function installApi(handlers: Handlers = {}): void {
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/me') return ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/feed`) {
        return handlers.feed ? await handlers.feed() : FEED;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return handlers.search ? await handlers.search(path) : { experiences: [] };
      }
      if (handlers.mutate) return handlers.mutate(method, path, body);
      return null;
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

function makeNavigation(): {
  navigate: jest.Mock;
  goBack: jest.Mock;
  canGoBack: jest.Mock;
} {
  return { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
}

function renderActivity(): void {
  const props = {
    navigation: makeNavigation(),
    route: { key: 'TripFeed-1', name: 'TripFeed', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripFeedScreen>;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripFeedScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Activity screen', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R20.3: a completion item shows the Experience, rating, and rode-with tag state', async () => {
    installApi();
    renderActivity();

    expect(await screen.findByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeTruthy();
    expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();
    expect(screen.getByTestId(`trip-feed-experience-${COMPLETION_ITEM_ID}`)).toBeTruthy();
    // The confirmed rode-with tag renders the tagged Member's name.
    expect(screen.getByTestId(`trip-feed-rodewith-${COMPLETION_ITEM_ID}`)).toBeTruthy();
  });

  test('R20.4: the Completions filter narrows the stream to logged completions', async () => {
    installApi();
    renderActivity();

    // Both items show under All.
    expect(await screen.findByTestId(`trip-feed-item-${JOIN_ITEM_ID}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('trip-activity-filter-completions'));

    // The non-completion item is filtered out; the completion remains.
    expect(screen.queryByTestId(`trip-feed-item-${JOIN_ITEM_ID}`)).toBeNull();
    expect(screen.getByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeTruthy();
  });

  test('R20.2/R10: logging a completion from the activity feed posts the assembled body', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    const search = jest.fn().mockResolvedValue({ experiences: [SEARCH_HIT] });
    installApi({ mutate, search });

    renderActivity();

    fireEvent.press(await screen.findByTestId('trip-activity-log-cta'));
    fireEvent.changeText(await screen.findByTestId('activity-log-search'), 'Thunder');
    fireEvent.press(await screen.findByTestId(`activity-log-result-${SEARCH_HIT.id}`));
    await screen.findByTestId('activity-log-selected');

    fireEvent.press(screen.getByTestId(`activity-log-member-${ARIEL_ID}`));
    fireEvent.press(screen.getByTestId('activity-log-rating-8'));
    fireEvent.press(screen.getByTestId('activity-log-submit'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/log-entries`,
        { experienceId: EXPERIENCE_UUID, rodeWith: [ARIEL_ID], rating: 8 },
      );
    });
  });

  test('R13.4: tapping a reaction posts it for the feed item', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi({ mutate });

    renderActivity();

    fireEvent.press(
      await screen.findByTestId(`trip-feed-reaction-${COMPLETION_ITEM_ID}-like`),
    );

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/feed/feed_item/${COMPLETION_ITEM_ID}/reactions`,
        { reaction: 'like' },
      );
    });
  });
});
