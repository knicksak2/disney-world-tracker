/**
 * Unit tests for `useOwnCompletionsQuery` (task 6.2).
 *
 * Validates: Requirements 12.7, 12.8
 *
 * The hook resolves the requesting User's own id from the cached `['me']`
 * query (`GET /me`, issued through `apiRequest`) and then reads that User's
 * own Completions through the owner path of the existing Tracking_Service
 * completions endpoint via the `fetchFriendCompletions(ownUserId)` helper,
 * keyed `['own-completions', ownUserId]` (R12.7, R12.8).
 *
 * Mocking strategy mirrors the convention in
 * `screens/friends/__tests__/FriendProfileScreen.test.tsx`:
 *   - `apiRequest` (the lowest-level network call) is mocked so the `['me']`
 *     read resolves deterministically; the real `ApiError` is preserved so
 *     the failure assertion checks the genuine `code`.
 *   - `fetchFriendCompletions` is mocked so the test can observe the exact
 *     `userId` the hook passes and control its resolved / rejected value
 *     without exercising the real 30-second-timeout wrapper.
 *
 * The test `QueryClient` uses `retryDelay: 0` so the hook's single automatic
 * retry settles without a real-time wait.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { FriendCompletionsDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`: the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve even though `apiRequest` is
// mocked and never reads a token here.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL. Never read at runtime here
// (the network call is mocked) but provided so any defensive codepath in
// the real client module does not throw on import.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` so the failure
// assertion checks the genuine error class and `code`.
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// Mock the friend-profile data layer so the completions read is a spyable
// `jest.fn` whose argument and behavior the test fully controls.
jest.mock('../../api/friendProfile', () => ({
  __esModule: true,
  fetchFriendCompletions: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import { ApiError, apiRequest as mockedApiRequest } from '../../api/client';
import { fetchFriendCompletions as mockedFetchCompletions } from '../../api/friendProfile';
import { ownCompletionsKeys, useOwnCompletionsQuery } from '../useOwnCompletions';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;
const fetchCompletionsMock = mockedFetchCompletions as jest.MockedFunction<
  typeof mockedFetchCompletions
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

const OWN_COMPLETIONS: FriendCompletionsDTO = {
  entries: [
    {
      experienceId: '11111111-1111-1111-1111-111111111111',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      areaType: 'ThemePark',
      category: 'Ride',
      completedOn: '2024-01-05',
      rating: 9,
      sharedNote: null,
    },
  ],
};

/**
 * Resolve `GET /me` with the fixture identity; reject any other path so a
 * stray call is caught loudly rather than silently resolving `undefined`.
 */
function meOnlyApiRequest(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (path === '/me') {
      return ME_RESPONSE as unknown;
    }
    throw new Error(`unexpected apiRequest path: ${String(path)}`);
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function createClient(): QueryClient {
  // The hook sets its own `retry` for the completions query; `retryDelay: 0`
  // keeps that single retry from introducing a real-time wait. `gcTime: 0`
  // avoids leaving cached entries between tests.
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderOwnCompletions(client: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOwnCompletionsQuery(), { wrapper });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useOwnCompletionsQuery (R12.7, R12.8)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('resolves ownUserId from [me], reads completions with that id, and keys the query as [own-completions, ownUserId]', async () => {
    meOnlyApiRequest();
    fetchCompletionsMock.mockResolvedValue(OWN_COMPLETIONS);

    const client = createClient();
    const { result } = renderOwnCompletions(client);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // ownUserId is resolved from the cached `['me']` read.
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me');

    // The completions read goes through the owner path with that exact id.
    expect(fetchCompletionsMock).toHaveBeenCalledTimes(1);
    expect(fetchCompletionsMock).toHaveBeenCalledWith(OWN_USER_ID);

    // The query is keyed `['own-completions', ownUserId]` — verified both
    // through the key factory and through the populated cache entry.
    expect(ownCompletionsKeys.completions(OWN_USER_ID)).toEqual([
      'own-completions',
      OWN_USER_ID,
    ]);
    expect(client.getQueryData(['own-completions', OWN_USER_ID])).toEqual(
      OWN_COMPLETIONS,
    );

    // The hook surfaces the completions payload to the screen.
    expect(result.current.data).toEqual(OWN_COMPLETIONS);
  });

  test('does not issue the completions read until ownUserId resolves', async () => {
    // `GET /me` never settles, so `ownUserId` stays undefined and the
    // completions query remains disabled (R12.7: own-completions keyed by
    // the resolved id, fetched only once that id is known).
    apiRequestMock.mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    const client = createClient();
    const { result } = renderOwnCompletions(client);

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(fetchCompletionsMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  test('surfaces a completions failure as a non-forbidden ApiError', async () => {
    meOnlyApiRequest();
    // The owner path never yields `profile_forbidden`; a failure here is a
    // transient/internal error that flows through the standard error+retry
    // path (R12.8).
    const transient = new ApiError({
      code: 'internal_error',
      message: 'The request took too long to complete. Please try again.',
      status: 0,
    });
    fetchCompletionsMock.mockRejectedValue(transient);

    const client = createClient();
    const { result } = renderOwnCompletions(client);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.code).toBe('internal_error');
    expect(result.current.error?.code).not.toBe('profile_forbidden');
    expect(result.current.data).toBeUndefined();
  });
});
