/**
 * Unit tests for the ThemeParks.wiki HTTP client.
 *
 * Validates: Requirements 1.1, 1.2 — typed wrappers `getDestinations()`
 * and `getEntityChildren(id)`, base-URL handling, and translation of
 * upstream HTTP / transport / parse failures into the typed
 * `UpstreamError` class.
 *
 * Real HTTP is never issued: every test injects a `fetch` stand-in via
 * the `options.fetch` constructor parameter, exercising the client at the
 * boundary of its only side effect.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  THEMEPARKS_DEFAULT_BASE_URL,
  UpstreamError,
  createThemeParksClient,
  type FetchLike,
} from '../themeparks.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a `fetch` stand-in that returns a JSON body with HTTP 200 OK by
 * default; supply `init` to customize status, body shape, or to throw
 * before/after returning.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function nonJsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

// ---------------------------------------------------------------------------
// getDestinations
// ---------------------------------------------------------------------------

describe('createThemeParksClient — base URL', () => {
  it('defaults to the v1 ThemeParks.wiki base URL', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ destinations: [] }));
    const client = createThemeParksClient({ fetch: fetchSpy });
    await client.getDestinations();
    expect(fetchSpy).toHaveBeenCalledWith(
      `${THEMEPARKS_DEFAULT_BASE_URL}/destinations`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('honours an injected base URL from configuration', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ destinations: [] }));
    const client = createThemeParksClient({
      baseUrl: 'https://staging.example.com/v1',
      fetch: fetchSpy,
    });
    await client.getDestinations();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://staging.example.com/v1/destinations',
      expect.anything(),
    );
  });

  it('strips trailing slashes from the base URL', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ destinations: [] }));
    const client = createThemeParksClient({
      baseUrl: 'https://example.com/v1///',
      fetch: fetchSpy,
    });
    await client.getDestinations();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/v1/destinations',
      expect.anything(),
    );
  });
});

describe('getDestinations', () => {
  it('returns the parsed destinations payload on a 200 response', async () => {
    const payload = {
      destinations: [
        {
          id: 'wdw',
          name: 'Walt Disney World',
          slug: 'waltdisneyworldresort',
          parks: [{ id: 'mk', name: 'Magic Kingdom' }],
        },
      ],
    };
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(payload)),
    });

    const result = await client.getDestinations();
    expect(result).toEqual(payload);
  });

  it('issues an Accept: application/json header', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ destinations: [] }));
    const client = createThemeParksClient({ fetch: fetchSpy });
    await client.getDestinations();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string> | undefined)?.['Accept']).toBe(
      'application/json',
    );
  });

  it('translates a non-2xx response to UpstreamError(http_status)', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({}, 503)),
    });
    await expect(client.getDestinations()).rejects.toMatchObject({
      name: 'UpstreamError',
      kind: 'http_status',
      status: 503,
    });
  });

  it('translates a transport-level rejection to UpstreamError(network)', async () => {
    const cause = new TypeError('socket hang up');
    const client = createThemeParksClient({
      fetch: vi.fn().mockRejectedValue(cause),
    });
    const promise = client.getDestinations();
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toMatchObject({ kind: 'network' });
  });

  it('translates an AbortError rejection to UpstreamError(aborted)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = createThemeParksClient({
      fetch: vi.fn().mockRejectedValue(abortErr),
    });
    await expect(client.getDestinations()).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('translates non-JSON bodies to UpstreamError(invalid_response)', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(nonJsonResponse('<html>not json</html>')),
    });
    await expect(client.getDestinations()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when the body is missing the destinations array', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' })),
    });
    await expect(client.getDestinations()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when a destination entry is missing required fields', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ destinations: [{ id: 'x' }] })),
    });
    await expect(client.getDestinations()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

// ---------------------------------------------------------------------------
// getEntityChildren
// ---------------------------------------------------------------------------

describe('getEntityChildren', () => {
  const validChildrenBody = {
    id: 'wdw',
    name: 'Walt Disney World',
    entityType: 'DESTINATION',
    timezone: 'America/New_York',
    children: [
      {
        id: 'space-mountain',
        name: 'Space Mountain',
        entityType: 'ATTRACTION',
        parentId: 'mk',
      },
      {
        id: 'cinderellas-table',
        name: "Cinderella's Royal Table",
        entityType: 'RESTAURANT',
        parentId: 'mk',
      },
    ],
  };

  it('returns the parsed children payload on a 200 response', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(validChildrenBody)),
    });
    expect(await client.getEntityChildren('wdw')).toEqual(validChildrenBody);
  });

  it('URL-encodes the entity id into the path', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse(validChildrenBody));
    const client = createThemeParksClient({
      baseUrl: 'https://api.example.com/v1',
      fetch: fetchSpy,
    });
    await client.getEntityChildren('id with space/and slash');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/entity/id%20with%20space%2Fand%20slash/children',
      expect.anything(),
    );
  });

  it('translates a 404 response to UpstreamError(http_status)', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)),
    });
    await expect(client.getEntityChildren('missing')).rejects.toMatchObject({
      kind: 'http_status',
      status: 404,
    });
  });

  it('translates a network failure to UpstreamError(network)', async () => {
    const client = createThemeParksClient({
      fetch: vi.fn().mockRejectedValue(new Error('ENETUNREACH')),
    });
    await expect(client.getEntityChildren('wdw')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('rejects when the body is missing the children array', async () => {
    const body = {
      id: 'wdw',
      name: 'Walt Disney World',
      entityType: 'DESTINATION',
    };
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(body)),
    });
    await expect(client.getEntityChildren('wdw')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects when a child entry is missing required fields', async () => {
    const body = {
      id: 'wdw',
      name: 'Walt Disney World',
      entityType: 'DESTINATION',
      children: [{ id: 'broken' }],
    };
    const client = createThemeParksClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(body)),
    });
    await expect(client.getEntityChildren('wdw')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

// ---------------------------------------------------------------------------
// Constructor preconditions
// ---------------------------------------------------------------------------

describe('createThemeParksClient — preconditions', () => {
  it('throws at construction when no fetch implementation is available', () => {
    expect(() =>
      createThemeParksClient({
        // Pretend a runtime without global fetch by overriding to undefined.
        fetch: undefined as unknown as FetchLike,
      }),
    ).not.toThrow();
    // The above branch falls back to globalThis.fetch (which exists in
    // Node 20). To pin down the precondition, force-pass a non-function:
    expect(() =>
      createThemeParksClient({
        fetch: 'not a function' as unknown as FetchLike,
      }),
    ).toThrow(/fetch implementation/);
  });
});
