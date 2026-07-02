/**
 * Pure classification of a Disney_Source HTTP response into a
 * `DisneyClassification` — the failure kind plus whether it is retriable —
 * used by the `Disney_Transport` to decide between retry, fail-fast, and
 * success (design.md → "1a. classifyDisneyResponse (pure)").
 *
 * This module mirrors the purity discipline of its siblings
 * (`classifyFacility.ts`, `enrich.ts`, …):
 *
 *   - **Pure**: depends only on its argument; no I/O, no clock, no globals.
 *   - **Total**: defined for every `{ target, status, body }`, including
 *     unexpected status codes; never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs, so it is a
 *     sound property-test target (see Property 5).
 *
 * Classification rules (R4.1–R4.5):
 *
 *   | Status / body                                   | kind             | retriable |
 *   | ----------------------------------------------- | ---------------- | --------- |
 *   | `2xx`                                           | (not a failure → `null`) | —  |
 *   | `403`/`429` **with** an Akamai/edge WAF marker  | `waf_block`      | `true`    |
 *   | `401`                                           | `auth_failure`   | `false`   |
 *   | `403` **without** a WAF marker                  | `auth_failure`   | `false`   |
 *   | `429` **without** a WAF marker                  | `http_status`    | `true`    |
 *   | `5xx`                                           | `http_status`    | `true`    |
 *   | any other non-2xx (e.g. `400`, `404`)           | `http_status`    | `false`   |
 *
 * WAF detection is a body-content check (case-insensitive substring match on
 * the Akamai "Access Denied" / edge rate-limit markers) combined with the
 * status code, so a genuine JSON `403`/`429` from the gateway is classified as
 * an Auth_Failure (or a transient rate-limit), never as a WAF_Block (R4.1,
 * R4.3). WAF and auth are distinct kinds, so the transport and Sync_Run_History
 * can tell an edge block (transient, retriable) apart from a credential failure
 * (fatal) (R4.5).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import type { DisneyClassification, DisneyTarget } from '@dwt/shared';

/**
 * Case-insensitive substring markers that identify an Akamai edge
 * "Access Denied" / rate-limit denial page (R4.1). These phrases appear in the
 * HTML body Akamai returns for a WAF/rate block and are absent from the JSON
 * error bodies the Disney_Sync_Gateway returns for a genuine credential
 * rejection, so they discriminate a WAF_Block from an Auth_Failure.
 *
 * Compared against a lower-cased copy of the response body, so every entry is
 * itself lower-cased.
 */
export const DISNEY_WAF_BODY_MARKERS: readonly string[] = [
  'access denied',
  "you don't have permission to access",
  'reference #',
  'akamai',
  'edgesuite',
  'edge rate',
  'rate limit exceeded',
];

/**
 * The HTTP statuses that can carry a WAF_Block: an Akamai edge "Access Denied"
 * (`403`) or an edge rate-limit denial (`429`) (R4.1).
 */
const WAF_ELIGIBLE_STATUSES: ReadonlySet<number> = new Set([403, 429]);

/** True when `body` contains any Akamai/edge WAF marker (case-insensitive). */
function hasWafBodyMarker(body: string): boolean {
  const haystack = body.toLowerCase();
  return DISNEY_WAF_BODY_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Classify a Disney_Source response.
 *
 * Returns `null` when the response is a success (`2xx`) and the caller may
 * proceed; otherwise returns the {@link DisneyClassification} describing the
 * failure kind and whether the `Disney_Transport` should retry it.
 */
export function classifyDisneyResponse(input: {
  readonly target: DisneyTarget;
  readonly status: number;
  readonly body: string;
}): DisneyClassification | null {
  const { status, body } = input;

  // 2xx — not a failure; the caller proceeds (R4, design 1a).
  if (status >= 200 && status <= 299) {
    return null;
  }

  // 403/429 with an Akamai "Access Denied" / edge rate-limit body marker is a
  // WAF_Block — transient and retriable (R4.1, R4.2).
  if (WAF_ELIGIBLE_STATUSES.has(status) && hasWafBodyMarker(body)) {
    return { kind: 'waf_block', retriable: true, status };
  }

  // 401, or a 403 without a WAF marker, is a genuine Auth_Failure — fatal and
  // non-retriable (R4.3, R4.4).
  if (status === 401 || status === 403) {
    return { kind: 'auth_failure', retriable: false, status };
  }

  // 429 without a WAF marker (a plain rate-limit) and any 5xx are transient
  // server-side conditions worth a bounded retry (design 1a, R3).
  if (status === 429 || status >= 500) {
    return { kind: 'http_status', retriable: true, status };
  }

  // Any other non-2xx (e.g. 400, 404) is a generic, non-retriable HTTP status.
  return { kind: 'http_status', retriable: false, status };
}
