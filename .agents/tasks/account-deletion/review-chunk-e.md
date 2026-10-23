# Mobile account-deletion flow, notices, DTO adoption and placeholder rendering (chunk E, tasks 14.1-14.4 and 15), review round 2

Chunk E adds the three-step `DeleteAccountScreen`, the entry row in `YouAndCrewScreen`, two in-memory session notices with banner components, `AuthSessionResponseDTO` adoption in Login, Register and Reset, and placeholder handling (`presentPerson`, `useAttention` filter, `trip_party_deleted` copy, hidden settle controls). This pass checks the fixes for the round 1 findings. The blocking round 1 defect (the restored flag surviving logout) is fixed in `setToken` and pinned by a store test and a chained Login-to-tabs regression test. Nothing blocking remains.
Watch for: "1 days" pluralisation on the confirm step (possible, cosmetic); the banner top inset on notch devices (possible, device-only).
**Verdict**: APPROVED

## High-level view

The delete flow matches R1.3 to R1.13 and the design. The success handler runs `cancelQueries`, `setAccountDeletionNotice`, `await clearToken()`, `queryClient.clear()` in that order, and makes no `/auth/logout` or push `DELETE` call. The password and grant live in `useState` only, `graceDays` comes from the reauth response, and `reauth_failed`, `account_locked`, `reauth_required`, other errors and in-flight states each behave as specified. The entry row is in `YouAndCrewScreen`; `ProfileScreen.tsx` is untouched.

The notices are in memory only and carry the exact spec copy. Each has `accessibilityRole="alert"` and announces once through a shared mount-effect hook, with colour never the only signal (icon plus text, dismiss button labelled). `setToken` now resets both notices, so neither outlives the sign-in that should consume it; `clearToken` is unchanged, as the design requires. The new files use theme tokens, `withAlpha` and `makeStyles` only; a grep for hex, `rgb(a)` and `white`/`black` literals in them found none.

Round 1's other items are handled: R1.16 was added additively to the requirements to record that the review step names no day count and the confirm step shows the server value; the dead `graceDays !== null` branch is now the constant `CONSEQUENCES`; the back button, password-step Cancel, confirm-error alert role and secret clearing now have tests.

<details>
<summary>Issues (3)</summary>

1. **"1 days" copy (possible, non-blocking)** — the confirm step interpolates `${graceDays} days` with no singular form. Only reachable if `ACCOUNT_DELETION_GRACE_DAYS=1`; pluralise if that is ever a supported value.
2. **Tabs test stubs sibling screens (confirmed, non-blocking)** — `mainTabsNavigator.restoredNotice.test.tsx` replaces the five tab destinations. They are not under test and the file says so; the chained block still renders the real `LoginScreen` and mocks only `apiRequest`.
3. **Banner safe-area inset (possible, non-blocking)** — `AccountRestoredNotice` adds the top inset itself while tab screens keep their own header padding, which could double the gap on a notch device. Needs a device look; not verifiable in Jest.

</details>

<details>
<summary>Details</summary>

### Restored-notice lifecycle (round 1 blocking finding)

`sessionStore.setToken` now sets `{ token, accountDeletionNotice: null, accountRestoredNotice: false }` after the secure-store write. Login and Reset set the restored flag after `await setToken`, so a restoring sign-in still ends with the flag true while a later ordinary sign-in starts clean. `clearToken` still only nulls the token, so the deletion notice survives the sign-out that follows a deletion. Coverage is at the right layer: `sessionStore.accountNotices.test.ts` asserts the flag is true after `clearToken` and false after the next `setToken`, and the chained block in `mainTabsNavigator.restoredNotice.test.tsx` drives the real `LoginScreen` and `MainTabsNavigator` through restored login, logout without dismissing, and a plain second login, asserting no banner and a single announcement. The coder reports both fail with the reset reverted (2 failed, 11 passed). I did not repeat the mutation, but the assertions are on the exact state the fix changes.

### Review-step wording versus R1.4

R1.16 now records that the review step states the consequence without a day count and the confirm step shows the server's `graceDays`. The earlier code and spec disagreement is closed additively; nothing was renumbered or removed.

### Evidence

`code-status.md` gives the `verify:mobile` tail after the fixes (335 suites, 2645 tests, exit 0) with `themeRetrofit.guard.test.ts` in that run and no allowlist change. As my one narrow spot-check I re-ran `mainTabsNavigator.restoredNotice.test.tsx` and `sessionStore.accountNotices.test.ts`: 2 suites, 13 tests passed, exit 0. I did not re-run the wider suite or typecheck this round (the round 1 typecheck was exit 0 and the only source changes since were the `setToken` line, the `CONSEQUENCES` constant and tests). The coder's `npm run verify:mobile` is a scoped gate, not the full `npm run verify`; the orchestrator should run the full gate at the end of the whole change.

### Interaction coverage

`DeleteAccountFlow.test.tsx` renders the real screen inside the real `YouAndCrewStack` and mocks only `apiRequest`. Each interaction asserts both the request and the screen: entry row navigation (no request yet), Continue, Verify (payload `{ password }`, server `graceDays` shown, not 30), wrong password (inline message, field cleared, signed in), lockout copy, confirm gating on exact case-sensitive `DELETE`, submit payload `{ reauthGrant, confirmation }`, the success order log, `reauth_required` back to the password step with a fresh grant used next, other errors inline, in-flight double-tap on both steps, and Cancel/back on every step. No interactive flow is left uncovered that I could find. Residual unverified items (no device or screen-reader run, no real API run) are stated in `code-status.md`.

</details>

<details>
<summary>File map</summary>

- `state/sessionStore.ts`: non-persisted deletion and restored notices; `setToken` resets both
- `hooks/useAnnounceOnMount.ts`, `components/AccountDeletionNotice.tsx`, `components/AccountRestoredNotice.tsx`: banners with alert role and one announcement
- `screens/youAndCrew/DeleteAccountScreen.tsx`, `screens/authCopy.ts`: three-step flow, shared lockout copy
- `navigation/YouAndCrewStack.tsx`, `screens/youAndCrew/YouAndCrewScreen.tsx`: route and entry row
- `LoginScreen.tsx`, `RegisterScreen.tsx`, `ResetPasswordScreen.tsx`: DTO adoption, notice, restored flag
- `navigation/RootNavigator.tsx`: exported `MainTabsNavigator` with the restored banner first
- `components/presentPerson.ts`, `InboxScreen.tsx`, `useAttention.ts`, `tripPartyDeleted.ts`, `ExpenseFormModal.tsx`, `SettlementModal.tsx`, `TripExpensesScreen.tsx`, `TripBalancesScreen.tsx`: placeholder rendering and money copy
- `.kiro/specs/account-deletion/requirements.md`: R1.16 added
- Tests: store, notices, flow, auth screens, tabs (including chained restore), presentPerson, inbox, useAttention, money screens

Full diff: `git diff` plus untracked files from `git status`.

</details>
