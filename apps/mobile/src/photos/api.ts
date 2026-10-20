import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  PhotoClientConfigDTO,
  PhotoInitiateResponseDTO,
  PhotoConfirmResponseDTO,
  MyPhotoDTO,
  MyPhotoStatusResponseDTO,
  FoodPhotoDTO,
  RestaurantFoodPhotoDTO,
  PhotoPageDTO,
  BlockedUserDTO,
  PhotoTargetKind,
  PhotoReportReason,
  TripPhotoDTO,
  SharedSummaryPhotoDTO,
  TripRecapPhotosDTO,
} from '@dwt/shared';
import { apiRequest } from '../api/client';
import { buildInitiatePayload, buildPutPlans, type UploadTarget } from './uploadPlan';
import type { PreparedImages } from './imagePrep.pure';
import {
  getPollInterval,
  getBatchForTick,
  filterPendingPhotoIds,
  isFinalPhotoStatus,
} from './pollPlan';

export const PHOTO_STALE_TIME_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Stale time for the PUBLIC gallery reads (dish strip/sheet, restaurant strip/sheet).
 * Those lists change when somebody else's (or the owner's own) photo is approved, which can
 * happen minutes after the upload, after the uploader has left the screen that polls the
 * status. A short stale time makes the next mount of a strip/sheet refetch when its data is
 * older than this; nothing polls in the background, so this is at most one GET per mounted
 * query per interval.
 */
export const PHOTO_GALLERY_STALE_TIME_MS = 2 * 60 * 1000; // 2 minutes

/** First segment of the restaurant/location gallery keys (NOT under `photoKeys.all`). */
export const RESTAURANT_PHOTOS_KEY = 'restaurant-food-photos';
/** First segment of the infinite dish gallery (sheet) key (NOT under `photoKeys.all`). */
export const DISH_PHOTOS_INFINITE_KEY = 'dish-photos-infinite';

export const photoKeys = {
  all: ['photos'] as const,
  config: () => [...photoKeys.all, 'config'] as const,
  /** Prefix matching every own-photo list regardless of kind/scope. */
  myAll: () => [...photoKeys.all, 'my'] as const,
  /** Own-photo list; for a food_log the scope is the FOOD ITEM id (R4.11). */
  my: (targetKind?: string, scopeId?: string) =>
    [...photoKeys.all, 'my', targetKind ?? '', scopeId ?? ''] as const,
  /**
   * Prefix matching every dish strip entry. Invalidate THIS (or `dish(realId)`), never
   * `dish('')`: the empty-string segment would not prefix-match any real dish id.
   */
  dishAll: () => [...photoKeys.all, 'dish'] as const,
  dish: (foodItemId: string) => [...photoKeys.all, 'dish', foodItemId] as const,
  /** Prefix matching every infinite dish gallery (sheet) entry. */
  dishInfiniteAll: () => [DISH_PHOTOS_INFINITE_KEY] as const,
  /**
   * Prefix matching every restaurant AND location gallery entry (the strip on the
   * experience page and its "See all" sheet). `useRestaurantFoodPhotos` keys live under
   * `['restaurant-food-photos', kind, id, limit]`, outside `photoKeys.all`, so invalidating
   * `photoKeys.all` does NOT refresh them.
   */
  restaurantAll: () => [RESTAURANT_PHOTOS_KEY] as const,
  restaurant: (experienceId: string, limit?: number) =>
    [...photoKeys.all, 'restaurant', experienceId, limit ?? 0] as const,
  blocks: () => [...photoKeys.all, 'blocks'] as const,
  /**
   * Prefix matching every Trip Album entry of every trip. `useTripAlbum` keys carry the
   * trip id and the page limit after this prefix, so invalidate THIS (or `tripAlbum(realId)`),
   * never `tripAlbum('')`, which would not prefix-match any real trip id.
   */
  tripAlbumAll: () => [...photoKeys.all, 'tripAlbum'] as const,
  tripAlbum: (tripId: string) => [...photoKeys.all, 'tripAlbum', tripId] as const,
  /** Prefix matching every recap highlights entry of every trip (see `tripAlbumAll`). */
  tripSummaryPhotosAll: () => [...photoKeys.all, 'tripSummaryPhotos'] as const,
  tripSummaryPhotos: (tripId: string) => [...photoKeys.all, 'tripSummaryPhotos', tripId] as const,
  /**
   * Prefix matching every recipient Recap Album entry (photo-uploads D35). It lives under
   * `photoKeys.all` on purpose: `useAddBlock` and `useReportPhoto` invalidate that prefix, so
   * a block refetches the album and the blocked uploader's photos disappear.
   */
  recapAlbumAll: () => [...photoKeys.all, 'recapAlbum'] as const,
  recapAlbum: (shareId: string) => [...photoKeys.all, 'recapAlbum', shareId] as const,
};

/**
 * Invalidates, by prefix, the Trip Album and the recap photos section. A photo that just
 * became final (approved/rejected) changes both: the Album shows the owner's non-approved
 * photos with their status, and the recap highlights only list approved ones.
 */
export function invalidateTripPhotoQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: photoKeys.tripAlbumAll() }),
    queryClient.invalidateQueries({ queryKey: photoKeys.tripSummaryPhotosAll() }),
  ]).then(() => undefined);
}

/**
 * Invalidates, by prefix, every public gallery query family: the dish strip, the dish
 * gallery sheet, and the restaurant/location strip and sheet. Call it whenever a photo
 * becomes final (approved/rejected), after an upload is confirmed, and after a delete.
 */
export function invalidatePhotoGalleries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: photoKeys.dishAll() }),
    queryClient.invalidateQueries({ queryKey: photoKeys.dishInfiniteAll() }),
    queryClient.invalidateQueries({ queryKey: photoKeys.restaurantAll() }),
  ]).then(() => undefined);
}

/**
 * Invalidates every photo query: everything under `photoKeys.all` (which already includes
 * the dish strip) PLUS the two gallery families that live outside it (the infinite dish
 * sheet and the restaurant/location strip and sheet). Each query is invalidated exactly
 * once, so a mutation triggers one refetch per active query, not two.
 */
export function invalidateAllPhotoQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: photoKeys.all }),
    queryClient.invalidateQueries({ queryKey: photoKeys.dishInfiniteAll() }),
    queryClient.invalidateQueries({ queryKey: photoKeys.restaurantAll() }),
  ]).then(() => undefined);
}

// Module-level registry of photo IDs currently being uploaded on this device
const activeUploadIds = new Set<string>();

export function markUploadActive(photoId: string): void {
  activeUploadIds.add(photoId);
}

export function markUploadInactive(photoId: string): void {
  activeUploadIds.delete(photoId);
}

export function isUploadActive(photoId: string): boolean {
  return activeUploadIds.has(photoId);
}

/**
 * Translates error into user-facing copy per Requirement 5.11 and design.
 */
export function getUploadErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as { code?: string; details?: { reason?: string }; message?: string };
    if (err.code === 'photo_uploads_disabled') {
      if (err.details?.reason === 'global_cap') {
        return 'Photo uploads are full for today, try again tomorrow';
      }
      return 'Photo uploads are turned off right now';
    }
    if (err.code === 'photo_quota_exceeded') {
      return 'You have reached your daily upload limit';
    }
    if (err.code === 'photo_target_full') {
      return 'This item has reached its photo limit';
    }
    if (err.code === 'photo_uploads_banned') {
      return 'Photo uploads are disabled for this account';
    }
    if (err.message) {
      return err.message;
    }
  }
  return 'Photo upload failed. Please try again.';
}

// ---------------------------------------------------------------------------
// 1. Photo Config
// ---------------------------------------------------------------------------

export async function fetchPhotoConfig(): Promise<PhotoClientConfigDTO> {
  return apiRequest<PhotoClientConfigDTO>('GET', '/photos/config');
}

export function usePhotoConfig(enabled = true) {
  return useQuery({
    queryKey: photoKeys.config(),
    queryFn: fetchPhotoConfig,
    staleTime: PHOTO_STALE_TIME_MS,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 2. Upload Photos Pipeline
// ---------------------------------------------------------------------------

export interface UploadPhotoItemInput {
  readonly prepared: PreparedImages;
  readonly takenAt?: string;
}

export interface UploadPhotosInput {
  readonly target: UploadTarget;
  readonly items: readonly UploadPhotoItemInput[];
}

export interface UploadPhotosResult {
  readonly confirmResults: PhotoConfirmResponseDTO;
  readonly photoIds: readonly string[];
}

export async function uploadPhotos(input: UploadPhotosInput): Promise<UploadPhotosResult> {
  const { target, items } = input;
  if (items.length === 0) {
    return { confirmResults: { results: [] }, photoIds: [] };
  }

  // Step 1: Initiate
  const initiatePayload = buildInitiatePayload(items, target);
  const initiateRes = await apiRequest<PhotoInitiateResponseDTO>(
    'POST',
    '/photos/uploads',
    initiatePayload
  );

  const slots = initiateRes.slots;
  const photoIds = slots.map((s) => s.photoId);

  // Register active upload IDs
  for (const id of photoIds) {
    markUploadActive(id);
  }

  try {
    // Step 2: Direct-to-storage PUTs for full and thumb
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const item = items[i];
      if (!slot || !item) {
        continue;
      }
      const [fullPlan, thumbPlan] = buildPutPlans(item.prepared, slot);

      // PUT full object
      const fullRes = await fetch(fullPlan.url, {
        method: fullPlan.method,
        headers: fullPlan.headers,
        body: fullPlan.body,
      });
      if (!fullRes.ok) {
        throw new Error(`Failed to upload full photo: HTTP ${fullRes.status}`);
      }

      // PUT thumbnail object
      const thumbRes = await fetch(thumbPlan.url, {
        method: thumbPlan.method,
        headers: thumbPlan.headers,
        body: thumbPlan.body,
      });
      if (!thumbRes.ok) {
        throw new Error(`Failed to upload thumbnail: HTTP ${thumbRes.status}`);
      }
    }

    // Step 3: Confirm
    const confirmRes = await apiRequest<PhotoConfirmResponseDTO>(
      'POST',
      '/photos/confirm',
      { photoIds }
    );

    return {
      confirmResults: confirmRes,
      photoIds,
    };
  } finally {
    for (const id of photoIds) {
      markUploadInactive(id);
    }
  }
}

export function useUploadPhotos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadPhotos,
    onSuccess: () => {
      void invalidateAllPhotoQueries(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Batched Photo Status Polling Hook (usePhotoStatuses)
// ---------------------------------------------------------------------------

export async function fetchPhotoStatuses(ids: readonly string[]): Promise<MyPhotoStatusResponseDTO> {
  if (ids.length === 0) {
    return { photos: [] };
  }
  const queryParam = encodeURIComponent(ids.join(','));
  return apiRequest<MyPhotoStatusResponseDTO>('GET', `/me/photos/status?ids=${queryParam}`);
}

export interface UsePhotoStatusesOptions {
  /**
   * Called once per poll tick that moved photos to a final status, with just those ids,
   * after the shared photo caches (own photos, public galleries, Trip Album and recap
   * photos) were invalidated. Use it to refresh a query this module does not own, such as
   * the Trip feed. It is read through a ref, so passing an inline function never restarts
   * the poll.
   */
  readonly onFinal?: (finalizedIds: readonly string[]) => void;
}

export function usePhotoStatuses(
  photoIdsToPoll: readonly string[],
  options?: UsePhotoStatusesOptions
) {
  const [statuses, setStatuses] = useState<Record<string, MyPhotoDTO>>({});
  const [finalIds, setFinalIds] = useState<ReadonlySet<string>>(new Set());
  const tickIndexRef = useRef(0);
  const startTimeRef = useRef(Date.now());
  const queryClient = useQueryClient();

  // Stable identity per SET of ids: callers usually derive the list from query data, so a
  // fresh array arrives on every refetch/render. Keying the effects on a sorted, joined key
  // keeps the timer and tick counter from resetting (and the poll from restarting in a loop)
  // unless the set of pending photos really changed. Photo ids are UUIDs, never containing ','.
  const idsKey = [...photoIdsToPoll].sort().join(',');
  const allPhotoIds = useMemo<readonly string[]>(
    () => (idsKey === '' ? [] : idsKey.split(',')),
    [idsKey]
  );

  const onFinalRef = useRef(options?.onFinal);
  useEffect(() => {
    onFinalRef.current = options?.onFinal;
  });

  useEffect(() => {
    // Reset timer on new ID list
    startTimeRef.current = Date.now();
    tickIndexRef.current = 0;
  }, [allPhotoIds]);

  useEffect(() => {
    const pendingIds = filterPendingPhotoIds(allPhotoIds, finalIds);
    if (pendingIds.length === 0) {
      return;
    }

    let isMounted = true;
    let timer: NodeJS.Timeout | null = null;

    const poll = async () => {
      const currentPending = filterPendingPhotoIds(allPhotoIds, finalIds);
      if (currentPending.length === 0) {
        return;
      }

      const elapsed = Date.now() - startTimeRef.current;
      const batch = getBatchForTick(currentPending, tickIndexRef.current);
      tickIndexRef.current += 1;

      if (batch.length > 0) {
        try {
          const res = await fetchPhotoStatuses(batch);
          if (isMounted && res.photos) {
            setStatuses((prev) => {
              const updated = { ...prev };
              for (const p of res.photos) {
                updated[p.id] = p;
              }
              return updated;
            });

            // Track newly final photos
            const newFinals = new Set(finalIds);
            const finalizedIds: string[] = [];
            for (const p of res.photos) {
              if (isFinalPhotoStatus(p.status)) {
                newFinals.add(p.id);
                finalizedIds.push(p.id);
              }
            }
            if (finalizedIds.length > 0) {
              setFinalIds(newFinals);
              // Prefix keys: `photoKeys.my()` carries two empty-string segments and
              // would not prefix-match any real `['photos','my',kind,scope]` entry, and
              // likewise `photoKeys.dish('')` would not match a real dish. A photo that just
              // became final (approved/rejected) changes the public galleries too, so refresh
              // the dish and restaurant gallery families by prefix, plus the Trip Album and
              // the recap photos section.
              queryClient.invalidateQueries({ queryKey: photoKeys.myAll() });
              void invalidatePhotoGalleries(queryClient);
              void invalidateTripPhotoQueries(queryClient);
              onFinalRef.current?.(finalizedIds);
            }
          }
        } catch {
          // Retry on next tick
        }
      }

      const nextPending = filterPendingPhotoIds(allPhotoIds, finalIds);
      if (nextPending.length > 0 && isMounted) {
        const nextInterval = getPollInterval(elapsed);
        timer = setTimeout(poll, nextInterval);
      }
    };

    const initialInterval = getPollInterval(Date.now() - startTimeRef.current);
    timer = setTimeout(poll, initialInterval);

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [allPhotoIds, finalIds, queryClient]);

  const pendingCount = filterPendingPhotoIds(allPhotoIds, finalIds).length;

  return {
    statuses,
    isPending: pendingCount > 0,
    pendingCount,
  };
}

// ---------------------------------------------------------------------------
// 4. My Photos with Restart Recovery (useMyPhotos)
// ---------------------------------------------------------------------------

export interface MyPhotosQueryOptions {
  readonly targetKind: PhotoTargetKind;
  readonly scopeId: string;
  readonly cursor?: string | null;
}

export async function fetchMyPhotos(
  targetKind: PhotoTargetKind,
  scopeId: string,
  cursor?: string | null
): Promise<PhotoPageDTO<MyPhotoDTO>> {
  const params = new URLSearchParams({
    targetKind,
    scopeId,
  });
  if (cursor) {
    params.set('cursor', cursor);
  }
  return apiRequest<PhotoPageDTO<MyPhotoDTO>>('GET', `/me/photos?${params.toString()}`);
}

export function useMyPhotos(targetKind: PhotoTargetKind, scopeId: string) {
  const queryClient = useQueryClient();
  const [retryPhotoIds, setRetryPhotoIds] = useState<ReadonlySet<string>>(new Set());

  const query = useQuery({
    queryKey: photoKeys.my(targetKind, scopeId),
    queryFn: () => fetchMyPhotos(targetKind, scopeId),
    staleTime: PHOTO_STALE_TIME_MS,
  });

  // Restart recovery (Requirement 4.12):
  // When loading returns uploading photos for which no local upload is in progress,
  // call confirm for them.
  useEffect(() => {
    const photos = query.data?.items;
    if (!photos || photos.length === 0) {
      return;
    }

    const unconfirmedToRecover = photos
      .filter((p) => p.status === 'uploading' && !isUploadActive(p.id))
      .map((p) => p.id);

    if (unconfirmedToRecover.length === 0) {
      return;
    }

    // Attempt confirm recovery
    apiRequest<PhotoConfirmResponseDTO>('POST', '/photos/confirm', {
      photoIds: unconfirmedToRecover,
    })
      .then((res) => {
        const incompleteSet = new Set<string>();
        for (const item of res.results) {
          if (item.result === 'incomplete') {
            incompleteSet.add(item.photoId);
          }
        }
        if (incompleteSet.size > 0) {
          setRetryPhotoIds(incompleteSet);
        }
        queryClient.invalidateQueries({ queryKey: photoKeys.my(targetKind, scopeId) });
      })
      .catch(() => {
        // Leave unconfirmed for next cycle
      });
  }, [query.data?.items, queryClient, targetKind, scopeId]);

  return {
    ...query,
    retryPhotoIds,
  };
}

// ---------------------------------------------------------------------------
// 5. Dish Photos (useDishPhotos)
// ---------------------------------------------------------------------------

export async function fetchDishPhotos(
  foodItemId: string,
  cursor?: string | null
): Promise<PhotoPageDTO<FoodPhotoDTO>> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set('cursor', cursor);
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<PhotoPageDTO<FoodPhotoDTO>>('GET', `/food-items/${foodItemId}/photos${queryString}`);
}

export function useDishPhotos(foodItemId: string) {
  return useQuery({
    queryKey: photoKeys.dish(foodItemId),
    queryFn: () => fetchDishPhotos(foodItemId),
    enabled: Boolean(foodItemId),
    staleTime: PHOTO_GALLERY_STALE_TIME_MS,
  });
}

export function useDishPhotosInfinite(foodItemId: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery<
    PhotoPageDTO<FoodPhotoDTO>,
    Error,
    InfiniteData<PhotoPageDTO<FoodPhotoDTO>>,
    readonly [string, string],
    string | null
  >({
    queryKey: [DISH_PHOTOS_INFINITE_KEY, foodItemId] as const,
    queryFn: ({ pageParam }) => fetchDishPhotos(foodItemId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    enabled: Boolean(foodItemId) && (opts?.enabled ?? true),
    staleTime: PHOTO_GALLERY_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// 6. Restaurant Food Photos (useRestaurantFoodPhotos, Infinite Query)
// ---------------------------------------------------------------------------

export async function fetchRestaurantFoodPhotos(
  kindOrExperienceId: 'experience' | 'location' | string,
  idOrLimit?: string | number,
  limitOrCursor?: number | string | null,
  cursorParam?: string | null
): Promise<PhotoPageDTO<RestaurantFoodPhotoDTO>> {
  let endpointPrefix = 'experiences';
  let targetId = '';
  let limit: number | undefined;
  let cursor: string | null | undefined;

  if (kindOrExperienceId === 'experience' || kindOrExperienceId === 'location') {
    endpointPrefix = kindOrExperienceId === 'experience' ? 'experiences' : 'locations';
    targetId = typeof idOrLimit === 'string' ? idOrLimit : '';
    limit = typeof limitOrCursor === 'number' ? limitOrCursor : undefined;
    cursor = cursorParam;
  } else {
    endpointPrefix = 'experiences';
    targetId = kindOrExperienceId;
    limit = typeof idOrLimit === 'number' ? idOrLimit : undefined;
    cursor = typeof limitOrCursor === 'string' ? limitOrCursor : null;
  }

  const params = new URLSearchParams();
  if (limit) {
    params.set('limit', String(limit));
  }
  if (cursor) {
    params.set('cursor', cursor);
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<PhotoPageDTO<RestaurantFoodPhotoDTO>>(
    'GET',
    `/${endpointPrefix}/${targetId}/food-photos${queryString}`
  );
}

export function useRestaurantFoodPhotos(
  kindOrExperienceId: 'experience' | 'location' | string,
  idOrLimit?: string | number,
  opts?: { limit?: number; enabled?: boolean }
) {
  let kind: 'experience' | 'location' = 'experience';
  let id = '';
  let limit: number | undefined;
  let enabled = true;

  if (kindOrExperienceId === 'experience' || kindOrExperienceId === 'location') {
    kind = kindOrExperienceId;
    id = typeof idOrLimit === 'string' ? idOrLimit : '';
    limit = opts?.limit;
    enabled = opts?.enabled ?? Boolean(id);
  } else {
    kind = 'experience';
    id = kindOrExperienceId;
    limit = typeof idOrLimit === 'number' ? idOrLimit : undefined;
    enabled = Boolean(id);
  }

  return useInfiniteQuery<
    PhotoPageDTO<RestaurantFoodPhotoDTO>,
    Error,
    InfiniteData<PhotoPageDTO<RestaurantFoodPhotoDTO>>,
    readonly [string, string, string, string | number],
    string | null
  >({
    queryKey: [RESTAURANT_PHOTOS_KEY, kind, id, limit ?? 'default'] as const,
    queryFn: ({ pageParam }) => fetchRestaurantFoodPhotos(kind, id, limit, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    enabled: Boolean(id) && enabled,
    staleTime: PHOTO_GALLERY_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// 7. Delete Photo (useDeletePhoto)
// ---------------------------------------------------------------------------

export async function deletePhoto(photoId: string): Promise<void> {
  await apiRequest<void>('DELETE', `/photos/${photoId}`);
}

export function useDeletePhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      void invalidateAllPhotoQueries(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// 8. Report Photo (useReportPhoto)
// ---------------------------------------------------------------------------

export interface ReportPhotoInput {
  readonly photoId: string;
  readonly reason: PhotoReportReason;
  readonly note?: string;
  readonly shareId?: string;
}

export async function reportPhoto(input: ReportPhotoInput): Promise<void> {
  const { photoId, reason, note, shareId } = input;
  await apiRequest<void>('POST', `/photos/${photoId}/report`, {
    reason,
    ...(note ? { note } : {}),
    ...(shareId ? { shareId } : {}),
  });
}

export function useReportPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reportPhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photoKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// 9. Blocks (useBlocks, useAddBlock, useRemoveBlock)
// ---------------------------------------------------------------------------

export async function fetchBlocks(): Promise<readonly BlockedUserDTO[]> {
  const res = await apiRequest<{ blocks: readonly BlockedUserDTO[] }>('GET', '/me/blocks');
  return res.blocks;
}

export function useBlocks() {
  return useQuery({
    queryKey: photoKeys.blocks(),
    queryFn: fetchBlocks,
    staleTime: PHOTO_STALE_TIME_MS,
  });
}

export type AddBlockInput =
  | { readonly userId: string; readonly photoId?: never }
  | { readonly photoId: string; readonly userId?: never; readonly shareId?: string };

export async function addBlock(input: AddBlockInput): Promise<BlockedUserDTO> {
  return apiRequest<BlockedUserDTO>('POST', '/me/blocks', input);
}

export function useAddBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addBlock,
    onSuccess: () => {
      void invalidateAllPhotoQueries(queryClient);
    },
  });
}

export async function removeBlock(blockId: string): Promise<void> {
  await apiRequest<void>('DELETE', `/me/blocks/${blockId}`);
}

export function useRemoveBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeBlock,
    onSuccess: () => {
      void invalidateAllPhotoQueries(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// 10. Trip Album & Highlights (useTripAlbum, useTripSummaryPhotos)
// ---------------------------------------------------------------------------

export async function fetchTripPhotos(
  tripId: string,
  cursor?: string | null,
  limit?: number
): Promise<PhotoPageDTO<TripPhotoDTO>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<PhotoPageDTO<TripPhotoDTO>>('GET', `/trips/${tripId}/photos${queryString}`);
}

export function useTripAlbum(tripId: string, limit?: number) {
  return useInfiniteQuery<
    PhotoPageDTO<TripPhotoDTO>,
    Error,
    InfiniteData<PhotoPageDTO<TripPhotoDTO>>,
    readonly [string, string, string, number | undefined],
    string | null
  >({
    queryKey: [...photoKeys.tripAlbum(tripId), limit] as const,
    queryFn: ({ pageParam }) => fetchTripPhotos(tripId, pageParam, limit),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    enabled: Boolean(tripId),
    staleTime: PHOTO_STALE_TIME_MS,
  });
}

export async function fetchTripSummaryPhotos(
  tripId: string
): Promise<readonly SharedSummaryPhotoDTO[]> {
  const res = await apiRequest<PhotoPageDTO<SharedSummaryPhotoDTO>>(
    'GET',
    `/trips/${tripId}/photos?summary=true`
  );
  return res?.items ?? [];
}

export function useTripSummaryPhotos(tripId: string, enabled = true) {
  return useQuery({
    queryKey: photoKeys.tripSummaryPhotos(tripId),
    queryFn: () => fetchTripSummaryPhotos(tripId),
    enabled: Boolean(tripId) && enabled,
    staleTime: PHOTO_STALE_TIME_MS,
  });
}

// ---------------------------------------------------------------------------
// 11. Recipient Recap Album (useRecapAlbum, photo-uploads D35, Requirements 15.25 to 15.33)
// ---------------------------------------------------------------------------

/** One page of `GET /me/inbox/:shareId/trip-recap/photos`; the server default limit (40) applies. */
export async function fetchRecapAlbum(
  shareId: string,
  cursor?: string | null
): Promise<TripRecapPhotosDTO> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<TripRecapPhotosDTO>(
    'GET',
    `/me/inbox/${encodeURIComponent(shareId)}/trip-recap/photos${queryString}`
  );
}

export function useRecapAlbum(shareId: string) {
  return useInfiniteQuery<
    TripRecapPhotosDTO,
    Error,
    InfiniteData<TripRecapPhotosDTO>,
    readonly [string, string, string],
    string | null
  >({
    queryKey: photoKeys.recapAlbum(shareId),
    queryFn: ({ pageParam }) => fetchRecapAlbum(shareId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    enabled: Boolean(shareId),
    staleTime: PHOTO_STALE_TIME_MS,
    retry: false,
  });
}

