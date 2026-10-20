# Recap share composer, read-only recap screen, and Summary entry (photo-uploads tasks 22.4 and 22.5)

Tasks 22.4 and 22.5 add the `tripSummary` share on mobile. The composer gets an "Include trip photos" toggle (default on) beside the all-crew-members line, and sends a pointer-only body. A new `TripRecapScreen` loads `GET /me/inbox/:shareId/trip-recap` and renders the shared `TripPhotosSection` in `recipient` mode. Inbox, Sent list, Notification Center, `shareBody.ts` and `attention.ts` each gain a `tripSummary` branch. `TripSummaryScreen` gains "Send to friends" and the text-share note. Every item of the consumer checklist is implemented and has a behavior test that asserts a request, a navigation target, or on-screen text. The forbidden features (per-photo recap opt-out, sender revoke, public or tokenized link) do not exist. The four non-blocking points below do not change that.

Watch for: (1) the coder's pasted verification tails were not available to this reviewer; I could only confirm a clean `apps/mobile` typecheck and file-level jest logs, so checkpoint 23's scoped gates and task 24's full `npm run verify` tail must still be produced (confirmed); (2) with `recap: null` the screen still renders the trip name and the "<sharer> shared this recap" subtitle above the unavailable text, where the task says "only the text" (confirmed, minor).

**Verdict**: APPROVED

## High-level view

The composer sends `{ kind, tripId, recipientIds, includePhotos }` and nothing else; the server composes the stored payload. The recap screen is read-only and routes every photo, Report and "Block uploader" interaction through the one `TripPhotosSection`, which hands `shareId` to `PhotoViewer`, `PhotoReportSheet` and the block call. A source-reading test pins that the screen defines no second photos section.

The recipient screen maps the three `photos.access` values to a strip or an explanation, and treats `recap: null` and the route's collapsed `validation_failed` (deleted share, unfriended sender, D25) with the same "This recap is no longer available" text and no retry. The Inbox reuses its existing `stillFriend` pre-check, then branches to `TripRecap` before the `FriendProfile` fallback. The Notification Center runs its own equivalent check against the cached friends list, using a `senderId` that `attention.ts` now carries for `tripSummary` refs only.

Box-ticking matches the code: parents 7, 8, 9, 10 and 22 and sub-tasks 22.4 and 22.5 are ticked with every child ticked; 12.2, 13.10, 14.3, 14.5 and parents 12, 13, 14 are unchecked; no marker other than `- [ ]` or `- [x]` appears. Task 24 is unchecked, which is honest given the full gate has no recorded tail.

<details>
<summary>Issues (4)</summary>

1. **Verification tails not visible (non-blocking, confirmed)** — the coder's pasted `typecheck`/scoped-suite tails did not reach this review. Include the literal tails and exit codes in the task 24 report; checkpoint 23 is ticked on the strength of runs I could not read.
2. **"Only the text" on `recap: null` (non-blocking, confirmed)** — `TripRecapScreen` renders the trip name header and sharer subtitle alongside `RECAP_UNAVAILABLE_COPY`. Either hide both when `data.recap === null` or amend the task text; the test titled "shows only..." does not assert the header's absence.
3. **`as never` in new tests (non-blocking, confirmed)** — two new `mockResolvedValueOnce({ friends: [...] } as never)` casts in `NotificationCenterScreen.test.tsx` extend an existing pattern (three at HEAD). Type the friends fixture as `FriendsListSnapshot` instead.
4. **Unrelated changes in the same tree (non-blocking, confirmed)** — `YouAndCrewStack` also registers `BlockedUsers`, `RootStackParamList.Menu` gains `focusFoodItemId`, and `RootNavigator` adds a global `ReactNavigation.RootParamList` augmentation. They belong to other tasks; the augmentation changes navigation typing app-wide, so confirm it is intended (typecheck is clean).

</details>

<details>
<summary>Details</summary>

## What the verification evidence does and does not establish

Reading the temp logs left by the coder, the file-level jest runs for the 22.4 and 22.5 suites ended green: `tripSummaryShare.inbox` 5/5, `TripRecapScreen` 10/10, composer plus `shareBody` 8/8, `NotificationCenterScreen` 13/13, `TripSummaryScreen` 10/10, theme guard 8/8, `TripAlbumScreen` 14/14. One earlier inbox run failed 1 of 5; `InboxScreen.tsx` was edited seconds later and the previous review pass saw it at 5/5. `TripPhotosSection.tsx`, its test, the `TripSummaryScreen` test and the API `sharingRoutes.tripSummary` test were edited after that pass, and I found no log of them being re-run. `apps/api` coverage output is timestamped after those edits, which suggests an API run, but it is not a tail. My one spot-check was `npm run typecheck` in `apps/mobile`, which exited 0. That proves the mobile program compiles, not that the API, shared or remaining mobile suites pass.

## Recap screen: null recap still shows a header

For `recap: null` the screen returns early from the figures branch but the header block above it is unconditional, so the recipient sees the trip name and "<sharer> shared this recap" over the unavailable line. The name comes from data the recipient already holds, so nothing new leaks, and the collapsed-`validation_failed` path shows the unavailable text alone. Hiding the header when `recap` is `null` would make the literal task text true.

## Checklist items verified against source and test

Inbox: the `tripSummary` branch sits after the `stillFriend` block and the `pinShowcase` branch and before the `FriendProfile` call; the test mounts the real `InboxScreen` in a real navigator and asserts the route is `TripRecap` with `{ shareId }` and that the `FriendProfile` stub never mounts, and that a non-friend sender shows `SENDER_TAP_UNAVAILABLE_COPY` with no navigation. Sent list: the row shows the trip name; the test asserts no stop-sharing, revoke, unsend or recall text or label. `shareBody.ts`: tested for the four-key body with no `sharerId`. Notification Center: navigates to `YouAndCrew > TripRecap` for a friend and alerts otherwise. `attention.ts`: both destination branches and the label are covered in `contracts.phase2.test.ts` and `sharingRoutes.tripSummary.test.ts`. Reaction chips: a `tripSummary` card renders the default four.

The recap screen tests cover `granted` (thumbnail labels, no album/add/edit/delete/stop-sharing text, and exactly one GET), `not_included`, `unavailable`, `recap: null`, the collapsed `validation_failed` with no retry, the retry path, Report posting `{ reason, shareId }` with the confirmation, and "Block uploader" posting `{ photoId, shareId }` with no `userId` plus the notice.

## Styling and accessibility

`TripRecapScreen` and `TripPhotosSection` use `makeStyles` and `useAppTheme` and contain no colour literals. The earlier hard-coded font metrics in `TripPhotosSection` now use `t.typography` tokens, and the `try/catch` around `useNavigation` is gone. Thumbnails are `imagebutton` with "Trip photo N, opens viewer"; the composer switch has `accessibilityRole="switch"`, a label and checked state; the unavailable text has `accessibilityRole="alert"`. Meaning is carried by text, not colour.

</details>

<details>
<summary>File map</summary>

- `apps/mobile/src/screens/share/TripRecapScreen.tsx` (new): read-only recap, all access states, reuses `TripPhotosSection`
- `apps/mobile/src/photos/TripPhotosSection.tsx`: member and recipient modes (task 22.6, reused here)
- `apps/mobile/src/screens/share/ShareComposerScreen.tsx`: `tripSummary` variant, toggle, crew-photos line
- `apps/mobile/src/screens/share/shareBody.ts`: `tripSummary` pointer body, `includePhotos` default true
- `apps/mobile/src/screens/share/InboxScreen.tsx`: card content and navigation branch after `stillFriend`, before `FriendProfile`
- `apps/mobile/src/screens/share/SentSharesScreen.tsx`: sender-side card, no revoke
- `apps/mobile/src/screens/notifications/NotificationCenterScreen.tsx`: `tripSummary` destination with still-Friend check
- `apps/mobile/src/screens/trips/TripSummaryScreen.tsx`: "Send to friends", text-share note, photos section
- `apps/mobile/src/navigation/RootNavigator.tsx`, `YouAndCrewStack.tsx`: composer params variant, `TripRecap` route (plus unrelated additions, issue 4)
- `packages/shared/src/attention.ts`: `tripSummary` destination, label, `senderId` on ref
- Tests: `TripRecapScreen.test.tsx`, `ShareComposerScreen.tripSummary.test.tsx`, `tripSummaryShare.inbox.test.tsx`, `shareBody.test.ts`, `NotificationCenterScreen.test.tsx`, `TripSummaryScreen.test.tsx`, `TripPhotosSection.test.tsx`, `sharingRoutes.tripSummary.test.ts`
- `.kiro/specs/photo-uploads/tasks.md`: boxes ticked

Full diff: `git diff` plus the untracked `TripRecapScreen.tsx` and new test files.

</details>
