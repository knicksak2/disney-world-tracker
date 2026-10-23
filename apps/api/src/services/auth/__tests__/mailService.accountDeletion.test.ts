/**
 * Unit tests for the two account-deletion emails added to the mail service (account-deletion R3.4, R4.7).
 * `sendPasswordReset` is exercised again here to pin that the additive change left it alone.
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { createMailService, type MailService } from '../mailService.js';

interface Sent {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  code?: string;
  resetUrl?: string;
}

function capture() {
  const sent: Sent[] = [];
  const mailer = createMailService({
    from: 'Tracker <noreply@example.com>',
    sendFn: async (payload) => {
      sent.push({ ...payload });
    },
  });
  return { mailer, sent };
}

describe('sendDeletionScheduled', () => {
  it('names the purge date in America/New_York and says signing in cancels it', async () => {
    const { mailer, sent } = capture();
    // 12:00Z in May is 8:00 AM EDT; 13:00Z in January is 8:00 AM EST.
    await mailer.sendDeletionScheduled({ to: 'pat@example.com', scheduledPurgeAt: new Date('2026-05-01T12:00:00.000Z'), graceDays: 30 });

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('pat@example.com');
    expect(mail.from).toBe('Tracker <noreply@example.com>');
    expect(mail.subject).toBe('Your Disney World Tracker account is scheduled for deletion');
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('May 1, 2026');
      expect(body).toContain('8:00 AM');
      expect(body).toContain('EDT');
      expect(body).toMatch(/sign in again before then/i);
      expect(body).toContain('cancelled');
      expect(body).toContain('30 days');
    }
  });

  it('uses the zone of the park calendar, not UTC: a late-evening UTC instant lands on the previous New York day', async () => {
    const { mailer, sent } = capture();
    // 2026-01-16T03:30Z is 10:30 PM EST on January 15.
    await mailer.sendDeletionScheduled({ to: 'a@example.com', scheduledPurgeAt: new Date('2026-01-16T03:30:00.000Z'), graceDays: 7 });
    expect(sent[0]!.text).toContain('January 15, 2026');
    expect(sent[0]!.text).toContain('10:30 PM');
    expect(sent[0]!.text).toContain('EST');
    expect(sent[0]!.text).not.toContain('January 16');
    expect(sent[0]!.text).toContain('7 days');
  });

  it('carries no reset code or reset link, in the payload or the body', async () => {
    const { mailer, sent } = capture();
    await mailer.sendDeletionScheduled({ to: 'a@example.com', scheduledPurgeAt: new Date('2026-05-01T12:00:00.000Z'), graceDays: 30 });
    const mail = sent[0]!;
    expect(mail.code).toBeUndefined();
    expect(mail.resetUrl).toBeUndefined();
    expect(Object.keys(mail).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    expect(mail.text + mail.html).not.toMatch(/reset code|verification code|reset-password|https?:\/\//i);
  });

  it('a transport failure rejects (the service, not the mailer, decides it is best-effort)', async () => {
    const mailer = createMailService({
      sendFn: async () => {
        throw new Error('smtp down');
      },
    });
    await expect(
      mailer.sendDeletionScheduled({ to: 'a@example.com', scheduledPurgeAt: new Date(), graceDays: 30 }),
    ).rejects.toThrow('smtp down');
  });

  // Feature: account-deletion, Property 3: The scheduled purge date is fixed at request time
  it('Property 3 (mail half): the date in the body is the New York rendering of the date it was given, for any instant', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date('2025-01-01'), max: new Date('2040-01-01'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 365 }),
        async (when, graceDays) => {
          const { mailer, sent } = capture();
          await mailer.sendDeletionScheduled({ to: 'a@example.com', scheduledPurgeAt: when, graceDays });
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(when);
          expect(sent[0]!.text).toContain(parts);
          expect(sent[0]!.text).toMatch(/\b(EDT|EST)\b/);
          expect(sent[0]!.text).toContain(`${graceDays} days`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('sendDeletionCancelled', () => {
  it('says the deletion was cancelled and nothing was removed', async () => {
    const { mailer, sent } = capture();
    await mailer.sendDeletionCancelled({ to: 'pat@example.com' });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('pat@example.com');
    expect(mail.subject).toBe('Your Disney World Tracker account deletion was cancelled');
    expect(mail.text).toContain('active again');
    expect(mail.text).toContain('Nothing was removed');
    expect(mail.html).toContain('Nothing was removed');
  });

  it('carries no reset code or reset link', async () => {
    const { mailer, sent } = capture();
    await mailer.sendDeletionCancelled({ to: 'pat@example.com' });
    const mail = sent[0]!;
    expect(mail.code).toBeUndefined();
    expect(mail.resetUrl).toBeUndefined();
    expect(Object.keys(mail).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    expect(mail.text + mail.html).not.toMatch(/reset code|verification code|reset-password|https?:\/\//i);
  });
});

describe('MailService is unchanged', () => {
  it('the factory result still satisfies the original MailService interface', () => {
    const { mailer } = capture();
    const asOriginal: MailService = mailer; // compile-time: the superset is assignable to the old type
    expect(typeof asOriginal.sendPasswordReset).toBe('function');
  });

  it('sendPasswordReset still formats the code, sends the link, and passes code and resetUrl to the transport', async () => {
    const { mailer, sent } = capture();
    await mailer.sendPasswordReset({ to: 'guest@example.com', code: '231109', resetUrl: 'http://localhost:3000/auth/reset-password?token=abc' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Your Disney World Tracker reset code: 231 109');
    expect(sent[0]!.code).toBe('231109');
    expect(sent[0]!.resetUrl).toBe('http://localhost:3000/auth/reset-password?token=abc');
    expect(sent[0]!.text).toContain('231 109');
    expect(sent[0]!.html).toContain('Reset Your Password');
  });

  it('the deletion mails go through the same transport as sendPasswordReset (mock mode logs, nothing leaks a code)', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const mailer = createMailService({ logger: logger as never });
    await mailer.sendDeletionCancelled({ to: 'pat@example.com' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const logged = logger.info.mock.calls[0]![0] as Record<string, unknown>;
    expect(logged.subject).toBe('Your Disney World Tracker account deletion was cancelled');
    expect(logged.code).toBeUndefined();
    expect(logged.resetUrl).toBeUndefined();
  });
});
