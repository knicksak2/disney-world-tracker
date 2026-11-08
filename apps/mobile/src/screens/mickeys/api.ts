import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MickeyClientConfigDTO,
  MickeyDetailDTO,
  MickeyListPageDTO,
  MickeySummaryDTO,
  MickeySubmissionDTO,
  FriendMickeyFindsPageDTO,
  TripMickeysDTO,
  MickeyZone,
  MickeyDifficulty,
  MickeyReportReason,
  Park,
} from '@dwt/shared';
import { apiRequest } from '../../api/client';

export const MICKEY_STALE_TIME_MS = 60_000;

export const mickeyKeys = {
  all: ['mickeys'] as const,
  config: () => [...mickeyKeys.all, 'config'] as const,
  summary: (forUser?: string) => [...mickeyKeys.all, 'summary', forUser ?? 'me'] as const,
  list: (filters: Record<string, unknown>) => [...mickeyKeys.all, 'list', filters] as const,
  detail: (id: string) => [...mickeyKeys.all, 'detail', id] as const,
  mySubmissions: () => [...mickeyKeys.all, 'mySubmissions'] as const,
  friendFinds: (userId: string) => [...mickeyKeys.all, 'friendFinds', userId] as const,
};

// ---------------------------------------------------------------------------
// 1. Config
// ---------------------------------------------------------------------------

export async function fetchMickeyConfig(): Promise<MickeyClientConfigDTO> {
  return apiRequest<MickeyClientConfigDTO>('GET', '/mickeys/config');
}

export function useMickeyConfig(enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.config(),
    queryFn: fetchMickeyConfig,
    staleTime: 5 * 60_000,
    retryOnMount: false,
    refetchOnMount: false,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 2. Summary
// ---------------------------------------------------------------------------

export async function fetchMickeySummary(forUser?: string): Promise<MickeySummaryDTO> {
  const query = forUser ? `?for=${encodeURIComponent(forUser)}` : '';
  return apiRequest<MickeySummaryDTO>('GET', `/mickeys/summary${query}`);
}

export function useMickeySummary(forUser?: string, enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.summary(forUser),
    queryFn: () => fetchMickeySummary(forUser),
    staleTime: MICKEY_STALE_TIME_MS,
    retryOnMount: false,
    refetchOnMount: false,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 3. List
// ---------------------------------------------------------------------------

export interface MickeyListFilters {
  readonly experienceId?: string | undefined;
  readonly park?: Park | undefined;
  readonly areaType?: 'ThemePark' | 'WaterPark' | 'DisneySprings' | 'Resort' | undefined;
  readonly zone?: MickeyZone | undefined;
  readonly difficulty?: MickeyDifficulty | undefined;
  readonly found?: 'all' | 'found' | 'unfound' | undefined;
  readonly scope?: 'all' | 'official' | 'community' | undefined;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export async function fetchMickeyList(filters: MickeyListFilters): Promise<MickeyListPageDTO> {
  const buildQuery = (cursorOverride?: string): string => {
    const params = new URLSearchParams();
    if (filters.experienceId) params.set('experienceId', filters.experienceId);
    if (filters.park) params.set('park', filters.park);
    if (filters.areaType) params.set('areaType', filters.areaType);
    if (filters.zone) params.set('zone', filters.zone);
    if (filters.difficulty) params.set('difficulty', filters.difficulty);
    if (filters.found && filters.found !== 'all') params.set('found', filters.found);
    if (filters.scope && filters.scope !== 'all') params.set('scope', filters.scope);
    if (filters.q && filters.q.trim().length >= 2) params.set('q', filters.q.trim());
    const activeCursor = cursorOverride ?? filters.cursor;
    if (activeCursor) params.set('cursor', activeCursor);
    if (filters.limit) params.set('limit', String(filters.limit));

    return params.toString() ? `?${params.toString()}` : '';
  };

  const firstPage = await apiRequest<MickeyListPageDTO>('GET', `/mickeys${buildQuery()}`);
  if (filters.cursor || !firstPage?.nextCursor) {
    return firstPage;
  }

  const allItems = [...firstPage.items];
  const seenIds = new Set(firstPage.items.map((item) => item.id));
  let nextCursor: string | null = firstPage.nextCursor;
  let pageCount = 1;

  while (nextCursor && pageCount < 20) {
    const nextPage: MickeyListPageDTO = await apiRequest<MickeyListPageDTO>(
      'GET',
      `/mickeys${buildQuery(nextCursor)}`,
    );
    pageCount += 1;
    if (!nextPage?.items?.length) {
      nextCursor = null;
      break;
    }
    for (const item of nextPage.items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
      }
    }
    nextCursor = nextPage.nextCursor ?? null;
  }

  return {
    items: allItems,
    nextCursor,
  };
}

export function useMickeyList(filters: MickeyListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.list(filters as Record<string, unknown>),
    queryFn: () => fetchMickeyList(filters),
    staleTime: MICKEY_STALE_TIME_MS,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 4. Detail
// ---------------------------------------------------------------------------

export async function fetchMickeyDetail(id: string): Promise<MickeyDetailDTO> {
  return apiRequest<MickeyDetailDTO>('GET', `/mickeys/${encodeURIComponent(id)}`);
}

export function useMickeyDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.detail(id),
    queryFn: () => fetchMickeyDetail(id),
    staleTime: MICKEY_STALE_TIME_MS,
    enabled: enabled && Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// 5. Hint Mutation
// ---------------------------------------------------------------------------

export interface MickeyHintInput {
  readonly mickeyId: string;
  readonly level: 2 | 3;
}

export function useMickeyHint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mickeyId, level }: MickeyHintInput) => {
      return apiRequest<{ mickeyId: string; hintLevel: number }>(
        'POST',
        `/me/mickeys/${encodeURIComponent(mickeyId)}/hint`,
        { level },
      );
    },
    onSuccess: (_, { mickeyId }) => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.detail(mickeyId) });
    },
  });
}

// ---------------------------------------------------------------------------
// 6. Find Mutation (Optimistic update and rollback)
// ---------------------------------------------------------------------------

export interface MickeyFindInput {
  readonly mickeyId: string;
  readonly tripId?: string | undefined;
}

export function useMickeyFind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mickeyId, tripId }: MickeyFindInput) => {
      return apiRequest<{
        mickeyId: string;
        hintLevel: number;
        foundAt: string;
        foundOn: string;
        tripId: string | null;
      }>('POST', `/me/mickeys/${encodeURIComponent(mickeyId)}/find`, { tripId });
    },
    onMutate: async ({ mickeyId, tripId }) => {
      await queryClient.cancelQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      const previousDetail = queryClient.getQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId));
      if (previousDetail) {
        queryClient.setQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId), {
          ...previousDetail,
          found: true,
          tripId: tripId ?? null,
        });
      }
      return { previousDetail };
    },
    onError: (_, { mickeyId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(mickeyKeys.detail(mickeyId), context.previousDetail);
      }
    },
    onSettled: (_, __, { mickeyId }) => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.summary() });
      void queryClient.invalidateQueries({ queryKey: [...mickeyKeys.all, 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 7. Undo Find Mutation (Optimistic update and rollback)
// ---------------------------------------------------------------------------

export function useMickeyUndoFind() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mickeyId }: { mickeyId: string }) => {
      return apiRequest<void>('DELETE', `/me/mickeys/${encodeURIComponent(mickeyId)}/find`);
    },
    onMutate: async ({ mickeyId }) => {
      await queryClient.cancelQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      const previousDetail = queryClient.getQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId));
      if (previousDetail) {
        queryClient.setQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId), {
          ...previousDetail,
          found: false,
          tripId: null,
        });
      }
      return { previousDetail };
    },
    onError: (_, { mickeyId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(mickeyKeys.detail(mickeyId), context.previousDetail);
      }
    },
    onSettled: (_, __, { mickeyId }) => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.summary() });
      void queryClient.invalidateQueries({ queryKey: [...mickeyKeys.all, 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 8. Vote Mutation
// ---------------------------------------------------------------------------

export interface MickeyVoteInput {
  readonly mickeyId: string;
  readonly vote: 'there' | 'gone';
}

export function useMickeyVote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mickeyId, vote }: MickeyVoteInput) => {
      return apiRequest<{ mickeyId: string; vote: 'there' | 'gone' }>(
        'PUT',
        `/me/mickeys/${encodeURIComponent(mickeyId)}/vote`,
        { vote },
      );
    },
    onMutate: async ({ mickeyId, vote }) => {
      await queryClient.cancelQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      const previousDetail = queryClient.getQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId));
      if (previousDetail) {
        queryClient.setQueryData<MickeyDetailDTO>(mickeyKeys.detail(mickeyId), {
          ...previousDetail,
          userVote: vote,
        });
      }
      return { previousDetail };
    },
    onError: (_, { mickeyId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(mickeyKeys.detail(mickeyId), context.previousDetail);
      }
    },
    onSuccess: (_, { mickeyId }) => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.summary() });
      void queryClient.invalidateQueries({ queryKey: [...mickeyKeys.all, 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 9. Report Mutation
// ---------------------------------------------------------------------------

export interface MickeyReportInput {
  readonly mickeyId: string;
  readonly reason: MickeyReportReason;
  readonly note?: string | undefined;
}

export function useMickeyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mickeyId, reason, note }: MickeyReportInput) => {
      return apiRequest<{ mickeyId: string; reported: boolean }>(
        'POST',
        `/mickeys/${encodeURIComponent(mickeyId)}/report`,
        { reason, note },
      );
    },
    onSuccess: (_, { mickeyId }) => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.detail(mickeyId) });
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.summary() });
      void queryClient.invalidateQueries({ queryKey: [...mickeyKeys.all, 'list'] });
    },
  });
}

// ---------------------------------------------------------------------------
// 10. Submit Mickey Mutation
// ---------------------------------------------------------------------------

export interface SubmitMickeyInput {
  readonly experienceId: string;
  readonly zone: MickeyZone;
  readonly difficulty: MickeyDifficulty;
  readonly clue1: string;
  readonly clue2: string;
  readonly reveal: string;
}

export function useSubmitMickey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitMickeyInput) => {
      return apiRequest<MickeySubmissionDTO>('POST', '/me/mickeys/submissions', input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.mySubmissions() });
      void queryClient.invalidateQueries({ queryKey: [...mickeyKeys.all, 'list'] });
      void queryClient.invalidateQueries({ queryKey: mickeyKeys.summary() });
    },
  });
}

// ---------------------------------------------------------------------------
// 11. My Submissions
// ---------------------------------------------------------------------------

export async function fetchMySubmissions(): Promise<readonly MickeySubmissionDTO[]> {
  return apiRequest<readonly MickeySubmissionDTO[]>('GET', '/me/mickeys/submissions');
}

export function useMySubmissions(enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.mySubmissions(),
    queryFn: fetchMySubmissions,
    staleTime: MICKEY_STALE_TIME_MS,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 12. Friend Mickey Finds
// ---------------------------------------------------------------------------

export async function fetchFriendMickeyFinds(userId: string): Promise<FriendMickeyFindsPageDTO> {
  return apiRequest<FriendMickeyFindsPageDTO>(
    'GET',
    `/users/${encodeURIComponent(userId)}/mickeys/finds`,
  );
}

export function useFriendMickeyFinds(userId: string, enabled = true) {
  return useQuery({
    queryKey: mickeyKeys.friendFinds(userId),
    queryFn: () => fetchFriendMickeyFinds(userId),
    staleTime: MICKEY_STALE_TIME_MS,
    retryOnMount: false,
    refetchOnMount: false,
    enabled: enabled && Boolean(userId),
  });
}

// ---------------------------------------------------------------------------
// 13. Trip Mickeys Tally
// ---------------------------------------------------------------------------

export async function fetchTripMickeys(tripId: string): Promise<TripMickeysDTO> {
  return apiRequest<TripMickeysDTO>(
    'GET',
    `/trips/${encodeURIComponent(tripId)}/mickeys`,
  );
}

export function useTripMickeys(tripId: string, enabled = true) {
  return useQuery({
    queryKey: [...mickeyKeys.all, 'trip', tripId] as const,
    queryFn: () => fetchTripMickeys(tripId),
    staleTime: MICKEY_STALE_TIME_MS,
    enabled: enabled && Boolean(tripId),
  });
}
