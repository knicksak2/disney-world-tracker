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
  within,
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
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { ExperienceDTO, TripFeedItemDTO, TripMemberDTO, TripPostPhotoSlotDTO } from '@dwt/shared';
import { useTripAlbum, useTripSummaryPhotos } from '../../../photos/api';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as photoPickerModule from '../../../photos/photoPicker';
import * as imagePrepModule from '../../../photos/imagePrep';
import { darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { FEED_MISC, RODE_WITH } from '../TripFeedScreen.palette';

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
    actorAvatarPreset: null,
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
    actorAvatarPreset: null,
    createdAt: '2025-08-01T17:00:00.000Z',
    metadata: {},
    reactions: [],
    comments: [],
  },
];

const MEMBER_POST_ITEM_ID = '33333333-3333-4333-8333-333333333333';

const MEMBER_POST_MINE_ALL_REMOVED: TripFeedItemDTO = {
  id: MEMBER_POST_ITEM_ID,
  type: 'member_post',
  actorDisplayName: 'Me',
  actorAvatarPreset: null,
  createdAt: '2025-08-01T19:00:00.000Z',
  metadata: {
    caption: 'Sunset at the castle',
  },
  photos: [
    {
      photoId: 'photo-rem-1',
      state: 'removed',
      mine: true,
      status: 'deleted',
      thumbUrl: null,
      url: null,
      width: null,
      height: null,
    },
    {
      photoId: 'photo-rem-2',
      state: 'removed',
      mine: true,
      status: 'deleted',
      thumbUrl: null,
      url: null,
      width: null,
      height: null,
    },
  ],
  mine: true,
  reactions: [{ reaction: 'love', count: 2, mine: false }],
  comments: [],
};

const SEARCH_HIT: ExperienceDTO = {
  id: EXPERIENCE_UUID,
  name: 'Big Thunder Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  description: '',
  active: true,
  imageUrl: null,
  areaType: 'ThemePark',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Handlers {
  readonly members?: readonly TripMemberDTO[];
  readonly feed?: () => Promise<unknown>;
  readonly search?: (path: string) => Promise<unknown>;
  readonly mutate?: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

function installApi(handlers: Handlers = {}): void {
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/me') return ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) {
        return handlers.members ?? MEMBERS;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Family Trip',
          status: 'active',
          startDate: '2020-01-01',
          endDate: '2030-12-31',
        };
      }
      if (method === 'GET' && path === '/me/trips') {
        return [{ status: 'active', trips: [] }];
      }
      if (method === 'GET' && path === '/photos/config') {
        return { enabled: true, tripEnabled: true, remainingToday: 20 };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/feed`) {
        return handlers.feed ? await handlers.feed() : FEED;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return handlers.search ? await handlers.search(path) : { experiences: [] };
      }
      if (handlers.mutate) return handlers.mutate(method, path, body);
      return {};
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

function renderActivity(extra?: React.ReactNode): void {
  const props = {
    navigation: makeNavigation(),
    route: { key: 'TripFeed-1', name: 'TripFeed', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripFeedScreen>;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripFeedScreen {...props} />
      {extra}
    </QueryClientProvider>,
  );
}

/**
 * Keeps the Trip Album and recap-photos queries active next to the feed, the way
 * they are when those screens sit underneath Trip Activity in the stack, so a
 * delete from the feed viewer can be seen refetching them.
 */
function AlbumAndRecapProbe(): null {
  useTripAlbum(TRIP_ID);
  useTripSummaryPhotos(TRIP_ID);
  return null;
}

const ALBUM_PATH = `/trips/${TRIP_ID}/photos`;
const RECAP_PHOTOS_PATH = `/trips/${TRIP_ID}/photos?summary=true`;
const FEED_PATH = `/trips/${TRIP_ID}/feed`;

function countGets(path: string): number {
  return apiRequestMock.mock.calls.filter(
    (call) => call[0] === 'GET' && call[1] === path,
  ).length;
}

function readySlot(photoId: string, mine: boolean): TripPostPhotoSlotDTO {
  return {
    photoId,
    state: 'ready',
    mine,
    status: 'approved',
    thumbUrl: `https://cdn.example.com/p/${photoId}/thumb.jpg`,
    url: `https://cdn.example.com/p/${photoId}/full.jpg`,
    width: 1280,
    height: 960,
  };
}

function memberPost(
  id: string,
  slots: readonly TripPostPhotoSlotDTO[],
  mine: boolean,
): TripFeedItemDTO {
  return {
    id,
    type: 'member_post',
    actorDisplayName: mine ? 'Me' : 'Donald',
    actorAvatarPreset: null,
    createdAt: '2025-08-01T20:00:00.000Z',
    metadata: { caption: 'Castle day' },
    photos: slots,
    mine,
    reactions: [],
    comments: [],
  };
}

/** The `source.uri` of the image rendered inside the open full-screen viewer. */
function viewerImageUri(): string {
  const viewer = screen.getByTestId('photo-viewer-modal');
  const image = within(viewer).getByLabelText('Guest photo');
  return (image.props as { source: { uri: string } }).source.uri;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Activity screen', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    apiRequestMock.mockReset();
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    await AsyncStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
    // Guard: showParkFilter defaults to false so park filter bar is omitted in 320px composer
    expect(screen.queryByTestId('activity-log-park-filters')).toBeNull();
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
        expect.objectContaining({
          experienceId: EXPERIENCE_UUID,
          rodeWith: [ARIEL_ID],
          rating: 8,
        }),
      );
    });
  });

  test('logging a completion with note sends note in payload', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    const search = jest.fn().mockResolvedValue({ experiences: [SEARCH_HIT] });
    installApi({ mutate, search });

    renderActivity();

    fireEvent.press(await screen.findByTestId('trip-activity-log-cta'));
    fireEvent.changeText(await screen.findByTestId('activity-log-search'), 'Thunder');
    fireEvent.press(await screen.findByTestId(`activity-log-result-${SEARCH_HIT.id}`));
    await screen.findByTestId('activity-log-selected');

    expect(screen.getByText('Rode with')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('activity-log-note-input'), 'Front row was thrilling!');
    fireEvent.press(screen.getByTestId('activity-log-submit'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/log-entries`,
        expect.objectContaining({
          experienceId: EXPERIENCE_UUID,
          rodeWith: [],
          note: 'Front row was thrilling!',
        }),
      );
    });
  });

  test('logging a dining completion shows "Dined with" header', async () => {
    const DINING_HIT: ExperienceDTO = {
      ...SEARCH_HIT,
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Be Our Guest Restaurant',
      category: 'Restaurant',
    };
    const search = jest.fn().mockResolvedValue({ experiences: [DINING_HIT] });
    installApi({ search });

    renderActivity();

    fireEvent.press(await screen.findByTestId('trip-activity-log-cta'));
    fireEvent.changeText(await screen.findByTestId('activity-log-search'), 'Guest');
    fireEvent.press(await screen.findByTestId(`activity-log-result-${DINING_HIT.id}`));
    await screen.findByTestId('activity-log-selected');

    expect(screen.getByText('Dined with')).toBeTruthy();
  });

  test('feed item renders note when present in metadata', async () => {
    const baseItem = FEED[0]!;
    const itemWithNote: TripFeedItemDTO = {
      ...baseItem,
      id: 'item-note-1',
      metadata: {
        ...baseItem.metadata,
        note: 'Amazing fireworks view from our table!',
      },
    };
    installApi({ feed: async () => [itemWithNote] });

    renderActivity();

    expect(await screen.findByText('"Amazing fireworks view from our table!"')).toBeTruthy();
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

  test('tapping wow reaction posts wire enum wow', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi({ mutate });

    renderActivity();

    fireEvent.press(
      await screen.findByTestId(`trip-feed-reaction-${COMPLETION_ITEM_ID}-wow`),
    );

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/feed/feed_item/${COMPLETION_ITEM_ID}/reactions`,
        { reaction: 'wow' },
      );
    });
  });

  test('comment action link toggles comment composer input and submits comment', async () => {
    const mutate = jest.fn().mockResolvedValue({ id: 'new-comment-id' });
    installApi({ mutate });

    renderActivity();

    expect(
      screen.queryByTestId(`trip-feed-comment-input-${COMPLETION_ITEM_ID}`),
    ).toBeNull();

    fireEvent.press(
      await screen.findByTestId(`trip-feed-comment-open-${COMPLETION_ITEM_ID}`),
    );

    const input = await screen.findByTestId(
      `trip-feed-comment-input-${COMPLETION_ITEM_ID}`,
    );
    expect(input).toBeTruthy();

    fireEvent.changeText(input, 'Great ride!');
    fireEvent.press(
      screen.getByTestId(`trip-feed-comment-submit-${COMPLETION_ITEM_ID}`),
    );

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/feed/feed_item/${COMPLETION_ITEM_ID}/comments`,
        { body: 'Great ride!' },
      );
    });
  });

  test('Task 22.3: posting sends initiate, confirm, then the post body with the returned photo ids and caption', async () => {
    const mutate = jest.fn().mockImplementation(async (_method: string, path: string) => {
      if (path === '/photos/uploads') {
        return {
          slots: [
            {
              photoId: 'photo-101',
              putUrl: 'http://storage.local/101',
              thumbPutUrl: 'http://storage.local/101_thumb',
            },
          ],
        };
      }
      if (path === '/photos/confirm') {
        return {
          results: [{ photoId: 'photo-101', status: 'accepted' }],
        };
      }
      if (path === `/trips/${TRIP_ID}/feed/posts`) {
        return { id: 'new-post-1' };
      }
      return null;
    });

    installApi({ mutate });

    jest.spyOn(photoPickerModule, 'requestLibraryPermission').mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    jest.spyOn(photoPickerModule, 'pickFromLibrary').mockResolvedValue({
      canceled: false,
      photos: [
        {
          uri: 'file:///p1.jpg',
          width: 1200,
          height: 800,
          takenAt: '2026-10-18T10:00:00Z',
          source: 'library',
        },
      ],
    });
    const fakeBlob = new Blob([new Uint8Array(50)], { type: 'image/jpeg' });
    jest.spyOn(imagePrepModule, 'prepareImage').mockResolvedValue({
      full: { uri: 'file:///p1.jpg', width: 1200, height: 800, blob: fakeBlob },
      thumb: { uri: 'file:///p1_t.jpg', width: 300, height: 200, blob: fakeBlob },
    });

    await AsyncStorage.setItem('photos.disclosure.v1', 'true');

    renderActivity();

    // 1. Open post composer
    const postCta = await screen.findByTestId('trip-activity-post-cta');
    fireEvent.press(postCta);

    // 2. Open picker sheet
    const pickPhotosBtn = await screen.findByTestId('feed-post-pick-photos');
    fireEvent.press(pickPhotosBtn);

    // The Trip post picker shows the trip guidance, never the food guidance (Requirement 23.9)
    const tripGuidance = await screen.findByText(
      'Share your favorite moments with your crew. People and text are welcome.',
    );
    expect(tripGuidance.props.accessibilityLabel).toBe(
      'Share your favorite moments with your crew. People and text are welcome.',
    );
    expect(screen.queryByText(/Frame just the dish/)).toBeNull();
    expect(screen.queryByText(/No people or text/)).toBeNull();

    // 3. Pick from library
    const chooseBtn = await screen.findByTestId('choose-from-library-button');
    fireEvent.press(chooseBtn);

    // Wait for photo to be picked
    expect(await screen.findByText('Choose Different Photo')).toBeTruthy();

    // 4. Confirm photos in picker sheet
    const confirmPickerBtn = await screen.findByTestId('confirm-photo-upload-button');
    fireEvent.press(confirmPickerBtn);

    // Wait for batch to be confirmed into composer
    expect(await screen.findByText('1 photo selected')).toBeTruthy();

    // 5. Add caption and submit
    const captionInput = screen.getByTestId('feed-post-caption-input');
    fireEvent.changeText(captionInput, 'Castle sunset');

    const submitBtn = screen.getByTestId('feed-post-submit');
    fireEvent.press(submitBtn);

    await waitFor(() => {
      // Initiate
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        '/photos/uploads',
        expect.objectContaining({
          target: { kind: 'trip', id: TRIP_ID },
          items: expect.any(Array),
        }),
      );
      // Confirm
      expect(mutate).toHaveBeenCalledWith('POST', '/photos/confirm', {
        photoIds: ['photo-101'],
      });
      // Post feed item
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/feed/posts`,
        {
          photoIds: ['photo-101'],
          caption: 'Castle sunset',
        },
      );
    });
  });

  test('Task 22.3: deleted-photo slot shows "photo removed", author delete control is driven by mine: true, reactions still render', async () => {
    let currentFeed: TripFeedItemDTO[] = [MEMBER_POST_MINE_ALL_REMOVED];
    const feed = jest.fn().mockImplementation(async () => currentFeed);
    const mutate = jest.fn().mockImplementation(async (method: string, path: string) => {
      if (method === 'DELETE' && path.includes(MEMBER_POST_ITEM_ID)) {
        currentFeed = [];
      }
      return undefined;
    });
    installApi({ mutate, feed });

    renderActivity();

    // The post is rendered
    expect(await screen.findByTestId(`trip-feed-item-${MEMBER_POST_ITEM_ID}`)).toBeTruthy();

    // Every removed slot shows "photo removed" text
    const removedTexts = screen.getAllByText('photo removed');
    expect(removedTexts).toHaveLength(2);

    // Reactions still render
    expect(screen.getByTestId(`trip-feed-reaction-${MEMBER_POST_ITEM_ID}-love`)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();

    // Author delete button is present (driven by mine: true)
    const deleteBtn = screen.getByTestId(`trip-feed-post-delete-${MEMBER_POST_ITEM_ID}`);
    expect(deleteBtn).toBeTruthy();

    // Tapping delete calls DELETE /trips/:id/feed/posts/:feedItemId and removes the item
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/feed/posts/${MEMBER_POST_ITEM_ID}`,
        undefined,
      );
    });

    // Item is removed from the feed
    await waitFor(() => {
      expect(screen.queryByTestId(`trip-feed-item-${MEMBER_POST_ITEM_ID}`)).toBeNull();
    });
  });

  test('Task 22.3: non-author post (mine absent) has no delete control', async () => {
    const nonAuthorPost: TripFeedItemDTO = {
      ...MEMBER_POST_MINE_ALL_REMOVED,
      mine: undefined,
    };
    const feed = jest.fn().mockResolvedValue([nonAuthorPost]);
    installApi({ feed });

    renderActivity();

    expect(await screen.findByTestId(`trip-feed-item-${MEMBER_POST_ITEM_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`trip-feed-post-delete-${MEMBER_POST_ITEM_ID}`)).toBeNull();
  });

  test('Task 22.3: renders ready image, checking placeholder, and unavailable placeholder slots', async () => {
    const mixedPost: TripFeedItemDTO = {
      id: 'mixed-post-1',
      type: 'member_post',
      actorDisplayName: 'Donald',
      actorAvatarPreset: null,
      createdAt: '2025-08-01T20:00:00.000Z',
      metadata: { caption: 'Mixed photo states' },
      photos: [
        {
          photoId: 'p-ready',
          state: 'ready',
          mine: false,
          status: 'approved',
          thumbUrl: 'http://cdn.local/ready-thumb.jpg',
          url: 'http://cdn.local/ready-full.jpg',
          width: 800,
          height: 600,
        },
        {
          photoId: 'p-checking',
          state: 'checking',
          mine: false,
          status: 'pending',
          thumbUrl: null,
          url: null,
          width: null,
          height: null,
        },
        {
          photoId: 'p-unavail',
          state: 'unavailable',
          mine: false,
          status: 'needs_review',
          thumbUrl: null,
          url: null,
          width: null,
          height: null,
        },
      ],
      mine: false,
      reactions: [],
      comments: [],
    };
    const feed = jest.fn().mockResolvedValue([mixedPost]);
    installApi({ feed });

    renderActivity();

    expect(await screen.findByTestId('trip-feed-slot-ready-p-ready')).toBeTruthy();
    expect(screen.getByTestId('trip-feed-slot-checking-p-checking')).toBeTruthy();
    expect(screen.getByText('Checking photo...')).toBeTruthy();
    expect(screen.getByTestId('trip-feed-slot-unavailable-p-unavail')).toBeTruthy();
    expect(screen.getByText('Photo unavailable')).toBeTruthy();
  });

  // photo-uploads R14.15: ready post photos open the shared full-screen viewer.
  describe('R14.15: tapping a post photo opens the full-screen viewer', () => {
    const OTHER_POST_ID = 'post-other';
    const OWN_POST_ID = 'post-own';

    /** Album/recap reads return empty pages; everything else is delegated. */
    function photoReads(
      inner?: (method: string, path: string, body?: unknown) => unknown,
    ): (method: string, path: string, body?: unknown) => Promise<unknown> {
      return async (method, path, body) => {
        if (method === 'GET' && (path === ALBUM_PATH || path === RECAP_PHOTOS_PATH)) {
          return { items: [], nextCursor: null };
        }
        return inner ? inner(method, path, body) : undefined;
      };
    }

    test('opens the viewer for the tapped photo with its full url, not the thumbnail', async () => {
      const post = memberPost(
        OTHER_POST_ID,
        [readySlot('ph-a', false), readySlot('ph-b', false)],
        false,
      );
      installApi({ feed: async () => [post] });
      renderActivity();

      // The feed card itself keeps showing the thumbnail.
      const feedImage = await screen.findByTestId('trip-feed-slot-ready-ph-a');
      expect((feedImage.props as { source: { uri: string } }).source.uri).toBe(
        'https://cdn.example.com/p/ph-a/thumb.jpg',
      );
      expect(screen.queryByTestId('photo-viewer-modal')).toBeNull();

      // Tapping the SECOND photo opens the viewer for that photo (single-photo viewer).
      fireEvent.press(screen.getByTestId('trip-feed-slot-press-ph-b'));
      expect(await screen.findByTestId('photo-viewer-modal')).toBeTruthy();
      expect(viewerImageUri()).toBe('https://cdn.example.com/p/ph-b/full.jpg');
    });

    test('the tap target is an image button labelled with the author and caption', async () => {
      installApi({
        feed: async () => [memberPost(OTHER_POST_ID, [readySlot('ph-a', false)], false)],
      });
      renderActivity();

      const press = await screen.findByTestId('trip-feed-slot-press-ph-a');
      expect(press.props.accessibilityRole).toBe('imagebutton');
      expect(press.props.accessibilityLabel).toBe('View photo by Donald, Castle day');
    });

    test('falls back to the thumbnail only when the slot has no full url', async () => {
      const noFull: TripPostPhotoSlotDTO = { ...readySlot('ph-a', false), url: null };
      installApi({ feed: async () => [memberPost(OTHER_POST_ID, [noFull], false)] });
      renderActivity();

      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-a'));
      await screen.findByTestId('photo-viewer-modal');
      expect(viewerImageUri()).toBe('https://cdn.example.com/p/ph-a/thumb.jpg');
    });

    test("someone else's photo: Report posts the reason and confirms; Block uploader posts { photoId } with no userId", async () => {
      const mutate = jest.fn().mockResolvedValue(undefined);
      installApi({
        feed: async () => [memberPost(OTHER_POST_ID, [readySlot('ph-a', false)], false)],
        mutate: photoReads(mutate),
      });
      renderActivity();

      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-a'));
      expect(await screen.findByTestId('photo-viewer-report')).toBeTruthy();
      expect(screen.getByTestId('photo-viewer-block')).toBeTruthy();

      // Report: pick a reason, submit, see the confirmation.
      fireEvent.press(screen.getByTestId('photo-viewer-report'));
      fireEvent.press(await screen.findByTestId('report-reason-spam'));
      fireEvent.press(screen.getByTestId('submit-report-button'));
      expect(await screen.findByTestId('photo-report-confirmation')).toBeTruthy();
      expect(mutate).toHaveBeenCalledWith('POST', '/photos/ph-a/report', { reason: 'spam' });
      fireEvent.press(screen.getByLabelText('Done'));

      // Block uploader: confirm, request carries the photo id and never a user id.
      fireEvent.press(screen.getByTestId('photo-viewer-block'));
      fireEvent.press(await screen.findByTestId('confirm-block-button'));
      expect(await screen.findByTestId('block-confirmation-notice')).toBeTruthy();
      expect(mutate).toHaveBeenCalledWith('POST', '/me/blocks', { photoId: 'ph-a' });
      const blockCall = mutate.mock.calls.find((c) => c[1] === '/me/blocks');
      expect(blockCall?.[2]).not.toHaveProperty('userId');
    });

    test("a plain member gets no Delete on someone else's photo", async () => {
      installApi({
        members: [
          { userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'member' },
          { userId: ARIEL_ID, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
        ],
        feed: async () => [memberPost(OTHER_POST_ID, [readySlot('ph-a', false)], false)],
      });
      renderActivity();

      // Wait for the members read so the organizer check has settled.
      await waitFor(() => {
        expect(countGets(`/trips/${TRIP_ID}/members`)).toBeGreaterThan(0);
      });
      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-a'));
      expect(await screen.findByTestId('photo-viewer-report')).toBeTruthy();
      expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();
    });

    test("an organizer sees Delete on another member's photo", async () => {
      // MEMBERS (default) makes the caller an organizer.
      installApi({
        feed: async () => [memberPost(OTHER_POST_ID, [readySlot('ph-a', false)], false)],
      });
      renderActivity();

      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-a'));
      expect(await screen.findByTestId('photo-viewer-delete')).toBeTruthy();
      expect(screen.getByTestId('photo-viewer-report')).toBeTruthy();
    });

    test("the user's own photo: Delete (no Report / Block) sends DELETE, closes the viewer and refetches the feed, album and recap photos", async () => {
      let removed = false;
      const ownPost = (): TripFeedItemDTO =>
        memberPost(
          OWN_POST_ID,
          [
            removed
              ? {
                  photoId: 'ph-own',
                  state: 'removed',
                  mine: true,
                  status: 'deleted',
                  thumbUrl: null,
                  url: null,
                  width: null,
                  height: null,
                }
              : readySlot('ph-own', true),
          ],
          true,
        );
      const mutate = jest.fn().mockImplementation(async (method: string, path: string) => {
        if (method === 'DELETE' && path === '/photos/ph-own') removed = true;
        return undefined;
      });
      installApi({ feed: async () => [ownPost()], mutate: photoReads(mutate) });
      // Album and recap photos stay mounted alongside the feed.
      renderActivity(<AlbumAndRecapProbe />);

      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-own'));
      expect(await screen.findByTestId('photo-viewer-delete')).toBeTruthy();
      expect(screen.queryByTestId('photo-viewer-report')).toBeNull();
      expect(screen.queryByTestId('photo-viewer-block')).toBeNull();

      await waitFor(() => {
        expect(countGets(ALBUM_PATH)).toBe(1);
        expect(countGets(RECAP_PHOTOS_PATH)).toBe(1);
      });
      const feedBefore = countGets(FEED_PATH);

      fireEvent.press(screen.getByTestId('photo-viewer-delete'));
      fireEvent.press(await screen.findByTestId('confirm-delete-button'));

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith('DELETE', '/photos/ph-own', undefined);
      });
      // The viewer closes and the post now shows the "photo removed" placeholder.
      await waitFor(() => {
        expect(screen.queryByTestId('photo-viewer-modal')).toBeNull();
      });
      expect(await screen.findByTestId('trip-feed-slot-removed-ph-own')).toBeTruthy();
      expect(screen.getByText('photo removed')).toBeTruthy();
      expect(screen.queryByTestId('trip-feed-slot-press-ph-own')).toBeNull();

      // Feed, album and recap photos were all refetched after the delete.
      expect(countGets(FEED_PATH)).toBeGreaterThan(feedBefore);
      await waitFor(() => {
        expect(countGets(ALBUM_PATH)).toBeGreaterThanOrEqual(2);
        expect(countGets(RECAP_PHOTOS_PATH)).toBeGreaterThanOrEqual(2);
      });
    });

    test('only ready slots are tappable: checking, removed and unavailable stay non-interactive', async () => {
      const inert = (
        photoId: string,
        state: TripPostPhotoSlotDTO['state'],
      ): TripPostPhotoSlotDTO => ({
        photoId,
        state,
        mine: false,
        status: null,
        thumbUrl: null,
        url: null,
        width: null,
        height: null,
      });
      const post = memberPost(
        OTHER_POST_ID,
        [
          readySlot('ph-ready', false),
          inert('ph-checking', 'checking'),
          inert('ph-removed', 'removed'),
          inert('ph-unavail', 'unavailable'),
        ],
        false,
      );
      installApi({ feed: async () => [post] });
      renderActivity();

      await screen.findByTestId('trip-feed-slot-ready-ph-ready');
      expect(screen.getByTestId('trip-feed-slot-checking-ph-checking')).toBeTruthy();
      expect(screen.getByTestId('trip-feed-slot-removed-ph-removed')).toBeTruthy();
      expect(screen.getByTestId('trip-feed-slot-unavailable-ph-unavail')).toBeTruthy();

      expect(screen.queryByTestId('trip-feed-slot-press-ph-checking')).toBeNull();
      expect(screen.queryByTestId('trip-feed-slot-press-ph-removed')).toBeNull();
      expect(screen.queryByTestId('trip-feed-slot-press-ph-unavail')).toBeNull();
      // The ready slot is the only image button in the post.
      const postBody = screen.getByTestId(`trip-feed-slots-${OTHER_POST_ID}`);
      expect(within(postBody).getAllByRole('imagebutton')).toHaveLength(1);
    });

    test('closing the viewer returns to the feed without sending any request', async () => {
      installApi({
        feed: async () => [memberPost(OTHER_POST_ID, [readySlot('ph-a', false)], false)],
      });
      renderActivity();

      fireEvent.press(await screen.findByTestId('trip-feed-slot-press-ph-a'));
      await screen.findByTestId('photo-viewer-modal');
      await waitFor(() => {
        expect(countGets(`/trips/${TRIP_ID}/members`)).toBeGreaterThan(0);
      });
      const callsBefore = apiRequestMock.mock.calls.length;

      fireEvent.press(screen.getByTestId('photo-viewer-close'));

      await waitFor(() => {
        expect(screen.queryByTestId('photo-viewer-modal')).toBeNull();
      });
      expect(screen.getByTestId('trip-feed-slot-press-ph-a')).toBeTruthy();
      expect(apiRequestMock.mock.calls.length).toBe(callsBefore);
    });
  });

  // Feature: dark-mode — the activity feed repaints with the Twilight palette.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    /** The screen root: the host View that `ScreenContainer` paints. */
    function rootContainer(): ReactTestInstance {
      const container = screen.UNSAFE_getAllByType(ScreenContainer)[0]!;
      return container.children[0] as ReactTestInstance;
    }

    test('(a)(b)(c) paints the root, feed text, log CTA and rode-with chip dark', async () => {
      installApi();
      setTestScheme('dark');
      renderActivity();

      await screen.findByText('Big Thunder Mountain');
      // (a) root container.
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
      // (b) primary text — the completed Experience's name.
      expect(flat(screen.getByText('Big Thunder Mountain')).color).toBe(
        darkTheme.color.textPrimary,
      );
      // (c) converted literals: the "Log a ride" CTA card (rule 3 violet S/B)
      // and its title (`primary` as text → `primaryFg`), and the confirmed
      // rode-with chip text (rule 3 green T).
      const cta = flat(screen.getByTestId('trip-activity-log-cta'));
      expect(cta.backgroundColor).toBe(FEED_MISC.dark.ctaBg);
      expect(cta.borderColor).toBe(FEED_MISC.dark.ctaBorder);
      expect(flat(screen.getByText('Log a ride or food')).color).toBe(darkTheme.color.primaryFg);
      expect(flat(screen.getByText('✓ Ariel')).color).toBe(RODE_WITH.dark.confirmedFg);
    });

    test('keeps the pre-retrofit light values under light', async () => {
      installApi();
      renderActivity();

      await screen.findByText('Big Thunder Mountain');
      expect(flat(screen.getByTestId('trip-activity-log-cta')).backgroundColor).toBe('#fcfaff');
      expect(flat(screen.getByText('✓ Ariel')).color).toBe('#27855a');
      expect(flat(screen.getByText('Log a ride or food')).color).toBe('#5b2a86');
    });

    test('uses undefined behavior for KeyboardAvoidingView on Android to prevent soft-keyboard jitter loops', async () => {
      const originalPlatform = Platform.OS;
      try {
        Platform.OS = 'android';
        installApi();
        renderActivity();

        fireEvent.press(await screen.findByTestId('trip-activity-log-cta'));
        await screen.findByTestId('activity-log-composer');
        const kavs = screen.UNSAFE_getAllByType(KeyboardAvoidingView);
        expect(kavs.length).toBeGreaterThan(0);
        for (const kav of kavs) {
          expect(kav.props.behavior).toBeUndefined();
        }
      } finally {
        Platform.OS = originalPlatform;
      }
    });
  });

  describe('Task 27.3: text-only posts, inline quick-post composer, and Posts filter chip (R20.7–R20.9)', () => {
    test('inline quick-post composer submits POST /trips/:id/feed/posts with { photoIds: [], caption }, clears input, and refetches feed', async () => {
      const feed = jest.fn().mockResolvedValue(FEED);
      const mutate = jest.fn().mockResolvedValue({ id: 'new-text-post-1' });
      installApi({ feed, mutate });

      renderActivity();

      const input = await screen.findByTestId('trip-activity-quick-post-input');
      fireEvent.changeText(input, '  Meet at Main Street Bakery in 10 mins!  ');
      fireEvent.press(screen.getByTestId('trip-activity-quick-post-submit'));

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith(
          'POST',
          `/trips/${TRIP_ID}/feed/posts`,
          {
            photoIds: [],
            caption: 'Meet at Main Street Bakery in 10 mins!',
          },
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('trip-activity-quick-post-input').props.value).toBe('');
        expect(feed).toHaveBeenCalledTimes(2);
      });
    });

    test('FeedPostComposerModal allows submitting a caption-only post without selecting or uploading photos', async () => {
      const feed = jest.fn().mockResolvedValue(FEED);
      const mutate = jest.fn().mockResolvedValue({ id: 'modal-text-post-1' });
      installApi({ feed, mutate });

      renderActivity();

      const quickInput = await screen.findByTestId('trip-activity-quick-post-input');
      fireEvent.changeText(quickInput, 'Draft carried over');

      fireEvent.press(await screen.findByTestId('trip-activity-post-cta'));
      const captionInput = await screen.findByTestId('feed-post-caption-input');
      expect(captionInput.props.value).toBe('Draft carried over');
      fireEvent.changeText(captionInput, 'Quick update from the monorail!');
      fireEvent.press(screen.getByTestId('feed-post-submit'));

      await waitFor(() => {
        expect(mutate).not.toHaveBeenCalledWith(
          'POST',
          '/photos/uploads',
          expect.anything(),
        );
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate).toHaveBeenCalledWith(
          'POST',
          `/trips/${TRIP_ID}/feed/posts`,
          {
            photoIds: [],
            caption: 'Quick update from the monorail!',
          },
        );
        expect(feed).toHaveBeenCalledTimes(2);
      });
    });

    test('renders zero-photo member_post as "posted an update" without slots grid, and filters by Posts chip', async () => {
      const textOnlyPost: TripFeedItemDTO = {
        id: 'text-only-post-1',
        type: 'member_post',
        actorDisplayName: 'Goofy',
        actorAvatarPreset: null,
        createdAt: '2025-08-01T21:00:00.000Z',
        metadata: { caption: 'Headed to Fantasyland next!' },
        photos: [],
        mine: false,
        reactions: [],
        comments: [],
      };
      const photoPost: TripFeedItemDTO = {
        id: 'photo-post-1',
        type: 'member_post',
        actorDisplayName: 'Donald',
        actorAvatarPreset: null,
        createdAt: '2025-08-01T20:30:00.000Z',
        metadata: { caption: 'Castle view' },
        photos: [readySlot('ph-castle', false)],
        mine: false,
        reactions: [],
        comments: [],
      };
      installApi({ feed: async () => [...FEED, textOnlyPost, photoPost] });

      renderActivity();

      // Both posts and completions are visible under All
      expect(await screen.findByTestId('trip-feed-item-text-only-post-1')).toBeTruthy();
      expect(screen.getByText('posted an update')).toBeTruthy();
      expect(screen.getByText('Headed to Fantasyland next!')).toBeTruthy();
      expect(screen.queryByTestId('trip-feed-slots-text-only-post-1')).toBeNull();

      expect(screen.getByTestId('trip-feed-item-photo-post-1')).toBeTruthy();
      expect(screen.getByText('posted photos')).toBeTruthy();
      expect(screen.getByTestId('trip-feed-slots-photo-post-1')).toBeTruthy();
      expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();

      // Filter by Posts chip -> only member_post items remain visible
      fireEvent.press(screen.getByTestId('trip-activity-filter-posts'));
      expect(screen.getByTestId('trip-feed-item-text-only-post-1')).toBeTruthy();
      expect(screen.getByTestId('trip-feed-item-photo-post-1')).toBeTruthy();
      expect(screen.queryByText('Big Thunder Mountain')).toBeNull();
      expect(screen.queryByText('joined the trip')).toBeNull();

      // Switch back to All -> completions reappear
      fireEvent.press(screen.getByTestId('trip-activity-filter-all'));
      expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();

      // Pull-to-refresh wired on FlatList
      const list = screen.getByTestId('trip-feed');
      expect(typeof list.props.onRefresh).toBe('function');
    });
  });

  describe('Task 28: Completion log deletion (R20.10, R20.11)', () => {
    const BASE_COMPLETION_ITEM = FEED[0]!;

    test('renders delete button for author (mine: true), clicking it sends DELETE /trips/:id/log-entries/:logEntryId and removes item', async () => {
      const completionItem: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        mine: true,
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          logEntryId: 'log-entry-123',
        },
      };
      let currentFeed: TripFeedItemDTO[] = [completionItem];
      const feed = jest.fn().mockImplementation(async () => currentFeed);
      const mutate = jest.fn().mockImplementation(async (method: string, path: string) => {
        if (method === 'DELETE' && path.includes('log-entry-123')) {
          currentFeed = [];
        }
        return undefined;
      });
      installApi({
        members: [{ userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'member' }],
        feed,
        mutate,
      });

      renderActivity();

      expect(await screen.findByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeTruthy();
      const deleteBtn = screen.getByTestId(`trip-feed-completion-delete-${COMPLETION_ITEM_ID}`);
      expect(deleteBtn).toBeTruthy();

      fireEvent.press(deleteBtn);

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith(
          'DELETE',
          `/trips/${TRIP_ID}/log-entries/log-entry-123`,
          undefined,
        );
      });

      await waitFor(() => {
        expect(screen.queryByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeNull();
      });
    });

    test('organizer can see and delete completion logged by another member (mine: false)', async () => {
      const completionItem: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        mine: false,
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          logEntryId: 'log-entry-456',
        },
      };
      const mutate = jest.fn().mockResolvedValue(null);
      installApi({
        members: [{ userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'organizer' }],
        feed: async () => [completionItem],
        mutate,
      });

      renderActivity();

      expect(await screen.findByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeTruthy();
      const deleteBtn = screen.getByTestId(`trip-feed-completion-delete-${COMPLETION_ITEM_ID}`);
      expect(deleteBtn).toBeTruthy();

      fireEvent.press(deleteBtn);

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith(
          'DELETE',
          `/trips/${TRIP_ID}/log-entries/log-entry-456`,
          undefined,
        );
      });
    });

    test('non-author non-organizer member sees no delete control on completion', async () => {
      const completionItem: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        mine: false,
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          logEntryId: 'log-entry-789',
        },
      };
      installApi({
        members: [{ userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'member' }],
        feed: async () => [completionItem],
      });

      renderActivity();

      expect(await screen.findByTestId(`trip-feed-item-${COMPLETION_ITEM_ID}`)).toBeTruthy();
      expect(screen.queryByTestId(`trip-feed-completion-delete-${COMPLETION_ITEM_ID}`)).toBeNull();
    });

    test('an upcoming Trip shows the message instead of the sheet', async () => {
      apiRequestMock.mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path === '/me') return ME;
        if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            name: 'Upcoming Trip',
            status: 'upcoming',
            startDate: '2030-01-01',
            endDate: '2030-01-10',
          };
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/feed`) return FEED;
        return {};
      });

      renderActivity();

      fireEvent.press(await screen.findByTestId('trip-activity-log-cta'));

      expect(await screen.findByText('Logging opens when the trip starts.')).toBeTruthy();
      expect(screen.queryByTestId('activity-log-date')).toBeNull();
    });

    test('Inline_Tag_Response shows controls only for tagId entry and Confirm posts {} to confirm endpoint', async () => {
      const mutate = jest.fn().mockResolvedValue(undefined);
      const completionWithTags: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        id: 'item-tags-1',
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          rodeWith: [
            {
              taggedMemberId: 'member-1',
              displayName: 'Alice Tagged',
              state: 'pending',
              tagId: 'tag-alice-123',
            },
            {
              taggedMemberId: 'member-2',
              displayName: 'Bob Tagged',
              state: 'pending',
              tagId: null,
            },
            {
              taggedMemberId: 'member-3',
              displayName: 'Charlie Confirmed',
              state: 'confirmed',
              tagId: null,
            },
          ],
        },
      };

      installApi({
        feed: async () => [completionWithTags],
        mutate,
      });

      renderActivity();

      // Tag controls present only for tagId entry
      expect(await screen.findByTestId('feed-tag-confirm-tag-alice-123')).toBeTruthy();
      expect(screen.getByTestId('feed-tag-decline-tag-alice-123')).toBeTruthy();
      expect(screen.queryByTestId('feed-tag-confirm-null')).toBeNull();

      fireEvent.press(screen.getByTestId('feed-tag-confirm-tag-alice-123'));

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith(
          'POST',
          '/me/rode-with-tags/tag-alice-123/confirm',
          {},
        );
      });
    });

    test('Inline_Tag_Response Decline posts to decline endpoint', async () => {
      const mutate = jest.fn().mockResolvedValue(undefined);
      const completionWithTags: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        id: 'item-tags-2',
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          rodeWith: [
            {
              taggedMemberId: 'member-1',
              displayName: 'Alice Tagged',
              state: 'pending',
              tagId: 'tag-alice-456',
            },
          ],
        },
      };

      installApi({
        feed: async () => [completionWithTags],
        mutate,
      });

      renderActivity();

      expect(await screen.findByTestId('feed-tag-decline-tag-alice-456')).toBeTruthy();

      fireEvent.press(screen.getByTestId('feed-tag-decline-tag-alice-456'));

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith(
          'POST',
          '/me/rode-with-tags/tag-alice-456/decline',
          {},
        );
      });
    });

    test('Inline_Tag_Response shows inline error on failure and keeps controls', async () => {
      const mutate = jest.fn().mockRejectedValue(new ApiError({ status: 500, code: 'internal_error', message: 'Could not confirm tag.' }));
      const completionWithTags: TripFeedItemDTO = {
        ...BASE_COMPLETION_ITEM,
        id: 'item-tags-3',
        metadata: {
          ...BASE_COMPLETION_ITEM.metadata,
          rodeWith: [
            {
              taggedMemberId: 'member-1',
              displayName: 'Alice Tagged',
              state: 'pending',
              tagId: 'tag-alice-789',
            },
          ],
        },
      };

      installApi({
        feed: async () => [completionWithTags],
        mutate,
      });

      renderActivity();

      expect(await screen.findByTestId('feed-tag-confirm-tag-alice-789')).toBeTruthy();

      fireEvent.press(screen.getByTestId('feed-tag-confirm-tag-alice-789'));

      await waitFor(() => {
        expect(screen.getByTestId('feed-tag-error-item-tags-3')).toBeTruthy();
        expect(screen.getByText('Could not confirm tag.')).toBeTruthy();
      });

      // Controls are kept
      expect(screen.getByTestId('feed-tag-confirm-tag-alice-789')).toBeTruthy();
      expect(screen.getByTestId('feed-tag-decline-tag-alice-789')).toBeTruthy();
    });
  });
});

