// Feature: disney-world-tracker, Property 12: registration accepts iff email/displayName/password all valid
/**
 * Property-based test for the registration input validator.
 *
 * Validates: Requirements 6.4
 *
 * Property 12 (design.md → Correctness Properties → "Registration input
 * validator"):
 *
 *   For any `(email, displayName, password)` triple, registration is
 *   accepted if and only if
 *
 *     - `email` matches RFC 5322 syntax,
 *     - `displayName` length is in `1..50` after trimming with at least
 *       one non-whitespace character,
 *     - `password` length is in `8..128`,
 *
 *   and on rejection the response identifies the failing field.
 *
 * The shared `registerInputSchema` from `@dwt/shared` is the single source
 * of truth for these rules — the API route, the mobile client, and any
 * other consumer all run inputs through this same Zod schema. Pinning the
 * iff-property at the schema layer therefore covers every code path that
 * touches registration input validation without needing to spin up
 * Fastify, Postgres, or Argon2.
 *
 * The acceptance direction asserts: when every field is constructed inside
 * its allowed range, `safeParse` succeeds and produces an output whose
 * `displayName` is exactly `displayName.trim()` (the schema's documented
 * transform).
 *
 * The rejection direction is split per-field. Each test fixes the other
 * two fields to known-valid values and varies one field through its
 * out-of-range space:
 *
 *   1. invalid email (no `@`, no local part, no domain, etc.)
 *   2. display name whose trimmed length is 0 (empty or whitespace-only)
 *   3. display name whose trimmed length is > 50
 *   4. password shorter than 8 chars
 *   5. password longer than 128 chars
 *
 * Splitting the rejection direction this way lets the failing-field
 * assertion be precise: the Zod error must contain an issue at the
 * expected `path`, which mirrors R6.4's "return a validation error
 * response indicating the failing field" requirement.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { registerInputSchema } from '@dwt/shared';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Local-part charset for valid emails. Restricted to letters and digits so
 * the generator cannot accidentally produce a leading/trailing dot or
 * consecutive dots, both of which Zod's email regex rejects.
 */
const EMAIL_LOCAL_CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Domain-label charset (no hyphens at start/end concerns either). */
const EMAIL_DOMAIN_CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** TLD charset is alphabetic only — Zod's email regex requires `[A-Z]{2,}`. */
const EMAIL_TLD_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const validLocalArb = fc
  .array(fc.constantFrom(...EMAIL_LOCAL_CHARSET.split('')), {
    minLength: 1,
    maxLength: 20,
  })
  .map((cs) => cs.join(''));

const validDomainArb = fc
  .array(fc.constantFrom(...EMAIL_DOMAIN_CHARSET.split('')), {
    minLength: 1,
    maxLength: 20,
  })
  .map((cs) => cs.join(''));

const validTldArb = fc
  .array(fc.constantFrom(...EMAIL_TLD_CHARSET.split('')), {
    minLength: 2,
    maxLength: 6,
  })
  .map((cs) => cs.join(''));

/**
 * A guaranteed-valid email address.
 *
 * The total length is bounded by `20 + 1 + 20 + 1 + 6 = 48` characters,
 * well under the 254-character `.max(254)` cap on `emailSchema`. The
 * structural shape `local@domain.tld` matches the practical RFC 5322
 * subset Zod's `.email()` validator accepts.
 */
const validEmailArb = fc
  .tuple(validLocalArb, validDomainArb, validTldArb)
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Whitespace runs that JavaScript `String.prototype.trim` removes. */
const trimmableWhitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 0,
    maxLength: 5,
  })
  .map((cs) => cs.join(''));

/**
 * Charset for the post-trim *core* of a display name. Excludes whitespace
 * so the trimmed value is guaranteed to satisfy the `\S` regex regardless
 * of length.
 */
const DISPLAY_NAME_CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_!.,'";

const displayNameCoreArb = (minLen: number, maxLen: number) =>
  fc
    .array(fc.constantFrom(...DISPLAY_NAME_CHARSET.split('')), {
      minLength: minLen,
      maxLength: maxLen,
    })
    .map((cs) => cs.join(''));

/**
 * A display name whose trimmed length lies in `1..50` and which contains at
 * least one non-whitespace character. Optionally padded with surrounding
 * whitespace so the test exercises the schema's `.trim()` transform.
 */
const validDisplayNameArb = fc
  .tuple(
    trimmableWhitespaceArb,
    displayNameCoreArb(1, 50),
    trimmableWhitespaceArb,
  )
  .map(([lead, core, trail]) => `${lead}${core}${trail}`);

/** A password whose length is exactly within `[8, 128]`. */
const validPasswordArb = fc.string({ minLength: 8, maxLength: 128 });

// ---------------------------------------------------------------------------
// Invalid generators
// ---------------------------------------------------------------------------

/**
 * Strings that are NOT valid email addresses by Zod's `.email()` validator.
 *
 * The generator deliberately includes recognisable shapes — bare strings
 * with no `@`, missing local part, missing domain, missing TLD, leading/
 * trailing dots, and arbitrary garbage — to make the rejection property
 * cover the canonical RFC 5322 violations the schema must catch.
 */
const invalidEmailArb = fc.oneof(
  fc.constant(''),
  fc.constant('not-an-email'),
  fc.constant('@example.com'),
  fc.constant('user@'),
  fc.constant('user@@example.com'),
  fc.constant('user @example.com'),
  fc.constant('user@example'),
  fc.constant('.user@example.com'),
  fc.constant('user.@example.com'),
  // Arbitrary strings without `@` are guaranteed not to validate as email.
  fc
    .array(fc.constantFrom(...EMAIL_LOCAL_CHARSET.split('')), {
      minLength: 1,
      maxLength: 30,
    })
    .map((cs) => cs.join('')),
);

/** Display names whose trimmed length is 0 — empty or pure whitespace. */
const emptyOrWhitespaceDisplayNameArb = fc.oneof(
  fc.constant(''),
  // Whitespace-only of various flavours; after `.trim()` these are length 0
  // and also fail the `\S` regex.
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
      minLength: 1,
      maxLength: 10,
    })
    .map((cs) => cs.join('')),
);

/** Display names whose trimmed length exceeds 50. */
const tooLongDisplayNameArb = displayNameCoreArb(51, 200);

/** Passwords shorter than 8 characters (length 0..7). */
const tooShortPasswordArb = fc.string({ minLength: 0, maxLength: 7 });

/** Passwords longer than 128 characters (length 129..200). */
const tooLongPasswordArb = fc.string({ minLength: 129, maxLength: 200 });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('registerInputSchema — Property 12: accepts iff all three fields valid', () => {
  it('accepts every triple in the valid input space', () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validDisplayNameArb,
        validPasswordArb,
        (email, displayName, password) => {
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (!result.success) {
            return false;
          }
          // The schema documents a `.trim()` transform on `displayName`;
          // pin that contract so a future regression cannot let an
          // un-trimmed value reach the route handler.
          return (
            result.data.email === email &&
            result.data.displayName === displayName.trim() &&
            result.data.password === password
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects when the email field is invalid (other fields valid)', () => {
    fc.assert(
      fc.property(
        invalidEmailArb,
        validDisplayNameArb,
        validPasswordArb,
        (email, displayName, password) => {
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (result.success) {
            return false;
          }
          // R6.4: the failing field must be identified in the response.
          return result.error.issues.some(
            (issue) => issue.path[0] === 'email',
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects when displayName trimmed length is 0 (other fields valid)', () => {
    fc.assert(
      fc.property(
        validEmailArb,
        emptyOrWhitespaceDisplayNameArb,
        validPasswordArb,
        (email, displayName, password) => {
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (result.success) {
            return false;
          }
          return result.error.issues.some(
            (issue) => issue.path[0] === 'displayName',
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects when displayName trimmed length exceeds 50 (other fields valid)', () => {
    fc.assert(
      fc.property(
        validEmailArb,
        tooLongDisplayNameArb,
        validPasswordArb,
        (email, displayName, password) => {
          // Defensive: the generator builds from a non-whitespace charset
          // with no padding, so trimming is a no-op and the trimmed length
          // equals the raw length. Assert the precondition explicitly so a
          // future generator change cannot silently weaken the property.
          fc.pre(displayName.trim().length > 50);
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (result.success) {
            return false;
          }
          return result.error.issues.some(
            (issue) => issue.path[0] === 'displayName',
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects when password length is below 8 (other fields valid)', () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validDisplayNameArb,
        tooShortPasswordArb,
        (email, displayName, password) => {
          fc.pre(password.length < 8);
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (result.success) {
            return false;
          }
          return result.error.issues.some(
            (issue) => issue.path[0] === 'password',
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects when password length exceeds 128 (other fields valid)', () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validDisplayNameArb,
        tooLongPasswordArb,
        (email, displayName, password) => {
          fc.pre(password.length > 128);
          const result = registerInputSchema.safeParse({
            email,
            displayName,
            password,
          });
          if (result.success) {
            return false;
          }
          return result.error.issues.some(
            (issue) => issue.path[0] === 'password',
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
