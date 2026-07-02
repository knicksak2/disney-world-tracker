/**
 * Wiring example test for `Facilities_Client` transport dispatch
 * (`services/catalog/disney/facilitiesClient.ts`).
 *
 * Where `facilitiesClient.test.ts` pins per-request shapes and auth headers,
 * this test pins the *wiring contract* introduced by the transport refactor
 * (task 6.1): the client reaches Disney **only** through `transport.request`
 * and never through a bare `fetch`, it threads `since` onto delta enumeration,
 * and it surfaces the `_changes` `last_seq` and per-id tombstone flags back to
 * the caller.
 *
 * A single spy `DisneyTransport` records every `request(spec)` call so we can
 * assert on the exact specs the client emits. To prove no code path escapes to
 * a bare `fetch`, `globalThis.fetch` is replaced with a spy that fails the test
 * if it is ever invoked while the client is exercised.
 *
 * Validates: Requirements 1.2, 1.3
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisneyRequestSpec, DisneyResponse } from '@dwt/shared';

import { FACILITIES_CHANNEL, createFacilitiesClient } from '../facilitiesClient.js';
import type { DisneyTransport } from '../transport.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_CREDENTIALS = { username: 'sync-user', password: 's3cr3t' } as const;
const SYNC_BASE_URL = 'https://sync.example.test/park-platform-pub';
const MENU_BASE_URL = 'https://menu.example.test/dining-menus';
const AUTH_URL = 'https://auth.example.test/token';
const CLIENT_ID = 'TEST-CLIENT-ID';

/** A `DisneyResponse` carrying a JSON body. */
function jsonResponse(value: unknown): DisneyResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    text: JSON.stringify(value),
  };
}

/** A minimal, valid `multipart/related` `_bulk_get` response echoing one doc. */
function bulkGetResponse(): DisneyResponse {
  const boundary = 'wiring-boundary-1';
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ id: 'doc-1' })}` +
    `\r\n--${boundary}--\r\n`;
  return {
    status: 200,
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    text: body,
  };
}

/**
 * A recording spy `DisneyTransport`. Every `request(spec)` is captured in
 * `requests`; the response is dispatched on the spec's URL so the full client
 * surface (`_changes`, `_bulk_get`, token grant, Menu_Service) can be driven.
 * The optional `changesResponse` overrides the default `_changes` body so a
 * test can feed a bespoke feed (mixed tombstones, a specific `last_seq`).
 */
function makeSpyTransport(changesResponse?: DisneyResponse): {
  transport: DisneyTransport;
  requests: DisneyRequestSpec[];
} {
  const requests: DisneyRequestSpec[] = [];

  const transport: DisneyTransport = {
    request: vi.fn(async (spec: DisneyRequestSpec): Promise<DisneyResponse> => {
      requests.push(spec);
      const href = spec.url;

      if (href.startsWith(AUTH_URL)) {
        return jsonResponse({ access_token: 'public-token-abc', expires_in: 3600 });
      }
      if (href.endsWith('/_changes')) {
        return changesResponse ?? jsonResponse({ results: [{ id: 'doc-1' }], last_seq: '1' });
      }
      if (href.endsWith('/_bulk_get')) {
        return bulkGetResponse();
      }
      if (href.startsWith(MENU_BASE_URL)) {
        return jsonResponse({ menus: [] });
      }
      throw new Error(`unexpected url in spy transport: ${href}`);
    }),
  };

  return { transport, requests };
}

/** A client wired to the test URLs and a recording spy transport. */
function makeClient(transport: DisneyTransport) {
  return createFacilitiesClient({
    transport,
    baseUrl: SYNC_BASE_URL,
    credentials: TEST_CREDENTIALS,
    menuService: { baseUrl: MENU_BASE_URL, authorizationUrl: AUTH_URL, clientId: CLIENT_ID },
  });
}

// ---------------------------------------------------------------------------
// Guard: no bare `fetch` — every Disney interaction goes through the transport
// ---------------------------------------------------------------------------

describe('Facilities_Client reaches Disney only through transport.request (R1.2, R1.3)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Any bare `fetch` the client might attempt is a wiring violation: fail loudly.
    fetchSpy = vi.fn(() => {
      throw new Error('Facilities_Client made a bare fetch call; all egress must use the transport');
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('drives every Sync Gateway + Menu_Service operation through transport.request, never fetch', async () => {
    const { transport, requests } = makeSpyTransport();
    const client = makeClient(transport);

    // Exercise the full public surface: enumeration, bulk get, and menus.
    await client.listChannelDocumentIds(FACILITIES_CHANNEL);
    await client.bulkGetDocuments(['doc-1']);
    await client.getMenus('restaurant;entityType=restaurant');

    // The bare-fetch guard was never tripped.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Every Disney interaction is an accounted-for transport.request call:
    // _changes, _bulk_get, the Public_Token grant, and the Menu_Service GET.
    expect(transport.request).toHaveBeenCalledTimes(requests.length);
    expect(requests.some((r) => r.url.endsWith('/_changes'))).toBe(true);
    expect(requests.some((r) => r.url.endsWith('/_bulk_get'))).toBe(true);
    expect(requests.some((r) => r.url.startsWith(AUTH_URL))).toBe(true);
    expect(requests.some((r) => r.url.startsWith(MENU_BASE_URL))).toBe(true);

    // Every recorded spec targets a Disney bucket the transport recognizes.
    for (const spec of requests) {
      expect(['sync_gateway', 'web']).toContain(spec.target);
    }
  });
});

// ---------------------------------------------------------------------------
// `since` is threaded onto delta enumeration
// ---------------------------------------------------------------------------

describe('listChannelDocumentIds threads `since` through the transport spec (R1.2)', () => {
  it('omits `since` on bootstrap enumeration and carries it on a delta enumeration', async () => {
    const { transport, requests } = makeSpyTransport();
    const client = makeClient(transport);

    // Bootstrap enumeration: no `since` on the recorded _changes spec.
    await client.listChannelDocumentIds(FACILITIES_CHANNEL);
    const bootstrap = requests.at(-1)!;
    expect(bootstrap.url.endsWith('/_changes')).toBe(true);
    expect(JSON.parse(String(bootstrap.body)) as Record<string, unknown>).not.toHaveProperty(
      'since',
    );

    // Delta enumeration: the recorded _changes spec body carries the `since` value.
    await client.listChannelDocumentIds(FACILITIES_CHANNEL, 'seq-42');
    const delta = requests.at(-1)!;
    expect(delta.url.endsWith('/_changes')).toBe(true);
    expect((JSON.parse(String(delta.body)) as Record<string, unknown>)['since']).toBe('seq-42');
  });
});

// ---------------------------------------------------------------------------
// The client surfaces `lastSeq` and per-id `deleted` flags from `_changes`
// ---------------------------------------------------------------------------

describe('listChannelDocumentIds surfaces lastSeq and per-id deleted flags (R1.2)', () => {
  it('returns the enumeration last_seq and a deleted flag per change record', async () => {
    const { transport } = makeSpyTransport(
      jsonResponse({
        results: [
          { id: 'doc-1' },
          { id: 'doc-2', deleted: true },
          { id: 'doc-3', deleted: false },
        ],
        last_seq: 'seq-99',
      }),
    );

    const result = await makeClient(transport).listChannelDocumentIds(FACILITIES_CHANNEL);

    expect(result.lastSeq).toBe('seq-99');
    expect(result.changes).toEqual([
      { id: 'doc-1', deleted: false },
      { id: 'doc-2', deleted: true },
      { id: 'doc-3', deleted: false },
    ]);
  });
});
