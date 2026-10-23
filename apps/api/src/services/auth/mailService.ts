/**
 * Transactional Mail Service for Auth notifications.
 *
 * Provides email dispatch for password reset verification codes and fallback links.
 * When `RESEND_API_KEY` is provided, dispatches via Resend REST API (using native Node fetch).
 * When SMTP credentials (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` or `SMTP_SERVICE`)
 * are provided, dispatches via SMTP (e.g. Gmail App Passwords, custom SMTP).
 * When neither is provided (such as local development and CI testing), logs the code
 * and link to the server logger and resolves cleanly.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type { AccountDeletionMail } from '../accountDeletion/ports.js';

export interface SendPasswordResetInput {
  readonly to: string;
  readonly code: string;
  readonly resetUrl: string;
}

export interface MailService {
  sendPasswordReset(input: SendPasswordResetInput): Promise<void>;
}

export interface SmtpOptions {
  readonly host?: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly user?: string;
  readonly pass?: string;
  readonly service?: string;
}

export interface MailServiceOptions {
  readonly apiKey?: string;
  readonly smtp?: SmtpOptions;
  readonly from?: string;
  readonly logger?: FastifyBaseLogger;
  /** Injectable transporter or transport function for unit/integration testing */
  readonly transporter?: Transporter;
  readonly sendFn?: (payload: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
    readonly code?: string;
    readonly resetUrl?: string;
  }) => Promise<void>;
}

const DEFAULT_FROM = 'Disney World Tracker <auth@disneytracker.app>';

/**
 * A purge date for an email: the park calendar's zone (`America/New_York`), with the zone abbreviation so the
 * reader knows which clock it is on, e.g. "May 1, 2026, 8:00 AM EDT".
 */
function formatPurgeDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** Wraps a plain-text body in the same card layout the other transactional mail uses. */
function simpleHtml(subject: string, title: string, paragraphs: readonly string[]): string {
  const body = paragraphs.map((p) => `    <p class="instructions">${p}</p>`).join('\n');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { text-align: center; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0; }
    .instructions { font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="title">${title}</h1>
      <p class="subtitle">Disney World Tracker</p>
    </div>
${body}
  </div>
</body>
</html>`;
}

export function createMailService(options: MailServiceOptions = {}): MailService & AccountDeletionMail {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;

  const smtpHost = options.smtp?.host ?? process.env.SMTP_HOST;
  const smtpPort =
    options.smtp?.port !== undefined
      ? options.smtp.port
      : process.env.SMTP_PORT
        ? Number.parseInt(process.env.SMTP_PORT, 10)
        : 587;
  const smtpUser = options.smtp?.user ?? process.env.SMTP_USER;
  const smtpPass = options.smtp?.pass ?? process.env.SMTP_PASS;
  const smtpService = options.smtp?.service ?? process.env.SMTP_SERVICE;
  const smtpSecure =
    options.smtp?.secure !== undefined
      ? options.smtp.secure
      : process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  const defaultFrom = smtpUser ? `Disney World Tracker <${smtpUser}>` : DEFAULT_FROM;
  const from = options.from ?? process.env.MAIL_FROM ?? defaultFrom;
  const logger = options.logger;

  let smtpTransporter: Transporter | null = options.transporter ?? null;
  if (!apiKey && !smtpTransporter) {
    if (smtpService) {
      smtpTransporter = nodemailer.createTransport({
        service: smtpService,
        auth:
          smtpUser && smtpPass
            ? {
                user: smtpUser,
                pass: smtpPass,
              }
            : undefined,
      });
    } else if (smtpHost) {
      smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth:
          smtpUser && smtpPass
            ? {
                user: smtpUser,
                pass: smtpPass,
              }
            : undefined,
      });
    } else if (smtpUser && smtpPass && smtpUser.toLowerCase().endsWith('@gmail.com')) {
      smtpTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    }
  }

  async function defaultSend(payload: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
    readonly code?: string;
    readonly resetUrl?: string;
  }): Promise<void> {
    if (apiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger?.error({ status: response.status, error: errText }, 'Failed to dispatch email via Resend API');
        throw new Error(`Email dispatch failed with HTTP ${response.status}: ${errText}`);
      }
      return;
    }

    if (smtpTransporter) {
      try {
        await smtpTransporter.sendMail({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
        logger?.info(
          {
            to: payload.to,
            subject: payload.subject,
          },
          'Transactional email dispatched via SMTP',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error({ error: message }, 'Failed to dispatch email via SMTP');
        throw new Error(`Email dispatch failed via SMTP: ${message}`);
      }
      return;
    }

    logger?.info(
      {
        to: payload.to,
        subject: payload.subject,
        code: payload.code,
        resetUrl: payload.resetUrl,
      },
      'Transactional email dispatched (mock mode: no RESEND_API_KEY or SMTP credentials set)',
    );
  }

  const transport = options.sendFn ?? defaultSend;

  return {
    async sendPasswordReset({ to, code, resetUrl }: SendPasswordResetInput): Promise<void> {
      const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
      const subject = `Your Disney World Tracker reset code: ${formattedCode}`;

      const text = [
        'Hi there,',
        '',
        `Your verification code to reset your Disney World Tracker password is: ${formattedCode}`,
        '',
        'Enter this 6-digit code in the app to choose a new password. This code expires in 15 minutes.',
        '',
        'Alternatively, if you are on a computer or web browser, you can reset your password directly at:',
        resetUrl,
        '',
        'If you did not request a password reset, you can safely ignore this email.',
      ].join('\n');

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { text-align: center; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0; }
    .code-box { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; padding: 20px; border-radius: 12px; text-align: center; margin: 24px 0; }
    .code-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.85; margin-bottom: 6px; }
    .code-val { font-size: 36px; font-weight: 800; letter-spacing: 6px; margin: 0; font-family: monospace; }
    .instructions { font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 24px; }
    .btn { display: inline-block; background-color: #f1f5f9; color: #4338ca; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 20px; border-radius: 8px; border: 1px solid #cbd5e1; }
    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="title">Reset Your Password</h1>
      <p class="subtitle">Disney World Tracker</p>
    </div>
    <div class="code-box">
      <div class="code-label">Verification Code</div>
      <div class="code-val">${formattedCode}</div>
    </div>
    <p class="instructions">
      Enter this 6-digit code in the mobile app along with your new password. This code will expire in <strong>15 minutes</strong>.
    </p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" class="btn">Reset in Browser Instead &rarr;</a>
    </div>
    <div class="footer">
      If you did not request this password reset, please ignore this email. Your password will remain unchanged.
    </div>
  </div>
</body>
</html>`;

      await transport({ from, to, subject, html, text, code, resetUrl });
    },

    async sendDeletionScheduled({ to, scheduledPurgeAt, graceDays }): Promise<void> {
      const when = formatPurgeDate(scheduledPurgeAt);
      const subject = 'Your Disney World Tracker account is scheduled for deletion';
      const lines = [
        'Hi there,',
        `We received your request to delete your Disney World Tracker account. Your account is now deactivated and will be permanently deleted after ${when}.`,
        `Changed your mind? Just sign in again before then, and the deletion is cancelled and your account is restored with everything in it. You have ${graceDays} days.`,
        'You have been signed out on every device. If you did not ask for this, sign in now to cancel it, and change your password.',
      ];
      const text = lines.join('\n\n');
      const html = simpleHtml(subject, 'Account Deletion Scheduled', lines);
      await transport({ from, to, subject, html, text });
    },

    async sendDeletionCancelled({ to }): Promise<void> {
      const subject = 'Your Disney World Tracker account deletion was cancelled';
      const lines = [
        'Hi there,',
        'Your Disney World Tracker account is active again and the scheduled deletion was cancelled. Nothing was removed.',
        'If this was not you, change your password right away.',
      ];
      const text = lines.join('\n\n');
      const html = simpleHtml(subject, 'Account Deletion Cancelled', lines);
      await transport({ from, to, subject, html, text });
    },
  };
}
