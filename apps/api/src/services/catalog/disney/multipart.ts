/**
 * Facilities_Parser — `multipart/related` body parser for `POST /_bulk_get`.
 *
 * The `Disney_Sync_Gateway` `POST /_bulk_get` endpoint answers with a
 * `multipart/related` body whose parts are the individual JSON documents that
 * were requested by id. This module turns that raw wire body into a list of
 * `FacilityDocument`s, following design.md → "2. Facilities_Parser" and
 * Requirement 3 ("Resilient Response Parsing"):
 *
 *   - **Format concern only (R3.1).** The parser reads the MIME boundary from
 *     the `Content-Type` header, splits the body into parts on that boundary,
 *     and JSON-parses each part's payload into a document. It performs no
 *     business-level exclusion: dropping tombstones (`softDeleted`) and
 *     blank-name documents (R3.4, R3.7) belongs to the sync orchestrator's
 *     normalization step so this module stays a pure format concern.
 *
 *   - **Per-part resilience (R3.3).** A part whose payload cannot be JSON-parsed
 *     into a document object is excluded and parsing continues with the
 *     remaining parts. A single malformed part therefore never fails a whole
 *     sync.
 *
 *   - **Whole-body failure (R3.2).** Only when the body yields no document at
 *     all — an unreadable boundary, or every part failing to parse — does the
 *     parser raise `UpstreamError('invalid_response')`. The orchestrator then
 *     leaves the upstream entity set unchanged.
 *
 * Purity note: `parseBulkGet` is pure, total (apart from the documented
 * `invalid_response` throw), and deterministic over `(contentType, body)`,
 * which makes both the "encode N docs → recover N docs" and the "one bad part
 * among good parts" behaviours directly property-testable.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import type { FacilityDocument } from './facilityDoc.js';
import { normalizeFacilityDocument } from './facilityDoc.js';
import { UpstreamError } from '../themeparks.js';

/**
 * The result of parsing a `POST /_bulk_get` `multipart/related` body: the
 * documents recovered from the parts that parsed successfully.
 */
export interface ParseResult {
  /** Every part that JSON-parsed into a document object, in body order. */
  readonly documents: readonly FacilityDocument[];
}

/**
 * Matches the `boundary` parameter of a `multipart/*` `Content-Type` header,
 * accepting either a quoted (`boundary="..."`) or an unquoted
 * (`boundary=...`) form. The unquoted form is terminated by the next `;` or
 * whitespace, per RFC 2045 token rules.
 */
const BOUNDARY_PATTERN = /boundary=(?:"([^"]+)"|([^;\s]+))/i;

/**
 * A blank line: the CRLF (or bare LF) that separates a MIME part's headers
 * from its body. Tolerant of servers that emit `\n` rather than `\r\n`.
 */
const HEADER_BODY_SEPARATOR = /\r?\n\r?\n/;

/**
 * Parse a `multipart/related` `POST /_bulk_get` body into individual
 * documents.
 *
 * @param contentType - The response `Content-Type` header, carrying the MIME
 *   `boundary` parameter (e.g. `multipart/related; boundary=abc123`).
 * @param body - The raw response body.
 * @returns The recovered documents.
 * @throws {UpstreamError} With discriminator `invalid_response` when the body
 *   yields no document at all (unreadable boundary or every part malformed),
 *   per R3.2.
 */
export function parseBulkGet(contentType: string, body: string): ParseResult {
  const boundary = readBoundary(contentType);
  if (boundary === null) {
    // Without a boundary the body cannot be split into any part, so no
    // document can be recovered — a whole-body parse failure (R3.2).
    throw new UpstreamError(
      'invalid_response',
      'multipart/related bulk_get body has no readable MIME boundary in its Content-Type.',
    );
  }

  const documents: FacilityDocument[] = [];
  for (const part of splitParts(body, boundary)) {
    const doc = parsePart(part);
    if (doc !== null) {
      documents.push(doc);
    }
    // A part that fails to parse is silently excluded (R3.3).
  }

  if (documents.length === 0) {
    // The body was structurally present but no part yielded a document — a
    // whole-body parse failure (R3.2).
    throw new UpstreamError(
      'invalid_response',
      'multipart/related bulk_get body yielded no parseable document.',
    );
  }

  return { documents };
}

/**
 * Read the MIME `boundary` parameter from a `Content-Type` header. Returns
 * `null` when the header carries no readable boundary.
 */
function readBoundary(contentType: string): string | null {
  const match = BOUNDARY_PATTERN.exec(contentType);
  if (match === null) {
    return null;
  }
  // Group 1 is the quoted form, group 2 the unquoted form; exactly one is set.
  const boundary = match[1] ?? match[2];
  if (boundary === undefined || boundary.length === 0) {
    return null;
  }
  return boundary;
}

/**
 * Split a `multipart/related` body into its raw part segments (headers +
 * payload), discarding the preamble, the closing delimiter, and any empty
 * segments. The MIME delimiter is `--<boundary>`.
 */
function splitParts(body: string, boundary: string): readonly string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  for (const segment of body.split(delimiter)) {
    const trimmed = segment.trim();
    // Skip the empty preamble/epilogue and the closing `--` marker segment.
    if (trimmed.length === 0 || trimmed.startsWith('--')) {
      continue;
    }
    parts.push(segment);
  }
  return parts;
}

/**
 * Parse a single raw MIME part into a document, or return `null` when the
 * part's payload is not a JSON object (R3.3).
 */
function parsePart(rawPart: string): FacilityDocument | null {
  const payload = extractPayload(rawPart).trim();
  if (payload.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }

  // A document is a JSON object; arrays, primitives, and `null` are not
  // documents and are excluded.
  if (!isPlainObject(parsed)) {
    return null;
  }

  // Normalize the raw Couchbase document into a FacilityDocument whose `id` is
  // the clean Enterprise_Id (derived from a clean `id` or from the
  // channel-prefixed `_id`). A document carrying no Enterprise_Id token cannot
  // be keyed and is dropped like any other malformed part (R3.3).
  return normalizeFacilityDocument(parsed);
}

/**
 * Strip a MIME part's headers, returning just its payload. The payload begins
 * after the first blank line; when a part carries no headers (no blank-line
 * separator) the whole segment is treated as the payload.
 */
function extractPayload(rawPart: string): string {
  const separator = HEADER_BODY_SEPARATOR.exec(rawPart);
  if (separator === null) {
    return rawPart;
  }
  return rawPart.slice(separator.index + separator[0].length);
}

/** True for plain JSON-like objects (i.e. not arrays, not `null`). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
