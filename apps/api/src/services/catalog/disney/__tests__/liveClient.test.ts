/**
 * Unit tests for the Sync-Gateway-backed Disney live client.
 *
 * Cover:
 *   - `routeLiveDocuments` channel routing into the projection input slots.
 *   - HTTP Basic transport: request shape + typed `UpstreamError` mapping.
 *   - "no live data" handling: a 2xx body yielding no document is an empty
 *     input (not an error), while transport/status failures propagate.
 *
 * No network is touched; a fake `fetch` drives every case.
 */

import { describe, expect, it, vi } from 'vitest';

import { UpstreamError, type FetchLike } from '../../themeparks.js';
import {
  DINING_STATUS_CHANNEL,
  FORECAST_CHANNEL,
  STATUS_CHANNEL,
  createDisneyLiveClient,
  liveDocumentIds,
  routeLiveDocuments,
} from '../liveClient.js';

const CREDS = { username: 'u', password: 'p' };
const ENTERPRISE_ID = '80010177;entityType=Attraction';

/** Build a `multipart/related` body from a list of JSON documents. */
function multipartBody(
  docs: readonly unknown[],
  boundary = 'BOUNDARY',
): { contentType: string; body: string } {
  const parts = docs
    .map(
      (doc) =>
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(doc)}\r\n`,
    )
    .join('');
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body: `${parts}--${boundary}--\r\n`,
  };
}

function multipartResponse(docs: readonly unknown[]): Response {
  const { contentType, body } = multipartBody(docs);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('routeLiveDocuments', () => {
  it('routes documents into projection slots by channel membership (R9.2–R9.5)', () => {
    const input = routeLiveDocuments([
      { id: 'a', channels: [STATUS_CHANNEL], status: 'Operating', waitMinutes: 25 },
      {
        id: 'b',
        channels: [DINING_STATUS_CHANNEL],
        availability: [{ status: 'Available', partySize: 2 }],
      },
      {
        id: 'c',
        channels: [FORECAST_CHANNEL],
        forecasts: [{ time: '2024-06-01T15:00:00Z', waitMinutes: 20, percentage: 50 }],
      },
      { id: 'd', channels: ['wdw.today.1_0.Attraction'], schedules: [{ type: 'Operating' }] },
    ]);

    expect(input.status?.status).toBe('Operating');
    expect(input.status?.waitMinutes).toBe(25);
    expect(input.diningStatus?.availability).toHaveLength(1);
    expect(input.forecast?.forecasts).toHaveLength(1);
    expect(input.schedule).toHaveLength(1);
  });

  it('ignores documents that belong to no recognized live channel', () => {
    const input = routeLiveDocuments([
      { id: 'x', channels: ['wdw.facilities.1_0.en_us'], name: 'Not a live doc' },
    ]);
    expect(input).toEqual({});
  });
});

describe('liveDocumentIds', () => {
  it('requests the Enterprise_Id as the primary live document key', () => {
    expect(liveDocumentIds(ENTERPRISE_ID)).toEqual([ENTERPRISE_ID]);
  });
});

describe('createDisneyLiveClient.getEntityLiveInput', () => {
  it('POSTs _bulk_get with HTTP Basic auth and the Enterprise_Id', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        multipartResponse([
          { id: ENTERPRISE_ID, channels: [STATUS_CHANNEL], status: 'Down' },
        ]),
      );
    const client = createDisneyLiveClient({
      baseUrl: 'https://sync-gw.example.invalid/park-platform-pub/',
      credentials: CREDS,
      fetch: fetchSpy,
    });

    const input = await client.getEntityLiveInput(ENTERPRISE_ID);

    expect(input.status?.status).toBe('Down');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      'https://sync-gw.example.invalid/park-platform-pub/_bulk_get',
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      docs: [{ id: ENTERPRISE_ID }],
      json: true,
    });
  });

  it('treats a 2xx body with no recognizable document as empty input (R9.6)', async () => {
    // Empty multipart → parseBulkGet raises invalid_response → folded to {}.
    const emptyBody = '--B--\r\n';
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(
      new Response(emptyBody, {
        status: 200,
        headers: { 'content-type': 'multipart/related; boundary=B' },
      }),
    );
    const client = createDisneyLiveClient({ credentials: CREDS, fetch: fetchSpy });

    const input = await client.getEntityLiveInput(ENTERPRISE_ID);
    expect(input).toEqual({});
  });

  it('maps a non-2xx status to UpstreamError(http_status)', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('nope', { status: 503 }));
    const client = createDisneyLiveClient({ credentials: CREDS, fetch: fetchSpy });

    await expect(client.getEntityLiveInput(ENTERPRISE_ID)).rejects.toMatchObject(
      { name: 'UpstreamError', kind: 'http_status', status: 503 },
    );
  });

  it('maps a transport rejection to UpstreamError(network)', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockRejectedValue(new TypeError('socket hang up'));
    const client = createDisneyLiveClient({ credentials: CREDS, fetch: fetchSpy });

    const err = await client
      .getEntityLiveInput(ENTERPRISE_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).kind).toBe('network');
  });

  it('maps an aborted request to UpstreamError(aborted)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchSpy = vi.fn<FetchLike>().mockRejectedValue(abortErr);
    const client = createDisneyLiveClient({ credentials: CREDS, fetch: fetchSpy });

    const err = await client
      .getEntityLiveInput(ENTERPRISE_ID)
      .catch((e: unknown) => e);
    expect((err as UpstreamError).kind).toBe('aborted');
  });
});
