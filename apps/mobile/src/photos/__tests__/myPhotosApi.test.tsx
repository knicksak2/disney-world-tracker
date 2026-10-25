import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MyPhotoDTO, PhotoPageDTO, PhotoConfirmResponseDTO } from '@dwt/shared';
import {
  photoKeys,
  fetchAllMyPhotos,
  useAllMyPhotos,
  markUploadActive,
  markUploadInactive,
} from '../api';
import * as clientModule from '../../api/client';

function createWrapper(queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})) {
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

function makeMockPhoto(overrides: Partial<MyPhotoDTO> = {}): MyPhotoDTO {
  return {
    id: 'photo-1',
    targetKind: 'food_log',
    targetId: 'log-1',
    scopeId: 'dish-1',
    status: 'approved',
    rejectReason: null,
    rejectMessage: null,
    thumbUrl: 'https://example.com/thumb.jpg',
    url: 'https://example.com/full.jpg',
    width: 800,
    height: 600,
    feedItemId: null,
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

describe('My Photos API & hooks (Task 25.5, Requirement 29.3, 29.11-29.13, 29.17)', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  describe('photoKeys.myLibrary', () => {
    it('produces expected key and prefix matches', () => {
      const key = photoKeys.myLibrary();
      expect(key).toEqual(['photos', 'my', 'library']);

      const allPrefix = photoKeys.all;
      expect(key[0]).toBe(allPrefix[0]);

      const myAllPrefix = photoKeys.myAll();
      expect(key.slice(0, 2)).toEqual([...myAllPrefix]);

      expect(key).not.toEqual(photoKeys.my('food_log', '123'));
      expect(key).not.toEqual(photoKeys.my('trip', '456'));
    });
  });

  describe('fetchAllMyPhotos', () => {
    it('calls GET /me/photos/all with and without cursor', async () => {
      const mockPage: PhotoPageDTO<MyPhotoDTO> = { items: [], nextCursor: null };
      apiRequestSpy.mockResolvedValueOnce(mockPage);

      await fetchAllMyPhotos();
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/me/photos/all');

      apiRequestSpy.mockResolvedValueOnce(mockPage);
      await fetchAllMyPhotos('cursor-abc');
      expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/me/photos/all?cursor=cursor-abc');
    });
  });

  describe('useAllMyPhotos', () => {
    it('follows nextCursor and flattens pages into items', async () => {
      const p1 = makeMockPhoto({ id: 'p1' });
      const p2 = makeMockPhoto({ id: 'p2' });

      const page1: PhotoPageDTO<MyPhotoDTO> = { items: [p1], nextCursor: 'c1' };
      const page2: PhotoPageDTO<MyPhotoDTO> = { items: [p2], nextCursor: null };

      apiRequestSpy
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAllMyPhotos(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.items).toEqual([p1]);
      expect(result.current.hasNextPage).toBe(true);

      act(() => {
        result.current.fetchNextPage();
      });

      await waitFor(() => expect(result.current.items).toHaveLength(2));
      expect(result.current.items).toEqual([p1, p2]);
      expect(result.current.hasNextPage).toBe(false);
    });

    it('triggers exactly one POST /photos/confirm and one invalidation across several re-renders with unchanged data for an inactive uploading photo', async () => {
      const uploadingPhoto = makeMockPhoto({ id: 'up-1', status: 'uploading' });
      const page: PhotoPageDTO<MyPhotoDTO> = { items: [uploadingPhoto], nextCursor: null };

      apiRequestSpy.mockImplementation((method: string, url: string) => {
        if (method === 'GET' && url.startsWith('/me/photos/all')) {
          return Promise.resolve(page);
        }
        if (method === 'POST' && url === '/photos/confirm') {
          const confirmRes: PhotoConfirmResponseDTO = {
            results: [{ photoId: 'up-1', result: 'accepted' }],
          };
          return Promise.resolve(confirmRes);
        }
        return Promise.reject(new Error(`Unexpected ${method} ${url}`));
      });

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result, rerender } = renderHook(() => useAllMyPhotos(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Re-render multiple times with unchanged data
      rerender({});
      rerender({});
      rerender({});

      await waitFor(() => {
        const confirmCalls = apiRequestSpy.mock.calls.filter(
          ([method, url]) => method === 'POST' && url === '/photos/confirm'
        );
        expect(confirmCalls).toHaveLength(1);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: photoKeys.myLibrary() });
    });

    it('does not confirm an active upload', async () => {
      const uploadingPhoto = makeMockPhoto({ id: 'active-up-1', status: 'uploading' });
      markUploadActive('active-up-1');

      const page: PhotoPageDTO<MyPhotoDTO> = { items: [uploadingPhoto], nextCursor: null };
      apiRequestSpy.mockResolvedValueOnce(page);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAllMyPhotos(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const confirmCalls = apiRequestSpy.mock.calls.filter(
        ([method, url]) => method === 'POST' && url === '/photos/confirm'
      );
      expect(confirmCalls).toHaveLength(0);

      markUploadInactive('active-up-1');
    });

    it('no confirm loop: when refetch returns new thumbUrl and confirm answers incomplete, confirms once in total and does not invalidate', async () => {
      let fetchCount = 0;
      apiRequestSpy.mockImplementation((method: string, url: string) => {
        if (method === 'GET' && url.startsWith('/me/photos/all')) {
          fetchCount++;
          // Every fetch returns a fresh presigned thumbUrl, exactly like the real API, so
          // data.pages changes identity on each refetch (the condition that caused the loop).
          return Promise.resolve({
            items: [
              makeMockPhoto({
                id: 'up-loop',
                status: 'uploading',
                thumbUrl: `https://thumb${fetchCount}.jpg`,
              }),
            ],
            nextCursor: null,
          });
        }
        if (method === 'POST' && url === '/photos/confirm') {
          const confirmRes: PhotoConfirmResponseDTO = {
            results: [{ photoId: 'up-loop', result: 'incomplete' }],
          };
          return Promise.resolve(confirmRes);
        }
        return Promise.reject(new Error(`Unexpected ${method} ${url}`));
      });

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useAllMyPhotos(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Wait for confirm
      await waitFor(() => {
        const confirmCalls = apiRequestSpy.mock.calls.filter(
          ([method, url]) => method === 'POST' && url === '/photos/confirm'
        );
        expect(confirmCalls).toHaveLength(1);
      });

      // No invalidation occurred for incomplete result
      expect(invalidateSpy).not.toHaveBeenCalled();

      // Trigger refetch (e.g., queryClient refetch)
      await act(async () => {
        await result.current.refetch();
      });

      // Assert STILL exactly 1 confirm call in total (no loop!)
      const confirmCallsAfterRefetch = apiRequestSpy.mock.calls.filter(
        ([method, url]) => method === 'POST' && url === '/photos/confirm'
      );
      expect(confirmCallsAfterRefetch).toHaveLength(1);

      // Clearing the set (simulating pull-to-refresh) allows one further confirm
      act(() => {
        result.current.clearConfirmedIds();
      });

      // Trigger refetch after clearing confirmedIds
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        const confirmCallsAfterClear = apiRequestSpy.mock.calls.filter(
          ([method, url]) => method === 'POST' && url === '/photos/confirm'
        );
        expect(confirmCallsAfterClear).toHaveLength(2);
      }, { timeout: 3000 });
    });
  });
});

