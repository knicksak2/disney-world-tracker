/**
 * Completion_Diff derivation (task 25.1).
 *
 * A pure set difference over the viewing User's own Completion_Entries and a
 * Friend's Completion_Entries — both the shared `CompletionEntryDTO[]` shape
 * (the owner-path `GET /users/:ownId/completions` for the viewer, the
 * friend-scoped `GET /users/:friendId/completions` for the Friend). The
 * Friend_Profile_View has already retrieved both (task 23.1), so this
 * derivation adds no new reads and simply projects the two lists into the
 * Friend-minus-viewer difference (R13.5).
 *
 * The difference is computed by **Experience identity** — an entry's
 * `experienceId` — so it is the set of Experiences the Friend has completed
 * whose `experienceId` does not appear anywhere in the viewer's completed set
 * (R13.1). Concretely it returns `{ e ∈ F : e.experienceId ∉ V }`, preserving
 * the Friend list's source order and keeping the first entry seen for any
 * duplicate `experienceId` so the result is a proper set by identity. Because
 * each returned entry is a Friend `CompletionEntryDTO`, it already carries the
 * Experience's name, Park, and Experience_Category for rendering (R13.2).
 *
 * The result is empty if and only if every Experience the Friend has completed
 * is also present in the viewer's completed set (R13.4). Mapping entries to
 * rows, attaching navigation, and choosing empty / loading / unavailable
 * states are render-layer concerns kept out of this pure function so it stays
 * trivially testable (Property 21).
 *
 * Validates: Requirements 13.1, 13.4, 13.5
 */

import type { CompletionEntryDTO } from '@dwt/shared';

/**
 * Derive the Completion_Diff: the Experiences the Friend has completed that the
 * viewing User has not, compared by `experienceId` (R13.1). Preserves the
 * Friend list's source order and deduplicates by `experienceId` (keeping the
 * first occurrence) so the returned list is a set by Experience identity. The
 * result is empty exactly when every Friend-completed Experience is present in
 * the viewer's set (R13.4).
 */
export function deriveCompletionDiff(
  viewerEntries: readonly CompletionEntryDTO[],
  friendEntries: readonly CompletionEntryDTO[],
): readonly CompletionEntryDTO[] {
  const viewerIds = new Set<string>();
  for (const entry of viewerEntries) {
    viewerIds.add(entry.experienceId);
  }

  const seen = new Set<string>();
  const diff: CompletionEntryDTO[] = [];
  for (const entry of friendEntries) {
    const id = entry.experienceId;
    if (viewerIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    diff.push(entry);
  }
  return diff;
}
