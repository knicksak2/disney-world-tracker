/**
 * Integration tests for password reset endpoints:
 *   - POST /auth/forgot-password
 *   - POST /auth/reset-password
 *   - GET  /auth/reset-password
 *   - POST /auth/reset-password-web
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3
 */

import { randomUUID } from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { LockoutService } from '../lockout.js';
import type { MailService } from '../mailService.js';
import type { PasswordResetRecord, PasswordResetRepo } from '../passwordResetRepo.js';
import { authRoutes } from '../routes.js';
import { verify as verifyArgon2 } from '../password.js';

describe('Password Reset Routes', () => {
  let app: FastifyInstance;
  let sentEmails: Array<{ to: string; code: string; resetUrl: string }>;
  let fakeMailService: MailService;
  let fakeRepo: PasswordResetRepo;
  let mockUsers: Map<string, { id: string; email: string; passwordHash: string; displayName: string }>;
  let mockResetTokens: Map<string, PasswordResetRecord>;
  let mockSessions: Array<{ userId: string; tokenHash: string; revokedAt: Date | null }>;

  beforeEach(async () => {
    sentEmails = [];
    mockUsers = new Map();
    mockResetTokens = new Map();
    mockSessions = [];

    // Seed existing user
    const userId = randomUUID();
    mockUsers.set('guest@example.com', {
      id: userId,
      email: 'guest@example.com',
      passwordHash: 'old_hash',
      displayName: 'Mickey Mouse',
    });

    fakeMailService = {
      async sendPasswordReset(input) {
        sentEmails.push(input);
      },
    };

    fakeRepo = {
      async findUserByEmail(email: string) {
        const u = mockUsers.get(email.toLowerCase());
        return u ? { id: u.id, email: u.email } : null;
      },
      async createResetRecord(userId: string, codeHash: string, tokenHash: string, expiresAt: Date) {
        const id = randomUUID();
        const user = Array.from(mockUsers.values()).find((u) => u.id === userId);
        const record: PasswordResetRecord = {
          id,
          userId,
          userEmail: user?.email ?? 'unknown@example.com',
          codeHash,
          tokenHash,
          attempts: 0,
          expiresAt,
          usedAt: null,
          createdAt: new Date(),
        };
        mockResetTokens.set(id, record);
        return id;
      },
      async findActiveByEmail(email: string) {
        const lower = email.toLowerCase();
        for (const record of mockResetTokens.values()) {
          if (
            record.userEmail.toLowerCase() === lower &&
            record.usedAt === null &&
            record.expiresAt > new Date()
          ) {
            return record;
          }
        }
        return null;
      },
      async findActiveByToken(tokenHash: string) {
        for (const record of mockResetTokens.values()) {
          if (
            record.tokenHash === tokenHash &&
            record.usedAt === null &&
            record.expiresAt > new Date()
          ) {
            return record;
          }
        }
        return null;
      },
      async incrementAttempts(id: string) {
        const rec = mockResetTokens.get(id);
        if (!rec) return 0;
        const updated: PasswordResetRecord = {
          ...rec,
          attempts: rec.attempts + 1,
        };
        mockResetTokens.set(id, updated);
        return updated.attempts;
      },
      async invalidateRecord(id: string) {
        const rec = mockResetTokens.get(id);
        if (rec) {
          mockResetTokens.set(id, { ...rec, usedAt: new Date() });
        }
      },
      async completeReset(resetId: string, userId: string, newPasswordHash: string) {
        const rec = mockResetTokens.get(resetId);
        if (rec) {
          mockResetTokens.set(resetId, { ...rec, usedAt: new Date() });
        }
        for (const u of mockUsers.values()) {
          if (u.id === userId) {
            u.passwordHash = newPasswordHash;
          }
        }
        // Revoke existing sessions
        for (const s of mockSessions) {
          if (s.userId === userId && s.revokedAt === null) {
            s.revokedAt = new Date();
          }
        }
      },
    };

    const fakePool = {
      async query(sql: string, params: any[] = []) {
        if (sql.includes('INSERT INTO sessions')) {
          const [userId, tokenHash] = params;
          mockSessions.push({ userId, tokenHash, revokedAt: null });
          return { rows: [{ id: randomUUID() }] };
        }
        if (sql.includes('profiles')) {
          const [userId] = params;
          const user = Array.from(mockUsers.values()).find((u) => u.id === userId);
          return { rows: [{ display_name: user?.displayName ?? 'Guest' }] };
        }
        return { rows: [] };
      },
    } as unknown as DbPool;

    const fakeLockout: LockoutService = {
      recordFailure: vi.fn().mockResolvedValue(false),
      isLocked: vi.fn().mockResolvedValue(false),
      clearOnSuccess: vi.fn().mockResolvedValue(undefined),
    };

    app = fastify();
    registerErrorHandler(app);
    await app.register(
      authRoutes({
        pool: fakePool,
        lockout: fakeLockout,
        requireSession: async () => {},
        mailService: fakeMailService,
        passwordResetRepo: fakeRepo,
      }),
    );
    await app.ready();
  });

  describe('POST /auth/forgot-password', () => {
    it('returns 200 and sends email when user exists (R1.1, R1.2)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        message: 'If an account exists with this email, a reset code has been sent.',
      });
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]?.to).toBe('guest@example.com');
      expect(sentEmails[0]?.code).toMatch(/^\d{6}$/);
      expect(sentEmails[0]?.resetUrl).toContain('/auth/reset-password?token=');
    });

    it('returns 200 with identical response and sends no email when user is unknown (Anti-Enumeration R1.3)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'unknown@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        message: 'If an account exists with this email, a reset code has been sent.',
      });
      expect(sentEmails).toHaveLength(0);
    });

    it('returns 400 validation_failed for malformed email (R1.4)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'not-an-email' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('validation_failed');
    });

    it('returns 200 without crashing when mailer dispatch throws an error (Anti-Enumeration & Resilience)', async () => {
      fakeMailService.sendPasswordReset = vi.fn().mockRejectedValue(new Error('Resend upstream 403'));

      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        message: 'If an account exists with this email, a reset code has been sent.',
      });
    });
  });

  describe('POST /auth/reset-password', () => {
    it('resets password, creates session, and returns auth token on valid code (R2.1, R2.2)', async () => {
      // 1. Request reset
      await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });
      const sentCode = sentEmails[0]?.code;
      expect(sentCode).toBeDefined();

      // 2. Submit reset with code
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: {
          email: 'guest@example.com',
          code: sentCode,
          newPassword: 'BrandNewPassword123',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.email).toBe('guest@example.com');
      expect(body.profile.displayName).toBe('Mickey Mouse');
      expect(typeof body.token).toBe('string');

      // Verify Argon2id hash updated
      const updatedUser = mockUsers.get('guest@example.com');
      expect(updatedUser?.passwordHash).not.toBe('old_hash');
      const matches = await verifyArgon2(updatedUser!.passwordHash, 'BrandNewPassword123');
      expect(matches).toBe(true);
    });

    it('rejects wrong verification code with 400 invalid_code and increments attempts (R2.3)', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: {
          email: 'guest@example.com',
          code: '999999',
          newPassword: 'ValidPassword123',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('invalid_code');
    });

    it('locks reset token after 5 failed attempts (R2.4)', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });
      const correctCode = sentEmails[0]?.code;

      // 4 wrong attempts
      for (let i = 0; i < 4; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/reset-password',
          payload: { email: 'guest@example.com', code: '000000', newPassword: 'ValidPassword123' },
        });
        expect(res.statusCode).toBe(400);
      }

      // 5th wrong attempt triggers too_many_attempts
      const res5 = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { email: 'guest@example.com', code: '000000', newPassword: 'ValidPassword123' },
      });
      expect(res5.statusCode).toBe(429);
      expect(JSON.parse(res5.body).error.code).toBe('too_many_attempts');

      // Subsequent attempt even with correct code is now locked
      const resCorrect = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { email: 'guest@example.com', code: correctCode, newPassword: 'ValidPassword123' },
      });
      expect(resCorrect.statusCode).toBe(400);
      expect(JSON.parse(resCorrect.body).error.code).toBe('invalid_code');
    });
  });

  describe('Web Fallback: GET /auth/reset-password and POST /auth/reset-password-web', () => {
    it('serves reset form HTML for valid token (R3.1)', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });
      const resetUrl = sentEmails[0]?.resetUrl;
      const token = new URL(resetUrl!).searchParams.get('token');

      const res = await app.inject({
        method: 'GET',
        url: `/auth/reset-password?token=${token}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Choose a New Password');
      expect(res.body).toContain(token);
    });

    it('renders error page for invalid or expired token (R3.2)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/reset-password?token=invalid_token',
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Link Expired or Invalid');
    });

    it('completes reset via web form submission (R3.3)', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'guest@example.com' },
      });
      const resetUrl = sentEmails[0]?.resetUrl;
      const token = new URL(resetUrl!).searchParams.get('token');

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password-web',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `token=${encodeURIComponent(token!)}&password=NewWebPassword123&confirmPassword=NewWebPassword123`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Password Updated!');

      // Check Argon2id hash was updated
      const updatedUser = mockUsers.get('guest@example.com');
      const matches = await verifyArgon2(updatedUser!.passwordHash, 'NewWebPassword123');
      expect(matches).toBe(true);
    });
  });
});
