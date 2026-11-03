import { describe, expect, it } from 'vitest';
import { InvalidResponse, parsePricesResponse } from '../parsePricesResponse.js';

describe('parsePricesResponse (contract test with realistic Endpoint P fixture)', () => {
  it('parses realistic 4-day response fixture (8 entries: 2 ages x 4 options)', () => {
    const fixture = {
      maxPricingCalendarDate: '2027-12-31',
      pricingCalendar: [
        {
          numDays: '4', // string format
          dates: [
            {
              date: '2026-11-15',
              validityStartDate: '2026-11-15',
              validityEndDate: '2026-11-21',
              bufferDays: 3,
              currency: 'USD',
              pricing: [
                // Adult base
                {
                  id: 'theme-park_4_A_0_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  pricePerDay: '174.34',
                  subtotal: '697.36',
                  tax: '45.33',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Child base
                {
                  id: 'theme-park_4_C_0_0_RF_AF_SOF_progenstr',
                  ageGroup: 'child',
                  pricePerDay: '169.34',
                  subtotal: '677.36',
                  tax: '44.03',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Adult Park Hopper
                {
                  id: 'theme-park_4_A_P_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  pricePerDay: '199.34',
                  subtotal: '797.36',
                  tax: '51.83',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Child Park Hopper
                {
                  id: 'theme-park_4_C_P_0_RF_AF_SOF_progenstr',
                  ageGroup: 'child',
                  pricePerDay: '194.34',
                  subtotal: '777.36',
                  tax: '50.53',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Adult Park Hopper Plus
                {
                  id: 'theme-park_4_A_PHP_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  pricePerDay: '204.09',
                  subtotal: '816.36',
                  tax: '53.06',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Child Park Hopper Plus
                {
                  id: 'theme-park_4_C_PHP_0_RF_AF_SOF_progenstr',
                  ageGroup: 'child',
                  pricePerDay: '199.09',
                  subtotal: '796.36',
                  tax: '51.76',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Adult Water Parks & Sports
                {
                  id: 'theme-park_4_A_WPS_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  pricePerDay: '191.84',
                  subtotal: '767.36',
                  tax: '49.88',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Child Water Parks & Sports
                {
                  id: 'theme-park_4_C_WPS_0_RF_AF_SOF_progenstr',
                  ageGroup: 'child',
                  pricePerDay: '186.84',
                  subtotal: '747.36',
                  tax: '48.58',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Not sellable (stopSale = true)
                {
                  id: 'theme-park_4_A_0_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  subtotal: '697.36',
                  stopSale: true,
                  availability: true,
                  enabled: true,
                },
                // Unrecognized id
                {
                  id: 'unrecognized_product_id',
                  ageGroup: 'adult',
                  subtotal: '697.36',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
                // Invalid price (non-numeric subtotal)
                {
                  id: 'theme-park_4_A_0_0_RF_AF_SOF_progenstr',
                  ageGroup: 'adult',
                  subtotal: 'N/A',
                  stopSale: false,
                  availability: true,
                  enabled: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parsePricesResponse(fixture, { numDays: 4, discountGroup: 'std-gst' });

    expect(parsed.horizonDate).toBe('2027-12-31');
    expect(parsed.rows).toHaveLength(8);
    expect(parsed.skippedNotSellable).toBe(1);
    expect(parsed.skippedUnrecognized).toBe(1);
    expect(parsed.invalidPriceCount).toBe(1);

    // Verify subtotal was parsed to cents (697.36 -> 69736) and pricePerDay was ignored
    const adultBase = parsed.rows.find((r) => r.optionCode === 'base' && r.ageGroup === 'adult');
    expect(adultBase).toBeDefined();
    expect(adultBase?.priceCents).toBe(69736);
    expect(adultBase?.taxCents).toBe(4533);
    expect(adultBase?.startDate).toBe('2026-11-15');
    expect(adultBase?.validEndDate).toBe('2026-11-21');
    expect(adultBase?.park).toBe('any');
  });

  it('parses realistic 1-day response fixture (12 entries: 4 parks x 2 ages for base + 2 ages x 2 hoppers)', () => {
    const parks: ('mk' | 'ep' | 'hs' | 'ak')[] = ['mk', 'ep', 'hs', 'ak'];
    const pricing: any[] = [];

    // 4 parks x 2 ages for base = 8 entries
    for (const p of parks) {
      pricing.push({
        id: `theme-park_1_A_0_0_RF_AF_SOF_progenstr_${p}`,
        ageGroup: 'adult',
        subtotal: '199.00',
        tax: '12.94',
        stopSale: false,
        availability: true,
        enabled: true,
      });
      pricing.push({
        id: `theme-park_1_C_0_0_RF_AF_SOF_progenstr_${p}`,
        ageGroup: 'child',
        subtotal: '194.00',
        tax: '12.61',
        stopSale: false,
        availability: true,
        enabled: true,
      });
    }

    // 2 ages x Park Hopper = 2 entries
    pricing.push({
      id: 'theme-park_1_A_P_0_RF_AF_SOF_progenstr',
      ageGroup: 'adult',
      subtotal: '264.00',
      tax: '17.16',
      stopSale: false,
      availability: true,
      enabled: true,
    });
    pricing.push({
      id: 'theme-park_1_C_P_0_RF_AF_SOF_progenstr',
      ageGroup: 'child',
      subtotal: '259.00',
      tax: '16.84',
      stopSale: false,
      availability: true,
      enabled: true,
    });

    // 2 ages x Park Hopper Plus = 2 entries (total = 12 entries)
    pricing.push({
      id: 'theme-park_1_A_PHP_0_RF_AF_SOF_progenstr',
      ageGroup: 'adult',
      subtotal: '284.00',
      tax: '18.46',
      stopSale: false,
      availability: true,
      enabled: true,
    });
    pricing.push({
      id: 'theme-park_1_C_PHP_0_RF_AF_SOF_progenstr',
      ageGroup: 'child',
      subtotal: '279.00',
      tax: '18.14',
      stopSale: false,
      availability: true,
      enabled: true,
    });

    const fixture = {
      maxPricingCalendarDate: '2027-12-31',
      pricingCalendar: [
        {
          numDays: 1,
          dates: [
            {
              date: '2026-11-15',
              validityStartDate: '2026-11-15',
              validityEndDate: '2026-11-15',
              pricing,
            },
          ],
        },
      ],
    };

    const parsed = parsePricesResponse(fixture, { numDays: 1, discountGroup: 'std-gst' });
    expect(parsed.rows).toHaveLength(12);

    const mkAdultBase = parsed.rows.find((r) => r.optionCode === 'base' && r.park === 'mk' && r.ageGroup === 'adult');
    expect(mkAdultBase).toBeDefined();
    expect(mkAdultBase?.priceCents).toBe(19900);
    expect(mkAdultBase?.park).toBe('mk');

    const epAdultBase = parsed.rows.find((r) => r.optionCode === 'base' && r.park === 'ep' && r.ageGroup === 'adult');
    expect(epAdultBase).toBeDefined();
    expect(epAdultBase?.priceCents).toBe(19900);
    expect(epAdultBase?.park).toBe('ep');
  });

  it('throws typed InvalidResponse on malformed body', () => {
    expect(() => parsePricesResponse({}, { numDays: 4, discountGroup: 'std-gst' })).toThrowError(InvalidResponse);
    expect(() => parsePricesResponse({ maxPricingCalendarDate: '2027-12-31' }, { numDays: 4, discountGroup: 'std-gst' })).toThrowError(InvalidResponse);
    expect(() => parsePricesResponse('not json', { numDays: 4, discountGroup: 'std-gst' })).toThrowError(InvalidResponse);
    expect(() => parsePricesResponse(null, { numDays: 4, discountGroup: 'std-gst' })).toThrowError(InvalidResponse);
  });
});
