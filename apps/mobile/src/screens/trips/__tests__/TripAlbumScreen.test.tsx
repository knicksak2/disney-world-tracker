import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripPhotoDTO } from '@dwt/shared';

import TripAlbumScreen, {
  ALBUM_NOTICE_STORAGE_KEY,
  getNewYorkDayKey,
  groupPhotosByNewYorkDay,
} from '../TripAlbumScreen';
import * as clientModule from '../../../api/client';
import * as photoPickerModule from '../../../photos/photoPicker';
import * as imagePrepModule from '../../../photos/imagePrep';
import type { PreparedImages } from '../../../photos/imagePrep.pure';

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
};

const TRIP_ID = 'trip-album-123';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const PHOTO_NY_MAY1: TripPhotoDTO = {
  id: 'photo-1',
  tripId: TRIP_ID,
  thumbUrl: 'https://cdn.example.com/p/photo-1/thumb.jpg',
  url: 'https://cdn.example.com/p/photo-1/full.jpg',
  width: 1920,
  height: 1080,
  // 01:30 UTC on May 2nd is 21:30 on May 1st in America/New_York (EDT)
  sortAt: '2026-05-02T01:30:00.000Z',
  createdAt: '2026-05-02T01:30:00.000Z',
  uploader: { userId: 'user-donald', displayName: 'Donald Duck', avatarPreset: 'castle' },
  mine: false,
  status: 'approved',
  feedItemId: null,
};

const PHOTO_NY_MAY2: TripPhotoDTO = {
  id: 'photo-2',
  tripId: TRIP_ID,
  thumbUrl: 'https://cdn.example.com/p/photo-2/thumb.jpg',
  url: 'https://cdn.example.com/p/photo-2/full.jpg',
  width: 1920,
  height: 1080,
  // 15:00 UTC on May 2nd is 11:00 on May 2nd in America/New_York (EDT)
  sortAt: '2026-05-02T15:00:00.000Z',
  createdAt: '2026-05-02T15:00:00.000Z',
  uploader: { userId: 'user-mickey', displayName: 'Mickey Mouse', avatarPreset: null },
  mine: true,
  status: 'approved',
  feedItemId: null,
};

describe('TripAlbumScreen (Tasks 22.1 & 22.2)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as unknown as Response);

    await AsyncStorage.clear();
    mockNavigation.navigate.mockClear();
    mockNavigation.goBack.mockClear();

    jest.spyOn(photoPickerModule, 'requestLibraryPermission').mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    global.fetch = originalFetch;
  });

  describe('Pure New York Day Grouping', () => {
    it('converts 01:30 UTC on May 2nd to 2026-05-01 in America/New_York', () => {
      const dayKey = getNewYorkDayKey('2026-05-02T01:30:00.000Z');
      expect(dayKey).toBe('2026-05-01');
    });

    it('groups photos into correct New York days and formats headings', () => {
      const groups = groupPhotosByNewYorkDay([PHOTO_NY_MAY1, PHOTO_NY_MAY2]);
      expect(groups).toHaveLength(2);
      expect(groups[0]?.dayKey).toBe('2026-05-02');
      expect(groups[0]?.photos).toEqual([PHOTO_NY_MAY2]);
      expect(groups[1]?.dayKey).toBe('2026-05-01');
      expect(groups[1]?.photos).toEqual([PHOTO_NY_MAY1]);
    });
  });

  describe('Task 22.1: Trip album screen', () => {
    it('renders empty state when album has no photos', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 20 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      expect(await screen.findByTestId('trip-album-empty')).toBeTruthy();
      expect(screen.getByText('No photos yet')).toBeTruthy();
    });

    it('groups photos across New York midnight and renders under May 1 and May 2', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 15 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY2, PHOTO_NY_MAY1], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      expect(await screen.findByTestId('album-day-heading-2026-05-01')).toBeTruthy();
      expect(screen.getByTestId('album-day-heading-2026-05-02')).toBeTruthy();
      expect(screen.getByTestId('album-photo-tile-photo-1')).toBeTruthy();
      expect(screen.getByTestId('album-photo-tile-photo-2')).toBeTruthy();

      // Check status chip renders for own photo
      expect(screen.getByTestId('album-photo-status-photo-2')).toBeTruthy();
    });

    it('scrolling requests the next cursor (keyset pagination)', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 15 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.includes('cursor=cursor-123')) {
          return Promise.resolve({ items: [PHOTO_NY_MAY1], nextCursor: null });
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY2], nextCursor: 'cursor-123' });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('album-photo-tile-photo-2');

      const list = screen.getByTestId('trip-album-list');
      fireEvent(list, 'onEndReached');

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          'GET',
          `/trips/${TRIP_ID}/photos?cursor=cursor-123`
        );
      });
    });

    it('plain member sees Report and Block on others photos and does not see Delete', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 10 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY1], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('album-photo-tile-photo-1');
      fireEvent.press(screen.getByTestId('album-photo-tile-photo-1'));

      expect(await screen.findByTestId('photo-viewer-report')).toBeTruthy();
      expect(screen.getByTestId('photo-viewer-block')).toBeTruthy();
      expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();
    });

    it('organizer sees Delete on others photos', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 10 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'organizer' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY1], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('album-photo-tile-photo-1');
      fireEvent.press(screen.getByTestId('album-photo-tile-photo-1'));

      expect(await screen.findByTestId('photo-viewer-delete')).toBeTruthy();
    });

    it('deleting a photo calls DELETE /photos/:id and photo disappears', async () => {
      let photoList = [PHOTO_NY_MAY2];

      apiRequestSpy.mockImplementation((method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 10 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (method === 'DELETE' && path === `/photos/${PHOTO_NY_MAY2.id}`) {
          photoList = [];
          return Promise.resolve();
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: photoList, nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('album-photo-tile-photo-2');
      fireEvent.press(screen.getByTestId('album-photo-tile-photo-2'));

      // Press delete in viewer
      const deleteBtn = await screen.findByTestId('photo-viewer-delete');
      fireEvent.press(deleteBtn);

      // Confirm delete dialog appears
      const confirmBtn = await screen.findByTestId('confirm-delete-button');
      fireEvent.press(confirmBtn);

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', `/photos/${PHOTO_NY_MAY2.id}`);
      });
    });

    it('no control with an include/exclude-from-recap label is rendered', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 10 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'organizer' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY2, PHOTO_NY_MAY1], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('album-photo-tile-photo-2');

      // Assert neither "include in recap" nor "exclude from recap" exists on screen
      expect(screen.queryByText(/include in recap/i)).toBeNull();
      expect(screen.queryByText(/exclude from recap/i)).toBeNull();
      expect(screen.queryByText(/recap photo/i)).toBeNull();
    });

    it('renders one-time crew notice on first open, dismisses with tap, persists to AsyncStorage, and does not render again', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 10 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [PHOTO_NY_MAY1], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      // First open: AsyncStorage has no notice dismissed key
      const { unmount } = render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      // Verify notice renders
      expect(await screen.findByTestId('album-crew-notice')).toBeTruthy();
      expect(
        screen.getByText(
          'Any trip member can share the trip recap with friends, it can include photos from everyone on the trip, deleting a photo removes it everywhere.'
        )
      ).toBeTruthy();

      // Dismiss notice
      fireEvent.press(screen.getByTestId('dismiss-album-notice-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('album-crew-notice')).toBeNull();
      }, { timeout: 5000 });

      const stored = await AsyncStorage.getItem(ALBUM_NOTICE_STORAGE_KEY);
      expect(stored).toBe('dismissed');

      unmount();

      // Second open: notice should not render
      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-2', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await waitFor(() => {
        expect(screen.queryByTestId('album-crew-notice')).toBeNull();
      });
    });
  });

  describe('Task 22.2: Upload to a trip', () => {
    it('shows remaining daily upload quota in toolbar when tripEnabled is true', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({
            enabled: true,
            tripEnabled: true,
            remainingToday: 7,
          });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      expect(await screen.findByTestId('add-trip-photos-btn')).toBeTruthy();
      expect(screen.getByTestId('album-daily-quota')).toBeTruthy();
      expect(screen.getByText('7 uploads left today')).toBeTruthy();
    });

    it('Add photos opens the picker with the trip guidance and not the food guidance (Requirement 23.9)', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 7 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      fireEvent.press(await screen.findByTestId('add-trip-photos-btn'));

      const guidance = await screen.findByText(
        'Share your favorite moments with your crew. People and text are welcome.'
      );
      expect(guidance.props.accessibilityLabel).toBe(
        'Share your favorite moments with your crew. People and text are welcome.'
      );
      expect(screen.queryByText(/Frame just the dish/)).toBeNull();
      expect(screen.queryByText(/No people or text/)).toBeNull();
    });

    it('hides Add photos when tripEnabled is false', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({
            enabled: true,
            tripEnabled: false,
            remainingToday: 7,
          });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-2', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      await screen.findByTestId('trip-album-empty');
      expect(screen.queryByTestId('add-trip-photos-btn')).toBeNull();
    });

    it('selecting 3 photos sends one initiate with 3 items and one confirm', async () => {
      // Mock picker returning 3 photos
      jest.spyOn(photoPickerModule, 'pickFromLibrary').mockResolvedValue({
        canceled: false,
        photos: [
          { uri: 'file:///photo-1.jpg', width: 1280, height: 720, takenAt: '2026-05-01T12:00:00Z', source: 'library' },
          { uri: 'file:///photo-2.jpg', width: 1280, height: 720, takenAt: '2026-05-01T13:00:00Z', source: 'library' },
          { uri: 'file:///photo-3.jpg', width: 1280, height: 720, takenAt: '2026-05-01T14:00:00Z', source: 'library' },
        ],
      });

      const fakeBlob = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
      const fakePrepared: PreparedImages = {
        full: { uri: 'file:///full.jpg', width: 1280, height: 720, blob: fakeBlob },
        thumb: { uri: 'file:///thumb.jpg', width: 320, height: 180, blob: fakeBlob },
      };

      jest.spyOn(imagePrepModule, 'prepareImage').mockResolvedValue(fakePrepared);

      apiRequestSpy.mockImplementation((_method: string, path: string, body?: any) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 20 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        if (path === '/photos/uploads') {
          expect(body.target).toEqual({ kind: 'trip', id: TRIP_ID });
          expect(body.items).toHaveLength(3);
          return Promise.resolve({
            slots: [
              { photoId: 'p-1', putUrl: 'https://r2.test/u/p-1/f.jpg', thumbPutUrl: 'https://r2.test/u/p-1/t.jpg' },
              { photoId: 'p-2', putUrl: 'https://r2.test/u/p-2/f.jpg', thumbPutUrl: 'https://r2.test/u/p-2/t.jpg' },
              { photoId: 'p-3', putUrl: 'https://r2.test/u/p-3/f.jpg', thumbPutUrl: 'https://r2.test/u/p-3/t.jpg' },
            ],
          });
        }
        if (path === '/photos/confirm') {
          expect(body.photoIds).toEqual(['p-1', 'p-2', 'p-3']);
          return Promise.resolve({
            results: [
              { photoId: 'p-1', status: 'accepted' },
              { photoId: 'p-2', status: 'accepted' },
              { photoId: 'p-3', status: 'accepted' },
            ],
          });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      // Pre-accept disclosure in AsyncStorage so upload button is enabled immediately
      await AsyncStorage.setItem('photos.disclosure.v1', 'true');

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      // 1. Open picker sheet
      const addBtn = await screen.findByTestId('add-trip-photos-btn');
      fireEvent.press(addBtn);

      // 2. Select from library
      const chooseBtn = await screen.findByTestId('choose-from-library-button');
      fireEvent.press(chooseBtn);

      // 3. Confirm upload
      const confirmUploadBtn = await screen.findByTestId('confirm-photo-upload-button');
      expect(await screen.findByText('Upload 3 Photos')).toBeTruthy();
      fireEvent.press(confirmUploadBtn);

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          'POST',
          '/photos/uploads',
          expect.objectContaining({
            target: { kind: 'trip', id: TRIP_ID },
            items: expect.any(Array),
          })
        );
        expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/confirm', {
          photoIds: ['p-1', 'p-2', 'p-3'],
        });
      });
    });

    it('displays a clear message when upload fails with photo_quota_exceeded', async () => {
      jest.spyOn(photoPickerModule, 'pickFromLibrary').mockResolvedValue({
        canceled: false,
        photos: [
          { uri: 'file:///photo-1.jpg', width: 1280, height: 720, takenAt: '2026-05-01T12:00:00Z', source: 'library' },
        ],
      });

      const fakeBlob = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
      jest.spyOn(imagePrepModule, 'prepareImage').mockResolvedValue({
        full: { uri: 'file:///full.jpg', width: 1280, height: 720, blob: fakeBlob },
        thumb: { uri: 'file:///thumb.jpg', width: 320, height: 180, blob: fakeBlob },
      });

      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path === '/photos/config') {
          return Promise.resolve({ enabled: true, tripEnabled: true, remainingToday: 0 });
        }
        if (path === '/me') {
          return Promise.resolve({ user: { id: 'user-me' } });
        }
        if (path === `/trips/${TRIP_ID}/members`) {
          return Promise.resolve([{ userId: 'user-me', role: 'member' }]);
        }
        if (path.startsWith(`/trips/${TRIP_ID}/photos`)) {
          return Promise.resolve({ items: [], nextCursor: null });
        }
        if (path === '/photos/uploads') {
          const err = new Error('Daily upload limit reached');
          (err as any).code = 'photo_quota_exceeded';
          return Promise.reject(err);
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      await AsyncStorage.setItem('photos.disclosure.v1', 'true');

      render(
        <TripAlbumScreen
          navigation={mockNavigation as any}
          route={{ key: 'TripAlbum-1', name: 'TripAlbum', params: { tripId: TRIP_ID } }}
        />,
        { wrapper: makeWrapper() }
      );

      const addBtn = await screen.findByTestId('add-trip-photos-btn');
      fireEvent.press(addBtn);

      const chooseBtn = await screen.findByTestId('choose-from-library-button');
      fireEvent.press(chooseBtn);

      const confirmUploadBtn = await screen.findByTestId('confirm-photo-upload-button');
      await screen.findByText('Choose Different Photo');
      fireEvent.press(confirmUploadBtn);

      // Verify clear quota exceeded error message in banner
      expect(await screen.findByTestId('album-upload-error')).toBeTruthy();
      expect(screen.getByText('You have reached your daily upload limit')).toBeTruthy();
    });
  });
});
