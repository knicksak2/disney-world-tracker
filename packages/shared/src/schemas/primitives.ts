/**
 * Reusable Zod primitives shared across the input and DTO schemas.
 *
 * Centralizing these here keeps the validation rules in one place so the
 * server, the mobile client, and the shared types cannot drift. Every
 * primitive matches a specific requirement; the comment block on each names
 * the requirement(s) it enforces.
 */

import { z } from 'zod';

import { EXPERIENCE_CATEGORIES, PARKS, SHARE_PAYLOAD_KINDS } from '../enums.js';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * UUID identifier (v4 for User/session ids; v5 for Experience ids per R1.7).
 * Both are valid UUID strings, so a single primitive accepts either.
 */
export const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Auth / Profile primitives
// ---------------------------------------------------------------------------

/**
 * Email address, validated against RFC 5322 syntax via Zod's built-in
 * validator (R6.1, R6.4). A practical 254-character cap is applied to match
 * the real-world `Path` length limit from RFC 5321 §4.5.3.1.3 so we never
 * accept addresses no SMTP server would actually deliver to.
 */
export const emailSchema = z.string().email().max(254);

/**
 * Display name: trimmed, 1-50 characters, with at least one non-whitespace
 * character (R7.2, R7.5, R7.6). The trim is applied as a transform so the
 * stored value matches the validated value byte-for-byte.
 *
 * The `\S` regex is applied to the post-trim value as a defense-in-depth
 * check for inputs that contain only zero-width or unicode whitespace
 * characters that survive a JavaScript `String.prototype.trim` (which only
 * trims ASCII / category-Z whitespace per the ECMA spec).
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'display_name_invalid' })
  .max(50, { message: 'display_name_invalid' })
  .regex(/\S/u, { message: 'display_name_invalid' });

/**
 * Password: 8-128 characters (R6.1, R6.4). No structural rules beyond length
 * are imposed at this layer — the design relies on Argon2id and lockout for
 * resistance to credential-stuffing rather than imposing complexity rules
 * that hurt usability.
 */
export const passwordSchema = z
  .string()
  .min(8, { message: 'validation_failed' })
  .max(128, { message: 'validation_failed' });

// ---------------------------------------------------------------------------
// Tracking primitives
// ---------------------------------------------------------------------------

/**
 * Rating value: integer in `[1, 10]` inclusive (R4.1, R4.7). `z.number().int()`
 * rejects non-integer values such as `5.5` or `NaN`.
 */
export const ratingValueSchema = z
  .number()
  .int({ message: 'rating_out_of_range' })
  .min(1, { message: 'rating_out_of_range' })
  .max(10, { message: 'rating_out_of_range' });

/**
 * Note body: trimmed, 1-2000 characters (R5.2, R5.10). Whitespace-only inputs
 * are rejected because trimming reduces them to length 0.
 */
export const noteBodySchema = z
  .string()
  .trim()
  .min(1, { message: 'note_length_invalid' })
  .max(2000, { message: 'note_length_invalid' });

/**
 * ISO-8601 calendar date (YYYY-MM-DD) for Completion dates (R2.1).
 *
 * This validates the date *string* shape only. The "not in the future
 * relative to the User's local time zone" check (R2.6) requires the User's
 * IANA TZ at validation time and is therefore enforced server-side rather
 * than in this primitive.
 */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, {
  message: 'validation_failed',
});

/**
 * IANA time zone identifier (e.g. `America/New_York`). The Zod schema only
 * checks the gross shape (`Region/Subregion`); resolution against the IANA
 * database happens server-side where `Intl.DateTimeFormat` is available.
 */
export const ianaTzSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/u, { message: 'validation_failed' });

/** ISO-8601 UTC timestamp (`Z`-suffixed). */
export const isoTimestampSchema = z.string().datetime({ offset: false });

// ---------------------------------------------------------------------------
// Search and sharing primitives
// ---------------------------------------------------------------------------

/**
 * User-search query: 1-100 characters (R8.1, R8.2). The query is *not*
 * trimmed here because the substring-match semantics in R8.1 are defined over
 * the raw query bytes; the server applies its own normalization before
 * matching.
 */
export const searchQuerySchema = z
  .string()
  .min(1, { message: 'search_query_length_invalid' })
  .max(100, { message: 'search_query_length_invalid' });

/**
 * Recipient list for a Share: 1-50 unique User ids (R9.1, R9.2). Duplicate
 * recipient ids are coalesced by `.uniqueItems`-style refinement — sending
 * the same Share to the same person twice is treated as a validation error
 * because the per-recipient delivery row is keyed by `(share_id, recipient_id)`
 * and the duplicate would otherwise abort the atomic insert silently.
 */
export const recipientListSchema = z
  .array(uuidSchema)
  .min(1, { message: 'share_recipient_count_invalid' })
  .max(50, { message: 'share_recipient_count_invalid' })
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'share_recipient_count_invalid',
        });
        return;
      }
      seen.add(id);
    }
  });

// ---------------------------------------------------------------------------
// Enum primitives
// ---------------------------------------------------------------------------

/** ExperienceCategory enum (R1.3-R1.5). */
export const experienceCategorySchema = z.enum(EXPERIENCE_CATEGORIES);

/** Park enum (R1.6). */
export const parkSchema = z.enum(PARKS);

/** SharePayloadKind enum (R9.1, R9.7). */
export const sharePayloadKindSchema = z.enum(SHARE_PAYLOAD_KINDS);

// ---------------------------------------------------------------------------
// Stats primitives
// ---------------------------------------------------------------------------

/**
 * Completion percentage in `[0.0, 100.0]` (R3.1-R3.3, R3.8). The schema
 * checks the bounds; the rounding to one decimal place is enforced at
 * computation time inside Stats_Service.
 */
export const completionPercentSchema = z.number().min(0).max(100);
