import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DELETE_ACCOUNT_CONFIRMATION_PHRASE } from '@dwt/shared';

import {
  escapeHtml,
  formatPurgeDate,
  renderPrivacyPolicyHtml,
  renderWebAccountDeletionFormHtml,
  renderWebAccountDeletionSuccessHtml,
  validateWebDeletionInput,
} from '../webPages.js';

const RUNS = { numRuns: 100 };

const graceDaysArb = fc.integer({ min: 1, max: 365 });
const msArb = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 0, 1) });
const dateArb = msArb.map((ms) => new Date(ms));

const SUPPORT_EMAIL = 'support@example.com';
const PLACEHOLDER = '[Support Contact Email]';

// Email-like strings that are rich in HTML metacharacters (and the quote that would break out of the href attribute).
const hostileChars = ['a', 'b', 'Z', '7', '.', '-', '_', '+', '<', '>', '"', "'", '&', '/', '=', ' ', '`', ';', '#'];
const hostilePartArb = fc
  .array(fc.constantFrom(...hostileChars), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''));
const hostileEmailArb = fc
  .tuple(hostilePartArb, hostilePartArb)
  .map(([local, domain]) => `${local}@${domain}.com`);

describe('webPages unit & property tests', () => {
  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: escapeHtml escapes all five HTML metacharacters so raw <, >, ", \', or unescaped & never survive', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const escaped = escapeHtml(input);
        expect(escaped).not.toContain('<');
        expect(escaped).not.toContain('>');
        expect(escaped).not.toContain('"');
        expect(escaped).not.toContain("'");
        const strippedEntities = escaped.replace(/&(?:amp|lt|gt|quot|#039);/g, '');
        expect(strippedEntities).not.toContain('&');
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: renderWebAccountDeletionFormHtml includes graceDays, form controls, /privacy link, and safely escapes email/errorMessage', () => {
    fc.assert(
      fc.property(
        graceDaysArb,
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 120 }),
        (graceDays, rawEmail, rawError) => {
          const html = renderWebAccountDeletionFormHtml({
            graceDays,
            email: rawEmail,
            errorMessage: rawError,
          });

          expect(html).toContain('<!DOCTYPE html>');
          expect(html).toContain('<form method="POST" action="/account-deletion">');
          expect(html).toContain('name="email"');
          expect(html).toContain('name="password"');
          expect(html).toContain('name="confirmation"');
          expect(html).toContain(`${graceDays}-day grace period`);
          expect(html).toContain('You &amp; Crew');
          expect(html).toContain('Deleted user');
          expect(html).toContain('href="/privacy"');

          if (rawEmail.length > 0) {
            expect(html).toContain(`value="${escapeHtml(rawEmail)}"`);
          }
          if (rawError.length > 0) {
            expect(html).toContain(escapeHtml(rawError));
          }
        },
      ),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: renderWebAccountDeletionSuccessHtml includes the America/New_York formatted scheduledPurgeAt date and graceDays', () => {
    fc.assert(
      fc.property(dateArb, graceDaysArb, (scheduledPurgeAt, graceDays) => {
        const html = renderWebAccountDeletionSuccessHtml({
          scheduledPurgeAt,
          graceDays,
        });
        const expectedDate = escapeHtml(formatPurgeDate(scheduledPurgeAt));

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Account Deletion Scheduled');
        expect(html).toContain(expectedDate);
        expect(html).toContain(`${graceDays}-day grace period`);
        expect(html).toContain('cancel the deletion and restore your account');
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: renderPrivacyPolicyHtml includes all privacy policy disclosures, graceDays, and a link to /account-deletion', () => {
    fc.assert(
      fc.property(graceDaysArb, (graceDays) => {
        const html = renderPrivacyPolicyHtml({ graceDays, supportEmail: SUPPORT_EMAIL });

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('1. Information We Collect');
        expect(html).toContain('2. Third-Party Service Providers &amp; Processing Disclosures');
        expect(html).toContain('omni-moderation-latest');
        expect(html).toContain('gemini-3.5-flash-lite');
        expect(html).toContain('Cloudflare');
        expect(html).toContain('3. Metadata &amp; EXIF / GPS Stripping');
        expect(html).toContain('4. Retention &amp; Deletion Schedules');
        expect(html).toContain(`${graceDays} days`);
        expect(html).toContain('5. Your Controls: Deletion, Reporting, and Blocking');
        expect(html).toContain('href="/account-deletion"');
        expect(html).toContain('6. User-Generated Content &amp; Code of Conduct');
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: renderPrivacyPolicyHtml stays synchronized with docs/privacy-policy.md (every heading, bullet topic, and code token matches)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const mdPath = resolve(here, '..', '..', '..', '..', '..', '..', 'docs', 'privacy-policy.md');
    const md = readFileSync(mdPath, 'utf8');
    const html = renderPrivacyPolicyHtml({ graceDays: 30, supportEmail: SUPPORT_EMAIL });
    const plainHtml = html
      .replace(/&amp;/g, '&')
      .replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&rsquo;/g, "'")
      .replace(/&rarr;/g, '->')
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    // 1. Every ## and ### section heading in docs/privacy-policy.md must appear in the rendered HTML.
    const headings = [...md.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]!.trim());
    expect(headings.length).toBeGreaterThanOrEqual(10);
    for (const h of headings) {
      expect(plainHtml, `missing heading from docs/privacy-policy.md: "${h}"`).toContain(h);
    }

    // 2. Every bold bullet label (**Label**:) in docs/privacy-policy.md must appear in the rendered HTML.
    const bulletLabels = [...md.matchAll(/^\s*(?:[-*]|\d+\.)\s+\*\*([^*]+)\*\*:/gm)].map((m) => m[1]!.trim());
    expect(bulletLabels.length).toBeGreaterThanOrEqual(15);
    for (const label of bulletLabels) {
      expect(plainHtml, `missing bullet label from docs/privacy-policy.md: "${label}"`).toContain(label);
    }

    // 3. Every inline code token (`...`) in docs/privacy-policy.md must appear in the rendered HTML.
    const codeTokens = [...md.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
    expect(codeTokens.length).toBeGreaterThanOrEqual(8);
    for (const token of codeTokens) {
      expect(plainHtml, `missing code token from docs/privacy-policy.md: "${token}"`).toContain(token);
    }
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: renderPrivacyPolicyHtml renders the supplied support email as an escaped mailto link and never the old placeholder', () => {
    const html = renderPrivacyPolicyHtml({ graceDays: 30, supportEmail: 'help.desk+dwt@example.org' });

    expect(html).toContain('<li><strong>Email:</strong> <a href="mailto:help.desk+dwt@example.org">help.desk+dwt@example.org</a></li>');
    expect(html).not.toContain(PLACEHOLDER);
    expect(html).not.toContain('Support Contact Email');
    expect(html).not.toMatch(/must replace/i);
    // The old inline-code rendering of the contact line is gone.
    expect(html).not.toContain('<code>help.desk+dwt@example.org</code>');
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: an arbitrary email-like supportEmail with HTML metacharacters is always escaped in the mailto link and text, and the placeholder never appears', () => {
    fc.assert(
      fc.property(hostileEmailArb, graceDaysArb, (supportEmail, graceDays) => {
        const html = renderPrivacyPolicyHtml({ graceDays, supportEmail });
        const escaped = escapeHtml(supportEmail);

        // The whole contact line is exactly the escaped link: the value cannot break out of the attribute or the element.
        const line = /<li><strong>Email:<\/strong> (.*)<\/li>/.exec(html);
        expect(line).not.toBeNull();
        expect(line![1]).toBe(`<a href="mailto:${escaped}">${escaped}</a>`);

        // No raw metacharacter from the supplied value survives anywhere it was injected.
        const payloadOnly = line![1]!.replace('<a href="mailto:', '').replace('">', '').replace('</a>', '');
        expect(payloadOnly).not.toMatch(/[<>"']/);

        expect(html).not.toContain(PLACEHOLDER);
        // The raw, unescaped value (when it has metacharacters) appears nowhere in the document.
        if (/[<>"'&]/.test(supportEmail)) {
          expect(html).not.toContain(supportEmail);
        }
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34: validateWebDeletionInput accepts valid email + password + exact trimmed DELETE phrase and rejects non-matching confirmation phrases', () => {
    const validEmailArb = fc
      .tuple(
        fc.stringMatching(/^[a-z0-9]{1,12}$/),
        fc.stringMatching(/^[a-z0-9]{1,10}$/),
        fc.constantFrom('com', 'org', 'net'),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
    const validPasswordArb = fc.string({ minLength: 1, maxLength: 64 });

    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const okRes = validateWebDeletionInput({
          email: `  ${email}  `,
          password,
          confirmation: ` ${DELETE_ACCOUNT_CONFIRMATION_PHRASE} `,
        });
        expect(okRes).toEqual({
          ok: true,
          email,
          password,
          confirmation: DELETE_ACCOUNT_CONFIRMATION_PHRASE,
        });
      }),
      RUNS,
    );

    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        fc.string().filter((s) => s.trim() !== DELETE_ACCOUNT_CONFIRMATION_PHRASE),
        (email, password, badConfirmation) => {
          const res = validateWebDeletionInput({
            email,
            password,
            confirmation: badConfirmation,
          });
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.email).toBe(email);
            expect(res.message).toContain(DELETE_ACCOUNT_CONFIRMATION_PHRASE);
          }
        },
      ),
      RUNS,
    );
  });

  it('validateWebDeletionInput rejects missing/malformed email or empty/oversized password', () => {
    expect(validateWebDeletionInput(null)).toEqual({
      ok: false,
      email: '',
      message: 'Please enter a valid email address.',
    });
    expect(
      validateWebDeletionInput({
        email: 'not-an-email',
        password: 'secretPassword123',
        confirmation: 'DELETE',
      }),
    ).toEqual({
      ok: false,
      email: 'not-an-email',
      message: 'Please enter a valid email address.',
    });
    expect(
      validateWebDeletionInput({
        email: 'reader@example.com',
        password: '',
        confirmation: 'DELETE',
      }),
    ).toEqual({
      ok: false,
      email: 'reader@example.com',
      message: 'Please enter your password.',
    });
    expect(
      validateWebDeletionInput({
        email: 'reader@example.com',
        password: 'x'.repeat(129),
        confirmation: 'DELETE',
      }),
    ).toEqual({
      ok: false,
      email: 'reader@example.com',
      message: 'Please enter your password.',
    });
  });
});

