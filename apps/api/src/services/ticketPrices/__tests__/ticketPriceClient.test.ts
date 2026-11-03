import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createTicketPriceClient,
} from '../ticketPriceClient.js';

describe('ticketPriceClient', () => {
  const baseUrl = 'https://disneyworld.disney.go.com';
  const userAgent = 'DisneyWaitTimes/1.0 (contact@disneywaittimes.com)';

  it('exposes only getToken and getPrices, and requests only the two documented paths', async () => {
    const requestedUrls: string[] = [];
    const mockFetch = (async (input: string | URL | any) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      if (url.includes('get-client-token')) {
        return new Response(JSON.stringify({ access_token: 'tok123', expires_in: 1800 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ maxPricingCalendarDate: '2027-12-31', pricingCalendar: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: mockFetch,
    });

    const keys = Object.keys(client).sort();
    expect(keys).toEqual(['getPrices', 'getToken']);

    const token = await client.getToken();
    expect(token).toBe('tok123');

    await client.getPrices({
      token,
      discountGroup: 'std-gst',
      numDays: 4,
      startDate: '2026-11-01',
      endDate: '2026-11-05',
    });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toBe('https://disneyworld.disney.go.com/profile-api/authentication/get-client-token/');
    expect(requestedUrls[1]).toContain(
      'https://disneyworld.disney.go.com/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices?',
    );
    for (const url of requestedUrls) {
      expect(url).not.toContain('/passes/');
      expect(url).not.toContain('.html');
    }
  });

  it('header assertions: User-Agent, Authorization on P only, no Cookie', async () => {
    const headersSeen: Record<string, string>[] = [];
    const mockFetch = (async (input: string | URL | any, init?: any) => {
      headersSeen.push((init?.headers as Record<string, string>) || {});
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('get-client-token')) {
        return new Response(JSON.stringify({ access_token: 'secret_token_123', expires_in: 1800 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
    }) as typeof fetch;

    const client = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: mockFetch,
    });

    const token = await client.getToken();
    await client.getPrices({
      token,
      discountGroup: 'std-gst',
      numDays: 1,
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });

    // Token call (T)
    expect(headersSeen[0]?.['User-Agent']).toBe(userAgent);
    expect(headersSeen[0]?.['Authorization']).toBeUndefined();
    expect(headersSeen[0]?.['Cookie']).toBeUndefined();

    // Prices call (P)
    expect(headersSeen[1]?.['User-Agent']).toBe(userAgent);
    expect(headersSeen[1]?.['Authorization']).toBe('BEARER secret_token_123');
    expect(headersSeen[1]?.['Cookie']).toBeUndefined();
  });

  it('query string contains documented params and none of fpAvailability, storeBasedPearlEnabled, addOn', async () => {
    let capturedUrl = '';
    const mockFetch = (async (input: string | URL | any) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
    }) as typeof fetch;

    const client = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: mockFetch,
    });

    await client.getPrices({
      token: 'tok',
      discountGroup: 'std-gst',
      numDays: 4,
      startDate: '2026-11-01',
      endDate: '2026-11-10',
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('discountGroup')).toBe('std-gst');
    expect(url.searchParams.get('startDate')).toBe('2026-11-01');
    expect(url.searchParams.get('storeId')).toBe('wdw');
    expect(url.searchParams.get('endDate')).toBe('2026-11-10');
    expect(url.searchParams.get('numDays')).toBe('4');

    expect(url.searchParams.has('fpAvailability')).toBe(false);
    expect(url.searchParams.has('storeBasedPearlEnabled')).toBe(false);
    expect(url.searchParams.has('addOn')).toBe(false);
  });

  it('WAF classifications: 403 with/without marker, 429, 200 HTML Akamai challenge, 503 Akamai edge page', async () => {
    const cases = [
      { status: 403, body: '<html>Access Denied, Reference #18.123</html>', expectedKind: 'waf_block' },
      { status: 403, body: '{"error": "forbidden"}', expectedKind: 'waf_block' }, // 403 is always waf_block
      { status: 429, body: 'Too Many Requests', expectedKind: 'waf_block' },
      { status: 200, body: '<html><title>Access Denied</title>Reference #999</html>', expectedKind: 'waf_block' },
      { status: 503, body: '<html>Akamai Edge rate limit exceeded</html>', expectedKind: 'waf_block' },
    ];

    for (const c of cases) {
      const mockFetch = (async () => new Response(c.body, { status: c.status })) as typeof fetch;
      const client = createTicketPriceClient({
        baseUrl,
        userAgent,
        timeoutMs: 5000,
        maxBodyBytes: 100_000,
        fetch: mockFetch,
      });

      await expect(client.getToken()).rejects.toMatchObject({
        kind: c.expectedKind,
      });
    }
  });

  it('handles 401 (unauthorized), 404 (not_found), 500 (http_status), timeout, oversize body, non-JSON', async () => {
    // 401
    const client401 = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response('unauthorized', { status: 401 })) as typeof fetch,
    });
    await expect(client401.getToken()).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });

    // 404
    const client404 = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response('not found', { status: 404 })) as typeof fetch,
    });
    await expect(
      client404.getPrices({
        token: 'tok',
        discountGroup: 'fl-resident',
        numDays: 1,
        startDate: '2026-11-01',
        endDate: '2026-11-01',
      }),
    ).rejects.toMatchObject({ kind: 'not_found', status: 404 });

    // 500
    const client500 = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response('internal error', { status: 500 })) as typeof fetch,
    });
    await expect(client500.getToken()).rejects.toMatchObject({ kind: 'http_status', status: 500 });

    // timeout
    const clientTimeout = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }) as typeof fetch,
    });
    await expect(clientTimeout.getToken()).rejects.toMatchObject({ kind: 'timeout' });

    // oversize body
    const clientOversize = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 10,
      fetch: (async () => new Response(JSON.stringify({ access_token: '1234567890abcdef' }), { status: 200 })) as typeof fetch,
    });
    await expect(clientOversize.getToken()).rejects.toMatchObject({ kind: 'invalid_response' });

    // non-JSON 200 without WAF markers
    const clientNonJson = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response('Hello plain text world', { status: 200 })) as typeof fetch,
    });
    await expect(clientNonJson.getToken()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('400 on today-dated call is retried once with UTC date, a second 400 yields start_date_rejected (never a 3rd call)', async () => {
    // Current time: 2026-10-25 21:00:00 EDT (which is 2026-10-26 01:00:00 UTC)
    // WDW_Today is 2026-10-25; UTC date is 2026-10-26
    const simulatedNow = new Date('2026-10-26T01:00:00.000Z');

    const requestedDates: string[] = [];
    let callCount = 0;

    const mockFetch = (async (input: string | URL | any) => {
      callCount++;
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const startDate = url.searchParams.get('startDate')!;
      requestedDates.push(startDate);

      if (callCount === 1) {
        // First call with 2026-10-25 returns 400
        return new Response('{"errors":[{"message":"Invalid start date"}]}', { status: 400 });
      }
      // Second call with 2026-10-26 succeeds!
      return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
    }) as typeof fetch;

    const client = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: mockFetch,
      now: () => simulatedNow,
    });

    const res = await client.getPrices({
      token: 'tok',
      discountGroup: 'std-gst',
      numDays: 1,
      startDate: '2026-10-25',
      endDate: '2026-10-31',
    });

    expect(requestedDates).toEqual(['2026-10-25', '2026-10-26']);
    expect(res.startDateSent).toBe('2026-10-26');
    expect(callCount).toBe(2);

    // If second call also answers 400, it throws start_date_rejected and makes NO third call
    let count2 = 0;
    const mockFetchBoth400 = (async () => {
      count2++;
      return new Response('{"errors":[{"message":"Invalid start date"}]}', { status: 400 });
    }) as typeof fetch;

    const clientBoth400 = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: mockFetchBoth400,
      now: () => simulatedNow,
    });

    await expect(
      clientBoth400.getPrices({
        token: 'tok',
        discountGroup: 'std-gst',
        numDays: 1,
        startDate: '2026-10-25',
        endDate: '2026-10-31',
      }),
    ).rejects.toMatchObject({
      kind: 'start_date_rejected',
      status: 400,
    });

    expect(count2).toBe(2); // exactly 2 calls, never a third
  });

  it('N11: 400 retry on single-day call sends startDate = endDate = UTC date, full pull keeps endDate, never startDate > endDate', async () => {
    // Current time: 2026-10-25 21:00:00 EDT (2026-10-26 01:00:00 UTC)
    // WDW date: 2026-10-25; UTC date: 2026-10-26
    const simulatedNow = new Date('2026-10-26T01:00:00.000Z');

    // 1. Single-day call (e.g. probe or diagnose: startDate = endDate = WDW date)
    const singleDayCalls: Array<{ startDate: string; endDate: string }> = [];
    const clientSingle = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async (input: string | URL | any) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        const startDate = url.searchParams.get('startDate')!;
        const endDate = url.searchParams.get('endDate')!;
        singleDayCalls.push({ startDate, endDate });

        if (singleDayCalls.length === 1) {
          return new Response('{"errors":[{"message":"Invalid start date"}]}', { status: 400 });
        }
        return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
      }) as typeof fetch,
      now: () => simulatedNow,
    });

    const resSingle = await clientSingle.getPrices({
      token: 'tok',
      discountGroup: 'std-gst',
      numDays: 1,
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });

    expect(resSingle.startDateSent).toBe('2026-10-26');
    expect(singleDayCalls).toHaveLength(2);
    // Initial call: 2026-10-25 -> 2026-10-25
    expect(singleDayCalls[0]).toEqual({ startDate: '2026-10-25', endDate: '2026-10-25' });
    // Retry call: 2026-10-26 -> 2026-10-26 (startDate = endDate = UTC date)
    expect(singleDayCalls[1]).toEqual({ startDate: '2026-10-26', endDate: '2026-10-26' });
    for (const c of singleDayCalls) {
      expect(c.startDate <= c.endDate).toBe(true);
    }

    // 2. Full pull (startDate = WDW date, endDate = horizon date)
    const fullPullCalls: Array<{ startDate: string; endDate: string }> = [];
    const clientFull = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async (input: string | URL | any) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        const startDate = url.searchParams.get('startDate')!;
        const endDate = url.searchParams.get('endDate')!;
        fullPullCalls.push({ startDate, endDate });

        if (fullPullCalls.length === 1) {
          return new Response('{"errors":[{"message":"Invalid start date"}]}', { status: 400 });
        }
        return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
      }) as typeof fetch,
      now: () => simulatedNow,
    });

    const resFull = await clientFull.getPrices({
      token: 'tok',
      discountGroup: 'std-gst',
      numDays: 1,
      startDate: '2026-10-25',
      endDate: '2027-10-25',
    });

    expect(resFull.startDateSent).toBe('2026-10-26');
    expect(fullPullCalls).toHaveLength(2);
    // Initial call: 2026-10-25 -> 2027-10-25
    expect(fullPullCalls[0]).toEqual({ startDate: '2026-10-25', endDate: '2027-10-25' });
    // Retry call: 2026-10-26 -> 2027-10-25 (endDate unchanged)
    expect(fullPullCalls[1]).toEqual({ startDate: '2026-10-26', endDate: '2027-10-25' });
    for (const c of fullPullCalls) {
      expect(c.startDate <= c.endDate).toBe(true);
    }
  });

  it('A5 / N2: 200 JSON body containing Akamai is NOT waf_block, whereas 200 HTML challenge IS waf_block', async () => {
    // 1. 200 JSON with Akamai in string field -> valid 200 response, NOT waf_block
    const jsonWithAkamai = JSON.stringify({
      message: 'Routed through Akamai Edge CDN',
      pricingCalendar: [],
    });
    const clientJson = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response(jsonWithAkamai, { status: 200 })) as typeof fetch,
    });
    const res = await clientJson.getPrices({
      token: 'tok',
      discountGroup: 'std-gst',
      numDays: 1,
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
    expect(res.status).toBe(200);

    // 2. 200 HTML challenge containing Akamai -> NOT valid JSON -> IS waf_block
    const htmlChallenge = '<html><head><title>Akamai Access Denied</title></head><body>Reference #18.123</body></html>';
    const clientHtml = createTicketPriceClient({
      baseUrl,
      userAgent,
      timeoutMs: 5000,
      maxBodyBytes: 100_000,
      fetch: (async () => new Response(htmlChallenge, { status: 200 })) as typeof fetch,
    });
    await expect(
      clientHtml.getPrices({
        token: 'tok',
        discountGroup: 'std-gst',
        numDays: 1,
        startDate: '2026-11-01',
        endDate: '2026-11-01',
      }),
    ).rejects.toMatchObject({ kind: 'waf_block' });
  });

  // Feature: trip-budget, Property 35: The ticket client sends only the documented requests
  it('Property 35: The ticket client sends only the documented requests (fast-check, 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('std-gst', 'fl-resident'),
        fc.integer({ min: 1, max: 10 }),
        fc.string({ minLength: 10, maxLength: 20 }),
        async (discountGroup, numDays, token) => {
          let calledUrl = '';
          let calledHeaders: Record<string, string> = {};

          const mockFetch = (async (input: string | URL | any, init?: any) => {
            calledUrl = typeof input === 'string' ? input : input.toString();
            calledHeaders = (init?.headers as Record<string, string>) || {};
            return new Response(JSON.stringify({ pricingCalendar: [] }), { status: 200 });
          }) as typeof fetch;

          const client = createTicketPriceClient({
            baseUrl,
            userAgent,
            timeoutMs: 5000,
            maxBodyBytes: 100_000,
            fetch: mockFetch,
          });

          await client.getPrices({
            token,
            discountGroup,
            numDays,
            startDate: '2026-11-01',
            endDate: '2026-11-05',
          });

          const url = new URL(calledUrl);
          // Only path P
          expect(url.pathname).toBe(
            '/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices',
          );
          // Required headers
          expect(calledHeaders['User-Agent']).toBe(userAgent);
          expect(calledHeaders['Authorization']).toBe(`BEARER ${token}`);
          expect(calledHeaders['Cookie']).toBeUndefined();

          // Params in bounds
          expect(url.searchParams.get('discountGroup')).toBe(discountGroup);
          expect(Number(url.searchParams.get('numDays'))).toBe(numDays);
          expect(url.searchParams.get('storeId')).toBe('wdw');
          expect(url.searchParams.has('fpAvailability')).toBe(false);
          expect(url.searchParams.has('storeBasedPearlEnabled')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
