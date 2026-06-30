/**
 * Unit tests for the ThemeParks.wiki live HTTP client.
 *
 * Validates: Requirements 1.1, 1.8 — the typed wrapper `getEntityLive(id, signal?)`,
 * base-URL handling, URL-encoding of the entity id, forwarding of the deadline
 * `AbortSignal`, and translation of upstream HTTP / transport / abort / parse
 * failures into the typed `UpstreamError` class.
 *
 * Real HTTP is never issued: every test injects a `fetch` stand-in via the
 * `options.fetch` constructor parameter, exercising the client at the boundary
 * of its only side effect.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  THEMEPARKS_DEFAULT_BASE_URL,
  UpstreamError,
  type FetchLike,
} from '../../catalog/themeparks.js';
import {
  createThemeParksLiveClient,
  type ThemeParksLiveResponse,
} from '../themeparksLive.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a `fetch` stand-in body with HTTP 200 OK (or supplied status). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A non-JSON body that triggers a JSON-parse failure on `.json()`. */
function nonJsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

/** A representative, well-formed live response body. */
const validLiveBody: ThemeParksLiveResponse = {
  id: 'space-mountain',
  name: 'Space Mountain',
  entityType: 'ATTRACTION',
  timezone: 'America/New_York',
  liveData: [
    {
      id: 'space-mountain',
      status: 'OPERATING',
      lastUpdated: '2024-01-01T12:00:00Z',
      queue: { STANDBY: { waitTime: 45 } },
    },
  ],
};

// ---------------------------------------------------------------------------
// Base URL handling
// ---------------------------------------------------------------------------

describe('createThemeParksLiveClient — base URL', () => {
  it('defaults to the v1 ThemeParks.wiki base URL', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({ fetch: fetchSpy });
    await client.getEntityLive('space-mountain');
    expect(fetchSpy).toHaveBeenCalledWith(
      `${THEMEPARKS_DEFAULT_BASE_URL}/entity/space-mountain/live`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('honours an injected base URL from configuration', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({
      baseUrl: 'https://staging.example.com/v1',
      fetch: fetchSpy,
    });
    await client.getEntityLive('space-mountain');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://staging.example.com/v1/entity/space-mountain/live',
      expect.anything(),
    );
  });

  it('strips trailing slashes from the base URL', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({
      baseUrl: 'https://example.com/v1///',
      fetch: fetchSpy,
    });
    await client.getEntityLive('space-mountain');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/v1/entity/space-mountain/live',
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// getEntityLive — success path (R1.1)
// ---------------------------------------------------------------------------

describe('getEntityLive — success', () => {
  it('returns the parsed body on a 2xx response', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(validLiveBody)),
    });
    expect(await client.getEntityLive('space-mountain')).toEqual(validLiveBody);
  });

  it('returns the parsed body for any 2xx status (e.g. 204-adjacent 200 with empty liveData)', async () => {
    const body = { id: 'x', liveData: [] };
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(body, 201)),
    });
    expect(await client.getEntityLive('x')).toEqual(body);
  });

  it('issues an Accept: application/json header', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({ fetch: fetchSpy });
    await client.getEntityLive('space-mountain');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['Accept']).toBe(
      'application/json',
    );
  });

  it('URL-encodes the entity id into the path', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({
      baseUrl: 'https://api.example.com/v1',
      fetch: fetchSpy,
    });
    await client.getEntityLive('id with space/and slash');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/entity/id%20with%20space%2Fand%20slash/live',
      expect.anything(),
    );
  });

  it('forwards an AbortSignal into fetch when supplied (R2.6 deadline)', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({ fetch: fetchSpy });
    const controller = new AbortController();
    await client.getEntityLive('space-mountain', controller.signal);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBe(controller.signal);
  });

  it('omits the signal property entirely when none is supplied', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(validLiveBody));
    const client = createThemeParksLiveClient({ fetch: fetchSpy });
    await client.getEntityLive('space-mountain');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init && 'signal' in init).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEntityLive — failure translation (R1.8)
// ---------------------------------------------------------------------------

describe('getEntityLive — failure translation', () => {
  it('translates a non-2xx response to UpstreamError(http_status)', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({}, 503)),
    });
    const promise = client.getEntityLive('space-mountain');
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toMatchObject({
      name: 'UpstreamError',
      kind: 'http_status',
      status: 503,
    });
  });

  it('translates a 404 response to UpstreamError(http_status)', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)),
    });
    await expect(client.getEntityLive('missing')).rejects.toMatchObject({
      kind: 'http_status',
      status: 404,
    });
  });

  it('translates a transport-level rejection to UpstreamError(network)', async () => {
    const cause = new TypeError('socket hang up');
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockRejectedValue(cause),
    });
    const promise = client.getEntityLive('space-mountain');
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toMatchObject({ kind: 'network' });
  });

  it('translates an AbortError rejection to UpstreamError(aborted)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockRejectedValue(abortErr),
    });
    await expect(client.getEntityLive('space-mountain')).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('translates a DOMException AbortError to UpstreamError(aborted)', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockRejectedValue(abortErr),
    });
    await expect(client.getEntityLive('space-mountain')).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('translates non-JSON bodies to UpstreamError(invalid_response)', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(nonJsonResponse('<html>not json</html>')),
    });
    await expect(client.getEntityLive('space-mountain')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects a non-object JSON body as UpstreamError(invalid_response)', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse([1, 2, 3])),
    });
    await expect(client.getEntityLive('space-mountain')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when the body is missing the liveData array', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ id: 'x', wrong: 'shape' })),
    });
    await expect(client.getEntityLive('x')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when liveData is present but not an array', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ id: 'x', liveData: {} })),
    });
    await expect(client.getEntityLive('x')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when a liveData entry is not an object', async () => {
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ id: 'x', liveData: ['nope'] })),
    });
    await expect(client.getEntityLive('x')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

// ---------------------------------------------------------------------------
// Gross-shape-only validation: partial entries still parse (R1.10, R1.17)
// ---------------------------------------------------------------------------

describe('getEntityLive — gross-shape-only validation', () => {
  it('accepts a recognized-but-partial entry without field-level validation', async () => {
    // A liveData entry that is an object but omits status/queue/etc. must pass
    // the client (projection handles partial payloads).
    const body = { id: 'x', liveData: [{ id: 'x' }] };
    const client = createThemeParksLiveClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(body)),
    });
    expect(await client.getEntityLive('x')).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// Constructor preconditions
// ---------------------------------------------------------------------------

describe('createThemeParksLiveClient — preconditions', () => {
  it('throws at construction when a non-function fetch is forced', () => {
    expect(() =>
      createThemeParksLiveClient({
        fetch: 'not a function' as unknown as FetchLike,
      }),
    ).toThrow(/fetch implementation/);
  });
});
