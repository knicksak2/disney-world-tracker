import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePhotoConfig,
  useUploadPhotos,
  usePhotoStatuses,
  useMyPhotos,
  useDishPhotos,
  useRestaurantFoodPhotos,
  useDeletePhoto,
  useReportPhoto,
  useBlocks,
  useAddBlock,
  useRemoveBlock,
  useRecapAlbum,
  photoKeys,
  getUploadErrorMessage,
  markUploadActive,
  markUploadInactive,
} from '../api';
import * as clientModule from '../../api/client';
import type { PreparedImages } from '../imagePrep.pure';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('Photos API hooks & uploader (Task 13.3)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    global.fetch = originalFetch;
  });

  describe('usePhotoConfig', () => {
    it('fetches photo config via GET /photos/config', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        enabled: true,
        foodEnabled: true,
        tripEnabled: true,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        maxBytes: 1048576,
        maxThumbBytes: 65536,
        dailyCap: 20,
        remainingToday: 15,
        experienceStripMax: 8,
      });

      const { result } = renderHook(() => usePhotoConfig(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/photos/config');
      expect(result.current.data?.remainingToday).toBe(15);
      expect(result.current.data?.experienceStripMax).toBe(8);
    });
  });

  describe('useUploadPhotos', () => {
    it('declared sizes equal sent sizes, PUT carries no bearer token and only Content-Type, confirm called after PUTs', async () => {
      const fullSize = 123456;
      const thumbSize = 7890;

      const fullBlob = new Blob([new Uint8Array(fullSize)], { type: 'image/jpeg' });
      const thumbBlob = new Blob([new Uint8Array(thumbSize)], { type: 'image/jpeg' });

      const prepared: PreparedImages = {
        full: { uri: 'file:///full.jpg', width: 1280, height: 720, blob: fullBlob },
        thumb: { uri: 'file:///thumb.jpg', width: 320, height: 180, blob: thumbBlob },
      };

      // Mock apiRequest: initiate returns slot, confirm returns accepted
      apiRequestSpy.mockImplementation((_method: string, path: string, _body?: any) => {
        if (path === '/photos/uploads') {
          return Promise.resolve({
            slots: [
              {
                photoId: 'photo-111',
                putUrl: 'https://r2.example.com/u/photo-111/full.jpg?signed=true',
                thumbPutUrl: 'https://r2.example.com/u/photo-111/thumb.jpg?signed=true',
                expiresAt: '2026-10-18T18:00:00.000Z',
              },
            ],
          });
        }
        if (path === '/photos/confirm') {
          return Promise.resolve({
            results: [{ photoId: 'photo-111', result: 'accepted' }],
          });
        }
        return Promise.reject(new Error(`Unexpected path: ${path}`));
      });

      // Mock fetch for direct-to-storage PUTs
      const capturedPuts: Array<{ url: string; init?: RequestInit }> = [];
      global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
        capturedPuts.push({ url, ...(init ? { init } : {}) });
        return Promise.resolve({
          ok: true,
          status: 200,
        });
      });

      const { result } = renderHook(() => useUploadPhotos(), { wrapper: createWrapper() });

      let mutateResult: any;
      await act(async () => {
        mutateResult = await result.current.mutateAsync({
          target: { kind: 'food_log', id: '11111111-1111-4111-8111-111111111111' },
          items: [{ prepared, takenAt: '2026-10-18T12:00:00.000Z' }],
        });
      });

      expect(mutateResult.confirmResults.results[0].result).toBe('accepted');

      // 1. Assert initiate payload: declared sizes equal blob sizes exactly
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/uploads', {
        target: { kind: 'food_log', id: '11111111-1111-4111-8111-111111111111' },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 123456,
            thumbByteSize: 7890,
            width: 1280,
            height: 720,
            takenAt: '2026-10-18T12:00:00.000Z',
          },
        ],
      });

      // 2. Assert direct storage PUT calls: exactly two calls
      expect(capturedPuts).toHaveLength(2);

      const fullPut = capturedPuts[0];
      const thumbPut = capturedPuts[1];
      expect(fullPut).toBeDefined();
      expect(thumbPut).toBeDefined();
      if (!fullPut || !thumbPut) return;

      expect(fullPut.url).toBe('https://r2.example.com/u/photo-111/full.jpg?signed=true');
      expect(fullPut.init?.method).toBe('PUT');
      expect(fullPut.init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      // Exact blob identity and size
      expect(fullPut.init?.body).toBe(fullBlob);
      expect((fullPut.init?.body as Blob).size).toBe(123456);
      expect((fullPut.init?.headers as Record<string, string>)?.['Authorization']).toBeUndefined();
      expect((fullPut.init?.headers as Record<string, string>)?.['Content-Length']).toBeUndefined();

      expect(thumbPut.url).toBe('https://r2.example.com/u/photo-111/thumb.jpg?signed=true');
      expect(thumbPut.init?.method).toBe('PUT');
      expect(thumbPut.init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(thumbPut.init?.body).toBe(thumbBlob);
      expect((thumbPut.init?.body as Blob).size).toBe(7890);
      expect((thumbPut.init?.headers as Record<string, string>)?.['Authorization']).toBeUndefined();
      expect((thumbPut.init?.headers as Record<string, string>)?.['Content-Length']).toBeUndefined();

      // 3. Confirm called with photo IDs after PUTs
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/confirm', {
        photoIds: ['photo-111'],
      });
    });

    it('translates photo_uploads_disabled error copy per Requirement 5.11', () => {
      const killSwitchErr = {
        code: 'photo_uploads_disabled',
        details: { reason: 'kill_switch' },
      };
      expect(getUploadErrorMessage(killSwitchErr)).toBe('Photo uploads are turned off right now');

      const globalCapErr = {
        code: 'photo_uploads_disabled',
        details: { reason: 'global_cap' },
      };
      expect(getUploadErrorMessage(globalCapErr)).toBe(
        'Photo uploads are full for today, try again tomorrow'
      );

      const quotaErr = { code: 'photo_quota_exceeded' };
      expect(getUploadErrorMessage(quotaErr)).toBe('You have reached your daily upload limit');

      const targetFullErr = { code: 'photo_target_full' };
      expect(getUploadErrorMessage(targetFullErr)).toBe('This item has reached its photo limit');
    });
  });

  describe('usePhotoStatuses', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('polls with exactly one request carrying all 7 pending IDs and stops on final status', async () => {
      const pendingIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

      apiRequestSpy.mockResolvedValueOnce({
        photos: pendingIds.map((id) => ({
          id,
          targetKind: 'food_log',
          targetId: 't1',
          scopeId: 's1',
          status: 'pending',
          rejectReason: null,
          rejectMessage: null,
          thumbUrl: null,
          url: null,
          width: 800,
          height: 600,
          feedItemId: null,
          createdAt: '2026-10-18T12:00:00.000Z',
        })),
      });

      const { result } = renderHook(() => usePhotoStatuses(pendingIds), {
        wrapper: createWrapper(),
      });

      // Advance timer by 3s to trigger first poll tick
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(apiRequestSpy).toHaveBeenCalledTimes(1);
      const calledUrl = apiRequestSpy.mock.calls[0][1];
      expect(calledUrl).toContain('/me/photos/status?ids=');
      for (const id of pendingIds) {
        expect(calledUrl).toContain(id);
      }

      // Next tick: mock all transitioning to approved
      apiRequestSpy.mockResolvedValueOnce({
        photos: pendingIds.map((id) => ({
          id,
          targetKind: 'food_log',
          targetId: 't1',
          scopeId: 's1',
          status: 'approved',
          rejectReason: null,
          rejectMessage: null,
          thumbUrl: `https://p/thumb-${id}.jpg`,
          url: `https://p/full-${id}.jpg`,
          width: 800,
          height: 600,
          feedItemId: null,
          createdAt: '2026-10-18T12:00:00.000Z',
        })),
      });

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(apiRequestSpy).toHaveBeenCalledTimes(2);

      // Now all photos are approved (final), so next ticks must issue no further requests
      await act(async () => {
        jest.advanceTimersByTime(15000);
      });

      expect(apiRequestSpy).toHaveBeenCalledTimes(2);
      expect(result.current.isPending).toBe(false);
    });

    function statusPhoto(id: string, status: 'pending' | 'approved' | 'rejected') {
      return {
        id,
        targetKind: 'trip',
        targetId: 't1',
        scopeId: 't1',
        status,
        rejectReason: null,
        rejectMessage: null,
        thumbUrl: null,
        url: null,
        width: 800,
        height: 600,
        feedItemId: null,
        createdAt: '2026-10-18T12:00:00.000Z',
      };
    }

    it('calls onFinal once with just the ids that became final, and not for a still-pending photo', async () => {
      const onFinal = jest.fn();
      apiRequestSpy.mockResolvedValueOnce({
        photos: [statusPhoto('p1', 'approved'), statusPhoto('p2', 'pending'), statusPhoto('p3', 'rejected')],
      });

      renderHook(() => usePhotoStatuses(['p1', 'p2', 'p3'], { onFinal }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(onFinal).toHaveBeenCalledTimes(1);
      expect(onFinal).toHaveBeenCalledWith(['p1', 'p3']);
    });

    it('does not call onFinal while every photo is still pending', async () => {
      const onFinal = jest.fn();
      apiRequestSpy.mockResolvedValue({ photos: [statusPhoto('p1', 'pending')] });

      renderHook(() => usePhotoStatuses(['p1'], { onFinal }), { wrapper: createWrapper() });

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(apiRequestSpy).toHaveBeenCalledTimes(2);
      expect(onFinal).not.toHaveBeenCalled();
    });

    it('keeps the tick counter when the caller passes a fresh array with the same ids on every render', async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        const requested = decodeURIComponent(path.split('ids=')[1] ?? '').split(',');
        return Promise.resolve({ photos: requested.map((id) => statusPhoto(id, 'pending')) });
      });

      // `[...ids]` is a new array identity on every render, as with ids derived from query data.
      renderHook(() => usePhotoStatuses([...ids]), { wrapper: createWrapper() });

      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      const requestedIds = apiRequestSpy.mock.calls.map((call: unknown[]) =>
        decodeURIComponent(String(call[1]).split('ids=')[1] ?? '').split(','),
      );
      // Chunk 0 (10 ids) then chunk 1 (the other 2): a re-render must not reset the tick index.
      expect(requestedIds).toEqual([ids.slice(0, 10), ids.slice(10)]);
    });
  });

  describe('useMyPhotos & restart recovery (Requirement 4.12)', () => {
    it('fetches own photos with statuses via GET /me/photos', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        items: [
          {
            id: 'photo-1',
            targetKind: 'food_log',
            targetId: 'log-1',
            scopeId: 'dish-1',
            status: 'approved',
            rejectReason: null,
            rejectMessage: null,
            thumbUrl: 'https://p/1/thumb.jpg',
            url: 'https://p/1/full.jpg',
            width: 800,
            height: 600,
            feedItemId: null,
            createdAt: '2026-10-18T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      });

      const { result } = renderHook(() => useMyPhotos('food_log', 'dish-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('/me/photos?targetKind=food_log&scopeId=dish-1')
      );
      expect(result.current.data?.items).toHaveLength(1);
    });

    it('performs restart recovery when loading uploading rows with no local upload in progress', async () => {
      // Photo-recovered is uploading on server, and not in activeUploadIds on device
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path.startsWith('/me/photos')) {
          return Promise.resolve({
            items: [
              {
                id: 'photo-recovered',
                targetKind: 'food_log',
                targetId: 'log-1',
                scopeId: 'dish-1',
                status: 'uploading',
                rejectReason: null,
                rejectMessage: null,
                thumbUrl: null,
                url: null,
                width: 800,
                height: 600,
                feedItemId: null,
                createdAt: '2026-10-18T10:00:00.000Z',
              },
              {
                id: 'photo-active',
                targetKind: 'food_log',
                targetId: 'log-1',
                scopeId: 'dish-1',
                status: 'uploading',
                rejectReason: null,
                rejectMessage: null,
                thumbUrl: null,
                url: null,
                width: 800,
                height: 600,
                feedItemId: null,
                createdAt: '2026-10-18T10:00:00.000Z',
              },
              {
                id: 'photo-approved',
                targetKind: 'food_log',
                targetId: 'log-1',
                scopeId: 'dish-1',
                status: 'approved',
                rejectReason: null,
                rejectMessage: null,
                thumbUrl: 'https://p/thumb.jpg',
                url: 'https://p/full.jpg',
                width: 800,
                height: 600,
                feedItemId: null,
                createdAt: '2026-10-18T10:00:00.000Z',
              },
            ],
            nextCursor: null,
          });
        }
        if (path === '/photos/confirm') {
          return Promise.resolve({
            results: [{ photoId: 'photo-recovered', result: 'incomplete' }],
          });
        }
        return Promise.reject(new Error(`Unexpected path: ${path}`));
      });

      // Mark photo-active as currently in progress on device
      markUploadActive('photo-active');

      try {
        const { result } = renderHook(() => useMyPhotos('food_log', 'dish-1'), {
          wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Confirm should be called with ONLY photo-recovered (not photo-active or photo-approved)
        await waitFor(() => {
          expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/confirm', {
            photoIds: ['photo-recovered'],
          });
        });

        // The incomplete result should be marked in retryPhotoIds
        await waitFor(() => {
          expect(result.current.retryPhotoIds.has('photo-recovered')).toBe(true);
        });
      } finally {
        markUploadInactive('photo-active');
      }
    });
  });

  describe('useDishPhotos & useRestaurantFoodPhotos', () => {
    it('useDishPhotos calls GET /food-items/:id/photos', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
      });

      const { result } = renderHook(() => useDishPhotos('dish-123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/food-items/dish-123/photos');
    });

    it('useRestaurantFoodPhotos calls GET /experiences/:id/food-photos?limit=8', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
      });

      const { result } = renderHook(() => useRestaurantFoodPhotos('exp-456', 8), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/experiences/exp-456/food-photos?limit=8');
    });
  });

  describe('useDeletePhoto, useReportPhoto, useBlocks', () => {
    it('useDeletePhoto calls DELETE /photos/:id', async () => {
      apiRequestSpy.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useDeletePhoto(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync('photo-del');
      });

      expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/photos/photo-del');
    });

    it('useReportPhoto calls POST /photos/:id/report with reason and note', async () => {
      apiRequestSpy.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useReportPhoto(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          photoId: 'photo-rep',
          reason: 'not_food',
          note: 'Picture of a park map',
        });
      });

      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/photo-rep/report', {
        reason: 'not_food',
        note: 'Picture of a park map',
      });
    });

    it('useBlocks, useAddBlock, useRemoveBlock execute expected endpoints', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        blocks: [
          {
            blockId: 'b-1',
            displayName: null,
            avatarPreset: null,
            createdAt: '2026-10-18T10:00:00.000Z',
          },
        ],
      });

      const wrapper = createWrapper();
      const { result: blocksRes } = renderHook(() => useBlocks(), { wrapper });

      await waitFor(() => expect(blocksRes.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/me/blocks');

      // Add block
      apiRequestSpy.mockResolvedValueOnce({
        blockId: 'b-2',
        displayName: 'Guest',
        avatarPreset: null,
        createdAt: '2026-10-18T12:00:00.000Z',
      });
      const { result: addRes } = renderHook(() => useAddBlock(), { wrapper });

      await act(async () => {
        await addRes.current.mutateAsync({ photoId: 'photo-target' });
      });
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/blocks', { photoId: 'photo-target' });

      // Remove block
      apiRequestSpy.mockResolvedValueOnce(undefined);
      const { result: removeRes } = renderHook(() => useRemoveBlock(), { wrapper });

      await act(async () => {
        await removeRes.current.mutateAsync('b-2');
      });
      expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/me/blocks/b-2');
    });
  });

  describe('photoKeys.recapAlbum & useRecapAlbum (decision D35)', () => {
    const PAGE_1 = {
      access: 'granted' as const,
      photos: [
        {
          id: 'photo-1',
          thumbUrl: 'https://r2.test/p/photo-1/thumb.jpg',
          url: 'https://r2.test/p/photo-1/full.jpg',
          width: 800,
          height: 600,
          sortAt: '2026-05-02T01:30:00.000Z',
        },
      ],
      nextCursor: 'cursor-1',
    };
    const PAGE_2 = { access: 'granted' as const, photos: [], nextCursor: null };

    it('keys live under photoKeys.all so a block or report invalidation refetches the album', () => {
      expect(photoKeys.recapAlbum('s1')).toEqual(['photos', 'recapAlbum', 's1']);
      expect(photoKeys.recapAlbum('s1').slice(0, photoKeys.all.length)).toEqual([...photoKeys.all]);
      expect(photoKeys.recapAlbumAll().slice(0, photoKeys.all.length)).toEqual([...photoKeys.all]);
      // The prefix key matches every share's entry.
      expect(photoKeys.recapAlbum('s1').slice(0, photoKeys.recapAlbumAll().length)).toEqual([
        ...photoKeys.recapAlbumAll(),
      ]);
    });

    it('requests the share path with no query on page 1 and follows nextCursor for the next page', async () => {
      apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me/inbox/s1/trip-recap/photos') return PAGE_1;
        if (path === '/me/inbox/s1/trip-recap/photos?cursor=cursor-1') return PAGE_2;
        throw new Error(`unexpected ${path}`);
      });

      const { result } = renderHook(() => useRecapAlbum('s1'), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/me/inbox/s1/trip-recap/photos');
      expect(result.current.hasNextPage).toBe(true);

      await act(async () => {
        await result.current.fetchNextPage();
      });
      expect(apiRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/me/inbox/s1/trip-recap/photos?cursor=cursor-1',
      );
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      expect(result.current.hasNextPage).toBe(false);
    });

    it('does not request anything for an empty share id', () => {
      renderHook(() => useRecapAlbum(''), { wrapper: createWrapper() });

      expect(apiRequestSpy).not.toHaveBeenCalled();
    });
  });
});
