/**
 * Pure HTML renderers and form input validation for the public web account-deletion
 * flow (`GET /account-deletion`, `POST /account-deletion`) and public privacy policy
 * page (`GET /privacy`).
 *
 * Kept free of I/O, database, and Fastify runtime dependencies so it can be unit-
 * and property-tested directly.
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.5, 19.6, 19.7, 19.8, 19.9, 19.11,
 *            20.1, 20.2, 20.3
 */

import { DELETE_ACCOUNT_CONFIRMATION_PHRASE } from '@dwt/shared';

const PURGE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Escapes all five HTML special characters (`&`, `<`, `>`, `"`, `'`) so arbitrary
 * user input can be safely interpolated into HTML element text and quoted attributes.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats a `scheduledPurgeAt` timestamp in `America/New_York` matching the
 * account-deletion email date format.
 */
export function formatPurgeDate(date: Date): string {
  return PURGE_DATE_FORMATTER.format(date);
}

export type WebDeletionInputValidationResult =
  | {
      readonly ok: true;
      readonly email: string;
      readonly password: string;
      readonly confirmation: string;
    }
  | {
      readonly ok: false;
      readonly email: string;
      readonly message: string;
    };

/**
 * Validates raw form fields from `POST /account-deletion` before any database or
 * lockout call is made.
 */
export function validateWebDeletionInput(
  body: unknown,
): WebDeletionInputValidationResult {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const rawEmail = typeof record.email === 'string' ? record.email.trim() : '';
  const rawPassword = typeof record.password === 'string' ? record.password : '';
  const rawConfirmation =
    typeof record.confirmation === 'string' ? record.confirmation.trim() : '';

  if (
    rawEmail.length === 0 ||
    rawEmail.length > 254 ||
    !SIMPLE_EMAIL_REGEX.test(rawEmail)
  ) {
    return {
      ok: false,
      email: rawEmail,
      message: 'Please enter a valid email address.',
    };
  }

  if (rawPassword.length === 0 || rawPassword.length > 128) {
    return {
      ok: false,
      email: rawEmail,
      message: 'Please enter your password.',
    };
  }

  if (rawConfirmation !== DELETE_ACCOUNT_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      email: rawEmail,
      message: `Please type ${DELETE_ACCOUNT_CONFIRMATION_PHRASE} in all caps to confirm account deletion.`,
    };
  }

  return {
    ok: true,
    email: rawEmail,
    password: rawPassword,
    confirmation: rawConfirmation,
  };
}

export interface RenderWebAccountDeletionFormOptions {
  readonly graceDays: number;
  readonly email?: string;
  readonly errorMessage?: string;
}

/**
 * Renders the self-contained HTML page for `GET /account-deletion` and error
 * re-renders on `POST /account-deletion`.
 */
export function renderWebAccountDeletionFormHtml(
  opts: RenderWebAccountDeletionFormOptions,
): string {
  const safeDays = Number.isFinite(opts.graceDays) ? Math.trunc(opts.graceDays) : 30;
  const emailValue = opts.email ? escapeHtml(opts.email) : '';
  const errorAlert = opts.errorMessage
    ? `<div role="alert" style="background-color: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 12px 14px; border-radius: 8px; font-size: 14px; margin-bottom: 20px;">${escapeHtml(opts.errorMessage)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delete Your Account | Disney World Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 32px 16px; line-height: 1.55; }
    .card { max-width: 560px; margin: 24px auto; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { margin-bottom: 20px; }
    .title { font-size: 24px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0; }
    .info-box { background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin-bottom: 20px; font-size: 14px; color: #334155; }
    .info-box h2 { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .info-box ul { margin: 8px 0 0 0; padding-left: 20px; }
    .info-box li { margin-bottom: 6px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    input[type="email"], input[type="password"], input[type="text"] { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; outline: none; }
    input[type="email"]:focus, input[type="password"]:focus, input[type="text"]:focus { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.15); }
    .btn-danger { width: 100%; background: #dc2626; color: #ffffff; border: none; padding: 14px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .btn-danger:hover { background: #b91c1c; }
    .hint { font-size: 12px; color: #64748b; margin-top: 4px; }
    .footer-links { margin-top: 20px; text-align: center; font-size: 13px; color: #64748b; }
    .footer-links a { color: #4f46e5; text-decoration: none; font-weight: 600; }
    .footer-links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="title">Delete Your Account</h1>
      <p class="subtitle">Disney World Tracker &mdash; Self-Service Account Deletion</p>
    </div>
    ${errorAlert}
    <div class="info-box">
      <h2>How account deletion works</h2>
      <p style="margin: 0 0 8px 0;">You can also delete your account directly inside the Disney World Tracker mobile app by opening <strong>You &amp; Crew &rarr; Delete account</strong>. If you have uninstalled the app, use the form below.</p>
      <ul>
        <li><strong>${safeDays}-day grace period:</strong> Once you submit this form, every device is signed out immediately and your profile is hidden from friends and trip members. Your account is scheduled for permanent erasure after <strong>${safeDays} days</strong>.</li>
        <li><strong>How to cancel:</strong> Signing in again with your email and password (or completing a password reset) before the ${safeDays}-day grace period ends cancels the deletion and restores your account.</li>
        <li><strong>What is permanently deleted:</strong> Your login credentials, profile (email, display name, avatar), experience ratings, completions, notes, favorites, collectible pins, friend connections, saved and shared lists, push notification tokens, and your uploaded photos. Trips you own are transferred to another trip member, or deleted along with their photos if you are the only member.</li>
        <li><strong>What is kept, anonymized:</strong> Shared trip comments, photo captions, trip activity history, shares you sent, and shared expense records (so trip balances stay accurate) are retained under the neutral label <strong>&ldquo;Deleted user&rdquo;</strong> with no link to your identity. Photo abuse reports you submitted are also retained without your identity.</li>
      </ul>
    </div>
    <form method="POST" action="/account-deletion">
      <div class="field">
        <label for="email">Account Email Address</label>
        <input type="email" id="email" name="email" value="${emailValue}" required maxlength="254" autocomplete="email" placeholder="you@example.com" />
      </div>
      <div class="field">
        <label for="password">Current Password</label>
        <input type="password" id="password" name="password" required maxlength="128" autocomplete="current-password" placeholder="Enter your password" />
      </div>
      <div class="field">
        <label for="confirmation">Type ${DELETE_ACCOUNT_CONFIRMATION_PHRASE} to confirm</label>
        <input type="text" id="confirmation" name="confirmation" required placeholder="${DELETE_ACCOUNT_CONFIRMATION_PHRASE}" autocomplete="off" />
        <div class="hint">Must match <strong>${DELETE_ACCOUNT_CONFIRMATION_PHRASE}</strong> in all capital letters.</div>
      </div>
      <button type="submit" class="btn-danger">Schedule Account Deletion</button>
    </form>
    <div class="footer-links">
      <a href="/privacy">Privacy Policy &amp; Data Retention Details</a>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderWebAccountDeletionSuccessOptions {
  readonly scheduledPurgeAt: Date;
  readonly graceDays: number;
}

/**
 * Renders the self-contained HTML confirmation page after `POST /account-deletion`
 * schedules an active account for deletion.
 */
export function renderWebAccountDeletionSuccessHtml(
  opts: RenderWebAccountDeletionSuccessOptions,
): string {
  const safeDays = Number.isFinite(opts.graceDays) ? Math.trunc(opts.graceDays) : 30;
  const formattedDate = escapeHtml(formatPurgeDate(opts.scheduledPurgeAt));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Deletion Scheduled | Disney World Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 32px 16px; line-height: 1.6; }
    .card { max-width: 500px; margin: 40px auto; background: #ffffff; border-radius: 16px; padding: 40px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; text-align: center; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 16px 0 10px 0; }
    .message { font-size: 15px; color: #475569; margin: 0 0 16px 0; }
    .footer-links { margin-top: 24px; font-size: 13px; }
    .footer-links a { color: #4f46e5; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div>
      <svg width="48" height="48" fill="none" stroke="#10b981" viewBox="0 0 24 24" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <h1 class="title">Account Deletion Scheduled</h1>
    <p class="message">Your account has been signed out on all devices, hidden from friends and trips, and scheduled for permanent deletion on <strong>${formattedDate}</strong> (${safeDays}-day grace period).</p>
    <p class="message">Changed your mind? Simply sign in to Disney World Tracker with your email and password (or reset your password) before <strong>${formattedDate}</strong> to cancel the deletion and restore your account.</p>
    <div class="footer-links">
      <a href="/privacy">Privacy Policy</a>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderPrivacyPolicyOptions {
  readonly graceDays: number;
  /** The deployment's configured `SUPPORT_EMAIL` (validated at boot); rendered HTML-escaped as a mailto link. */
  readonly supportEmail: string;
}

/**
 * Renders the public HTML privacy policy page at `GET /privacy`, mirroring
 * `docs/privacy-policy.md` and linking to `/account-deletion`.
 */
export function renderPrivacyPolicyHtml(opts: RenderPrivacyPolicyOptions): string {
  const safeDays = Number.isFinite(opts.graceDays) ? Math.trunc(opts.graceDays) : 30;
  const safeEmail = escapeHtml(opts.supportEmail);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy | Disney World Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 32px 16px; line-height: 1.65; }
    .card { max-width: 760px; margin: 24px auto; background: #ffffff; border-radius: 16px; padding: 36px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    h1 { font-size: 28px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    h2 { font-size: 19px; font-weight: 700; color: #0f172a; margin: 28px 0 10px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    h3 { font-size: 16px; font-weight: 600; color: #1e293b; margin: 18px 0 6px 0; }
    p, li { font-size: 15px; color: #334155; }
    ul, ol { padding-left: 22px; }
    li { margin-bottom: 8px; }
    .meta { font-size: 13px; color: #64748b; margin-bottom: 20px; }
    a { color: #4f46e5; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Privacy Policy</h1>
    <div class="meta"><strong>Effective Date:</strong> October 18, 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> October 18, 2026</div>
    <p>Welcome to <strong>Disney World Tracker</strong> (&ldquo;the App&rdquo;). We respect your privacy and are committed to protecting the personal information you share with us. This Privacy Policy explains what data we collect, how it is processed and stored, who it is shared with, and your rights regarding your photos and account data.</p>

    <h2>1. Information We Collect</h2>
    <h3>Account &amp; Profile Data</h3>
    <p>When you create an account, we collect your email address, display name, and your chosen avatar preset. Your password is cryptographically hashed using Argon2id before storage; we never store plain-text passwords.</p>
    <h3>Activity &amp; Trip Data</h3>
    <p>We store records of experiences you rate, mark completed, or add to your itineraries, along with your friend connections and trip plans.</p>
    <h3>User Photos</h3>
    <p>When you choose to upload photos (food logs, dish photos, or trip album photos), we process and store image files and associated metadata (such as timestamps, dish references, and captions).</p>

    <h2>2. Third-Party Service Providers &amp; Processing Disclosures</h2>
    <p>To operate photo uploads safely and securely, we utilize trusted third-party infrastructure and AI service providers:</p>
    <ol>
      <li><strong>Harm Moderation via OpenAI:</strong> Every uploaded photo (both full-resolution and thumbnail representations) is automatically transmitted to <strong>OpenAI</strong> (<code>omni-moderation-latest</code>) for automated safety and content moderation screening to detect harmful, illicit, or abusive material.</li>
      <li><strong>Food Identification &amp; Content Screening via Google:</strong> Every food photo uploaded to dish galleries or food logs is additionally transmitted to <strong>Google</strong> (<code>gemini-3.5-flash-lite</code> or fallback models) for automated vision evaluation to confirm food/beverage subjects, screen for prominent faces, and detect excessive text.</li>
      <li><strong>Encrypted Object Storage via Cloudflare:</strong> All user photos are stored in private, access-controlled <strong>Cloudflare</strong> R2 object storage buckets. Images are never publicly accessible; access is granted strictly through temporary, cryptographically signed, short-lived URLs.</li>
      <li><strong>Human Operator Review:</strong> Photos that are reported by community members or flagged for review by automated filters (including private, members-only Trip photos) may be viewed by the app operator to ensure safety, policy compliance, and community integrity.</li>
    </ol>

    <h2>3. Metadata &amp; EXIF / GPS Stripping</h2>
    <p>Your privacy is protected before photos leave your device:</p>
    <ul>
      <li>The mobile app automatically strips all EXIF metadata (including GPS coordinates, device models, and camera parameters) during local JPEG re-encoding before upload.</li>
      <li>Our backend servers perform automated scans of uploaded image headers to verify that EXIF segments have been removed.</li>
    </ul>

    <h2>4. Retention &amp; Deletion Schedules</h2>
    <p>We retain data only as long as necessary to provide our services and maintain community standards:</p>
    <ul>
      <li><strong>Approved Photos:</strong> Remain stored until deleted by the user or an organizer of the associated trip.</li>
      <li><strong>Rejected Photos:</strong> Photos rejected by automated moderation are retained for <strong>24 hours</strong> (<code>PHOTOS_REJECTED_RETENTION_HOURS</code>) for audit consistency before automated permanent deletion.</li>
      <li><strong>Photos Under Review:</strong> Photos escalated to human operator review are retained for a maximum of <strong>120 hours</strong> (<code>PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS</code>). If not approved within this window, they are automatically deleted by the system sweep.</li>
      <li><strong>Deleted Photos:</strong> When you delete a photo, its database row is marked deleted immediately, preventing further reads. Temporary serving URLs expire within 1 hour (<code>PHOTOS_GET_URL_TTL_SECONDS</code>), and underlying storage objects are hard-deleted on the next automated background sweep.</li>
      <li><strong>Deleted Accounts:</strong> When you delete your account, it is hidden immediately and then permanently erased when a grace period ends (see Section 5 for the steps and exactly what is erased and what is kept). The grace period is <strong>${safeDays} days</strong> (<code>ACCOUNT_DELETION_GRACE_DAYS</code>, default 30). Erasure runs as a background job that works in small batches, so it can finish a few hours after the grace period ends rather than at the exact moment.</li>
      <li><strong>Database Backups:</strong> Our database host may keep backups of the database for its own recovery purposes. Copies of your data inside those backups are not edited when you delete your account; they age out on the hosting provider&rsquo;s own schedule. We do not state a backup retention period here because it depends on the provider&rsquo;s plan and has not been verified.</li>
    </ul>

    <h2>5. Your Controls: Deletion, Reporting, and Blocking</h2>
    <ul>
      <li><strong>Delete Your Photos:</strong> You can delete your own photos at any time from your food log history, the dish gallery viewer, or the trip album. Trip organizers may also remove photos from their trips.</li>
      <li><strong>Report Content:</strong> If you encounter inappropriate, infringing, or objectionable content, you can tap the <strong>Report</strong> button in the photo viewer. Reports are queued for operator review.</li>
      <li><strong>Block Users:</strong> You can block any photo uploader directly from the photo viewer without revealing your identity or learning theirs. Blocking immediately hides all present and future photos from that uploader across all galleries, strips, and albums. You can review and unblock users in <strong>You &amp; Crew &rarr; Blocked Users</strong>.</li>
      <li><strong>Delete Your Account:</strong> You can delete your account yourself, without contacting us:
        <ul>
          <li><strong>In the mobile app:</strong> Open <strong>You &amp; Crew &rarr; Delete account</strong>, review what will happen, enter your password again, and type <code>DELETE</code> to confirm.</li>
          <li><strong>On the web (including after uninstalling the app):</strong> Visit our self-service <a href="/account-deletion">Account Deletion Request page (/account-deletion)</a>, enter your account email address and password, and type <code>DELETE</code> to confirm.</li>
          <li>Sign-in is by email address and password only; the App does not use any third-party sign-in provider (such as Apple or Google), so there is no external sign-in token to revoke.</li>
          <li><strong>Grace period:</strong> After you confirm, every device is signed out and your account is hidden from friends and trip members. It is permanently deleted after the grace period (<strong>${safeDays} days</strong> by default). <strong>Signing in again with your email and password during the grace period cancels the deletion</strong> and restores your account. Resetting your password during that time also restores it. After the grace period the account cannot be restored.</li>
          <li><strong>What is deleted:</strong> Your sign-in and profile (email, display name, avatar), your ratings, completions, notes, favorites, pins, friend connections, saved and shared lists, push notification registrations, and your photos. Trips you own are handed to another trip member, or deleted together with their photos if you are the only member. You are removed from trips you only joined.</li>
          <li><strong>What is kept, anonymized:</strong> Content that other people can see and rely on is kept but shown as &ldquo;Deleted user&rdquo;, with nothing linking it back to you. This covers comments and captions on shared trips, trip history entries, shares you sent to other people, and shared expense records (so that everyone else&rsquo;s balances stay correct). Reports you filed about photos are also kept without your identity.</li>
          <li><strong>After deletion:</strong> The email address becomes available to register again.</li>
        </ul>
      </li>
    </ul>

    <h2>6. User-Generated Content &amp; Code of Conduct</h2>
    <p>Disney World Tracker is a community dedicated to celebrating visits to Walt Disney World.</p>
    <h3>Objectionable Content Policy</h3>
    <p>Objectionable content is strictly prohibited. You may not upload photos or content that is:</p>
    <ul>
      <li>Defamatory, obscene, pornographic, sexually explicit, or suggestive;</li>
      <li>Violent, threatening, abusive, or promoting hate speech or harassment;</li>
      <li>Infringing upon any third party&rsquo;s intellectual property or privacy rights;</li>
      <li>Deceptive, promotional spam, or unauthorized advertising.</li>
    </ul>
    <p>Any content violating these standards will be removed immediately without prior notice. App operators may issue strikes and permanently ban repeat offenders or severe violators from uploading content or using the application.</p>
    <h3>Support Contact Information</h3>
    <p>If you have questions about this Privacy Policy, wish to appeal a content decision, or need to report an urgent safety concern, please contact our support team at:</p>
    <ul>
      <li><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></li>
    </ul>
  </div>
</body>
</html>`;
}

