# Visibility retrofit, money with non-visible parties, admin deletion status, and structural guards (chunk D, tasks 12.1-12.5 and checkpoint 13), pass 2

Pass 1 found one blocking gap: the Trip feed's rode-with list was converted to `profile_identity` but its only test replaced that subquery with `NULL`. Pass 2 confirms the gap is closed. The new test in `visibility.trips.test.ts` records the SQL `getFeed` really sends, cuts the `json_agg` subquery out by text, binds `le.id` to a seeded log entry and runs that text. It asserts the pending tagged member as the alias id with `Deleted user` and `state: 'pending'`, the active tagger keeping the real id and name, and the real values after `restore`. It also asserts the cut text contains `JOIN profile_identity pr` and not `rwt.tagged_member_id,`. This is a test that fails when the conversion is reverted (the coder shows that mutation; the assertion on the cut text makes it structural as well). I did not re-run the suites the coder ran. I ran this one file as a spot check: 19 passed, exit 0.

Watch for: nothing blocking remains. The guest-under-pending-sponsor case and the real-Postgres-only paths are open items that need a decision or the operator's smoke run.

**Verdict**: APPROVED

## High-level view

Every Appendix B read surface the code has goes through `profile_identity`, `active_friendships`, `active_trip_memberships` or `ACTIVE_USER_SQL` / `deletion_state = 'active'`, with writes on base tables, and each converted row has a pg-mem test with OMIT absent, PLACEHOLDER equal to the alias id plus `Deleted user` plus a null avatar, and real values after restore. The feed rode-with list is now covered, so the single untested conversion from pass 1 is gone.

Money reads the raw roster, adds every party found in the data and sums to exactly zero with pending and tombstone parties (Properties 13 and 29, fast-check at 100 runs). Create and edit reject with `trip_party_deleted` before the membership check, and delete stays allowed. Photos filter on an active-owner join with no `photos.status` change (Property 19). Admin shows no purged id or email and no deletion control.

The three guards pin counts taken from the finished tree (composeServices 1, accountDeletion/repo 7, admin/repo 5, auth/routes 4, friends/repo 1, tripExpenses/repo 1; roster 13 files). They differ from the design's orientation numbers, each entry has a one-line reason, and no allowlist was widened to pass a new unsafe query.

<details>
<summary>Issues (3)</summary>

1. **Guest add/rename under a pending sponsor (non-blocking, possible)** — `tripExpenses/routes.ts` still passes a raw `trip_memberships` check, so a guest can be created under a pending sponsor and every expense naming it fails with `trip_party_deleted` until restore. The coder left it because no requirement describes a 4xx there (R12.11 covers create/edit of expenses). Needs a user decision; default is today's behavior.
2. **Real-Postgres paths unexercised (non-blocking, confirmed)** — pg-mem shims are used for correlated sub-selects, `to_char`, `NULLIF`, `ESCAPE`, `unnest`, and the `LEFT JOIN users` photo queries and `ANY($1::uuid[])` forms. Make sure the operator's smoke list in design.md includes a gallery, an inbox, a feed with a pending rode-with tag and a net-balance read with a pending account.
3. **Flaky first gate run in chunk C pass 2 (non-blocking, possible)** — code-status.md records one unidentified failure that did not reproduce. If the full `npm run verify` at the end of the spec fails on a pg-mem property test, capture the name with `--reporter=dot`.

</details>

<details>
<summary>Details</summary>

## Feed rode-with list: closed

The test reuses the repo's real SQL, so a regression to `rwt.tagged_member_id` fails two assertions, not just one. It registers `json_build_object` with the one signature the subquery calls, and flattens pg-mem's extra array wrapper. Both are commented as test-side accommodations and the SQL under test is unchanged. `rode_with_count` and the list read the same tag rows and the list shows non-visible taggers as the placeholder, so count equals list length; filtering only the count would make them disagree, so leaving it is right.

## openShare COALESCE

`sharing/repo.ts` `openShare` now carries a comment explaining that `COALESCE(p.is_visible, true)` is safe because every user, tombstones included, always has a profile row. No test pins that, but the claim is consistent with the tombstone tests in chunk A.

## Surface coverage

The coder's list of Appendix B rows without a pg-mem test is Push delivery, Highest-rated leaderboard, Self reads and the client filter in `useAttention.ts` (task 14.4, mobile). The first is covered by the request transaction test in chunk A, the second and third have no change to read, and the fourth belongs to a later task. The server half of the attention item (`countUnreadInbox`, `listPendingRodeWithTags`) is tested.

## Evidence

code-status.md "Chunk D, iteration 2" records `verify:api` with typecheck clean for api, mobile and shared, 533 files passed, 4154 tests passed, EXIT 0, and the one earlier `tsc` failure (TS2322 in the new test) fixed. Mutation checks and a litmus run are recorded.

</details>

<details>
<summary>File map</summary>

Unchanged from pass 1 apart from `accountDeletion/__tests__/visibility.trips.test.ts` (new rode-with test) and a comment in `sharing/repo.ts`. Full diff: `git diff` on the working tree.

</details>
