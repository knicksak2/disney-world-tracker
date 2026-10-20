/**
 * TripRecapAlbumScreen (photo-uploads decision D35, Requirements 15.31 to 15.33).
 *
 * Renders the real screen (and the real PhotoGrid / PhotoViewer it reuses) inside a real
 * native stack; only `apiRequest` is spied.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SharedSummaryPhotoDTO, TripRecapPhotosDTO } from '@dwt/shared';

import * as clientModule from '../../../api/client';
import { ApiError } from '../../../api/client';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme, lightTheme } from '../../../theme/theme';
import TripRecapAlbumScreen from '../TripRecapAlbumScreen';
import { RECAP_PHOTOS_NOT_INCLUDED_COPY, RECAP_UNAVAILABLE_COPY } from '../TripRecapScreen';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

const SHARE_ID = 'share-album-1';
const TRIP_NAME = 'Fall 2026 Family Trip';
const PATH = `/me/inbox/${SHARE_ID}/trip-recap/photos`;

function photo(id: string, sortAt: string): SharedSummaryPhotoDTO {
  return {
    id,
    thumbUrl: `https://r2.test/p/${id}/thumb.jpg`,
    url: `https://r2.test/p/${id}/full.jpg`,
    width: 1200,
    height: 800,
    sortAt,
  };
}

// 2026-05-02T01:30Z is 21:30 on May 1 in New York: UTC grouping would put it under May 2.
const P_MAY3 = photo('photo-3', '2026-05-03T15:00:00.000Z');
const P_MAY1_LATE = photo('photo-1', '2026-05-02T01:30:00.000Z');
const P_MAY1_EARLY = photo('photo-2', '2026-05-01T14:00:00.000Z');
const P_APR30 = photo('photo-4', '2026-04-30T16:00:00.000Z');

const PAGE_1: TripRecapPhotosDTO = {
  access: 'granted',
  photos: [P_MAY3, P_MAY1_LATE, P_MAY1_EARLY],
  nextCursor: 'c1',
};
const PAGE_2: TripRecapPhotosDTO = { access: 'granted', photos: [P_APR30], nextCursor: null };

const SINGLE_PAGE: TripRecapPhotosDTO = {
  access: 'granted',
  photos: [P_MAY3, P_MAY1_LATE, P_MAY1_EARLY],
  nextCursor: null,
};

const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function AlbumHarness({
  client,
  tripName,
}: {
  readonly client: QueryClient;
  readonly tripName?: string;
}): JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="TripRecapAlbum"
            component={TripRecapAlbumScreen}
            initialParams={{ shareId: SHARE_ID, ...(tripName ? { tripName } : {}) }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}

function renderAlbum(options: { client?: QueryClient; tripName?: string } = {}) {
  const client = options.client ?? makeClient();
  return {
    client,
    ...render(
      <AlbumHarness client={client} {...(options.tripName ? { tripName: options.tripName } : {})} />,
    ),
  };
}

describe('TripRecapAlbumScreen', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });
  afterEach(() => {
    apiRequestSpy.mockRestore();
    resetTestScheme();
  });

  /** Serves the album pages by cursor, and the report / block mutations. */
  function program(
    pages: Readonly<Record<string, TripRecapPhotosDTO>> = { '': SINGLE_PAGE },
  ): void {
    apiRequestSpy.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === PATH) return pages[''];
      const cursorMatch = method === 'GET' ? /^.+\?cursor=(.+)$/.exec(path) : null;
      if (cursorMatch && path.startsWith(`${PATH}?cursor=`)) return pages[cursorMatch[1] ?? ''];
      if (method === 'POST' && /^\/photos\/[^/]+\/report$/.test(path)) return undefined;
      if (method === 'POST' && path === '/me/blocks') {
        return { id: 'block-1', createdAt: '2026-05-01T00:00:00.000Z' };
      }
      throw new Error(`unexpected apiRequest ${method} ${path}`);
    });
  }

  const albumGets = (): unknown[][] =>
    apiRequestSpy.mock.calls.filter(
      ([method, path]) => method === 'GET' && String(path).startsWith(PATH),
    );

  // -------------------------------------------------------------------------
  // M3: loading, request path, grouping by New York day
  // -------------------------------------------------------------------------

  test('shows a loading indicator, then requests GET .../trip-recap/photos with no query and groups by New York day, newest first', async () => {
    let resolve: (value: TripRecapPhotosDTO) => void = () => undefined;
    apiRequestSpy.mockImplementation(
      () => new Promise<TripRecapPhotosDTO>((r) => (resolve = r)),
    );
    renderAlbum();

    const loading = screen.getByTestId('trip-recap-album-loading');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(screen.queryByTestId('trip-recap-album-list')).toBeNull();

    await act(async () => {
      resolve(SINGLE_PAGE);
    });

    expect(await screen.findByTestId('trip-recap-album-list')).toBeTruthy();
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', PATH);
    expect(screen.queryByTestId('trip-recap-album-loading')).toBeNull();

    // 01:30Z on May 2 sits under May 1; UTC grouping would have produced a May 2 header.
    expect(screen.getByTestId('recap-album-day-heading-2026-05-01')).toBeTruthy();
    expect(screen.queryByTestId('recap-album-day-heading-2026-05-02')).toBeNull();
    expect(screen.getByTestId('photo-grid-tile-photo-1')).toBeTruthy();

    const headings = screen.getAllByTestId(/^recap-album-day-heading-/);
    expect(headings.map((h) => h.props.testID)).toEqual([
      'recap-album-day-heading-2026-05-03',
      'recap-album-day-heading-2026-05-01',
    ]);
    expect(screen.getByText('Sun, May 3, 2026')).toBeTruthy();
    expect(screen.getByText('Fri, May 1, 2026')).toBeTruthy();
    // Counts: one photo on May 3, two on May 1.
    expect(screen.getByText('1 photo')).toBeTruthy();
    expect(screen.getByText('2 photos')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // M4: paging
  // -------------------------------------------------------------------------

  test('endReached requests ?cursor=<nextCursor>, renders both pages, and stops when nextCursor is null', async () => {
    program({ '': PAGE_1, c1: PAGE_2 });
    renderAlbum();

    const list = await screen.findByTestId('trip-recap-album-list');
    expect(screen.queryByTestId('photo-grid-tile-photo-4')).toBeNull();

    fireEvent(list, 'endReached');

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', `${PATH}?cursor=c1`);
    });
    expect(await screen.findByTestId('photo-grid-tile-photo-4')).toBeTruthy();
    // Page 1 tiles are still there and the new day sorts below them.
    expect(screen.getByTestId('photo-grid-tile-photo-3')).toBeTruthy();
    expect(screen.getByTestId('recap-album-day-heading-2026-04-30')).toBeTruthy();
    // Tile labels count across pages and days.
    expect(screen.getByTestId('photo-grid-tile-photo-4').props.accessibilityLabel).toBe(
      'Trip photo 4 of 4, opens viewer',
    );

    const callsAfterLastPage = albumGets().length;
    fireEvent(screen.getByTestId('trip-recap-album-list'), 'endReached');
    await act(async () => {
      await Promise.resolve();
    });
    expect(albumGets()).toHaveLength(callsAfterLastPage);
  });

  test('a failing next page shows a Retry that re-requests the same cursor and recovers', async () => {
    let page2Attempts = 0;
    apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
      if (path === PATH) return PAGE_1;
      if (path === `${PATH}?cursor=c1`) {
        page2Attempts += 1;
        if (page2Attempts === 1) {
          throw new ApiError({ code: 'internal_error', message: 'boom', status: 500 });
        }
        return PAGE_2;
      }
      throw new Error(`unexpected ${path}`);
    });
    renderAlbum();

    fireEvent(await screen.findByTestId('trip-recap-album-list'), 'endReached');

    const retry = await screen.findByTestId('trip-recap-album-more-retry');
    expect(retry.props.accessibilityRole).toBe('button');
    expect(screen.getByText("Couldn't load more photos")).toBeTruthy();
    // The first page stays on screen.
    expect(screen.getByTestId('photo-grid-tile-photo-3')).toBeTruthy();

    fireEvent.press(retry);

    expect(await screen.findByTestId('photo-grid-tile-photo-4')).toBeTruthy();
    expect(page2Attempts).toBe(2);
    expect(screen.queryByTestId('trip-recap-album-more-retry')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // M5: viewer offers Report and Block only
  // -------------------------------------------------------------------------

  test('a tile opens the viewer with Report and Block but no Delete, add or status control', async () => {
    program();
    renderAlbum();

    fireEvent.press(await screen.findByTestId('photo-grid-tile-photo-3'));

    expect(await screen.findByTestId('photo-viewer-modal')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-report')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-block')).toBeTruthy();
    expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();
    expect(screen.queryByTestId('add-trip-photos-btn')).toBeNull();
    expect(screen.queryByText(/add photos?/i)).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
    // No uploader name: the viewer's generic label is all it can show.
    expect(screen.getByText('Another guest')).toBeTruthy();
  });

  test('Report posts { reason, shareId } for the opened photo', async () => {
    program();
    renderAlbum();

    fireEvent.press(await screen.findByTestId('photo-grid-tile-photo-2'));
    fireEvent.press(await screen.findByTestId('photo-viewer-report'));
    fireEvent.press(await screen.findByTestId('report-reason-inappropriate'));
    fireEvent.press(screen.getByTestId('submit-report-button'));

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/photos/photo-2/report',
        expect.objectContaining({ reason: 'inappropriate', shareId: SHARE_ID }),
      );
    });
    expect(await screen.findByTestId('photo-report-confirmation')).toBeTruthy();
  });

  test('Block uploader posts exactly { photoId, shareId } and never a userId', async () => {
    program();
    renderAlbum();

    fireEvent.press(await screen.findByTestId('photo-grid-tile-photo-1'));
    fireEvent.press(await screen.findByTestId('photo-viewer-block'));
    fireEvent.press(await screen.findByTestId('confirm-block-button'));

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/blocks', {
        photoId: 'photo-1',
        shareId: SHARE_ID,
      });
    });
    const blockCall = apiRequestSpy.mock.calls.find(([, path]) => path === '/me/blocks');
    expect(blockCall?.[2]).not.toHaveProperty('userId');
  });

  // -------------------------------------------------------------------------
  // M6: refetch after block
  // -------------------------------------------------------------------------

  test('after a block the album is requested again, the blocked photo disappears and the recap query is invalidated', async () => {
    let blocked = false;
    apiRequestSpy.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === PATH) {
        return blocked ? { ...SINGLE_PAGE, photos: [P_MAY1_LATE, P_MAY1_EARLY] } : SINGLE_PAGE;
      }
      if (method === 'POST' && path === '/me/blocks') {
        blocked = true;
        return { id: 'block-1', createdAt: '2026-05-01T00:00:00.000Z' };
      }
      throw new Error(`unexpected apiRequest ${method} ${path}`);
    });
    const client = makeClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    renderAlbum({ client });

    fireEvent.press(await screen.findByTestId('photo-grid-tile-photo-3'));
    expect(albumGets()).toHaveLength(1);
    fireEvent.press(await screen.findByTestId('photo-viewer-block'));
    fireEvent.press(await screen.findByTestId('confirm-block-button'));

    await waitFor(() => expect(albumGets()).toHaveLength(2));
    await waitFor(() => {
      expect(screen.queryByTestId('photo-grid-tile-photo-3')).toBeNull();
    });
    expect(screen.getByTestId('photo-grid-tile-photo-1')).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['share', 'trip-recap', SHARE_ID] }),
    );
  });

  // -------------------------------------------------------------------------
  // M7: empty, error + retry
  // -------------------------------------------------------------------------

  test('an empty first page shows "No photos to show"', async () => {
    program({ '': { access: 'granted', photos: [], nextCursor: null } });
    renderAlbum();

    expect(await screen.findByText('No photos to show')).toBeTruthy();
    expect(screen.getByTestId('trip-recap-album-empty')).toBeTruthy();
    expect(screen.queryByTestId('trip-recap-album-list')).toBeNull();
  });

  test('another failure shows a Retry button that re-requests and then renders the list', async () => {
    let attempts = 0;
    apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
      if (path !== PATH) throw new Error(`unexpected ${path}`);
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError({ code: 'internal_error', message: 'boom', status: 500 });
      }
      return SINGLE_PAGE;
    });
    renderAlbum();

    expect(await screen.findByTestId('trip-recap-album-error')).toBeTruthy();
    const retry = screen.getByTestId('trip-recap-album-retry');
    expect(retry.props.accessibilityRole).toBe('button');
    expect(screen.queryByTestId('trip-recap-album-unavailable')).toBeNull();

    fireEvent.press(retry);

    expect(await screen.findByTestId('trip-recap-album-list')).toBeTruthy();
    expect(attempts).toBe(2);
    expect(screen.queryByTestId('trip-recap-album-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // M8: unavailable / not_included
  // -------------------------------------------------------------------------

  test('the collapsed validation_failed reads "This recap is no longer available" with no Retry and one request', async () => {
    apiRequestSpy.mockImplementation(async () => {
      throw new ApiError({ code: 'validation_failed', message: 'Invalid request.', status: 400 });
    });
    renderAlbum();

    const text = await screen.findByTestId('trip-recap-album-unavailable');
    expect(text.props.children).toBe(RECAP_UNAVAILABLE_COPY);
    expect(screen.getByText('This recap is no longer available')).toBeTruthy();
    expect(text.props.accessibilityRole).toBe('alert');
    expect(screen.queryByTestId('trip-recap-album-retry')).toBeNull();
    expect(screen.queryByTestId('trip-recap-album-error')).toBeNull();
    expect(apiRequestSpy).toHaveBeenCalledTimes(1);
  });

  test('access "unavailable" reads the same text with no Retry', async () => {
    program({ '': { access: 'unavailable', photos: [], nextCursor: null } });
    renderAlbum();

    expect((await screen.findByTestId('trip-recap-album-unavailable')).props.children).toBe(
      RECAP_UNAVAILABLE_COPY,
    );
    expect(screen.queryByTestId('trip-recap-album-retry')).toBeNull();
    expect(screen.queryByTestId('trip-recap-album-list')).toBeNull();
  });

  test('access "not_included" shows the explanation instead of the list', async () => {
    program({ '': { access: 'not_included', photos: [], nextCursor: null } });
    renderAlbum();

    const note = await screen.findByTestId('trip-recap-album-not-included');
    expect(note.props.children).toBe(RECAP_PHOTOS_NOT_INCLUDED_COPY);
    expect(screen.queryByTestId('trip-recap-album-list')).toBeNull();
    expect(screen.queryByTestId('trip-recap-album-unavailable')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // M9: header
  // -------------------------------------------------------------------------

  test('header reads "All trip photos" with the trip name as subtitle when it is known', async () => {
    program();
    renderAlbum({ tripName: TRIP_NAME });

    await screen.findByTestId('trip-recap-album-list');
    expect(screen.getByText('All trip photos')).toBeTruthy();
    expect(screen.getByText(TRIP_NAME)).toBeTruthy();
  });

  test('header has no subtitle when the trip name is unknown', async () => {
    program();
    renderAlbum();

    await screen.findByTestId('trip-recap-album-list');
    expect(screen.getByText('All trip photos')).toBeTruthy();
    expect(screen.queryByText(TRIP_NAME)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // M10: theme + accessibility
  // -------------------------------------------------------------------------

  test('every tile is an image button labelled "Trip photo N of M, opens viewer" and each day heading is a header', async () => {
    program();
    renderAlbum();

    await screen.findByTestId('trip-recap-album-list');
    const expected: Record<string, string> = {
      'photo-3': 'Trip photo 1 of 3, opens viewer',
      'photo-1': 'Trip photo 2 of 3, opens viewer',
      'photo-2': 'Trip photo 3 of 3, opens viewer',
    };
    for (const [id, label] of Object.entries(expected)) {
      const tile = screen.getByTestId(`photo-grid-tile-${id}`);
      expect(tile.props.accessibilityRole).toBe('imagebutton');
      expect(tile.props.accessibilityLabel).toBe(label);
    }
    for (const heading of screen.getAllByTestId(/^recap-album-day-heading-/)) {
      expect(heading.props.accessibilityRole).toBe('header');
    }
  });

  test('repaints with the active scheme: the day heading colour follows dark and light', async () => {
    const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
    program();

    setTestScheme('dark');
    const dark = renderAlbum();
    const darkHeading = await screen.findByTestId('recap-album-day-heading-2026-05-01');
    expect(flat(darkHeading).color).toBe(darkTheme.color.textPrimary);
    dark.unmount();

    setTestScheme('light');
    renderAlbum();
    const lightHeading = await screen.findByTestId('recap-album-day-heading-2026-05-01');
    expect(flat(lightHeading).color).toBe(lightTheme.color.textPrimary);

    expect(darkTheme.color.textPrimary).not.toBe(lightTheme.color.textPrimary);
  });

  // -------------------------------------------------------------------------
  // M11: source guard
  // -------------------------------------------------------------------------

  test('the screen source has no uploader, delete, add or status code and gives the viewer the shareId', () => {
    const source = readFileSync(join(__dirname, '..', 'TripRecapAlbumScreen.tsx'), 'utf8');
    for (const forbidden of [
      'uploader',
      'displayName',
      'useDeletePhoto',
      'PhotoPickerSheet',
      'PhotoStatusChip',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('shareId={shareId}');
    expect(source).toMatch(/<PhotoViewer[\s\S]*shareId=\{shareId\}[\s\S]*canDelete=\{false\}/);
  });
});
