/**
 * Closed set of ticket error codes and error normalization (Requirement 11.14, review F19).
 */

export const TICKET_ERROR_CODES = [
  'invalid_response',
  'not_offered',
  'start_date_rejected',
  'row_count_drop',
  'empty',
  'invalid_price',
  'unrecognized_fraction',
  'network',
  'timeout',
  'waf_block',
  'manual',
  'consecutive_failures',
  'horizon_changed',
] as const;

export type StaticTicketErrorCode = (typeof TICKET_ERROR_CODES)[number];
export type TicketErrorCode = StaticTicketErrorCode | `http_status:${number}`;

const HTTP_STATUS_REGEX = /^http_status:\d{3}$/;

/**
 * Normalizes any raw error string to a valid Ticket_Error_Code.
 * Accepts any code in TICKET_ERROR_CODES or the pattern http_status:<3 digits>.
 * Normalizes any other string, HTML, free text, or non-string to 'invalid_response'.
 */
export function normalizeErrorCode(raw: unknown): string {
  if (typeof raw !== 'string') {
    return 'invalid_response';
  }
  const s = raw.trim();
  if ((TICKET_ERROR_CODES as readonly string[]).includes(s)) {
    return s;
  }
  if (HTTP_STATUS_REGEX.test(s)) {
    return s;
  }
  return 'invalid_response';
}
