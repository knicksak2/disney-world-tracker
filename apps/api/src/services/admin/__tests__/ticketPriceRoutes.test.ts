// Feature: trip-budget, Property 38: Admin ticket price operations and visibility
/**
 * Integration tests for Admin Ticket Prices routes (/admin/ticket-prices).
 *
 * Validates: Requirements 11.14, 13.2, 13.10, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.1, 21.2, 21.8
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { adminRoutes, ADMIN_SECTIONS, type AdminRoutesOptions } from '../routes.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo } from '../repo.js';
import type {
  AdminTicketPricesPort,
  AdminTicketPricesState,
} from '../../ticketPrices/adminPort.js';

describe('Admin Ticket Prices Routes (Property 38)', () => {
  const username = 'admin';
  const password = 'supersecretpassword';
  const basicAuth = createBasicAuthHook({ username, password });
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sameOriginHeaders = {
    authorization: authHeader,
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
  };

  function defaultState(overrides: Partial<AdminTicketPricesState> = {}): AdminTicketPricesState {
    return {
      enabled: false,
      control: {
        lastAttemptAt: '2026-10-25T10:00:00.000Z',
        lastProbeAt: '2026-10-25T09:00:00.000Z',
        blockedUntil: null,
        inProgressSince: null,
        observedHorizonDate: '2027-10-25',
        lastDiagnoseAt: null,
        lastStatus: 'success',
        lastError: null,
      },
      sets: [
        {
          discountGroup: 'std-gst',
          numDays: 4,
          asOf: '2026-10-25T08:00:00.000Z',
          horizonDate: '2027-10-25',
          rowCount: 433,
          windowDays: 365,
          lastError: null,
        },
      ],
      totalRows: 1250,
      tableSize: '320 kB',
      config: {
        TICKET_PRICES_BASE_URL: 'https://disneyworld.disney.go.com',
        TICKET_PRICES_GROUPS: 'std-gst',
        TICKET_PRICES_STALE_AFTER_DAYS: 30,
      },
      adultMk1DayPriceCents: 18400,
      ...overrides,
    };
  }

  function createMockTicketPricesPort(overrides: Partial<AdminTicketPricesPort> = {}): AdminTicketPricesPort {
    let blockedUntilTime: string | null = null;
    return {
      readState: async () => defaultState({
        control: {
          ...defaultState().control,
          blockedUntil: blockedUntilTime,
        },
      }),
      runNow: async () => ({ outcome: 'started' }),
      diagnose: async () => ({
        token: { status: 200, bytes: 154, ms: 120 },
        prices: {
          status: 200,
          bytes: 1420500,
          ms: 450,
          wafMarker: false,
          startDateSent: '2026-10-25',
          retried: false,
        },
        maxPricingCalendarDate: '2027-10-25',
        adultMk1DayPriceCents: 18400,
      }),
      blockNow: async () => {
        blockedUntilTime = '2026-10-25T18:00:00.000Z';
        return { blockedUntil: blockedUntilTime };
      },
      ...overrides,
    };
  }

  function buildApp(port?: AdminTicketPricesPort): FastifyInstance {
    const app = Fastify();
    const fakeRepo = createAdminRepo({} as never, {} as never);
    const opts: AdminRoutesOptions = {
      repo: fakeRepo,
      basicAuth,
      ticketPrices: port,
    };
    void app.register(adminRoutes(opts));
    return app;
  }

  it('ADMIN_SECTIONS contains the /admin/ticket-prices path when port is wired', async () => {
    const app = buildApp(createMockTicketPricesPort());
    await app.ready();
    const sec = ADMIN_SECTIONS.find((s) => s.path === '/admin/ticket-prices');
    expect(sec).toBeDefined();
    expect(sec?.category).toBe('Data Ingestion & External Sync');
    expect(sec?.title).toBe('Disney Ticket Prices');
  });

  describe('GET /admin/ticket-prices', () => {
    it('returns 401 without basic auth credentials', async () => {
      const port = createMockTicketPricesPort();
      const app = buildApp(port);
      const res = await app.inject({ method: 'GET', url: '/admin/ticket-prices' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with security headers and renders page components when enabled is false', async () => {
      const port = createMockTicketPricesPort();
      const app = buildApp(port);
      const res = await app.inject({
        method: 'GET',
        url: '/admin/ticket-prices',
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('private, no-store');

      const body = res.body;
      // Kill switch status and operator gate text
      expect(body).toContain('DISABLED');
      expect(body).toContain('Operator launch gate: The kill switch is currently disabled');
      expect(body).toContain('Run the Diagnose action three times at different times of day (including once after 20:00 ET)');

      // Decision text and launch gate pending line
      expect(body).toContain('lets go with optiion 1. just make the spec ill have antigravity implement it');
      expect(body).toContain('owner&#39;s written confirmation pending');
      expect(body).toContain('Revisit notice:');
      expect(body).toContain('Ticket price collection was approved under option 1');

      // Table size and total rows
      expect(body).toContain('320 kB');
      expect(body).toContain('1250');

      // Control row and sets
      expect(body).toContain('std-gst');
      expect(body).toContain('2027-10-25');

      // HTML contains no price input (<input with price editing) and no secret tokens
      expect(body).not.toMatch(/<input[^>]+name=['"]?price/i);
      expect(body).not.toMatch(/<input[^>]+type=['"]?number/i);
    });

    it('renders escaped last_error through table helper (review F19)', async () => {
      const xssScript = '<script>alert(1)</script>';
      const port = createMockTicketPricesPort({
        readState: async () => defaultState({
          control: {
            ...defaultState().control,
            lastError: xssScript,
          },
          sets: [
            {
              ...defaultState().sets[0]!,
              lastError: xssScript,
            },
          ],
        }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'GET',
        url: '/admin/ticket-prices',
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('<script>alert(1)</script>');
      expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('POST /admin/ticket-prices/refresh', () => {
    it('returns 403 on cross-origin request', async () => {
      let ran = false;
      const port = createMockTicketPricesPort({
        runNow: async () => {
          ran = true;
          return { outcome: 'started' };
        },
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/refresh',
        headers: {
          authorization: authHeader,
          host: 'localhost:3000',
          origin: 'http://malicious.example.com',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(ran).toBe(false);
    });

    it('redirects with flash message when accepted', async () => {
      const port = createMockTicketPricesPort({
        runNow: async () => ({ outcome: 'started' }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/refresh',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/admin/ticket-prices?flash=started');
    });

    it('redirects with flash blocked message when blocked', async () => {
      const port = createMockTicketPricesPort({
        runNow: async () => ({ outcome: 'blocked', blockedUntil: '2026-10-25T18:00:00.000Z' }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/refresh',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('flash=blocked%20until%202026-10-25T18%3A00%3A00.000Z');
    });
  });

  describe('POST /admin/ticket-prices/diagnose', () => {
    it('returns 403 on cross-origin request', async () => {
      const port = createMockTicketPricesPort();
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: {
          authorization: authHeader,
          host: 'localhost:3000',
          origin: 'http://malicious.example.com',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('renders result table including startDateSent with kill switch off (round 4 M1)', async () => {
      const port = createMockTicketPricesPort({
        diagnose: async () => ({
          token: { status: 200, bytes: 120, ms: 80 },
          prices: {
            status: 200,
            bytes: 1500000,
            ms: 320,
            wafMarker: false,
            startDateSent: '2026-10-26',
            retried: true,
          },
          maxPricingCalendarDate: '2027-10-25',
          adultMk1DayPriceCents: 18400,
        }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Diagnostic Results');
      expect(res.body).toContain('2026-10-26');
      expect(res.body).toContain('$184.00');
      expect(res.body).toContain('1500000 bytes');
      expect(res.body).not.toContain('Refused');
    });

    it('renders refusal when blocked', async () => {
      const port = createMockTicketPricesPort({
        diagnose: async () => ({
          refused: 'blocked',
          blockedUntil: '2026-10-25T19:00:00.000Z',
        }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Diagnostic refused: blocked');
      expect(res.body).toContain('2026-10-25T19:00:00.000Z');
    });

    it('renders refusal when too_soon', async () => {
      const port = createMockTicketPricesPort({
        diagnose: async () => ({ refused: 'too_soon' }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('must wait 60s between diagnose runs');
    });

    it('renders refusal when already_running', async () => {
      const port = createMockTicketPricesPort({
        diagnose: async () => ({ refused: 'already_running' }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('a refresh run is already in progress');
    });

    it('renders diagnostic error details without producing a 500 when upstream call fails (R6)', async () => {
      const port = createMockTicketPricesPort({
        diagnose: async () => ({
          token: { status: 200, bytes: 120, ms: 50 },
          prices: {
            status: 403,
            bytes: 512,
            ms: 120,
            wafMarker: true,
            startDateSent: '2026-10-25',
            retried: false,
          },
          maxPricingCalendarDate: null,
          adultMk1DayPriceCents: null,
          failure: {
            call: 'prices',
            code: 'waf_block',
            message: 'Akamai WAF challenge received',
          },
        }),
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/diagnose',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Diagnostic Error');
      expect(res.body).toContain('waf_block');
      expect(res.body).toContain('WAF Marker Detected');
      expect(res.body).toContain('true');
    });
  });

  describe('POST /admin/ticket-prices/block (Block now)', () => {
    it('returns 403 on cross-origin request and performs no state change', async () => {
      let blocked = false;
      const port = createMockTicketPricesPort({
        blockNow: async () => {
          blocked = true;
          return { blockedUntil: '2026-10-25T20:00:00.000Z' };
        },
      });
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/block',
        headers: {
          authorization: authHeader,
          host: 'localhost:3000',
          origin: 'http://malicious.example.com',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(blocked).toBe(false);
    });

    it('sets blocked_until and redirects with flash message', async () => {
      const port = createMockTicketPricesPort();
      const app = buildApp(port);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/ticket-prices/block',
        headers: sameOriginHeaders,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('flash=blocked%20until%202026-10-25T18%3A00%3A00.000Z');
    });
  });

  describe('Unwired port behavior', () => {
    it('does not register ticket prices routes when ticketPrices is undefined', async () => {
      const app = buildApp(undefined);
      const res = await app.inject({
        method: 'GET',
        url: '/admin/ticket-prices',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
