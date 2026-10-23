/**
 * How the client presents a person whose id arrives from the server
 * (account-deletion R6.4, design "Placeholder rendering").
 *
 * A deleted or pending person reaches the client as the Deleted_User_Placeholder:
 * the server already sends the name `Deleted user` and a null avatar preset, and
 * the id carries the fixed `deadc0de-` prefix, so `isDeletedUserId(id)` is enough
 * to tell the client "do not link, do not offer actions". The client never decides
 * the text, only whether the person may be tapped.
 *
 * Every list that links a person to a profile, comparison or friend action (inbox
 * senders, trip feed and comment authors, expense parties) goes through
 * `presentPerson`. A placeholder gets no friend, invite, share, block or compare
 * action.
 */

import { DELETED_USER_DISPLAY_NAME, isDeletedUserId } from '@dwt/shared';

export interface PersonPresentation {
  /** False for a placeholder: it must not open a profile or comparison, nor offer a person action. */
  readonly tappable: boolean;
  /** Screen-reader label. A placeholder's contains "Deleted user". */
  readonly accessibilityLabel: string;
}

export function presentPerson(id: string, displayName: string): PersonPresentation {
  if (isDeletedUserId(id)) {
    return { tappable: false, accessibilityLabel: DELETED_USER_DISPLAY_NAME };
  }
  return { tappable: true, accessibilityLabel: displayName };
}

/** True when any of the given ids is a placeholder (used to hide settle controls). */
export function involvesDeletedUser(...ids: readonly string[]): boolean {
  return ids.some((id) => isDeletedUserId(id));
}

/**
 * Copy of a `userId -> displayName` roster map that also names every placeholder
 * id found in the data. The roster omits non-visible people, so without this a
 * balance row for a deleted payer would fall back to a generic "Member".
 */
export function withDeletedUserNames(
  names: ReadonlyMap<string, string>,
  ids: Iterable<string>,
): Map<string, string> {
  const next = new Map(names);
  for (const id of ids) {
    if (isDeletedUserId(id) && !next.has(id)) {
      next.set(id, DELETED_USER_DISPLAY_NAME);
    }
  }
  return next;
}
