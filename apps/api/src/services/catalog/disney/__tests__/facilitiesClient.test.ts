/**
 * Unit tests for the Facilities_Client request shapes and body parsing
 * (`services/catalog/disney/facilitiesClient.ts`).
 *
 * The client now routes every Disney request through the shared
 * `DisneyTransport` (`transport.request(spec)`) rather than calling `fetch`
 * directly. These example-based tests drive the client through a fake transport
 * that records the `DisneyRequestSpec`s it receives, pinning:
 *
 *   - HTTP Basic auth carried in `spec.headers` on every Sync Gateway request
 *     with `target: 'sync_gateway'` (R1.2, R5.3).
 *   - Bearer Public_Token carried in `spec.headers` on every Menu_Service
 *     request with `target: 'web'` (R1.3), with the Public_Token first obtained
 *     via the anonymous `assertion`/`public` grant (R1.4) and no per-guest
 *     credentials sent (R15.3).
 *   - The client never sets a `User-Agent` — the transport owns it (R5.1, R5.2).
 *   - `POST /_changes` body carries `style: "all_docs"`,
 *     `filter: "sync_gateway/bychannel"`, and `feed: "normal"` (R2.1), the WDW
 *     Facilities_Channel (R2.2), an optional `since` for Delta_Sync (R6.2), and
 *     returns `{ changes, lastSeq }` with per-document tombstone flags (R6.3,
 *     R7.3).
 *   - The client surfaces the transport's single typed error unchanged and
 *     raises `UpstreamError('invalid_response')` when a successful body cannot
 *     be parsed.
 *
 * Validates: Requirements 1.2, 1.3, 5.3, 6.2, 6.3, 7.3, 15.3
 */

import { describe, expect, it } from 'vitest';

import type { DisneyRequestSpec, DisneyResponse } from '@dwt/shared';

import { FACILITIES_CHANNEL, createFacilitiesClient } from '../facilitiesClient.js';
import type { DisneyTransport } from '../transport.js';
import { UpstreamError } from '../../themeparks.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_CREDENTIALS = { username: 'sync-user', password: 's3cr3t' } as const;
const SYNC_BASE_URL = 'https://sync.example.test/park-platform-pub';
const MENU_BASE_URL = 'https://menu.example.test/dining-menus';
const AUTH_URL = 'https://auth.example.test/token';
const CLIENT_ID = 'TEST-CLIENT-ID';

/** The expected `Authorization: Basic ...` value for TEST_CREDENTIALS. */
const EXPECTED_BASIC = `Basic ${Buffer.from(
  `${TEST_CREDENTIALS.username}:${TEST_CREDENTIALS.password}`,
  'utf8',
).toString('base64')}`;

/** Read the `Authorization` header off a recorded request spec. */
function authHeaderOf(spec: DisneyRequestSpec): string | undefined {
  return spec.headers?.['Authorization'];
}

/** Parse a recorded JSON request body. */
function jsonBodyOf(spec: DisneyRequestSpec): Record<string, unknown> {
  const raw = typeof spec.body === 'string' ? spec.body : '';
  return JSON.parse(raw) as Record<string, unknown>;
}

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
  const boundary = 'unit-boundary-1';
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
 * Build a recording fake `DisneyTransport` that dispatches on the spec's URL:
 * `_changes`/`_bulk_get` against the Sync Gateway, the authorization token
 * endpoint, and the Menu Service. Every spec is captured in `requests`.
 */
function makeTransport(): { transport: DisneyTransport; requests: DisneyRequestSpec[] } {
  const requests: DisneyRequestSpec[] = [];

  const transport: DisneyTransport = {
    async request(spec: DisneyRequestSpec): Promise<DisneyResponse> {
      requests.push(spec);
      const href = spec.url;

      if (href.startsWith(AUTH_URL)) {
        return jsonResponse({ access_token: 'public-token-abc', expires_in: 3600 });
      }
      if (href.endsWith('/_changes')) {
        return jsonResponse({ results: [{ id: 'doc-1' }], last_seq: '1' });
      }
      if (href.endsWith('/_bulk_get')) {
        return bulkGetResponse();
      }
      if (href.startsWith(MENU_BASE_URL)) {
        return jsonResponse({ menus: [] });
      }
      throw new Error(`unexpected url in test fake: ${href}`);
    },
  };

  return { transport, requests };
}

/** A client wired to the test URLs and a recording transport. */
function makeClient(transport: DisneyTransport) {
  return createFacilitiesClient({
    transport,
    baseUrl: SYNC_BASE_URL,
    credentials: TEST_CREDENTIALS,
    menuService: { baseUrl: MENU_BASE_URL, authorizationUrl: AUTH_URL, clientId: CLIENT_ID },
  });
}

// ---------------------------------------------------------------------------
// R1.2, R5.3 — HTTP Basic auth on Sync Gateway requests, no User-Agent
// ---------------------------------------------------------------------------

describe('Sync Gateway requests carry HTTP Basic auth via spec.headers (R1.2, R5.3)', () => {
  it('listChannelDocumentIds sends Basic auth on a sync_gateway POST /_changes', async () => {
    const { transport, requests } = makeTransport();
    await makeClient(transport).listChannelDocumentIds(FACILITIES_CHANNEL);

    const changes = requests.find((r) => r.url.endsWith('/_changes'));
    expect(changes).toBeDefined();
    expect(changes!.target).toBe('sync_gateway');
    expect(changes!.method).toBe('POST');
    expect(authHeaderOf(changes!)).toBe(EXPECTED_BASIC);
    // The transport owns the User-Agent; the client never sets one (R5.1).
    expect(changes!.headers?.['User-Agent']).toBeUndefined();
  });

  it('bulkGetDocuments sends Basic auth on a sync_gateway POST /_bulk_get', async () => {
    const { transport, requests } = makeTransport();
    await makeClient(transport).bulkGetDocuments(['doc-1']);

    const bulk = requests.find((r) => r.url.endsWith('/_bulk_get'));
    expect(bulk).toBeDefined();
    expect(bulk!.target).toBe('sync_gateway');
    expect(bulk!.method).toBe('POST');
    expect(bulk!.accept).toBe('multipart/related');
    expect(authHeaderOf(bulk!)).toBe(EXPECTED_BASIC);
    expect(bulk!.headers?.['User-Agent']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R1.3, R1.4, R15.3 — Bearer Public_Token on Menu_Service requests
// ---------------------------------------------------------------------------

describe('Menu_Service requests carry a Bearer Public_Token (R1.3, R1.4, R15.3)', () => {
  it('acquires a Public_Token then calls the Menu_Service with Bearer auth on target web', async () => {
    const { transport, requests } = makeTransport();
    await makeClient(transport).getMenus('restaurant;entityType=restaurant');

    // The token is obtained first via the anonymous assertion/public grant (R1.4).
    const tokenReq = requests.find((r) => r.url.startsWith(AUTH_URL));
    expect(tokenReq).toBeDefined();
    expect(tokenReq!.target).toBe('web');
    expect(tokenReq!.method).toBe('POST');
    const tokenBody = String(tokenReq!.body);
    expect(tokenBody).toContain('grant_type=assertion');
    expect(tokenBody).toContain('assertion_type=public');
    expect(tokenBody).toContain(`client_id=${CLIENT_ID}`);

    // The Menu_Service request then carries the acquired token as bearer (R1.3).
    const menuReq = requests.find((r) => r.url.startsWith(MENU_BASE_URL));
    expect(menuReq).toBeDefined();
    expect(menuReq!.target).toBe('web');
    expect(menuReq!.method).toBe('GET');
    expect(authHeaderOf(menuReq!)).toBe('Bearer public-token-abc');
  });

  it('sends only the Public_Token / Static_Credentials, never per-guest credentials (R15.3)', async () => {
    const { transport, requests } = makeTransport();
    await makeClient(transport).getMenus('restaurant;entityType=restaurant');

    // The token grant is app-level: no username/password/guest assertion travels.
    const tokenReq = requests.find((r) => r.url.startsWith(AUTH_URL))!;
    const tokenBody = String(tokenReq.body);
    expect(tokenBody).not.toMatch(/username=/i);
    expect(tokenBody).not.toMatch(/password=/i);

    // The Menu_Service request carries exactly the bearer token and nothing
    // resembling a per-guest credential.
    const menuHeaders = requests.find((r) => r.url.startsWith(MENU_BASE_URL))!.headers;
    expect(menuHeaders?.['Authorization']).toBe('Bearer public-token-abc');
    expect(menuHeaders?.['Cookie']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R2.1, R2.2, R6.2, R6.3, R7.3 — _changes request/response shape
// ---------------------------------------------------------------------------

describe('POST /_changes request shape (R2.1, R2.2)', () => {
  it('fixes style=all_docs, filter=sync_gateway/bychannel, feed=normal', async () => {
    const { transport, requests } = makeTransport();
    await makeClient(transport).listChannelDocumentIds(FACILITIES_CHANNEL);

    const body = jsonBodyOf(requests.find((r) => r.url.endsWith('/_changes'))!);
    expect(body['style']).toBe('all_docs');
    expect(body['filter']).toBe('sync_gateway/bychannel');
    expect(body['feed']).toBe('normal');
  });

  it('requests the WDW Facilities_Channel wdw.facilities.1_0.en_us', async () => {
    // The constant itself pins the channel (R2.2 / R15.1).
    expect(FACILITIES_CHANNEL).toBe('wdw.facilities.1_0.en_us');

    const { transport, requests } = makeTransport();
    await makeClient(transport).listChannelDocumentIds(FACILITIES_CHANNEL);

    const body = jsonBodyOf(requests.find((r) => r.url.endsWith('/_changes'))!);
    expect(body['channels']).toBe('wdw.facilities.1_0.en_us');
  });

  it('omits `since` on a bootstrap enumeration and includes it on a delta (R6.2)', async () => {
    const { transport, requests } = makeTransport();
    const client = makeClient(transport);

    await client.listChannelDocumentIds(FACILITIES_CHANNEL);
    expect(jsonBodyOf(requests.at(-1)!)['since']).toBeUndefined();

    await client.listChannelDocumentIds(FACILITIES_CHANNEL, 'seq-42');
    expect(jsonBodyOf(requests.at(-1)!)['since']).toBe('seq-42');
  });

  it('returns the change records and last_seq, flagging tombstones (R6.3, R7.3)', async () => {
    const transport: DisneyTransport = {
      async request(): Promise<DisneyResponse> {
        return jsonResponse({
          results: [
            { id: 'doc-1' },
            { id: 'doc-2', deleted: true },
            { id: 'doc-3', deleted: false },
          ],
          last_seq: 'seq-99',
        });
      },
    };

    const result = await makeClient(transport).listChannelDocumentIds(FACILITIES_CHANNEL);
    expect(result.lastSeq).toBe('seq-99');
    expect(result.changes).toEqual([
      { id: 'doc-1', deleted: false },
      { id: 'doc-2', deleted: true },
      { id: 'doc-3', deleted: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Error surfacing: transport errors propagate; unparseable bodies → invalid_response
// ---------------------------------------------------------------------------

describe('error surfacing', () => {
  it('propagates the transport error unchanged (classification is the transport\u2019s job)', async () => {
    const boom = new Error('transport failed');
    const transport: DisneyTransport = {
      async request(): Promise<DisneyResponse> {
        throw boom;
      },
    };

    const error = await makeClient(transport)
      .listChannelDocumentIds(FACILITIES_CHANNEL)
      .catch((e: unknown) => e);
    expect(error).toBe(boom);
  });

  it('raises UpstreamError("invalid_response") when a successful body is not JSON', async () => {
    const transport: DisneyTransport = {
      async request(): Promise<DisneyResponse> {
        return { status: 200, headers: { 'content-type': 'text/plain' }, text: 'not json' };
      },
    };

    const error = await makeClient(transport)
      .listChannelDocumentIds(FACILITIES_CHANNEL)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).kind).toBe('invalid_response');
  });
});
