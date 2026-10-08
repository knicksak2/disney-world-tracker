import { describe, expect, it } from 'vitest';
import {
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  webResetPasswordInputSchema,
} from '../User.js';
import { errorCodeToHttpStatus } from '../../errors.js';

describe('password-reset schemas and errors', () => {
  describe('forgotPasswordInputSchema', () => {
    it('accepts valid email', () => {
      const parsed = forgotPasswordInputSchema.parse({
        email: 'guest@example.com',
      });
      expect(parsed.email).toBe('guest@example.com');
    });

    it('rejects invalid email syntax', () => {
      expect(() =>
        forgotPasswordInputSchema.parse({
          email: 'not-an-email',
        }),
      ).toThrow();
    });

    it('rejects unexpected properties (.strict())', () => {
      expect(() =>
        forgotPasswordInputSchema.parse({
          email: 'guest@example.com',
          extra: true,
        }),
      ).toThrow();
    });
  });

  describe('resetPasswordInputSchema', () => {
    it('accepts valid email, 6-digit numeric code, and 8+ char password', () => {
      const parsed = resetPasswordInputSchema.parse({
        email: 'guest@example.com',
        code: '123456',
        newPassword: 'new-valid-password',
      });
      expect(parsed).toEqual({
        email: 'guest@example.com',
        code: '123456',
        newPassword: 'new-valid-password',
      });
    });

    it('trims leading/trailing whitespace around 6-digit code', () => {
      const parsed = resetPasswordInputSchema.parse({
        email: 'guest@example.com',
        code: ' 123456 ',
        newPassword: 'new-valid-password',
      });
      expect(parsed.code).toBe('123456');
    });

    it('rejects code with non-digit characters', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '12345a',
          newPassword: 'new-valid-password',
        }),
      ).toThrow();
    });

    it('rejects code shorter than 6 digits', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '12345',
          newPassword: 'new-valid-password',
        }),
      ).toThrow();
    });

    it('rejects code longer than 6 digits', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '1234567',
          newPassword: 'new-valid-password',
        }),
      ).toThrow();
    });

    it('rejects new password shorter than 8 chars', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '123456',
          newPassword: 'short',
        }),
      ).toThrow();
    });

    it('rejects new password longer than 128 chars', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '123456',
          newPassword: 'a'.repeat(129),
        }),
      ).toThrow();
    });

    it('rejects unexpected properties (.strict())', () => {
      expect(() =>
        resetPasswordInputSchema.parse({
          email: 'guest@example.com',
          code: '123456',
          newPassword: 'valid-password',
          tamper: 1,
        }),
      ).toThrow();
    });
  });

  describe('webResetPasswordInputSchema', () => {
    it('accepts valid token and valid password', () => {
      const token = 'a'.repeat(32);
      const parsed = webResetPasswordInputSchema.parse({
        token,
        newPassword: 'new-valid-password',
      });
      expect(parsed).toEqual({
        token,
        newPassword: 'new-valid-password',
      });
    });

    it('rejects token shorter than 16 chars', () => {
      expect(() =>
        webResetPasswordInputSchema.parse({
          token: 'short-token',
          newPassword: 'new-valid-password',
        }),
      ).toThrow();
    });

    it('rejects invalid password length', () => {
      expect(() =>
        webResetPasswordInputSchema.parse({
          token: 'a'.repeat(32),
          newPassword: 'short',
        }),
      ).toThrow();
    });
  });

  describe('Error code catalog mappings', () => {
    it('maps invalid_code to HTTP 400', () => {
      expect(errorCodeToHttpStatus.invalid_code).toBe(400);
    });

    it('maps too_many_attempts to HTTP 429', () => {
      expect(errorCodeToHttpStatus.too_many_attempts).toBe(429);
    });

    it('maps token_invalid to HTTP 400', () => {
      expect(errorCodeToHttpStatus.token_invalid).toBe(400);
    });
  });
});
