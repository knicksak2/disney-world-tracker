/**
 * Same-origin check for Admin POST requests.
 *
 * Validates: Requirements 18.9, Property 27
 */

import type { IncomingHttpHeaders } from 'node:http';

/**
 * Checks whether an incoming HTTP request is same-origin.
 *
 * Algorithm (Requirement 18.9, Property 27):
 * 1. IF `Sec-Fetch-Site` is present: true only when equal to `'same-origin'`.
 * 2. ELSE IF `Origin` is present: true only when origin's host equals request's `Host`.
 * 3. ELSE: true (non-browser client).
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders): boolean {
  const rawSecFetchSite = headers['sec-fetch-site'];
  if (rawSecFetchSite !== undefined && rawSecFetchSite !== '') {
    const val = Array.isArray(rawSecFetchSite) ? rawSecFetchSite[0] : rawSecFetchSite;
    return val === 'same-origin';
  }

  const rawOrigin = headers['origin'];
  if (rawOrigin !== undefined && rawOrigin !== '') {
    const originVal = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    const rawHost = headers['host'];
    if (!rawHost) {
      return false;
    }
    const hostVal = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    try {
      const parsed = new URL(originVal);
      return parsed.host.toLowerCase() === hostVal.toLowerCase();
    } catch {
      return false;
    }
  }

  return true;
}
