/**
 * Unit tests for the Friend_Profile_View data-layer helpers (task 7.1).
 *
 * Validates: Requirements 5.5
 *
 * `apiRequest` is mocked so each test controls the resolved/rejected
 * value and can observe the arguments the helpers pass (method, path,
 * and the `AbortSignal`). The timeout tests use Jest fake timers to
 * advance the 30-second deadline deterministically; the mock honors the
 * forwarded signal by rejecting with an `AbortError` on abort, mirroring
 * how the real `fetch` behaves so the helper's abort-detection branch is
 * exercised end-to-end.
 */

// `expo-constants` supplies the API base URL via `Constants.expoConfig.extra`.
// `apiRequest` is mocked here so the value is never read, but a defensive
// codepath could still resolve it — provide a fake so nothing throws.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'https://api.test.example' } },
  },
}));

// Mock the API client: `apiRequest` is a `jest.fn` so each test supplies
// its own behavior. `ApiError` and everything else is preserved from the
// real module so the helper's synthetic timeout error is a real `ApiError`.
jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import type { FriendCompletionsDTO, ProfileDTO } from '@dwt/shared';

import { ApiError, apiRequest as mockedApiRequest } from './client';
import {
  FRIEND_PROFILE_TIMEOUT_MS,
  fetchFriendCompletions,
  fetchFriendProfile,
  fetchFriendStats,
  type FriendStatsResponse,
} from './friendProfile';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const FRIEND_ID = '11111111-1111-4111-8111-111111111111';

const SAMPLE_PROFILE: ProfileDTO = {
  userId: FRIEND_ID,
  displayName: 'Minnie',
  avatarUrl: null,
  overallCompletionPercent: 42.5,
};

const SAMPLE_COMPLETIONS: FriendCompletionsDTO = { entries: [] };

beforeEach(() => {
  apiRequestMock.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('friend profile helpers — paths and pass-through (R5.5)', () => {
  test('fetchFriendProfile issues GET against the friend profile path', async () => {
    apiRequestMock.mockResolvedValue(SAMPLE_PROFILE);

    const result = await fetchFriendProfile(FRIEND_ID);

    expect(result).toEqual(SAMPLE_PROFILE);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    const [method, path, body, signal] = apiRequestMock.mock.calls[0]!;
    expect(method).toBe('GET');
    expect(path).toBe(`/users/${FRIEND_ID}/profile`);
    expect(body).toBeUndefined();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('fetchFriendStats targets the summary endpoint with the for= query', async () => {
    const stats = { overall: { completed: 0, total: 0, percent: 0 } } as
      unknown as FriendStatsResponse;
    apiRequestMock.mockResolvedValue(stats);

    await fetchFriendStats(FRIEND_ID);

    const [method, path] = apiRequestMock.mock.calls[0]!;
    expect(method).toBe('GET');
    expect(path).toBe(`/me/stats/summary?for=${FRIEND_ID}`);
  });

  test('fetchFriendCompletions issues GET against the completions path', async () => {
    apiRequestMock.mockResolvedValue(SAMPLE_COMPLETIONS);

    const result = await fetchFriendCompletions(FRIEND_ID);

    expect(result).toEqual(SAMPLE_COMPLETIONS);
    const [, path] = apiRequestMock.mock.calls[0]!;
    expect(path).toBe(`/users/${FRIEND_ID}/completions`);
  });

  test('a profile_forbidden error propagates unchanged (not converted)', async () => {
    const forbidden = new ApiError({
      code: 'profile_forbidden',
      message: 'You may not view this profile.',
      status: 403,
    });
    apiRequestMock.mockRejectedValue(forbidden);

    await expect(fetchFriendProfile(FRIEND_ID)).rejects.toBe(forbidden);
  });
});

describe('friend profile helpers — 30s timeout (R5.5)', () => {
  test('an in-flight request that exceeds the deadline rejects with a non-profile_forbidden ApiError', async () => {
    jest.useFakeTimers();

    // Honor the forwarded signal the way `fetch` does: reject on abort.
    apiRequestMock.mockImplementation(
      (_method, _path, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const promise = fetchFriendProfile(FRIEND_ID);
    // Attach a rejection handler before advancing timers so the rejection
    // is observed and never becomes an unhandled rejection.
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'internal_error',
    });

    // Advance to the deadline — the controller aborts and the helper
    // converts the AbortError into its synthetic ApiError.
    jest.advanceTimersByTime(FRIEND_PROFILE_TIMEOUT_MS);

    await assertion;
  });

  test('the synthetic timeout error is never profile_forbidden so it flows through the retry path', async () => {
    jest.useFakeTimers();

    apiRequestMock.mockImplementation(
      (_method, _path, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const promise = fetchFriendCompletions(FRIEND_ID);
    const captured = promise.catch((err: unknown) => err);

    jest.advanceTimersByTime(FRIEND_PROFILE_TIMEOUT_MS);

    const error = await captured;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).not.toBe('profile_forbidden');
  });

  test('a request that resolves before the deadline does not throw a timeout', async () => {
    jest.useFakeTimers();
    apiRequestMock.mockResolvedValue(SAMPLE_PROFILE);

    const result = await fetchFriendProfile(FRIEND_ID);
    expect(result).toEqual(SAMPLE_PROFILE);

    // Advancing past the deadline after completion must not surface any
    // late error — the timer was cleared in `finally`.
    expect(() => {
      jest.advanceTimersByTime(FRIEND_PROFILE_TIMEOUT_MS * 2);
    }).not.toThrow();
  });
});
