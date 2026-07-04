/**
 * shareBody — pure `POST /me/shares` body composition for the Share_Composer.
 *
 * The Share_Composer opens with a fully derived, discriminated
 * `ShareComposerParams` (from a `Share_Entry_Point`) and offers independent
 * include/exclude toggles for the sender's Rating and Note. When the User
 * confirms, the screen must submit a body carrying the kind and content
 * derived from the entry point, including the sender's Rating and Note *only*
 * when the corresponding value is present AND its toggle is marked included
 * (R2.8, R2.14).
 *
 * That derivation is captured here as a framework-free pure function so it can
 * be exercised directly by property tests (task 5.5, Property 4) and reused by
 * the screen — mirroring the `recipientGating.ts` / `shareEntryPoint.ts`
 * pure-core pattern.
 */

import type { ShareComposerParams } from '../../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// Body shapes for `POST /me/shares`
// ---------------------------------------------------------------------------

/** Body for `POST /me/shares` — Experience branch. */
export interface ExperienceShareBody {
  readonly kind: 'experience';
  readonly recipientIds: ReadonlyArray<string>;
  readonly experienceId: string;
  readonly rating?: number;
  readonly includeRating?: boolean;
  readonly note?: string;
}

/** Body for `POST /me/shares` — Progress branch. */
export interface ProgressShareBody {
  readonly kind: 'progress';
  readonly recipientIds: ReadonlyArray<string>;
  readonly statsSnapshot: {
    readonly overallPercent: number;
    readonly perParkPercent: Record<string, number | undefined>;
    readonly perCategoryPercent: Record<string, number | undefined>;
  };
}

export type ShareCreateBody = ExperienceShareBody | ProgressShareBody;

/** The states of the two independent include/exclude toggles (R2.14). */
export interface IncludeToggles {
  /** Whether the sender's Rating is currently marked for inclusion. */
  readonly includeRating: boolean;
  /** Whether the sender's Note is currently marked for inclusion. */
  readonly includeNote: boolean;
}

// ---------------------------------------------------------------------------
// Presence predicates — a value can be included only when it is present
// ---------------------------------------------------------------------------

/**
 * True when the pre-populated params carry a Rating available for inclusion.
 * Only an `experience` payload can carry a Rating, and it must be defined.
 */
export function hasRatingValue(params: ShareComposerParams): boolean {
  return params.kind === 'experience' && params.rating !== undefined;
}

/**
 * True when the pre-populated params carry a non-empty Note available for
 * inclusion. Only an `experience` payload can carry a Note, and it must be a
 * non-empty string.
 */
export function hasNoteValue(params: ShareComposerParams): boolean {
  return (
    params.kind === 'experience' &&
    params.note !== undefined &&
    params.note.length > 0
  );
}

// ---------------------------------------------------------------------------
// Body composition (R2.8, R2.14)
// ---------------------------------------------------------------------------

/**
 * Build the `POST /me/shares` body from the pre-populated composer params, the
 * include/exclude toggle states, and the chosen recipients (R2.8).
 *
 * Rules:
 *   - The body's `kind` and content are derived from the entry point's params;
 *     the composer never lets the User change the kind or the content.
 *   - The sender's Rating is included if and only if a Rating is present in the
 *     params AND the `includeRating` toggle is marked included (R2.14). When
 *     included the body carries both `rating` and `includeRating: true` so the
 *     Sharing_Service records the value; when excluded neither field appears.
 *   - The sender's Note is included if and only if a non-empty Note is present
 *     in the params AND the `includeNote` toggle is marked included (R2.14).
 *   - A `progress` payload carries the overall/per-Park/per-Category snapshot
 *     verbatim; it never carries a Rating or Note.
 */
export function buildShareCreateBody(
  params: ShareComposerParams,
  toggles: IncludeToggles,
  recipientIds: ReadonlyArray<string>,
): ShareCreateBody {
  if (params.kind === 'experience') {
    const includedRating = hasRatingValue(params) && toggles.includeRating;
    const includedNote = hasNoteValue(params) && toggles.includeNote;

    return {
      kind: 'experience',
      recipientIds,
      experienceId: params.experienceId,
      ...(includedRating
        ? { rating: params.rating, includeRating: true }
        : {}),
      ...(includedNote ? { note: params.note } : {}),
    };
  }

  return {
    kind: 'progress',
    recipientIds,
    statsSnapshot: {
      overallPercent: params.overallPercent,
      perParkPercent: { ...params.perParkPercent },
      perCategoryPercent: { ...params.perCategoryPercent },
    },
  };
}
