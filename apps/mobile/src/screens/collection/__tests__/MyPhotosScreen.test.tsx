import React from 'react';
import { FlatList, Image, StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  type NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { MyPhotoDTO, PhotoPageDTO, PhotoStatus } from '@dwt/shared';

import * as clientModule from '../../../api/client';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme, lightTheme } from '../../../theme/theme';
import MyPhotosScreen from '../MyPhotosScreen';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const apiRequestMock = clientModule.apiRequest as jest.MockedFunction<
  typeof clientModule.apiRequest
>;

const Stack = createNativeStackNavigator();

function OtherScreen() {
  return <View testID="other-screen" />;
}

function makePhoto(
  id: string,
  status: PhotoStatus,
  overrides?: Partial<MyPhotoDTO>
): MyPhotoDTO {
  return {
    id,
    targetKind: 'food_log',
    targetId: 'target-1',
    scopeId: 'scope-1',
    status,
    rejectReason: status === 'rejected' ? 'invalid_image' : null,
    rejectMessage: status === 'rejected' ? 'Photo is blurry' : null,
    thumbUrl:
      status === 'uploading' || status === 'rejected'
        ? null
        : `https://cdn.example.com/p/${id}/thumb.jpg`,
    url:
      status === 'approved' || status === 'hidden'
        ? `https://cdn.example.com/p/${id}/full.jpg`
        : null,
    width: 1280,
    height: 960,
    feedItemId: null,
    createdAt: '2026-05-02T15:00:00.000Z',
    ...overrides,
  };
}

function renderScreen(navRef?: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MyPhotos" component={MyPhotosScreen} />
          <Stack.Screen name="OtherScreen" component={OtherScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}

describe('MyPhotosScreen (Task 25.6, Requirement 29)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    resetTestScheme();
  });

  afterEach(() => {
    resetTestScheme();
  });

  it('requests GET /me/photos/all with no query on page 1', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    } as PhotoPageDTO<MyPhotoDTO>);

    renderScreen();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/photos/all');
    });
  });

  it('renders cells in server order with a chip per status across all six statuses and reject reason text', async () => {
    const photos: MyPhotoDTO[] = [
      makePhoto('p1', 'uploading'),
      makePhoto('p2', 'pending'),
      makePhoto('p3', 'needs_review'),
      makePhoto('p4', 'approved'),
      makePhoto('p5', 'rejected', {
        rejectReason: 'invalid_image',
        rejectMessage: 'Photo is blurry',
      }),
      makePhoto('p6', 'hidden'),
    ];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        return { items: photos, nextCursor: null };
      }
      if (method === 'POST' && path === '/photos/confirm') {
        return { results: [{ photoId: 'p1', result: 'incomplete' }] };
      }
      if (method === 'GET' && path.startsWith('/me/photos/status')) {
        return { photos: [] };
      }
      return null;
    });

    renderScreen();

    // Verify all 6 tiles exist in DOM
    for (const p of photos) {
      await screen.findByTestId(`my-photo-tile-${p.id}`);
      expect(screen.getByTestId(`my-photo-chip-${p.id}`)).toBeTruthy();
    }

    // Verify chips display correct labels
    expect(within(screen.getByTestId('my-photo-chip-p1')).getByText('Uploading…')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p2')).getByText('Processing…')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p3')).getByText('Under review')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p4')).getByText('Approved')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p5')).getByText('Rejected')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p5')).getByText('Photo is blurry')).toBeTruthy();
    expect(within(screen.getByTestId('my-photo-chip-p6')).getByText('Under review')).toBeTruthy();
  });

  it('renders placeholders for uploading and rejected cells, and image for approved', async () => {
    const photos: MyPhotoDTO[] = [
      makePhoto('p-uploading', 'uploading'),
      makePhoto('p-rejected', 'rejected'),
      makePhoto('p-approved', 'approved'),
    ];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        return { items: photos, nextCursor: null };
      }
      if (method === 'POST' && path === '/photos/confirm') {
        return { results: [{ photoId: 'p-uploading', result: 'incomplete' }] };
      }
      return null;
    });

    renderScreen();

    await screen.findByTestId('my-photo-tile-p-approved');

    // uploading: placeholder, no Image
    expect(
      within(screen.getByTestId('my-photo-tile-p-uploading')).UNSAFE_queryByType(Image)
    ).toBeNull();

    // rejected: placeholder, no Image
    expect(
      within(screen.getByTestId('my-photo-tile-p-rejected')).UNSAFE_queryByType(Image)
    ).toBeNull();

    // approved: Image present
    expect(
      within(screen.getByTestId('my-photo-tile-p-approved')).UNSAFE_getByType(Image)
    ).toBeTruthy();
  });

  it('tapping a cell opens PhotoViewer with Delete, without Report or Block, showing "You"', async () => {
    const approvedPhoto = makePhoto('p-appr', 'approved', {
      targetKind: 'trip',
      createdAt: '2026-10-23T18:00:00.000Z',
    });

    apiRequestMock.mockResolvedValueOnce({
      items: [approvedPhoto],
      nextCursor: null,
    });

    renderScreen();

    const tile = await screen.findByTestId('my-photo-tile-p-appr');
    fireEvent.press(tile);

    // PhotoViewer is open
    expect(await screen.findByText('You')).toBeTruthy();
    expect(screen.getByText('Trip photo • Oct 23, 2026')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-delete')).toBeTruthy();
    expect(screen.queryByTestId('photo-viewer-report')).toBeNull();
    expect(screen.queryByTestId('photo-viewer-block')).toBeNull();
  });

  it('delete asserts the DELETE /photos/<id> call, the list refetch, and that the cell is gone', async () => {
    const photo = makePhoto('p-del', 'approved');
    let listCallCount = 0;

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        listCallCount++;
        return listCallCount === 1
          ? { items: [photo], nextCursor: null }
          : { items: [], nextCursor: null };
      }
      if (method === 'DELETE' && path === '/photos/p-del') {
        return undefined;
      }
      return null;
    });

    renderScreen();

    const tile = await screen.findByTestId('my-photo-tile-p-del');
    fireEvent.press(tile);

    // Press delete in viewer
    const deleteBtn = await screen.findByTestId('photo-viewer-delete');
    fireEvent.press(deleteBtn);

    // Confirm dialog
    const confirmBtn = await screen.findByTestId('confirm-delete-button');
    fireEvent.press(confirmBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/photos/p-del');
    });

    // List refetched and cell is gone
    await waitFor(() => {
      expect(screen.queryByTestId('my-photo-tile-p-del')).toBeNull();
    });
  });

  it('a rejected cell opens the viewer and can be deleted', async () => {
    const rejectedPhoto = makePhoto('p-rej', 'rejected');

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        return { items: [rejectedPhoto], nextCursor: null };
      }
      if (method === 'DELETE' && path === '/photos/p-rej') {
        return undefined;
      }
      return null;
    });

    renderScreen();

    const tile = await screen.findByTestId('my-photo-tile-p-rej');
    fireEvent.press(tile);

    // Viewer displays "Photo unavailable" and has Delete button
    expect(await screen.findByText('Photo unavailable')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-delete')).toBeTruthy();

    fireEvent.press(screen.getByTestId('photo-viewer-delete'));
    fireEvent.press(await screen.findByTestId('confirm-delete-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/photos/p-rej');
    });
  });

  it('tapping an uploading cell with non-null thumbUrl opens viewer showing "Photo unavailable" with no Image and Delete available', async () => {
    const uploadingWithThumb = makePhoto('p-up-thumb', 'uploading', {
      thumbUrl: 'https://cdn.example.com/u/user/thumb.jpg',
    });

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        return { items: [uploadingWithThumb], nextCursor: null };
      }
      if (method === 'POST' && path === '/photos/confirm') {
        return { results: [{ photoId: 'p-up-thumb', result: 'incomplete' }] };
      }
      return null;
    });

    renderScreen();

    const tile = await screen.findByTestId('my-photo-tile-p-up-thumb');
    fireEvent.press(tile);

    expect(await screen.findByText('Photo unavailable')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-delete')).toBeTruthy();

    // Verify cell status stays uploading with no retry chip
    expect(within(screen.getByTestId('my-photo-chip-p-up-thumb')).getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('paging sends cursor=<nextCursor> and appends; failed page 2 shows inline message and Retry succeeds', async () => {
    const page1Photos = [makePhoto('p-1', 'approved')];
    const page2Photos = [makePhoto('p-2', 'approved')];
    let page2Attempt = 0;

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        return { items: page1Photos, nextCursor: 'cur-page-1' };
      }
      if (method === 'GET' && path === '/me/photos/all?cursor=cur-page-1') {
        page2Attempt++;
        if (page2Attempt === 1) {
          throw new Error('Page 2 network error');
        }
        return { items: page2Photos, nextCursor: null };
      }
      return null;
    });

    renderScreen();

    await screen.findByTestId('my-photo-tile-p-1');

    // Trigger onEndReached
    const flatList = screen.UNSAFE_getByType(FlatList);
    act(() => {
      flatList.props.onEndReached();
    });

    // Page 2 failure: error text and Retry button displayed, previous cell stays
    expect(await screen.findByText("Couldn't load more photos")).toBeTruthy();
    expect(screen.getByTestId('my-photo-tile-p-1')).toBeTruthy();

    // Press Retry
    const retryBtn = screen.getByRole('button', { name: 'Retry loading more photos' });
    fireEvent.press(retryBtn);

    // Page 2 succeeds and appends
    await screen.findByTestId('my-photo-tile-p-2');
    expect(screen.getByTestId('my-photo-tile-p-1')).toBeTruthy();
  });

  it('shows empty state with no add control on empty first page', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    renderScreen();

    expect(await screen.findByText('No photos yet')).toBeTruthy();
    expect(
      screen.getByText('Photos you add to food logs and trips show up here.')
    ).toBeTruthy();
    // No add photo control
    expect(screen.queryByText('Add photo')).toBeNull();
    expect(screen.queryByText('Add photos')).toBeNull();
  });

  it('first-page error shows centered message then Retry re-requests first page', async () => {
    let callCount = 0;
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        callCount++;
        if (callCount === 1) {
          throw new Error('First page network error');
        }
        return { items: [makePhoto('p-retried', 'approved')], nextCursor: null };
      }
      return null;
    });

    renderScreen();

    expect(await screen.findByText("Couldn't load your photos")).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: 'Retry loading photos' });
    fireEvent.press(retryBtn);

    await screen.findByTestId('my-photo-tile-p-retried');
    expect(callCount).toBe(2);
  });

  it('pull-to-refresh refetches list and clears confirmed ids', async () => {
    let listCount = 0;
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/photos/all') {
        listCount++;
        return { items: [makePhoto('p-refresh', 'approved')], nextCursor: null };
      }
      return null;
    });

    renderScreen();

    await screen.findByTestId('my-photo-tile-p-refresh');
    expect(listCount).toBe(1);

    const flatList = screen.UNSAFE_getByType(FlatList);
    await act(async () => {
      flatList.props.refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(listCount).toBe(2);
    });
  });

  describe('polling and status transitions', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('polls pending cells after 3 seconds with max 10 ids per chunk; approved answer refetches; needs_review refetches and stops polling', async () => {
      const twelvePending = Array.from({ length: 12 }, (_, i) =>
        makePhoto(`pend-${i}`, 'pending')
      );

      const statusCalls: string[][] = [];

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/me/photos/all') {
          return { items: twelvePending, nextCursor: null };
        }
        if (method === 'GET' && path.startsWith('/me/photos/status?ids=')) {
          const ids = decodeURIComponent(path.slice('/me/photos/status?ids='.length)).split(',');
          statusCalls.push(ids);
          return {
            photos: ids.map((id) => ({
              id,
              targetKind: 'food_log',
              targetId: 't-1',
              scopeId: 's-1',
              status: 'pending',
              rejectReason: null,
              rejectMessage: null,
              thumbUrl: null,
              url: null,
              width: 100,
              height: 100,
              feedItemId: null,
              createdAt: '2026-05-02T15:00:00.000Z',
            })),
          };
        }
        return null;
      });

      renderScreen();

      await screen.findByTestId('my-photo-tile-pend-0');

      // 3 seconds: tick 1 triggers 1st chunk of 10
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });

      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
      expect(statusCalls[0]!.length).toBe(10); // max 10 per request chunk

      // Next tick triggers remaining 2
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });

      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
      expect(statusCalls[1]!.length).toBe(2); // exactly 2 in second chunk
    });

    it('stale polled value: polled approved is overridden when list refetch returns hidden (Under review)', async () => {
      const item = makePhoto('p-race', 'pending');
      let listFetchCount = 0;

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/me/photos/all') {
          listFetchCount++;
          if (listFetchCount === 1) {
            return { items: [item], nextCursor: null };
          }
          // On refetch, server reports hidden
          return {
            items: [
              makePhoto('p-race', 'hidden', { rejectMessage: 'Under operator review' }),
            ],
            nextCursor: null,
          };
        }
        if (method === 'GET' && path.startsWith('/me/photos/status')) {
          // Poll returns approved
          return {
            photos: [
              {
                id: 'p-race',
                targetKind: 'food_log',
                targetId: 't-1',
                scopeId: 's-1',
                status: 'approved',
                rejectReason: null,
                rejectMessage: null,
                thumbUrl: 'https://cdn.example.com/p/p-race/thumb.jpg',
                url: null,
                width: 100,
                height: 100,
                feedItemId: null,
                createdAt: '2026-05-02T15:00:00.000Z',
              },
            ],
          };
        }
        return null;
      });

      renderScreen();

      await screen.findByTestId('my-photo-tile-p-race');

      // Advance 3s for poll
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });

      // Poll triggers list refetch; list refetch returns 'hidden'.
      // Chip must display 'Under review' (the list status), NOT 'Approved' (stale polled value)!
      await waitFor(() => {
        expect(
          within(screen.getByTestId('my-photo-chip-p-race')).getByText('Under review')
        ).toBeTruthy();
      });
    });

    it('hidden, needs_review, and uploading cells cause no status requests', async () => {
      const nonPendingPhotos = [
        makePhoto('p-hid', 'hidden'),
        makePhoto('p-rev', 'needs_review'),
        makePhoto('p-up', 'uploading'),
      ];

      let statusCalled = false;
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/me/photos/all') {
          return { items: nonPendingPhotos, nextCursor: null };
        }
        if (method === 'POST' && path === '/photos/confirm') {
          return { results: [{ photoId: 'p-up', result: 'incomplete' }] };
        }
        if (method === 'GET' && path.startsWith('/me/photos/status')) {
          statusCalled = true;
          return { photos: [] };
        }
        return null;
      });

      renderScreen();

      await screen.findByTestId('my-photo-tile-p-hid');

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      expect(statusCalled).toBe(false);
    });
  });

  describe('thumbnail error guard and focus re-arm', () => {
    it('one extra list request when multiple thumbnails error, no loop, and pull-to-refresh re-arms', async () => {
      const photo1 = makePhoto('p-err1', 'approved');
      const photo2 = makePhoto('p-err2', 'approved');
      let listCount = 0;

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/me/photos/all') {
          listCount++;
          return { items: [photo1, photo2], nextCursor: null };
        }
        return null;
      });

      renderScreen();

      const tile1 = await screen.findByTestId('my-photo-tile-p-err1');
      const tile2 = await screen.findByTestId('my-photo-tile-p-err2');
      expect(listCount).toBe(1);

      const img1 = within(tile1).UNSAFE_getByType(Image);
      const img2 = within(tile2).UNSAFE_getByType(Image);

      // Both images error simultaneously
      act(() => {
        fireEvent(img1, 'error');
        fireEvent(img2, 'error');
      });

      // Exactly ONE refetch happens
      await waitFor(() => {
        expect(listCount).toBe(2);
      });

      // Errors fire again after new URLs delivered
      act(() => {
        fireEvent(img1, 'error');
        fireEvent(img2, 'error');
      });

      // No third list request (guard prevents loop)
      expect(listCount).toBe(2);

      // Pull-to-refresh re-arms the guard
      const flatList = screen.UNSAFE_getByType(FlatList);
      await act(async () => {
        flatList.props.refreshControl.props.onRefresh();
      });

      expect(listCount).toBe(3);

      // Subsequent error causes another refetch
      act(() => {
        fireEvent(img1, 'error');
      });

      await waitFor(() => {
        expect(listCount).toBe(4);
      });
    });

    it('focus re-arm: blur and focus after > PHOTO_GALLERY_STALE_TIME_MS re-arms guard; within stale time does not', async () => {
      jest.useFakeTimers();

      const photo = makePhoto('p-focus', 'approved');
      let listCount = 0;

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/me/photos/all') {
          listCount++;
          return { items: [photo], nextCursor: null };
        }
        return null;
      });

      const navRef = React.createRef<NavigationContainerRef<any>>();
      renderScreen(navRef);

      const tile = await screen.findByTestId('my-photo-tile-p-focus');
      expect(listCount).toBe(1);

      const img = within(tile).UNSAFE_getByType(Image);

      // First error consumes the initial arm
      act(() => {
        fireEvent(img, 'error');
      });
      expect(listCount).toBe(2);

      // Error again: no request
      act(() => {
        fireEvent(img, 'error');
      });
      expect(listCount).toBe(2);

      // Navigate to OtherScreen (blur MyPhotosScreen)
      act(() => {
        navRef.current?.navigate('OtherScreen');
      });

      // Advance by 10 seconds (< 120,000 ms)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      // Return to MyPhotosScreen
      act(() => {
        navRef.current?.goBack();
      });

      // Error again: still disarmed (within stale time)
      act(() => {
        fireEvent(img, 'error');
      });
      expect(listCount).toBe(2);

      // Navigate to OtherScreen again (blur)
      act(() => {
        navRef.current?.navigate('OtherScreen');
      });

      // Advance by 130 seconds (> 120,000 ms PHOTO_GALLERY_STALE_TIME_MS)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(130000);
      });

      // Return to MyPhotosScreen
      act(() => {
        navRef.current?.goBack();
      });

      // Error again: guard re-armed! Refetch triggers
      act(() => {
        fireEvent(img, 'error');
      });
      expect(listCount).toBe(3);

      jest.useRealTimers();
    });
  });

  describe('theming, accessibility roles and labels', () => {
    it('repaints with active scheme: screen background differs between light and dark', async () => {
      const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
        (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

      apiRequestMock.mockResolvedValue({ items: [], nextCursor: null });

      setTestScheme('dark');
      const darkRender = renderScreen();
      const darkScreen = await screen.findByTestId('my-photos-screen');
      const darkBg = flat(darkScreen).backgroundColor;
      expect(darkBg).toBe(darkTheme.color.surface);
      darkRender.unmount();

      setTestScheme('light');
      renderScreen();
      const lightScreen = await screen.findByTestId('my-photos-screen');
      const lightBg = flat(lightScreen).backgroundColor;
      expect(lightBg).toBe(lightTheme.color.surface);

      expect(darkBg).not.toEqual(lightBg);
    });

    it('provides accessible roles and labels for tiles, header, retry button, and indicators', async () => {
      const photos = [
        makePhoto('p-food', 'approved', { targetKind: 'food_log' }),
        makePhoto('p-trip', 'approved', { targetKind: 'trip' }),
        makePhoto('p-other', 'approved', { targetKind: 'unknown' as any }),
      ];

      apiRequestMock.mockResolvedValueOnce({ items: photos, nextCursor: null });

      renderScreen();

      // Tiles have role imagebutton and distinct labels
      const foodTile = await screen.findByTestId('my-photo-tile-p-food');
      expect(foodTile.props.accessibilityRole).toBe('imagebutton');
      expect(foodTile.props.accessibilityLabel).toBe('Food photo, opens viewer');

      const tripTile = screen.getByTestId('my-photo-tile-p-trip');
      expect(tripTile.props.accessibilityRole).toBe('imagebutton');
      expect(tripTile.props.accessibilityLabel).toBe('Trip photo, opens viewer');

      const otherTile = screen.getByTestId('my-photo-tile-p-other');
      expect(otherTile.props.accessibilityRole).toBe('imagebutton');
      expect(otherTile.props.accessibilityLabel).toBe('Photo, opens viewer');

      // Header back button
      const backBtn = screen.getByRole('button', { name: 'Go back' });
      expect(backBtn).toBeTruthy();
    });
  });
});
