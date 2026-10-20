// Feature: photo-uploads, Property 27: Admin POST same-origin protection

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IncomingHttpHeaders } from 'node:http';
import { isSameOriginRequest } from '../sameOrigin.js';

/**
 * Independent oracle for Property 27.
 */
function oracleSameOrigin(headers: IncomingHttpHeaders): boolean {
  const sfs = headers['sec-fetch-site'];
  if (sfs !== undefined && sfs !== '') {
    const val = Array.isArray(sfs) ? sfs[0] : sfs;
    return val === 'same-origin';
  }

  const origin = headers['origin'];
  if (origin !== undefined && origin !== '') {
    const originVal = Array.isArray(origin) ? origin[0] : origin;
    const host = headers['host'];
    if (!host) return false;
    const hostVal = Array.isArray(host) ? host[0] : host;
    try {
      const u = new URL(originVal);
      return u.host.toLowerCase() === hostVal.toLowerCase();
    } catch {
      return false;
    }
  }

  return true;
}

describe('Property 27: Admin POST same-origin protection', () => {
  it('isSameOriginRequest matches oracle across arbitrary header combinations (>=100 runs)', () => {
    const secFetchSiteArb = fc.oneof(
      fc.constant('same-origin'),
      fc.constant('cross-site'),
      fc.constant('same-site'),
      fc.constant('none'),
      fc.string(),
      fc.constant(undefined),
      fc.constant(''),
    );

    const hostArb = fc.oneof(
      fc.constant('example.com'),
      fc.constant('example.com:3000'),
      fc.constant('evil.com'),
      fc.constant('admin.wdw.internal'),
      fc.constant(undefined),
    );

    const originArb = fc.oneof(
      fc.constant('https://example.com'),
      fc.constant('https://example.com:3000'),
      fc.constant('https://evil.com'),
      fc.constant('https://admin.wdw.internal'),
      fc.constant('null'),
      fc.constant('not-a-valid-url'),
      fc.constant(undefined),
      fc.constant(''),
    );

    fc.assert(
      fc.property(
        secFetchSiteArb,
        originArb,
        hostArb,
        (secFetchSite, origin, host) => {
          const headers: IncomingHttpHeaders = {};
          if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite;
          if (origin !== undefined) headers['origin'] = origin;
          if (host !== undefined) headers['host'] = host;

          const actual = isSameOriginRequest(headers);
          const expected = oracleSameOrigin(headers);

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('specific edge cases behavior', () => {
    // 1. Both present: sec-fetch-site takes precedence
    expect(
      isSameOriginRequest({
        'sec-fetch-site': 'same-origin',
        origin: 'https://evil.example',
        host: 'good.example',
      }),
    ).toBe(true);

    expect(
      isSameOriginRequest({
        'sec-fetch-site': 'cross-site',
        origin: 'https://good.example',
        host: 'good.example',
      }),
    ).toBe(false);

    // 2. Only origin present
    expect(
      isSameOriginRequest({
        origin: 'https://good.example',
        host: 'good.example',
      }),
    ).toBe(true);

    expect(
      isSameOriginRequest({
        origin: 'https://good.example:8080',
        host: 'good.example:8080',
      }),
    ).toBe(true);

    expect(
      isSameOriginRequest({
        origin: 'https://evil.example',
        host: 'good.example',
      }),
    ).toBe(false);

    // 3. Neither present: non-browser client allowed
    expect(isSameOriginRequest({})).toBe(true);
    expect(isSameOriginRequest({ host: 'good.example' })).toBe(true);
  });
});
