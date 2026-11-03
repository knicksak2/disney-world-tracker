import { describe, expect, it } from 'vitest';
import { normalizeErrorCode, TICKET_ERROR_CODES } from '../errorCodes.js';

describe('normalizeErrorCode', () => {
  it('every member of the closed set passes through unchanged', () => {
    for (const code of TICKET_ERROR_CODES) {
      expect(normalizeErrorCode(code)).toBe(code);
    }
  });

  it('accepts valid http_status:<3-digit> codes', () => {
    expect(normalizeErrorCode('http_status:503')).toBe('http_status:503');
    expect(normalizeErrorCode('http_status:404')).toBe('http_status:404');
    expect(normalizeErrorCode('http_status:500')).toBe('http_status:500');
    expect(normalizeErrorCode('http_status:200')).toBe('http_status:200');
  });

  it('normalizes invalid status codes, free text, HTML, and non-strings to invalid_response', () => {
    expect(normalizeErrorCode('http_status:abc')).toBe('invalid_response');
    expect(normalizeErrorCode('http_status:50')).toBe('invalid_response');
    expect(normalizeErrorCode('http_status:5000')).toBe('invalid_response');
    expect(normalizeErrorCode('Internal Server Error')).toBe('invalid_response');
    expect(normalizeErrorCode('<html><body>WAF Block</body></html>')).toBe('invalid_response');
    expect(normalizeErrorCode('<script>alert(1)</script>')).toBe('invalid_response');
    expect(normalizeErrorCode('')).toBe('invalid_response');
    expect(normalizeErrorCode(null)).toBe('invalid_response');
    expect(normalizeErrorCode(undefined)).toBe('invalid_response');
    expect(normalizeErrorCode(123)).toBe('invalid_response');
    expect(normalizeErrorCode({})).toBe('invalid_response');
  });
});
