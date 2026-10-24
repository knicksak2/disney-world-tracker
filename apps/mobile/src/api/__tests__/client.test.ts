/**
 * Unit tests for the API client (`apps/mobile/src/api/client.ts`).
 *
 * Validates:
 *   - R6.10: 401 with session invalidation (`unauthorized`) clears session token and notifies unauthorized callback.
 *   - Bug fix (ChangePasswordControl 401 defect): 401 with credential failure (`invalid_credentials`) throws ApiError
 *     WITHOUT clearing session token and WITHOUT notifying unauthorized callback.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'https://api.test.example' } },
  },
}));

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, val: string) => {
    mockSecureStore.set(key, val);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

import {
  ApiError,
  apiFetchText,
  apiRequest,
  setOnUnauthorizedCallback,
} from '../client';
import { SESSION_TOKEN_KEY } from '../sessionStorage';

describe('API client (client.ts)', () => {
  const originalFetch = global.fetch;
  const onUnauthorizedMock = jest.fn();

  beforeEach(() => {
    mockSecureStore.clear();
    onUnauthorizedMock.mockReset();
    setOnUnauthorizedCallback(onUnauthorizedMock);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setOnUnauthorizedCallback(null);
  });

  describe('apiRequest', () => {
    it('returns parsed JSON on 200 OK', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'valid-session-token');

      global.fetch = jest.fn(async (url, init) => {
        expect(url).toBe('https://api.test.example/test-endpoint');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer valid-session-token');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ message: 'hello' }),
          json: async () => ({ message: 'hello' }),
        } as unknown as Response;
      });

      const data = await apiRequest<{ message: string }>('GET', '/test-endpoint');
      expect(data).toEqual({ message: 'hello' });
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBe('valid-session-token');
    });

    it('returns null on 204 No Content', async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 204,
        text: async () => '',
      } as unknown as Response));

      const data = await apiRequest('POST', '/auth/logout');
      expect(data).toBeNull();
    });

    it('clears session token and notifies callback on 401 with code "unauthorized"', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'expired-token');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'unauthorized',
            message: 'Authentication required.',
          },
        }),
      } as unknown as Response));

      await expect(apiRequest('GET', '/me')).rejects.toThrow(ApiError);
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBeUndefined();
      expect(onUnauthorizedMock).toHaveBeenCalledTimes(1);
    });

    it('clears session token and notifies callback on 401 with fallback internal_error', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'expired-token');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error('Not JSON');
        },
      } as unknown as Response));

      await expect(apiRequest('GET', '/me')).rejects.toThrow(ApiError);
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBeUndefined();
      expect(onUnauthorizedMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT clear session token and does NOT notify callback on 401 with code "invalid_credentials"', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'active-session-token');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'invalid_credentials',
            message: 'Current password is incorrect.',
          },
        }),
      } as unknown as Response));

      let caughtError: unknown;
      try {
        await apiRequest('POST', '/auth/change-password', {
          currentPassword: 'wrong-password',
          newPassword: 'new-valid-password-123',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiError);
      const apiErr = caughtError as ApiError;
      expect(apiErr.code).toBe('invalid_credentials');
      expect(apiErr.status).toBe(401);
      expect(apiErr.message).toBe('Current password is incorrect.');

      // Active session must be preserved!
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBe('active-session-token');
      // Unauthorized logout callback must NOT be triggered!
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });

    it('does NOT clear session token or notify callback on 400 validation_failed', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'active-session-token');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'validation_failed',
            message: 'Password must be 8 to 128 characters.',
            field: 'newPassword',
          },
        }),
      } as unknown as Response));

      await expect(
        apiRequest('POST', '/auth/change-password', {
          currentPassword: 'current-pass-1',
          newPassword: 'short',
        }),
      ).rejects.toThrow(ApiError);

      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBe('active-session-token');
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });
  });

  describe('apiFetchText', () => {
    it('returns raw text on 200 OK', async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => 'csv,header,row\n1,2,3',
      } as unknown as Response));

      const text = await apiFetchText('/export/csv');
      expect(text).toBe('csv,header,row\n1,2,3');
    });

    it('clears session token on 401 unauthorized in apiFetchText', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'token-123');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'unauthorized',
            message: 'Authentication required.',
          },
        }),
      } as unknown as Response));

      await expect(apiFetchText('/protected-text')).rejects.toThrow(ApiError);
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBeUndefined();
      expect(onUnauthorizedMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT clear session token on 401 invalid_credentials in apiFetchText', async () => {
      mockSecureStore.set(SESSION_TOKEN_KEY, 'token-123');

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'invalid_credentials',
            message: 'Invalid credentials.',
          },
        }),
      } as unknown as Response));

      await expect(apiFetchText('/protected-text')).rejects.toThrow(ApiError);
      expect(mockSecureStore.get(SESSION_TOKEN_KEY)).toBe('token-123');
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });
  });
});

