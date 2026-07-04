// Feature: social-sharing-loop, Task 4.1 — Experience_Detail_View Share_Entry_Point core
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
//
// Framework-free core (no React, no react-navigation) for the
// Experience_Detail_View `Share_Entry_Point`, mirroring the existing
// `infoTags.ts` / `gating.ts` pure-core pattern so the enablement rule and the
// composer-param projection are unit- and property-testable without rendering.
//
// Two guarantees live here:
//   - `isExperienceShareEntryEnabled` — the control is enabled if and only if
//     none of the required content (the Experience detail, the viewer's Rating,
//     the viewer's Note) is still loading (R1.2).
//   - `buildExperienceShareParams` — activating the enabled control projects
//     the already-loaded detail (`name`, `park`, `category`), the viewer's
//     Rating as a whole number 1–10 when present (R1.4), and the viewer's Note
//     text ≤2000 characters when present (R1.5) into a discriminated
//     `experience` `ShareComposerParams` (R1.3).

import type {
  ExperienceCategory,
  NoteDTO,
  Park,
  RatingDTO,
} from '@dwt/shared';

import type { ShareComposerParams } from '../../navigation/RootNavigator';

/** Maximum Note length carried into the composer (R1.5, R5.2). */
const NOTE_MAX_LENGTH = 2000;

/** The `experience` variant of the discriminated composer params. */
export type ExperienceShareParams = Extract<
  ShareComposerParams,
  { kind: 'experience' }
>;

/**
 * The minimal slice of the loaded Experience detail the entry point projects
 * into composer params. A structural subset of the screen's
 * `ExperienceDetailDTO` so the core stays decoupled from the wire shape.
 */
export interface ShareableExperienceDetail {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
}

/** Content-load flags for the three reads the entry point depends on. */
export interface ShareEntryLoadState {
  /** `GET /catalog/:experienceId` (the Experience detail) is still loading. */
  readonly detailLoading: boolean;
  /** The viewer's own Rating read is still loading. */
  readonly ratingLoading: boolean;
  /** The viewer's own Note read is still loading. */
  readonly noteLoading: boolean;
}

/**
 * The `Share_Entry_Point` is enabled if and only if none of its required
 * content is still loading (R1.2). While the Experience detail, the viewer's
 * Rating, or the viewer's Note is loading, the control is disabled.
 */
export function isExperienceShareEntryEnabled(
  flags: ShareEntryLoadState,
): boolean {
  return !flags.detailLoading && !flags.ratingLoading && !flags.noteLoading;
}

/**
 * Normalize a viewer Rating into a whole number 1–10 for inclusion in the
 * pre-populated Experience_Share (R1.4). The `RatingDTO.value` is already an
 * integer in `[1, 10]`; rounding and clamping here is defensive so a malformed
 * value can never leak a non-whole or out-of-range Rating into the composer.
 */
function normalizeRating(value: number): number {
  const whole = Math.round(value);
  if (whole < 1) return 1;
  if (whole > 10) return 10;
  return whole;
}

/**
 * Build the `experience` `ShareComposerParams` from the loaded Experience
 * detail plus the viewer's own Rating and Note (R1.3, R1.4, R1.5).
 *
 * The optional `rating` / `note` fields are populated only when the viewer has
 * the corresponding value; their presence drives the composer's include/exclude
 * toggles (R2.14). A Note is included only when it carries non-empty text after
 * trimming, and is truncated to 2000 characters as a defensive bound (R1.5).
 */
export function buildExperienceShareParams(
  detail: ShareableExperienceDetail,
  rating: RatingDTO | null,
  note: NoteDTO | null,
): ExperienceShareParams {
  const params: {
    kind: 'experience';
    experienceId: string;
    experienceName: string;
    park: Park;
    category: ExperienceCategory;
    rating?: number;
    note?: string;
  } = {
    kind: 'experience',
    experienceId: detail.id,
    experienceName: detail.name,
    park: detail.park,
    category: detail.category,
  };

  if (rating !== null) {
    params.rating = normalizeRating(rating.value);
  }

  if (note !== null) {
    const body = note.body.trim();
    if (body.length > 0) {
      params.note = body.slice(0, NOTE_MAX_LENGTH);
    }
  }

  return params;
}
