/**
 * Pure domain logic for unified experience logging.
 *
 * I/O-free. Single source of truth for:
 *   - trip containment & pre-selection rules (R2.1, R2.2, R2.3)
 *   - draft reconciliation across date and trip changes (R2.6, R2.7, R2.8, R2.9)
 *   - candidate member filtering (R3.1)
 *   - category labels & dish prompt eligibility (R3.2, R8.1, R8.3)
 *   - submission routing & body formatting (R1.3, R3.5, R4.4, R5.1, R13.2)
 *   - log toast string formatting (R7.2)
 */

export interface LogTripRef {
  readonly id: string;
  readonly name: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string;   // YYYY-MM-DD, >= startDate
}

export interface LogDraft {
  readonly visitedOn: string;              // YYYY-MM-DD
  readonly rating: number | null;          // 1..10 or null
  readonly note: string;                   // raw; trimmed on submit
  readonly tripId: string | null;
  readonly rodeWith: readonly string[];    // Trip_Member user ids
}

/** Inclusive on both ends. Plain string comparison (zero-padded ISO dates). */
export function isDateWithinTrip(
  date: string,
  trip: Pick<LogTripRef, 'startDate' | 'endDate'>,
): boolean {
  return date >= trip.startDate && date <= trip.endDate;
}

/**
 * R2.1/R2.2: the id of the single Active_Trip whose inclusive range contains
 * `visitedOn`; `null` if there are zero or two-or-more such trips.
 */
export function preselectTripId(
  activeTrips: readonly LogTripRef[],
  visitedOn: string,
): string | null {
  const matching = activeTrips.filter((t) => isDateWithinTrip(visitedOn, t));
  const first = matching[0];
  return matching.length === 1 && first ? first.id : null;
}

export type DraftHint = 'date_outside_trip' | null;

/**
 * R2.6-R2.9: apply a change to Visit_Date and/or Trip_Selection.
 *  - tripId changes to a different value -> rodeWith = [].
 *  - visitedOn changes, tripId non-null, NOT locked, date outside that trip's range
 *      -> tripId = null, rodeWith = [], hint = 'date_outside_trip'.
 *  - locked trip and the new date is outside its range -> return prev unchanged (the picker should
 *      prevent this; this is the defensive fallback).
 *  - lockedTripId !== null: a change to tripId is ignored.
 */
export function reconcileDraft(
  prev: LogDraft,
  change: { readonly visitedOn?: string; readonly tripId?: string | null },
  trips: readonly LogTripRef[],
  lockedTripId: string | null,
): { readonly draft: LogDraft; readonly hint: DraftHint } {
  if (lockedTripId !== null) {
    const lockedTrip = trips.find((t) => t.id === lockedTripId);
    if (change.visitedOn !== undefined && change.visitedOn !== prev.visitedOn) {
      if (lockedTrip && !isDateWithinTrip(change.visitedOn, lockedTrip)) {
        return { draft: prev, hint: null };
      }
      return {
        draft: {
          ...prev,
          visitedOn: change.visitedOn,
          tripId: lockedTripId,
        },
        hint: null,
      };
    }
    return {
      draft: {
        ...prev,
        tripId: lockedTripId,
      },
      hint: null,
    };
  }

  let nextTripId = change.tripId !== undefined ? change.tripId : prev.tripId;
  const nextVisitedOn = change.visitedOn !== undefined ? change.visitedOn : prev.visitedOn;
  let rodeWith = prev.rodeWith;
  let hint: DraftHint = null;

  if (change.tripId !== undefined && change.tripId !== prev.tripId) {
    rodeWith = [];
  }

  if (nextTripId !== null) {
    const trip = trips.find((t) => t.id === nextTripId);
    if (trip && !isDateWithinTrip(nextVisitedOn, trip)) {
      nextTripId = null;
      rodeWith = [];
      hint = 'date_outside_trip';
    }
  }

  return {
    draft: {
      visitedOn: nextVisitedOn,
      rating: prev.rating,
      note: prev.note,
      tripId: nextTripId,
      rodeWith,
    },
    hint,
  };
}

/** R3.1: members except the caller, input order preserved, ids unique. */
export function ridingWithCandidates<M extends { readonly userId: string }>(
  members: readonly M[],
  callerUserId: string,
): readonly M[] {
  const seen = new Set<string>();
  const candidates: M[] = [];
  for (const m of members) {
    if (m.userId !== callerUserId && !seen.has(m.userId)) {
      seen.add(m.userId);
      candidates.push(m);
    }
  }
  return candidates;
}

/** R3.2 / R8.3. `category === 'Restaurant'` (exact, the ExperienceCategory value). */
export function ridingWithLabel(category: string | null | undefined): 'Dined with' | 'Rode with' {
  return category === 'Restaurant' ? 'Dined with' : 'Rode with';
}

export function offersDishPrompt(category: string | null | undefined): boolean {
  return category === 'Restaurant';
}

export interface LogSubmission {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * R13.2: lockedTripId !== null -> POST /trips/:tripId/log-entries
 *          body { experienceId, rodeWith, visitedOn, userTz, rating?, note? }  (rating/note omitted when null/empty)
 *        otherwise            -> POST /me/experiences/:id/logs
 *          body { visitedOn, userTz, rating, note, tripId, rodeWith? }  (rodeWith only when tripId != null and non-empty;
 *          rating/note/tripId are null when absent)
 * rodeWith is de-duplicated preserving first occurrence and never contains `callerUserId`.
 * note is trimmed; an empty trimmed note is treated as absent.
 */
export function buildLogSubmission(args: {
  readonly experienceId: string;
  readonly draft: LogDraft;
  readonly userTz: string;
  readonly lockedTripId: string | null;
  readonly callerUserId: string;
}): LogSubmission {
  const seen = new Set<string>();
  const rodeWith: string[] = [];
  for (const id of args.draft.rodeWith) {
    if (id !== args.callerUserId && !seen.has(id)) {
      seen.add(id);
      rodeWith.push(id);
    }
  }

  const trimmedNote = args.draft.note.trim();

  if (args.lockedTripId !== null) {
    const body: Record<string, unknown> = {
      experienceId: args.experienceId,
      rodeWith,
      visitedOn: args.draft.visitedOn,
      userTz: args.userTz,
    };
    if (args.draft.rating !== null) {
      body.rating = args.draft.rating;
    }
    if (trimmedNote.length > 0) {
      body.note = trimmedNote;
    }
    return {
      path: `/trips/${encodeURIComponent(args.lockedTripId)}/log-entries`,
      body,
    };
  }

  const body: Record<string, unknown> = {
    visitedOn: args.draft.visitedOn,
    userTz: args.userTz,
    rating: args.draft.rating,
    note: trimmedNote.length > 0 ? trimmedNote : null,
    tripId: args.draft.tripId,
  };
  if (args.draft.tripId !== null && rodeWith.length > 0) {
    body.rodeWith = rodeWith;
  }

  return {
    path: `/me/experiences/${encodeURIComponent(args.experienceId)}/logs`,
    body,
  };
}

/** R7.2 exact toast text. taggedNames: at most two shown, then "and N more". */
export function formatLogToast(args: {
  readonly experienceName: string;
  readonly tripName: string | null;
  readonly taggedNames: readonly string[];
}): string {
  const base = args.tripName
    ? `${args.experienceName} logged to ${args.tripName}`
    : `${args.experienceName} logged`;

  const first = args.taggedNames[0];
  const second = args.taggedNames[1];

  if (args.taggedNames.length === 1 && first) {
    return `${base} with ${first}`;
  }

  if (args.taggedNames.length === 2 && first && second) {
    return `${base} with ${first} and ${second}`;
  }

  if (args.taggedNames.length >= 3 && first && second) {
    const remainder = args.taggedNames.length - 2;
    return `${base} with ${first}, ${second} and ${remainder} more`;
  }

  return base;
}

