/**
 * API client and unauthorized-callback registry.
 *
 * Two responsibilities live here:
 *
 *   1. `apiRequest()` — a thin `fetch` wrapper that:
 *        • resolves the base URL from `app.config.ts` via `expo-constants`
 *        • attaches `Authorization: Bearer <token>` from secure storage
 *        • parses the uniform error envelope into a typed `ApiError`
 *        • on 401, clears the persisted session token and notifies
 *          listeners so the navigator can flip back to the auth stack
 *          (R6.10).
 *
 *   2. The unauthorized-callback registry — the navigator subscribes
 *      via `setOnUnauthorizedCallback` so that any layer of the app
 *      that observes a 401 (including `apiRequest` itself) can call
 *      `notifyUnauthorized()` and trigger the auth-stack reset.
 *
 * The registry is intentionally module-local so the client does not
 * have to know who triggered the 401 — every registered listener
 * fires.
 */

import Constants from 'expo-constants';

import type {
  AvatarPresetId,
  ErrorCode,
  ErrorEnvelope,
  ProfileDTO,
} from '@dwt/shared';

import { clearSessionToken, getSessionToken } from './sessionStorage';

// ---------------------------------------------------------------------------
// Unauthorized callback registry
// ---------------------------------------------------------------------------

export type UnauthorizedCallback = () => void;

let onUnauthorized: UnauthorizedCallback | null = null;

/**
 * Register a callback that runs when the API client observes a 401
 * response. Replaces any previously registered callback. Pass `null`
 * to clear.
 *
 * Per R6.10, the navigator uses this to clear the session token and
 * route back to the auth stack as soon as the server reports the
 * token is no longer valid.
 */
export function setOnUnauthorizedCallback(
  callback: UnauthorizedCallback | null,
): void {
  onUnauthorized = callback;
}

/**
 * Invoke the currently registered unauthorized callback, if any. Used
 * by the API client when it sees a 401 response.
 */
export function notifyUnauthorized(): void {
  if (onUnauthorized !== null) {
    onUnauthorized();
  }
}

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/**
 * Typed view over the backend's uniform error envelope. Thrown by
 * `apiRequest` for any non-2xx response so callers can branch on
 * `error.code` (which is the closed `ErrorCode` union from
 * `@dwt/shared`) rather than reading status numbers.
 *
 * `field` is populated for `validation_failed` envelopes that
 * pinpoint a specific input (e.g. `email`, `displayName`,
 * `password`). `details` carries optional structured context such
 * as `retryAfterSeconds` for rate-limit or lockout responses.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(params: {
    code: ErrorCode;
    message: string;
    status: number;
    field?: string;
    details?: Readonly<Record<string, unknown>>;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    if (params.field !== undefined) {
      this.field = params.field;
    }
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------

/**
 * HTTP method for `apiRequest`. Limited to the verbs the App actually
 * issues, so an unsupported method is caught by the type system.
 */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Resolve the API base URL from `app.config.ts`'s `extra.apiBaseUrl`.
 *
 * Expo exposes `extra` through `Constants.expoConfig?.extra` on SDK
 * 49+. We fall back to the legacy `manifest` and `manifest2` shapes
 * so the helper keeps working in older runtimes (e.g. classic
 * builds, dev menus). If none of the sources surfaces a base URL we
 * throw — there is no useful default for a network call.
 */
function resolveBaseUrl(): string {
  const extra =
    (Constants.expoConfig?.extra as { apiBaseUrl?: unknown } | undefined) ??
    ((Constants as unknown as { manifest?: { extra?: { apiBaseUrl?: unknown } } })
      .manifest?.extra) ??
    ((Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { extra?: { apiBaseUrl?: unknown } } } };
    }).manifest2?.extra?.expoClient?.extra);

  const value = extra?.apiBaseUrl;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      'API base URL is not configured. Set `extra.apiBaseUrl` in app.config.ts.',
    );
  }
  // Strip trailing slash so callers can always pass a leading-slash path.
  return value.replace(/\/+$/, '');
}

/**
 * Issue an authenticated JSON request to the API.
 *
 * Behavior:
 *   - Serializes `body` as JSON when present (with the matching
 *     `Content-Type` header).
 *   - Reads the persisted bearer token from secure storage and
 *     attaches it as `Authorization: Bearer <token>` when present.
 *   - On 401: clears the persisted token and fires the unauthorized
 *     callback (R6.10) before throwing an `ApiError`.
 *   - On any non-2xx: parses the uniform error envelope into an
 *     `ApiError`. If the response body is not a valid envelope, falls
 *     back to `internal_error`.
 *   - On success: returns the parsed JSON body cast to `T`. Callers
 *     pick `T` based on the route contract; `apiRequest` does no
 *     runtime validation of the success body.
 *
 * An optional `signal` is forwarded to the underlying `fetch` so a
 * caller can enforce a per-request timeout (or otherwise cancel the
 * request) via an `AbortController`. When the signal aborts, `fetch`
 * rejects with an `AbortError`; `apiRequest` lets that rejection
 * propagate unchanged so the caller can translate it into whatever
 * domain error its retry contract expects.
 *
 * Generic `T` defaults to `unknown` so callers must opt in to a
 * specific shape.
 */
export async function apiRequest<T = unknown>(
  method: ApiMethod,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const baseUrl = resolveBaseUrl();
  const url = path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const token = await getSessionToken();
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  if (signal !== undefined) {
    init.signal = signal;
  }

  const response = await fetch(url, init);

  if (response.status === 401) {
    // R6.10: once the server reports the credential is invalid, the
    // app must stop using it. Clear before notifying so any listener
    // that re-renders the navigator does not race against a still-
    // present token.
    await clearSessionToken();
    notifyUnauthorized();
    throw await buildApiError(response);
  }

  if (!response.ok) {
    throw await buildApiError(response);
  }

  if (response.status === 204) {
    // 204 No Content — there is no body to parse. Returning `null`
    // cast to `T` matches the natural `void`/`null` return contract
    // for endpoints like `POST /auth/logout`.
    return null as T;
  }

  // Some successful endpoints (e.g. a `201` reaction add) reply with an empty
  // body. Read the body as text first and only parse when there is something to
  // parse, so an empty 2xx response resolves to `null` instead of throwing a
  // JSON parse error that would surface to the caller as a spurious failure.
  const text = await response.text();
  if (text.length === 0) {
    return null as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Read the response body and translate it into an `ApiError`. The
 * backend always emits the uniform envelope on error; we still defend
 * against a malformed payload (e.g. an upstream proxy returning a
 * plaintext 5xx page) by falling back to `internal_error`.
 */
async function buildApiError(response: Response): Promise<ApiError> {
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    envelope = null;
  }

  const body = envelope?.error;
  if (body && typeof body.code === 'string' && typeof body.message === 'string') {
    return new ApiError({
      code: body.code,
      message: body.message,
      status: response.status,
      ...(body.field !== undefined ? { field: body.field } : {}),
      ...(body.details !== undefined ? { details: body.details } : {}),
    });
  }

  return new ApiError({
    code: 'internal_error',
    message: `Request failed with status ${response.status}.`,
    status: response.status,
  });
}

// ---------------------------------------------------------------------------
// setAvatarPreset
// ---------------------------------------------------------------------------

/**
 * Choose (or clear) the Profile avatar preset via `PUT /me/profile/avatar`.
 *
 * Avatars are a fixed set of bundled illustrations referenced by a preset id
 * (see `AVATAR_PRESET_IDS` / `AvatarPresetId` in `@dwt/shared`), so this is a
 * plain JSON request — no upload or multipart. Pass a preset id to set the
 * avatar, or `null` to clear it back to the placeholder.
 *
 * `apiRequest` handles Authorization, the uniform error envelope, and the
 * 401 → session-clear flow, so this is a thin typed wrapper. The server
 * re-validates the id against the same allowlist and returns the updated
 * `ProfileDTO`, so the caller can render the new avatar immediately.
 */
export async function setAvatarPreset(
  avatarPreset: AvatarPresetId | null,
): Promise<ProfileDTO> {
  return apiRequest<ProfileDTO>('PUT', '/me/profile/avatar', { avatarPreset });
}
