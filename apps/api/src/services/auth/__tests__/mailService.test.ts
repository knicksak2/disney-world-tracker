/**
 * Unit tests for MailService.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import { describe, expect, it, vi } from 'vitest';
import { createMailService } from '../mailService.js';

describe('MailService', () => {
  it('logs verification code and resetUrl in mock mode when neither apiKey nor SMTP is configured (R4.4)', async () => {
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      level: 'info',
    };

    const mailer = createMailService({
      logger: mockLogger as any,
    });

    await mailer.sendPasswordReset({
      to: 'guest@example.com',
      code: '231109',
      resetUrl: 'http://localhost:3000/auth/reset-password?token=abc',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: 'Your Disney World Tracker reset code: 231 109',
        code: '231109',
        resetUrl: 'http://localhost:3000/auth/reset-password?token=abc',
      }),
      'Transactional email dispatched (mock mode: no RESEND_API_KEY or SMTP credentials set)',
    );
  });

  it('delegates to transport sendFn when apiKey or custom sendFn is provided (R4.1, R4.2)', async () => {
    const mockSendFn = vi.fn().mockResolvedValue(undefined);

    const mailer = createMailService({
      apiKey: 'test-key',
      sendFn: mockSendFn,
    });

    await mailer.sendPasswordReset({
      to: 'guest@example.com',
      code: '123456',
      resetUrl: 'https://example.com/reset?token=xyz',
    });

    expect(mockSendFn).toHaveBeenCalledTimes(1);
    const payload = mockSendFn.mock.calls[0]?.[0];
    expect(payload.to).toBe('guest@example.com');
    expect(payload.subject).toBe('Your Disney World Tracker reset code: 123 456');
    expect(payload.html).toContain('123 456');
    expect(payload.html).toContain('https://example.com/reset?token=xyz');
    expect(payload.text).toContain('123 456');
    expect(payload.text).toContain('https://example.com/reset?token=xyz');
  });

  it('dispatches via SMTP transporter when configured without apiKey (R4.3)', async () => {
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-123' });
    const mockTransporter = {
      sendMail: mockSendMail,
    };
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      level: 'info',
    };

    const mailer = createMailService({
      transporter: mockTransporter as any,
      smtp: {
        user: 'myaccount@gmail.com',
        pass: 'app-password',
      },
      logger: mockLogger as any,
    });

    await mailer.sendPasswordReset({
      to: 'recipient@example.com',
      code: '654321',
      resetUrl: 'https://app.disneytracker.app/reset?token=abc',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailArgs = mockSendMail.mock.calls[0]?.[0];
    expect(mailArgs.from).toBe('Disney World Tracker <myaccount@gmail.com>');
    expect(mailArgs.to).toBe('recipient@example.com');
    expect(mailArgs.subject).toBe('Your Disney World Tracker reset code: 654 321');
    expect(mailArgs.html).toContain('654 321');
    expect(mailArgs.text).toContain('654 321');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'recipient@example.com',
        subject: 'Your Disney World Tracker reset code: 654 321',
      }),
      'Transactional email dispatched via SMTP',
    );
  });

  it('throws descriptive error when SMTP delivery fails (R4.3)', async () => {
    const mockSendMail = vi.fn().mockRejectedValue(new Error('SMTP connection timeout'));
    const mockTransporter = {
      sendMail: mockSendMail,
    };
    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      level: 'info',
    };

    const mailer = createMailService({
      transporter: mockTransporter as any,
      logger: mockLogger as any,
    });

    await expect(
      mailer.sendPasswordReset({
        to: 'recipient@example.com',
        code: '111222',
        resetUrl: 'https://app.disneytracker.app/reset?token=err',
      }),
    ).rejects.toThrow('Email dispatch failed via SMTP: SMTP connection timeout');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SMTP connection timeout' }),
      'Failed to dispatch email via SMTP',
    );
  });
});
