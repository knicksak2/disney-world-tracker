/**
 * Tests for the account-deletion shared contract: constants, `isDeletedUserId`,
 * the five Zod schemas, and the four error codes.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.5, 16.6
 */

import { describe, expect, it } from 'vitest';
import {
  DELETE_ACCOUNT_CONFIRMATION_PHRASE,
  DELETED_USER_DISPLAY_NAME,
  DELETED_USER_ID_PREFIX,
  ERROR_CODES,
  authSessionResponseSchema,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  errorCodeToHttpStatus,
  isDeletedUserId,
  reauthRequestSchema,
  reauthResponseSchema,
} from '../index.js';

const USER_ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const SESSION_BODY = {
  user: { id: USER_ID, email: 'guest@example.com' },
  profile: { displayName: 'Guest' },
  token: 'opaque-session-token',
};

describe('account-deletion constants', () => {
  it('pins the phrase, the placeholder name and the id prefix', () => {
    expect(DELETE_ACCOUNT_CONFIRMATION_PHRASE).toBe('DELETE');
    expect(DELETED_USER_DISPLAY_NAME).toBe('Deleted user');
    expect(DELETED_USER_ID_PREFIX).toBe('deadc0de-');
  });
});

describe('isDeletedUserId', () => {
  it('is true for a deadc0de- UUID', () => {
    expect(isDeletedUserId('deadc0de-1234-4abc-8def-0123456789ab')).toBe(true);
  });

  it('is true regardless of hex case', () => {
    expect(isDeletedUserId('DEADC0DE-1234-4abc-8def-0123456789ab')).toBe(true);
  });

  it('is false for an ordinary v4 UUID', () => {
    expect(isDeletedUserId(USER_ID)).toBe(false);
  });

  it('is false for the display name and for empty / non-string input', () => {
    expect(isDeletedUserId('Deleted user')).toBe(false);
    expect(isDeletedUserId('')).toBe(false);
    expect(isDeletedUserId(undefined as unknown as string)).toBe(false);
  });

  it('is false when the prefix appears anywhere but the start', () => {
    expect(isDeletedUserId('x-deadc0de-1234-4abc-8def-0123456789ab')).toBe(false);
  });
});

describe('reauthRequestSchema', () => {
  it('accepts a non-empty password up to 128 characters', () => {
    expect(reauthRequestSchema.parse({ password: 'hunter2' }).password).toBe('hunter2');
    expect(reauthRequestSchema.safeParse({ password: 'a'.repeat(128) }).success).toBe(true);
  });

  it('rejects an empty password, a 129-character password and an unknown key', () => {
    expect(reauthRequestSchema.safeParse({ password: '' }).success).toBe(false);
    expect(reauthRequestSchema.safeParse({ password: 'a'.repeat(129) }).success).toBe(false);
    expect(reauthRequestSchema.safeParse({ password: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('reauthResponseSchema', () => {
  const valid = { reauthGrant: 'grant', expiresAt: '2026-01-01T00:00:00.000Z', graceDays: 30 };

  it('accepts a grant, an ISO expiry and the grace days', () => {
    expect(reauthResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a bad expiry, out-of-range grace days and an unknown key', () => {
    expect(reauthResponseSchema.safeParse({ ...valid, expiresAt: 'tomorrow' }).success).toBe(false);
    expect(reauthResponseSchema.safeParse({ ...valid, graceDays: 0 }).success).toBe(false);
    expect(reauthResponseSchema.safeParse({ ...valid, graceDays: 366 }).success).toBe(false);
    expect(reauthResponseSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});

describe('deleteAccountRequestSchema', () => {
  it('accepts a grant and a confirmation string', () => {
    const body = { reauthGrant: 'grant', confirmation: 'DELETE' };
    expect(deleteAccountRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects a missing grant, a non-string confirmation and an unknown key', () => {
    expect(deleteAccountRequestSchema.safeParse({ confirmation: 'DELETE' }).success).toBe(false);
    expect(
      deleteAccountRequestSchema.safeParse({ reauthGrant: 'g', confirmation: 5 }).success,
    ).toBe(false);
    expect(
      deleteAccountRequestSchema.safeParse({ reauthGrant: 'g', confirmation: 'DELETE', x: 1 })
        .success,
    ).toBe(false);
  });
});

describe('deleteAccountResponseSchema', () => {
  const valid = {
    status: 'pending_deletion',
    scheduledPurgeAt: '2026-02-01T12:00:00.000Z',
    graceDays: 30,
  };

  it('accepts the pending_deletion status', () => {
    expect(deleteAccountResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects any other status, a non-ISO date and an unknown key', () => {
    expect(deleteAccountResponseSchema.safeParse({ ...valid, status: 'active' }).success).toBe(
      false,
    );
    expect(
      deleteAccountResponseSchema.safeParse({ ...valid, scheduledPurgeAt: 'soon' }).success,
    ).toBe(false);
    expect(deleteAccountResponseSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe('authSessionResponseSchema', () => {
  it('accepts a body with accountRestored: true and one without the key', () => {
    expect(authSessionResponseSchema.parse({ ...SESSION_BODY, accountRestored: true })).toEqual({
      ...SESSION_BODY,
      accountRestored: true,
    });
    const without = authSessionResponseSchema.parse(SESSION_BODY);
    expect('accountRestored' in without).toBe(false);
  });

  it('rejects accountRestored: false and an unknown key', () => {
    expect(
      authSessionResponseSchema.safeParse({ ...SESSION_BODY, accountRestored: false }).success,
    ).toBe(false);
    expect(authSessionResponseSchema.safeParse({ ...SESSION_BODY, extra: 1 }).success).toBe(false);
  });

  it('rejects a body missing the token', () => {
    const { token: _token, ...rest } = SESSION_BODY;
    expect(authSessionResponseSchema.safeParse(rest).success).toBe(false);
  });
});

describe('account-deletion error codes', () => {
  const NEW_CODES = {
    reauth_failed: 403,
    reauth_required: 403,
    account_deletion_confirmation_invalid: 400,
    trip_party_deleted: 409,
  } as const;

  it('lists the four codes in the catalog with their statuses', () => {
    for (const [code, status] of Object.entries(NEW_CODES)) {
      expect(ERROR_CODES).toContain(code);
      expect(errorCodeToHttpStatus[code as keyof typeof NEW_CODES]).toBe(status);
    }
  });

  it('maps no new code to 401', () => {
    for (const code of Object.keys(NEW_CODES)) {
      expect(errorCodeToHttpStatus[code as keyof typeof NEW_CODES]).not.toBe(401);
    }
  });
});
