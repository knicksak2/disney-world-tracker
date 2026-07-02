/**
 * Tests for the public dining-menu source mapping (restaurant-menu-display).
 *
 * `projectDiningMenuPayload` maps the anonymous website dining-menu payload
 * (captured verbatim from
 * `disneyworld.disney.go.com/dining/dinemenu/api/menu?searchTerm=...`) into the
 * tolerant `RawMenu[]` shape consumed by `projectMenus`, and `formatDiningPrice`
 * renders the structured `prices[]` array into a display string. The
 * `createDiningMenuClient` wiring is covered by asserting it routes through the
 * injected transport and treats a 404 as "no menus".
 */

import { describe, expect, it, vi } from 'vitest';

import { projectMenus } from '../menu.js';
import {
  createDiningMenuClient,
  formatDiningPrice,
  projectDiningMenuPayload,
} from '../diningMenuClient.js';
import type { DisneyTransport } from '../transport.js';

// A trimmed but structurally faithful capture of a real response
// (Amare-style a-la-carte + 1900-Park-Fare-style buffet with no per-item price).
const REAL_PAYLOAD = {
  name: 'Amare',
  location: "Walt Disney World Swan Reserve",
  destinationId: 'WDW',
  mealPeriodsList: [
    { name: 'Breakfast', label: 'Breakfast' },
    { name: 'Dinner', label: 'Dinner', isActive: true },
  ],
  mealPeriods: [
    {
      name: 'Breakfast',
      label: 'Breakfast',
      experience: 'Signature Dining',
      serviceStyle: 'A la Carte',
      groups: [
        {
          name: 'Eggs',
          type: 'Entree',
          items: [
            {
              title: 'The Reg',
              prices: [{ withoutTax: 20, type: 'Per Serving', currency: 'USD' }],
              pricesRange: false,
              description: 'Two Eggs Any Style',
            },
            {
              title: 'Buffet Plate',
              prices: [],
              pricesRange: false,
              description: '',
            },
          ],
        },
      ],
    },
    {
      name: 'Dinner',
      label: 'Dinner',
      experience: 'Signature Dining',
      serviceStyle: 'A la Carte',
      groups: [
        {
          name: 'Mains',
          type: 'Entree',
          items: [
            {
              title: 'Branzino',
              prices: [
                { withoutTax: 42, type: 'Lunch', currency: 'USD' },
                { withoutTax: 48, type: 'Dinner', currency: 'USD' },
              ],
              pricesRange: false,
              description: '',
            },
          ],
        },
      ],
    },
  ],
};

describe('formatDiningPrice', () => {
  it('formats a single USD price', () => {
    expect(formatDiningPrice([{ withoutTax: 20, currency: 'USD' }])).toBe('$20');
  });

  it('joins multiple prices', () => {
    expect(
      formatDiningPrice([
        { withoutTax: 42, currency: 'USD' },
        { withoutTax: 48, currency: 'USD' },
      ]),
    ).toBe('$42 / $48');
  });

  it('keeps cents when present', () => {
    expect(formatDiningPrice([{ withoutTax: 12.5, currency: 'USD' }])).toBe('$12.50');
  });

  it('returns null for an empty or missing price array', () => {
    expect(formatDiningPrice([])).toBeNull();
    expect(formatDiningPrice(undefined)).toBeNull();
    expect(formatDiningPrice('nope')).toBeNull();
  });

  it('prefixes an unknown currency code', () => {
    expect(formatDiningPrice([{ withoutTax: 5, currency: 'CAD' }])).toBe('CAD 5');
  });
});

describe('projectDiningMenuPayload', () => {
  it('maps meal periods → menus preserving order, with prices and empty-price fallback', () => {
    const raw = projectDiningMenuPayload(REAL_PAYLOAD);
    // Runs cleanly through the existing pure projection.
    const menus = projectMenus(raw);

    expect(menus).toEqual([
      {
        menuType: 'Breakfast',
        cuisineType: null,
        groups: [
          {
            name: 'Eggs',
            items: [
              { name: 'The Reg', price: '$20' },
              { name: 'Buffet Plate', price: null },
            ],
          },
        ],
      },
      {
        menuType: 'Dinner',
        cuisineType: null,
        groups: [
          {
            name: 'Mains',
            items: [{ name: 'Branzino', price: '$42 / $48' }],
          },
        ],
      },
    ]);
  });

  it('returns [] for a {statusCode:404} / unexpected body', () => {
    expect(projectDiningMenuPayload({ statusCode: 404 })).toEqual([]);
    expect(projectDiningMenuPayload(null)).toEqual([]);
    expect(projectDiningMenuPayload({})).toEqual([]);
    expect(projectDiningMenuPayload({ mealPeriods: 'nope' })).toEqual([]);
  });
});

describe('createDiningMenuClient', () => {
  it('requests the searchTerm through the shared transport and projects the body', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      text: JSON.stringify(REAL_PAYLOAD),
    });
    const transport = { request } as unknown as DisneyTransport;
    const client = createDiningMenuClient({ transport, baseUrl: 'https://x.test/menu' });

    const menus = await client.getMenus('90001212;entityType=restaurant');

    expect(request).toHaveBeenCalledTimes(1);
    const spec = request.mock.calls[0]![0] as { url: string; target: string; method: string };
    expect(spec.target).toBe('web');
    expect(spec.method).toBe('GET');
    expect(spec.url).toBe(
      'https://x.test/menu?searchTerm=90001212%3BentityType%3Drestaurant',
    );
    expect(menus).toHaveLength(2);
    expect(menus[0]!.menuType).toBe('Breakfast');
  });

  it('treats a 404 transport error as "no menus" ([])', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('nf'), { status: 404, kind: 'http_status' }));
    const transport = { request } as unknown as DisneyTransport;
    const client = createDiningMenuClient({ transport });

    await expect(client.getMenus('unknown')).resolves.toEqual([]);
  });

  it('propagates non-404 transport errors (seam degrades to cache)', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('waf'), { status: 403, kind: 'waf_block' }));
    const transport = { request } as unknown as DisneyTransport;
    const client = createDiningMenuClient({ transport });

    await expect(client.getMenus('x')).rejects.toThrow('waf');
  });
});

describe('createDiningMenuClient observability', () => {
  function makeLogger() {
    return { warn: vi.fn(), debug: vi.fn() };
  }
  function transportReturning(text: string): DisneyTransport {
    return { request: vi.fn().mockResolvedValue({ status: 200, headers: {}, text }) } as unknown as DisneyTransport;
  }

  it('warns when a 200 response is not JSON (contract change signal)', async () => {
    const logger = makeLogger();
    const client = createDiningMenuClient({
      transport: transportReturning('<html>Access Denied</html>'),
      logger,
    });

    await expect(client.getMenus('x')).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![1]).toMatch(/not JSON/i);
  });

  it('warns when a 200 JSON body is missing the mealPeriods array', async () => {
    const logger = makeLogger();
    const client = createDiningMenuClient({
      transport: transportReturning(JSON.stringify({ name: 'X', unexpected: true })),
      logger,
    });

    await expect(client.getMenus('x')).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![1]).toMatch(/mealPeriods/);
  });

  it('does NOT warn for a legitimately empty menu (empty mealPeriods array)', async () => {
    const logger = makeLogger();
    const client = createDiningMenuClient({
      transport: transportReturning(JSON.stringify({ name: 'X', mealPeriods: [] })),
      logger,
    });

    await expect(client.getMenus('x')).resolves.toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for the statusCode:404 no-menu sentinel', async () => {
    const logger = makeLogger();
    const client = createDiningMenuClient({
      transport: transportReturning(JSON.stringify({ statusCode: 404 })),
      logger,
    });

    await expect(client.getMenus('x')).resolves.toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('does NOT warn on a valid menu payload', async () => {
    const logger = makeLogger();
    const client = createDiningMenuClient({ transport: transportReturning(JSON.stringify(REAL_PAYLOAD)), logger });

    const menus = await client.getMenus('x');
    expect(menus).toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
