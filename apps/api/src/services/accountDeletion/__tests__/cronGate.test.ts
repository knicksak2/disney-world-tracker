import { describe, expect, it } from 'vitest';

import { secretMatches } from '../cronGate.js';

describe('secretMatches', () => {
  const secret = 'test-account-deletion-cron-secret-12345';

  it('accepts an identical secret', () => {
    expect(secretMatches(secret, secret)).toBe(true);
  });

  it('rejects a mismatch of the same length', () => {
    expect(secretMatches('test-account-deletion-cron-secret-12346', secret)).toBe(false);
  });

  it('rejects a different length (prefix, longer, and padded)', () => {
    expect(secretMatches(secret.slice(0, -1), secret)).toBe(false);
    expect(secretMatches(secret + 'x', secret)).toBe(false);
    expect(secretMatches(` ${secret}`, secret)).toBe(false);
  });

  it('rejects an empty provided value', () => {
    expect(secretMatches('', secret)).toBe(false);
  });

  it('rejects an empty expected value, even when both are empty', () => {
    expect(secretMatches('anything', '')).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });

  it('rejects non-string provided values (missing header, repeated header array, number, null)', () => {
    expect(secretMatches(undefined, secret)).toBe(false);
    expect(secretMatches([secret, secret], secret)).toBe(false);
    expect(secretMatches(12345, secret)).toBe(false);
    expect(secretMatches(null, secret)).toBe(false);
  });

  it("does not match another cron's secret", () => {
    expect(secretMatches('test-trip-booking-cron-secret-12345', secret)).toBe(false);
  });
});
