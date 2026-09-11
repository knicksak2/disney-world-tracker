# Design Document

## Overview

The Pin Collection system awards collectible, tiered achievement Pins for a User's Disney World
activity — lifetime progress, park/land completion, single-day touring feats, dining, resorts,
and social play. Challenges are evaluated by a pure, deterministic engine, awarded synchronously
in the triggering action's response, and rendered as parametric SVG Pins on a mobile Pin Board.

## Architecture

The Pin Collection system comprises a pure, deterministic evaluation engine coupled with synchronous award returns and a mobile parametric SVG renderer.

```
                  POST /me/experiences/:id/logs
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │       Tracking_Service       │
                 │      (Inserts log row)       │
                 └──────────────┬───────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │          Pin_Service         │
                 │   (Pure Evaluation Engine)   │
                 └──────────────┬───────────────┘
                                │ (Diff against existing user_pins)
                                ▼
                 ┌──────────────────────────────┐
                 │          user_pins           │
                 │(user_id, pin_id, awarded_at) │
                 └──────────────┬───────────────┘
                                │
                                ▼
                 HTTP Response: { log, newlyAwardedPins: PinDTO[] }
                                │
                                ▼
                 Mobile: Triggers PinCelebrationModal
```

## Components and Interfaces

### Backend Structure (`apps/api/src/services/pins/`)
- `evaluator.ts`: Pure evaluation functions calculating unlocked pins and progress percentages from in-memory snapshots.
- `repo.ts`: `PinRepo` managing `user_pins` queries, award inserts, claim updates, reconciliation, and user board aggregation.
- `routes.ts`: Fastify routes `GET /me/pins` (board read), `POST /me/pins/:pinId/claim` (manual claim), and the internal cron-gated `POST`/`HEAD /internal/pins/reconcile` (historical backfill).
- `composeServices.ts`: Composed under `pins: { repo, requireSession }`; the shared `awardPins` port is additionally wired into `tracking.completion` (previously missing — Requirement 21.1) and already reaches the trips `log-entries` handler (which previously received it but never called it).

### Mobile Structure (`apps/mobile/src/screens/profile/` & `apps/mobile/src/components/pins/`)
- `PinView.tsx`: Parametric SVG component rendering metallic frames, recessed enamel, intra-tier ray flourishes, and locked states.
- `PinBoardScreen.tsx`: Collection grid with tier pill filters (All, Bronze, Silver, Gold, Amethyst, Pearl, Prism) and progress headers. Tapping a ready-to-claim Pin fires the claim mutation and opens `PinCelebrationModal`; tapping any other Pin opens `PinDetailModal` as before.
- `PinDetailModal.tsx`: High-resolution pin artwork viewer with lore and progress breakdowns.
- `PinCelebrationModal.tsx`: Unlock celebration shown after a Pin is claimed (either via the grid tap-to-claim or on arrival with `celebratePinIds`), reused for chaining through multiple ready-to-claim Pins in one sitting.
- `AttributionScreen.tsx`: CC BY 3.0 credits viewer matching `motifs/CREDITS.md`.

---

## Manual Claim & Award-Wiring Completeness (additive)

*Backs Requirements 20 and 21. Nothing in Requirement 2 (Synchronous Award Evaluation) or
Property 1 (Award Idempotency) changes — awarding is still automatic and synchronous; claiming is
a new User-facing step layered on top of an existing award.*

### Data model addition

`user_pins` gains one nullable column, `claimed_at TIMESTAMPTZ NULL`, in migration `0036` (below).
`awarded_at` keeps its exact current meaning (criteria met, server truth); `claimed_at` is purely
presentational — it gates when the App shows the full celebration/art, never whether the Pin
counts toward the tier summary or overall percentage (Requirement 20.5, Property 14). A Pin is
**ready to claim** when `awarded_at IS NOT NULL AND claimed_at IS NULL`.

`UserPinProgressDTO` gains one additive field, `claimedAt: string | null`, parallel to the existing
`awardedAt`. `unlocked` keeps its current meaning (awarded) unchanged; the mobile client derives
"ready to claim" as `unlocked && claimedAt === null`. No existing field is renamed or repurposed.

### `PinRepo` additions

```ts
export interface PinRepo {
  getBoard(userId: string): Promise<PinBoardDTO>;
  awardNewly(userId: string): Promise<string[]>;

  /**
   * Claim one already-awarded Pin for a User (Requirement 20.3, 20.4). Idempotent:
   *   - `{ status: 'not_awarded' }`     — no `user_pins` row exists yet for this pin; the
   *      route surfaces this as `pin_not_eligible` (409) and creates nothing.
   *   - `{ status: 'already_claimed', claimedAt }` — `claimed_at` was already set; returns the
   *      existing timestamp rather than erroring or re-firing a celebration.
   *   - `{ status: 'claimed', claimedAt }` — this call set `claimed_at = now()`.
   * Implemented as a single `UPDATE ... WHERE user_id = $1 AND pin_id = $2 AND claimed_at IS NULL
   * RETURNING claimed_at`, so a concurrent double-claim can only ever win once.
   */
  claimPin(userId: string, pinId: string): Promise<ClaimResult>;

  /**
   * Reconciliation (Requirement 21.2): runs `awardNewly` for every User, so historical
   * Completions recorded before Requirement 21.1's wiring fix (or before this feature existed)
   * self-heal into ready-to-claim Pins. Reuses `awardNewly`'s own idempotent insert, so running
   * it repeatedly — or concurrently with a synchronous award — never duplicates an award
   * (Property 1 continues to hold; Property 15 restates this for the batch case).
   */
  reconcileAll(): Promise<{ usersProcessed: number; pinsAwarded: number }>;
}

export type ClaimResult =
  | { readonly status: 'not_awarded' }
  | { readonly status: 'already_claimed'; readonly claimedAt: string }
  | { readonly status: 'claimed'; readonly claimedAt: string };
```

### New endpoints

- **`POST /me/pins/:pinId/claim`** (session-gated, `apps/api/src/services/pins/routes.ts`). Calls
  `repo.claimPin`; `not_awarded` surfaces as `pin_not_eligible` (409); `already_claimed` and
  `claimed` both return `200 { pinId, claimedAt }` (Requirement 20.4).
- **`POST` / `HEAD /internal/pins/reconcile`** (cron-secret-gated, same file). Mirrors the existing
  `/internal/sampling/run` pattern in `apps/api/src/services/intelligence/routes.ts`: the caller
  supplies `x-cron-secret` matching a new `PIN_RECONCILE_CRON_SECRET` env var; the route replies
  `202` immediately and runs `repo.reconcileAll()` fire-and-forget (errors are logged, never
  surfaced to the caller). `GET /me/pins` remains read-only and never triggers this path
  (Requirement 21.3) — reconciliation is reached only via this dedicated internal endpoint, driven
  by the existing free-tier keep-alive cron rather than a request-time side effect (Requirement 21.4).

### Award-wiring fix (Requirement 21.1)

Two Completion-writing paths never called the injected `awardPins` port:

- `PUT /me/experiences/:id/completion` (`apps/api/src/services/tracking/completion/routes.ts`) —
  `CompletionRoutesOptions` gains the same optional `awardPins?: (userId: string) => Promise<readonly
  string[]>` field already used by `logs`/`rating`/`note`; the PUT handler calls it after
  `repo.mark(...)` commits and spreads `newlyAwardedPinIds` onto its response, matching the
  existing pattern exactly.
- `POST /trips/:id/log-entries` (`apps/api/src/services/trips/routes.ts`) — `awardPins` is already
  present on `TripRoutesOptions` and already destructured in this file (it is called by the
  sibling `rode-with-tags/:tagId/confirm` handler); the `log-entries` handler simply did not call
  it. It now does, after `repo.logCompletion(...)` commits, spreading `newlyAwardedPinIds` onto
  `{ logEntryId }`.

Both follow the established best-effort contract: a Pin-award failure is logged and never fails
the already-committed write.

---

## Claimable-Pin Discoverability (additive)

*Backs Requirement 22. Purely a presentation-layer change on top of the existing `unlocked`/
`claimedAt` fields (Requirement 20) — no new persisted field, no new endpoint, no new DTO field.*

### Grid sort (Requirement 22.1)

`PinBoardScreen`'s `visible` projection gains a comparator ahead of the existing catalog-order
sort: ready-to-claim Pins (`isReadyToClaim(p)`, already defined) sort before every other Pin;
within the "ready" group and within the "not ready" group, the existing stable catalog-order
comparator (`ORDER.get(pinId)`) applies unchanged. This is a pure client-side sort over the
already-fetched board response — no new query, no new server field.

```ts
function claimableFirstComparator(
  a: UserPinProgressDTO,
  b: UserPinProgressDTO,
): number {
  const aReady = isReadyToClaim(a) ? 0 : 1;
  const bReady = isReadyToClaim(b) ? 0 : 1;
  if (aReady !== bReady) return aReady - bReady;
  return (ORDER.get(a.pinId) ?? 0) - (ORDER.get(b.pinId) ?? 0);
}
```

The tier/track filters continue to run before the sort (filter, then sort), so the claimable-first
ordering holds within whatever subset the active filters select.

### Unlocked/Locked filter (Requirement 22.2)

A third filter axis, `ownership: 'all' | 'unlocked' | 'locked'`, alongside the existing `tier` and
`track` `useState`s, rendered as a third pill row (`Chip` components, mirroring the tier/track
rows exactly). `unlocked` matches `p.unlocked === true` (claimed or ready-to-claim); `locked`
matches `p.unlocked === false`. Combines with tier/track via `&&`, same as the existing two axes.

### Claimable-Pin Badge (Requirement 22.3–22.5)

A new hook, `useClaimablePinsBadge()` (`apps/mobile/src/components/pins/useClaimablePinsBadge.ts`),
mirrors `useAttentionBadge()`'s shape and cache-sharing property exactly, but is scoped to Pins
rather than the four notification domains:

```ts
export interface UseClaimablePinsBadgeResult {
  readonly display: BadgeDisplay;   // reuses the shared 'hidden' | 'count' | 'overflow' type
  readonly count: number;
}

export function useClaimablePinsBadge(): UseClaimablePinsBadgeResult {
  const { data } = useQuery<PinBoardDTO, ApiError>({
    queryKey: pinBoardKey,           // ['me','pins'] — the SAME key PinBoardScreen reads (R22.4)
    queryFn: () => apiRequest<PinBoardDTO>('GET', '/me/pins'),
    refetchInterval: POLLING_INTERVAL_MS, // the existing 60s Polling_Interval, reused as-is
  });
  const count = (data?.pins ?? []).filter(isReadyToClaim).length;
  return { display: badgeDisplayFor(count), count };
}
```

Because it keys on the exact same `pinBoardKey` tuple `PinBoardScreen` already uses, the badge and
the board can never disagree about which Pins are ready (R22.4) — the same cache-sharing guarantee
`useAttentionBadge` gives the notification badge (design's existing "Validates: R4.5, R5.6, R10.6"
rationale, restated here for Pins). `badgeDisplayFor` and `BadgeDisplay` are imported from
`@dwt/shared` (already exported, used unmodified — no shared-package change).

`RootNavigator.tsx`'s `ProfileTabIcon` combines the notification count from `useAttentionBadge()`
and the claimable-Pin count from `useClaimablePinsBadge()` into a single `AttentionBadge`
rendered at the standard top-right overlay position (`testID="profile-tab-badge"`). Combining them
avoids cluttering the bottom tab bar with multiple badges, while the individual counts remain
clearly separated on the Profile screen itself. `AttentionBadge` itself is used unmodified:

```tsx
const { count: notificationCount } = useAttentionBadge();
const { count: pinCount } = useClaimablePinsBadge();
const totalCount = notificationCount + pinCount;
const totalDisplay = badgeDisplayFor(totalCount);
// ...
<View style={styles.badgeOverlay} pointerEvents="none">
  <AttentionBadge display={totalDisplay} count={totalCount} testID="profile-tab-badge" />
</View>
```

**Revision (R22.5 — combined tab-bar badge).** In an earlier pass, two separate badges were rendered on
the Profile tab icon at opposite corners (notification top-right, pin bottom-left). The user reported
that having two separate badges on the bottom bar was messy/cluttered and requested they be combined on
the tab bar into a single count, while keeping them split into their respective entry controls once the
User opens the Profile screen.

No `tabBarBadge` (React Navigation's built-in prop) is used, consistent with the existing
hand-rolled overlay approach.

### Profile-screen "View your pins" badge (Requirement 22.6)

`ProfileScreen.tsx` already gives its "View notifications" entry control a badge overlay
(`profile-notifications-badge`, fed by the existing `useAttentionBadge()`) using a
`notificationBtnWrap` / `notificationBadgeOverlay` style pair around the `SecondaryButton`. The
"Pin collection" card's "View your pins" `SecondaryButton` gets the identical treatment, fed by
`useClaimablePinsBadge()` instead:

```tsx
const { display: pinBadgeDisplay, count: pinBadgeCount } = useClaimablePinsBadge();
// ...
<View style={styles.notificationBtnWrap}>
  <SecondaryButton label="View your pins" onPress={() => navigation.navigate('PinBoard')} />
  <View style={styles.notificationBadgeOverlay} pointerEvents="none">
    <AttentionBadge display={pinBadgeDisplay} count={pinBadgeCount} testID="profile-pins-badge" />
  </View>
</View>
```

This reuses the exact styles and `AttentionBadge` usage already shipped for the notifications
entry — no new style, no new component — so the Profile screen's two entry controls (Notification
Center, Pin Board) share one visual pattern for "there's something waiting for you here," matching
the tab-icon badges' underlying data via the same `pinBoardKey`-scoped cache (R22.4).

---

## Claim Reveal, Bulk Claim, and Celebration Fanfare (additive)

*Backs Requirement 23. Presentation-layer only — no change to the claim endpoint's contract, to
`isReadyToClaim`, or to when/how a Pin becomes ready to claim (Requirement 20). Fixes a mismatch a
User reported after Requirement 20/22 shipped: a ready-to-claim tile rendered `PinView` with
`unlocked={item.unlocked}`, and `item.unlocked` is already `true` for a ready-to-claim Pin — so the
tile showed full-color art on the board before the User ever tapped it, and the claim modal's
"New pin unlocked! / Add to collection" copy then contradicted what the User had already seen.*

### Locked-until-claimed tile art (Requirement 23.1, 23.2)

`PinCell` (`PinBoardScreen.tsx`) passes `unlocked={item.unlocked && !readyToClaim}` to `PinView`
instead of `unlocked={item.unlocked}` — a ready-to-claim Pin now renders through the exact same
locked/dimmed/padlock path (`PinView`'s existing `unlocked: false` branch, Requirement 4.5) as a
truly locked Pin, distinguished only by the "Tap to claim" badge already rendered alongside it
(Requirement 20.7 — unchanged). No new prop on `PinView`: this is purely which boolean `PinCell`
computes and passes in.

On a successful claim, the optimistic cache patch (`claimMutation.onSuccess`, already setting
`claimedAt` on the board cache) causes `readyToClaim` to become `false` on the next render, so
`PinCell`'s computed `unlocked` prop flips from `false` to `true` — `PinView` re-renders from its
locked branch to its unlocked branch. That transition is the reveal (23.2). `PinCell` wraps this in
an `Animated.View` cross-fade (locked art fades out over ~180ms as unlocked art fades in) driven by
a second `Animated.Value`, so the reveal is visible rather than an instant swap; this is local to
`PinCell` and does not touch `PinView`'s own animation internals.

### Celebration copy (Requirement 23.3)

`PinCelebrationModal`'s heading changes from "New pin unlocked!" / "N new pins unlocked!" to
"Pin claimed!" / "N pins claimed!", and the primary button's label changes from "Add to collection"
(describes a still-pending action) to "Awesome!" ("Next" when advancing through a multi-pin queue). Both are static copy
changes; the modal's data contract (`pinIds`, `onViewDetails`) is unchanged.

### Claim-all bulk action (Requirement 23.4)

A "Claim all (N)" `SecondaryButton` renders in `PinBoardScreen`'s summary header whenever
`readyToClaimCount >= 2` (derived the same way `useClaimablePinsBadge` derives its count — via
`isReadyToClaim` over `board.data.pins` — so the button's N and the tab/Profile badges' N can never
disagree). Pressing it enqueues every ready-to-claim pin id, in the same claimable-first catalog
order the grid already uses, into the existing `queue` state via the existing `enqueueClaim`
plumbing (a small `enqueueAll` that loops `enqueueClaim` over the ready ids, skipping any already
in the queue exactly like a single `enqueueClaim` call does today). No new queue mechanism — this
is a bulk producer for the queue that already exists and already drains one-at-a-time.

```tsx
const readyIds = (board.data?.pins ?? []).filter(isReadyToClaim).map((p) => p.pinId);
{readyIds.length >= 2 ? (
  <SecondaryButton
    label={`Claim all (${readyIds.length})`}
    onPress={() => readyIds.forEach(enqueueClaim)}
    testID="pin-board-claim-all"
  />
) : null}
```

### Queue position indicator and paced advancement (Requirement 23.5, 23.6)

`PinCelebrationModal` gains an optional `position` prop: `{ index: number; total: number } | null`.
When `total > 1`, the modal renders a small "`{index} of {total}`" line under the heading (e.g.
"2 of 5"); when `total <= 1` (a single claim, or a lone `celebratePinIds` arrival) nothing renders,
preserving today's single-claim look exactly.

`PinBoardScreen` computes `position` from the queue's shape at the moment a celebration is shown:
`total` is the queue length observed when the queue was last non-empty *before* draining started
for this batch (captured once into a `queueTotal` ref/state when a claim batch begins, so it does
not shrink as pins are claimed — "2 of 5" stays "of 5" throughout that batch) and `index` is
`queueTotal - queue.length` at the moment each celebration is shown.

Advancing the queue (the existing drain `useEffect`) uses a snappier delay — `PACE_MS = 150` —
between `dismissCelebration` clearing `celebratingId` and the next queued claim firing, via a
`setTimeout` gated on `queue.length > 0`, so consecutive celebrations in a batch are visibly
sequential rather than instantaneous without feeling sluggish. A single ready-to-claim tap (queue length 1) is unaffected in
practice since there is nothing queued after it to pace against.

### "Skip all" bulk claim advancement (Requirement 23.8)

When celebrating as part of a multi-pin claim batch with subsequent pins remaining (`position.total > 1` and `position.index < position.total`), `PinCelebrationModal` renders a "Skip all" secondary button (`pin-celebration-skip-all`) beneath the primary action.

Pressing "Skip all":
1. Immediately closes `PinCelebrationModal` (`celebratingId = null`) and clears the queue state so no subsequent individual celebrations appear.
2. Optimistically marks all remaining queued pins as claimed in TanStack Query (`pinBoardKey`).
3. Dispatches `POST /me/pins/:pinId/claim` in parallel (`Promise.allSettled`) for every remaining pin id in the batch, invalidating `pinBoardKey` on completion.
4. Triggers the celebratory haptic feedback so the bulk claim is accompanied by the same celebratory confirmation.

### Celebration fanfare (Requirement 23.7)

`PinCelebrationModal` adds:

- A **confetti burst**: a fixed set of ~16 small colored rect/circle `Animated.View`s positioned
  absolutely behind the pin art, each animating outward from center with a randomized (but
  seeded-at-mount, not per-frame-random) angle/distance/rotation over ~700ms via
  `Animated.timing` + `useNativeDriver: true`, then unmounting. Implemented with React Native's
  built-in `Animated` — no new dependency (the repo has no confetti/particle/Lottie library today;
  introducing one for a single modal is not justified).
- A **pop/scale-in** on the revealed pin art itself: `Animated.spring` from `0.6` to `1` scale as
  the modal opens, layered on top of the existing per-pin `PinView` render (not replacing it).
- A **haptic pattern** distinct from today's single `notificationAsync(Success)`: two Haptics calls
  in quick succession (`impactAsync(Heavy)` immediately, then `notificationAsync(Success)` ~120ms
  later via a short `setTimeout`), giving a "thunk-ding" pattern rather than one flat notification.
- **Reduce-motion fallback**: the confetti and pop animation both check
  `AccessibilityInfo.isReduceMotionEnabled()` (the same pattern `PinView`'s shimmer already uses)
  and skip straight to the settled state (full-opacity art, no confetti views mounted) when true;
  the haptic pattern and the "Pin claimed!" text are unaffected by reduce-motion, since haptics and
  text are not motion.

None of this changes `PinCelebrationModal`'s existing props contract for callers celebrating a
single pin outside a queue (e.g. arriving with one `celebratePinIds` id) — `position` is optional
and the fanfare always plays; a caller passing nothing new sees the same modal, now with the pop
and confetti already part of every claim celebration, single or queued.

---

## Locked Art Direction Constants & Rendering Rules

These constants are verbatim from `.kiro/specs/pin-collection/pin-frame-sample.html`:

### 1. Tiers and Multi-Stop Metal Ramps
```typescript
export const TIERS = ['bronze', 'silver', 'gold', 'amethyst', 'pearl', 'prism'] as const;
export type PinTier = (typeof TIERS)[number];

export const METALS: Record<PinTier, readonly string[]> = {
  /* Darker and redder than it was. The old bronze mid (#e2a672) sat 18 degrees from
     gold's hue with a luminance ratio of only 1.55, which is why bronze pins read as gold.
     This ramp keeps the hue family but drops the mid tone's luminance so the two separate
     on lightness instead. */
  bronze:   ['#eec4a0', '#c97f4a', '#9a5526', '#5e2f10'],
  silver:   ['#ffffff', '#e2e8f0', '#b0b9c8', '#727b8b'],
  gold:     ['#fff8db', '#f8db79', '#e5ab2c', '#8c620f'],
  amethyst: ['#f7e4ff', '#cba2f0', '#8a45c9', '#41185f'],
  /* pearl's lightest stop is deliberately NOT #ffffff — sharing a top stop with
     silver made the two tiers ambiguous at the highlight */
  pearl:    ['#fff6fb', '#f0e4fa', '#dcecf6', '#c2bcdd', '#9d95bd'],
  /* Seven hues for the full spectrum sweep */
  prism:    ['#fff0c4', '#ffc2e8', '#c9a8ff', '#8ed8ff', '#a8f0c8', '#ffe07a', '#b06fd8'],
};

export const RIM_BY_TIER: Record<PinTier, number> = {
  bronze:   4.2,  // Narrow rim, maximum enamel area
  silver:   5.2,
  gold:     6.2,
  amethyst: 7.2,
  pearl:    8.2,
  prism:    9.2,  // Heavy prestige metal rim
};
```

### 2. Royal Enamel Palette
```typescript
export const PALETTES = {
  royal: {
    royal:   '#4a2a7a',
    plum:    '#6a3fb0',
    teal:    '#14727f',
    forest:  '#2f7d3e',
    crimson: '#a8323f',
    amber:   '#b5721a',
    sky:     '#2f6bb0',
    ink:     '#241a3a',
  },
} as const;

export const tierEnamel = (t: PinTier): string =>
  t === 'bronze' || t === 'silver' || t === 'gold'
    ? PALETTES.royal.royal
    : PALETTES.royal.ink;
```

### 3. Special Emblem Geometry & Declared Exceptions
- **`wireframeGlobe` (EPCOT):** Screens as `reject: medallion (0.99)` at 6.2px in `screen.js`, overridden by the declared round exception with its reason verbatim:
  `roundReason: 'a globe is round; the circle IS the object, not a frame around one'`.
- **`scene: 'castle'` (Magic Kingdom):** Generated original vector geometry that `screen.js` raster tooling cannot screen; it is unverified by raster metrics and subject to device-level visual approval.
- **Prototype Calibration vs Production Game Catalog:** `pin-frame-sample.html` serves as the calibrated 4-rim visual testbed. In the production game catalog, all 4 Theme Park 100% Mastery pins live in **Gold** (Option A).

### 4. Continuous 20-Stage Experience Ladder Progression (B4 Arch System)
The **Lifetime Experience Ladder** consists of 20 escalating milestones across the 6 tiers (Bronze 1–8, Silver 9–13, Gold 14–16, Amethyst 17–19, Pearl 19–20, Prism 20). *(Series 1 note: this describes the renderer's 20-stage `b4fire` art, which remains available. The ladder's rung **count and thresholds** are redefined in "Progression Ladders" above — 12 rungs to 255 attractions — and the 7th tier, Mythic, is added there.)*
- **Plate & Well:** Every ladder pin is contained in an **Arch Plaque** (`shape: 'arch'`) over a **Night Sky well** (`sky: 'night'`) with an engraved numeric/Roman milestone banner.
- **Intra-Tier Monotonic Scaling:** Every ladder rung strictly scales ray count (`coreRays = 8..24`), core radius (`coreR = 96..160`), satellite count (`satCount = 0..6`), spark tip radius, and star scatter (`stars = 4..31`), ensuring **every single pin in the ladder is visually distinct and incrementally richer than the preceding rung**, both within the same tier and across tiers.

---

## Tier System, Collecting Philosophy & Series Model

### Seven tiers

`bronze → silver → gold → amethyst → pearl → prism → mythic`

The original design used six tiers. Series 1 adds a seventh, **Mythic** (tier key `mythic`), as a
**1-of-1 capstone above prism**. It is a singular showpiece, not another gradient
rung, so the "six tiers, seven-plus are indistinguishable at 88px" reasoning in
`docs/pin-art-direction.md` §2 does not apply — the capstone renders bespoke. That contract's
§2 and §9 (which closed the top-tier question at prismatic) must be amended to record this
addition and its rationale. **Pending — tracked in "Open Items" below; the renderer's
`TIERS` / `METALS` / `RIM_BY_TIER` do not yet contain `capstone`.**

### Philosophy — tier means rarity, but honest matched sets are preserved (Option C)

A Pin's tier is set by **how much effort / how rare** it is, not by which category it belongs
to. A matched set keeps one shared tier **only when its members fall in the same effort band**;
when members span bands, the set is split by member size or the trivial members fold into a
larger Pin. We never dress a trivial achievement in prestige metal to keep a row symmetric.

### Effort bands

| Tier | Represents | Anchor |
|---|---|---|
| Bronze | "You did it / getting started" | first-of-a-kind, sets of 1–3, low counts |
| Silver | "A dedicated day / trip" | mid sets (~4–8), a moderate land's attractions |
| Gold | "A full trip's serious effort / a big set" | a large land fully, park ride-mastery, 10-ride day, 3 parks |
| Amethyst | "Elite — multi-trip or a hard single-day feat" | a whole park 100%, 4 parks/day, 12-ride day, 150–300 lifetime |
| Pearl | "Multi-year dedication" | near-total catalog, all 8 Deluxe, all 11 pavilions, 15-ride day |
| Prism | "Apex of a playstyle — very few ever" | the playstyle crown jewels |
| Mythic (capstone) | "The single hardest thing in the app" | 100% of the entire catalog |

### Series model

Tiers are the **permanent axis**; Pins are grouped into versioned **Series**. Series 1 is the
launch roster. "Prism = the playstyle pinnacles" describes how Series 1 *populates* Prism — it
is not a permanent cap. Later Series may add Pins to any tier, including further capstones.
Series 1 populates Prism with six playstyle pinnacles: **Completionist, Commando Tourer,
Culture, Hotelier, Social, Foodie.**

## Countable Sets & Denominators

Resolved from the live catalog (informational snapshot — counts are derived at evaluation time
from the active catalog, never hardcoded, per `verify/catalog.js`):

- **Active experiences:** ~868
- **Attractions** (the countable set for the lifetime ladder and completion Pins): categories
  `Ride`, `Show`, `Character_Meet`, `Walkthrough`, `Parade`, `PlayArea` ≈ **255** (of which
  **197** are in the four theme parks; the rest are water parks, Disney Springs, and unparked)
- **Dining:** `category = 'Restaurant'` ≈ **450**, splitting into three tracks (via
  `grouped_facets` service-type): **real restaurants** ≈ **193** (78 quick + 115 table service;
  of which Signature 23, Character Dining 13), **festival booths** (`Festival Kiosk`) ≈ **28**
  (seasonal), and **snacks / kiosks / lounges / pool bars** ≈ **229**
- **Resorts:** `category = 'Resort'` ≈ **54**
- **World Showcase countries:** distinct `world_showcase_country` = **11**

Completion and lifetime-count Pins count **attractions only**. Dining, resorts, and character
meets are **separate parallel tracks**. (`Tour`, `Recreation`, `Spa`, `Event`, `Game` are
excluded from the attraction countable set unless a specific Pin names them.)

## Progression Ladders

### Attractions ladder ("Centurion")
Counts distinct completed attractions across **all 255 active attractions** (four theme parks +
water parks + Disney Springs + unparked). Twelve rungs, apex = 100%:

`Bronze 5 · 15 · 30 · Silver 50 · 75 · Gold 100 · 130 · Amethyst 160 · 190 · Pearl 215 · 235 · Prism 255`

The Prism rung (255) is the **"All Attractions"** Completionist pinnacle. (The earlier 10→400
rungs assumed a ~400 catalog and are replaced by these.)

### Dining tracks

Dining is **three parallel tracks**, not one ladder — the 450 `Restaurant` rows split cleanly by
their `grouped_facets` service-type values (`tableService`: Casual Dining, Fine/Signature Dining,
Character Dining, Buffet, Family Style, Prix Fixe · `quickService`: Quick Service Restaurant,
Fast Casual, Food Court, Festival Kiosk):

**1. Restaurants ladder ("Culinary")** — distinct completed *real* restaurants (**193**: 78
quick service + 115 table service; a stable set). Twelve rungs, apex = 100%, matching the
attractions ladder:

`Bronze 3 · 10 · 20 · 30 · Silver 45 · 60 · Gold 80 · 100 · Amethyst 120 · 145 · Pearl 170 · Prism 193`

The Prism rung (193) is **"All Restaurants" / "Culinary Legend"**, the Foodie playstyle pinnacle.
Flavor sub-pins hang off it: a **Signature** ladder (of 23 — e.g. 4 / 10 / all), **Character
Dining** (of 13), and a **Royal Banquet** pin (Gold — the princess character-dining set:
Cinderella's Royal Table, Akershus, Be Our Guest, Story Book Dining), all resolved via curated
`upstream_entity_id` sets.

**2. Festival Foodie** — cumulative distinct festival booths (`Festival Kiosk` facet) visited
over time, counting across every festival (a booth still counts after it closes). Series 1 is
intentionally modest — sized to a single festival (~28–35 booths) and stopping at Gold, since the
Foodie pinnacle is already the Restaurants apex:

`Bronze 1 · 5 · 10 · Silver 20 · Gold 30`

Higher rungs and per-festival splits are **deferred to a later series** (blocked until
Catalog_Sync tags each booth's festival and retains booths across festivals — only the current
festival's booths are ever active, and the festival is not tagged on the row).

**3. Snacks & Lounges** — the ~229 residual (snack carts, quick-service kiosks, coffee, pool
bars, lounges: everything not a real restaurant and not a festival booth). Deliberately light and
low-tier, capped at Gold: a casual "Snacker" ladder plus a couple of themed sets.

`Snacker: Bronze 5 · 15 · 30 · Silver 50 · Gold 75` · themed: **Pool Bar Hopper** (~30 pool bars)
· **Coffee Crawl** (~21 coffee spots).

## Completion Apexes & Capstone

- **All Attractions** — 100% of active attractions → **Prism** (Completionist pinnacle). Hard
  but achievable by a superfan.
- **The Whole Catalog** — 100% of all active experiences (attractions + dining + resorts +
  everything) → **Mythic** (capstone), 1-of-1. Effectively unattainable by design.

## Land Completion Model (size-graded, attractions-only)

Land completion counts a land's **attraction** experiences only (dining / meets handled by their
own tracks). Tier scales with the land's active attraction count:

| Land attraction count | Completion Pin |
|---|---|
| ≤ 4 (small) | no standalone Pin — rolls into park mastery or a combined-land Pin |
| 5–7 (medium) | Silver |
| 8+ (large) | Gold |
| World Showcase (31) | Amethyst |

The Bronze **land-starter** set (visit each land once) is retained as a matched set. Live
per-land attraction counts (active): World Showcase 31 · Fantasyland 15 · World Nature 12 · Main
Street 11 · Tomorrowland 10 · World Celebration 10 · Africa 9 · Adventureland 6 · Discovery
Island 6 · Animation Courtyard 6 · Frontierland 5 · Asia 5 · World Discovery 5 · Echo Lake 4 ·
Sunset Blvd 4 · Toy Story 4 · Galaxy's Edge 3 · Liberty Square 3 · Pandora 2 · Hollywood Blvd 1.

**Small-land handling (finalized):** two combined Silver completions — HS **"The Boulevards"**
(Hollywood Blvd + Sunset Blvd) and HS **"Immersive Lands"** (Toy Story Land + Galaxy's Edge).
**Echo Lake, Liberty Square, and Pandora** roll into their park's mastery (no standalone
completion; they keep their Bronze starters, and their headline attractions — e.g. the Haunted
Mansion — are recognized through thematic sets). **Frontierland stands alone** (Silver, and it
auto-promotes toward Gold as its announced expansion opens). *Rivers of America is not used as a
grouping — it is being removed for the Frontierland/Cars expansion.*

### Series 1 Places Roster (~54 pins)

Applying the rule above to the live catalog:

| Tier | Pins | What |
|---|---|---|
| 🥉 Bronze | 27 | 20 land starters (visit each theme-park land once) + 7 park starters (first experience in each park) |
| 🥈 Silver | 10 | 6 medium-land completions (Adventureland, Discovery Island, Animation Courtyard, Frontierland, Asia, World Discovery) + The Boulevards + Immersive Lands + 2 water parks (Typhoon Lagoon, Blizzard Beach) |
| 🥇 Gold | 8 | 6 large-land completions (Fantasyland, Main Street, Tomorrowland, World Nature, World Celebration, Africa) + Disney Springs + **All Lands Explorer** (visit all 20 lands) |
| 💜 Amethyst | 5 | World Showcase completion + 4 park masteries (100% of a park's attractions) |
| 🤍 Pearl | 5 | 4 park sovereigns (100% of everything in a park — attractions + dining + meets) + **Four Parks Master** (100% of the attractions across all four theme parks) |
| 🌟 Mythic | 1 | The Whole Catalog (100% of all active experiences) |

The Prism **"All Attractions"** pin is the top rung of the attractions ladder, not a separate
places pin. Every completion Pin is computed live from `land` / `park`, so its target set
self-adjusts as Disney opens and closes attractions.

## Activity & Social Tracks

Counts of user activity (friend tags, reviews, trips, character meets, single-day feats). Rungs
are product choices, not catalog-derived, except where noted.

### Social / Friends
- **Squad** (confirmed `rode_with_tags`): Bronze 1 · 5 · Silver 10 · 15 · Gold 25 · Amethyst 40.
- **Critic** (ratings + notes): Bronze 1 · 5 · Silver 10 · 25 · Gold 50 · Pearl (50 ratings + 25 notes).
- **Trip Organizer** (distinct trips): Bronze 1 · Silver 3 · Gold 5 · Amethyst 10.
- **Prism "Legendary Guide"** (Social pinnacle): 50 friend rides + 5 organized trips.

### Resorts (Disney-owned only)
"Disney-owned" is the **~31 Disney-branded resorts** — Deluxe, Moderate, Value, DVC villas, and
Fort Wilderness — and **excludes** the ~23 Good Neighbor / third-party hotels among the 54
`Resort` rows (Marriott, Hilton, Wyndham, Holiday Inn, Four Seasons, **and the Marriott-operated
Swan / Dolphin / Swan Reserve**). It is resolved by a name predicate on the `Resort` experiences
(`name` begins with `Disney's `, contains ` at Disney's `, or contains `Fort Wilderness`) rather
than a hand-maintained id list, so it self-adjusts with the catalog (R16.1). Verified against the
live catalog: 31 match, 23 excluded.
- **Resort count**: Bronze 1 · 3 · Silver 6 · Gold 12 · Amethyst 20.
- **Deluxe Royalty** (all 8 Deluxe, curated) → Pearl.
- **Transit loops** (curated): Monorail (3) · Crescent Lake (3) · Skyliner (4) → Silver each.
- **Prism "Grand Hotelier"** (Hotelier pinnacle): all Disney-owned resorts (~30).

### Characters & Princesses
- **Character Meet** (`category = 'Character_Meet'`, 38 available): Bronze 1 · 3 · 5 · Silver 10 · Gold 15 · Amethyst 25.
- **Royal Encounter** (1 princess) → Bronze · **Princess Court** (4 princesses) → Gold · **All Princesses** (8, curated) → Amethyst.

### Single-Day Touring Feats
Grouped by `visited_on` calendar date — **date granularity only** (no time-of-day feats; the log
model has no reliable ride time).
- **Multi-park day**: 2 parks → Bronze · 3 parks → Gold · 4 parks → Amethyst.
- **Ride marathon**: 6 rides → Silver · 10 → Gold · 12 → Amethyst · 15 → Pearl.
- **Prism "Grand Slam"** (Touring pinnacle): rides in **all 4 theme parks** *and* **15+ total
  rides**, same calendar day — the union of the two hardest single-day feats. No "100%"
  requirement (unreachable in a multi-park day).
- **Taste of the Kingdoms** (dining × touring): a `Restaurant` logged in all 4 theme parks on the
  same calendar date → Gold.
- **Around the World**: an experience logged in all 11 World Showcase countries on the same
  calendar date → Silver.

## Thematic Sets

Cross-cutting collections. **Ride-type sets are facet-derived** (from `thrillFactor` / `interests`)
so they self-size as Disney adds rides; **named/historical sets are curated by
`upstream_entity_id`**. These **replace** the old scattered thematic pins (coaster_king,
mountain_conqueror, dark_ride_aficionado, water_ride_splash, flight_sim_ace, target_blaster,
animatronics_veteran, the boat / 360-cinema / 1971 sets) with one consistently-tiered block.

### Ride-type families
- **Roller Coasters** (curated, 9): Bronze (first coaster) → Gold (all 9).
- **The 3 Mountains** (curated: Space Mountain, Big Thunder Mountain, Expedition Everest — Splash
  is now Tiana's and no longer a mountain): Silver.
- **Water Rides** (`Water Rides`, 27): Silver (5) → Amethyst (all).
- **Dark Rides** (`Dark`, 15): Silver (6) → Gold (all).
- **Spinners** (`Spinning`, 11): Bronze (1) → Silver (all).
- **Gentle Rides** (`Slow Rides`, 30): Gold (all) — real completionist breadth even if each is easy.

### Shows & spectacle
- **Shows ladder** (`category = 'Show'`, ~101 available): Show Enthusiast (5) → Silver · Show
  Connoisseur (15) → Gold · Show Devotee (30) → Amethyst.
- **Nighttime Spectaculars** (curated ~3): Silver.
- **Parades** (`category = 'Parade'`, 5): Silver.

### Historical / signature (curated)
- **1971 Opening Day Club** (all 9 opening-day classics): **Silver** — all easy Magic Kingdom
  classics doable in one day; a knowledge set, not a rarity grind.
- **Animatronic Classics** (4: Carousel of Progress, Hall of Presidents, Tiki Room, Country Bears): Silver.
- **Flight Simulators** (~5: Soarin', Flight of Passage, Star Tours, Smugglers Run): Silver.
- **Target Shooters** (2: Buzz, Toy Story Mania): Bronze.
- **Interstellar Pilot** (Space Mountain + Mission: SPACE + Star Tours): Silver.
- **Rail & Transit** (WDW Railroad + PeopleMover + Wildlife Express): Silver.
- **Wildlife Spotter** (Kilimanjaro Safaris + wildlife trails): Silver.
- **Comedy & Laughs** (Monsters Inc. Laugh Floor + Turtle Talk): Bronze.

### IP / franchise (`interests` facet)
- **Star Wars** (6): Silver.
- **Pixar Pals** (11): Gold (all).
- **Classic Characters** (13): Silver.

### Culture
- **World Showcase Traveler**: Silver (6 countries) → Gold (all 11).
- **Circle-Vision 360 Films** (Canada + China + France films): Silver.
- **Global Ambassador** → **Prism** (Culture pinnacle): all 11 countries + the three 360° films +
  World Nature 100% + World Discovery 100%.

**~23 thematic pins**, completing all 6 Prism pinnacles (Global Ambassador is the last).

## Identifier & Dining-Classification Notes

- **Matching:** explicit experience sets (coasters, 1971 classics, Deluxe resorts, signature
  dining, etc.) resolve by stable **`upstream_entity_id`** (Enterprise_Id). The internal
  `experiences.id` is a UUIDv5 derived from it; both are stable, but names are not — never match
  by name.
- **Dining tiers:** `sub_type` is null for all 450 restaurants, but `grouped_facets` service-type
  values *do* classify them — `tableService` includes a clean **`Fine/Signature Dining`** (23)
  and **`Character Dining`** (13), and `quickService` distinguishes real quick service from
  `Festival Kiosk` / kiosks / pool bars. The three dining **tracks** are bucketed from these
  facets; the exact **Signature** and **Character Dining** flavor sets are additionally pinned to
  curated `upstream_entity_id` lists so a facet reclassification can't silently change them.

## Open Items (Series 1, pending)

- **Mythic tier — decided (Series 1).** Metal = **Aurora-Gold**, a genuine 7th ramp
  (`['#fff6e0','#ffb347','#ff8fbf','#c99cff','#5fd6a8','#ffcf4a','#e08a1e']`), confirmed **distinct
  from all six existing tiers** by the renderer's own `tiersConfusable` metric — its mid stop
  `#ffb347` clears gold on contrast (1.31 ≥ 1.25) and every other tier on hue/saturation, so no
  hue+lightness+saturation collision — so the earlier "a 7th shade is indistinguishable at 88px"
  note (art-direction §2/§9) was an unmeasured assertion and does not hold; it is superseded here.
  Art (Series 1, **placeholder** — see below): a sunburst-crown frame over a blue-green Earth with a
  firework finale, composed from game-icons (`world`, `bright-explosion`, `laser-burst`, `sparkles`,
  all CC BY 3.0), recorded in `mythic-pin.html`. It is a bespoke scene and takes the castle-style
  declared exception from raster screening.
  - **Still pending:** wiring `mythic` into the renderer's `TIERS` / `METALS` / `RIM_BY_TIER` /
    `TIER_META` and flipping the `===6` tier assertions in `verify/all.js` to `===7`; amending
    art-direction §2/§9 with the measured rationale. This is deterministic engineering, deferred to
    the catalogue-materialization pass (task 6).
  - **Hero-art polish deferred.** The placeholder art is acknowledged as not final quality —
    hand-composing stock icons blind has a quality ceiling. A visual-polish pass (a design tool or a
    designer who can iterate on renders) should replace it with show-piece art before release; the
    logical definition (`mythic_whole_catalog`) and tier are locked regardless.
- Cross-cutting thematic set rosters and their tiers (coasters, mountains, dark rides, water,
  thrill / 44"+, 1971, nighttime, parades, animatronics, flight sims, shooters, boats).
- Passthrough on every existing challenge to confirm its tier fits the rarity rubric — including
  the `grand_slam` fix (4 parks **+ a real single-day ride count + Magic Kingdom 100%**, not one
  attraction per park).
- Update `requirements.md` R1.1 / R3.1 wording (legacy "136" / "167" counts) to the final roster,
  and update `tasks.md` to the restructured implementation plan. *(Done: the legacy per-pin
  catalog tables in this design doc have been removed and replaced with a pointer to the track
  design + `pin-roster-v2.html`.)*
- **Master-catalogue rename (at materialization).** `pin-roster-v2.html` is the design roster
  (tier / track / criteria, no art) and is the current source of truth for *which* pins exist.
  `pin-catalog-mockup.html` remains the legacy rendered catalogue the verify gate runs on. When
  the rendered catalogue is rebuilt from the v2 roster, promote it to `pin-catalog-mockup.html`,
  archive the current file as `pin-catalog-mockup-v1.html`, and repoint the hardcoded filename in
  `verify/run-all.js`, `verify/bite.js`, `verify/trace.js` and the steering/README/art-direction
  references. The gate cannot run on `pin-roster-v2.html` (no renderer/`MOTIFS`).

**Deferred to a later series:**

- Per-festival booth pin sets (Food & Wine, Flower & Garden, Arts, Holidays) — blocked until
  Catalog_Sync tags each booth's festival and retains booths across festivals.

## Data Models

### Migration `0035_pins_and_challenges.sql`

```sql
BEGIN;

-- Single Source of Truth: Pin definitions live in @dwt/shared (catalog.ts).
-- user_pins records earned awards.
CREATE TABLE user_pins (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_id      TEXT         NOT NULL,
    awarded_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_pins_unique UNIQUE (user_id, pin_id)
);

CREATE INDEX user_pins_user_id_idx ON user_pins(user_id, awarded_at DESC);

COMMIT;
```

### Migration `0036_pin_claiming.sql` (additive — backs Requirement 20, 21)

```sql
BEGIN;

-- claimed_at is purely presentational (Requirement 20.5): the tier summary and
-- overall percentage are computed from awarded_at, never from this column. NULL
-- means "awarded but not yet claimed" (ready to claim); non-NULL means claimed.
ALTER TABLE user_pins ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL;

COMMIT;
```

---

## Explicit Attraction & Category Sets — reference name-lists

These are the **human-reference name-lists** for the curated sets the track design uses (coasters,
mountains, 1971 classics, dark rides, resorts, princess dining, etc.). At materialization each set
resolves by stable **`upstream_entity_id`** (per Requirement 13), **not** by name — the names below
are how a person builds each id list against the live catalog. The parenthesised pin-ids are
**legacy labels** from the old catalogue; the authoritative set→tier→pin mapping is the track
design above and `pin-roster-v2.html`. Some legacy sets here are no longer used as-is (e.g. the
"4 Speed Coasters", "Disney Historian Classics", "Broadway Live Shows") and some new ones (Wildlife
Spotter, Comedy & Laughs) will be added during materialization.

1. **The 3 Mountains (`gold_mountain_goat`)**:
   - `"Space Mountain"`, `"Big Thunder Mountain Railroad"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

2. **The 4 Speed Coasters (`gold_speed_demon`)**:
   - `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Test Track"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`

3. **All Roller Coasters (`bronze_coaster_rookie` >= 1)**:
   - `"Space Mountain"`, `"Big Thunder Mountain Railroad"`, `"Seven Dwarfs Mine Train"`, `"The Barnstormer"`, `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`, `"Slinky Dog Dash"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

4. **All Spinners (`bronze_spinning_star` >= 1)**:
   - `"Dumbo the Flying Elephant"`, `"The Magic Carpets of Aladdin"`, `"Astro Orbiter"`, `"Mad Tea Party"`, `"Alien Swirling Saucers"`, `"TriceraTop Spin"`

5. **Boat Rides (`bronze_gentle_waters_3` >= 3)**:
   - `"Jungle Cruise"`, `"Pirates of the Caribbean"`, `"it's a small world"`, `"Gran Fiesta Tour Starring The Three Caballeros"`, `"Living with the Land"`, `"Frozen Ever After"`, `"Na'vi River Journey"`

6. **1971 Opening Day Classics (`gold_1971_club` >= 6, `pearl_1971_heritage` all 9)**:
   - `"Jungle Cruise"`, `"Peter Pan's Flight"`, `"Haunted Mansion"`, `"it's a small world"`, `"Dumbo the Flying Elephant"`, `"Mad Tea Party"`, `"Country Bear Musical Jamboree"`, `"Walt Disney World Railroad"`, `"Tomorrowland Speedway"`

7. **Disney Historian Classics (`amethyst_historian`)**:
   - All 9 1971 Opening Day Classics + `"Walt Disney's Carousel of Progress"` + `"Walt Disney Presents"`

8. **12 Classic Dark Rides (`silver_dark_ride_aficionado` >= 6)**:
   - `"Peter Pan's Flight"`, `"Haunted Mansion"`, `"Under the Sea ~ Journey of The Little Mermaid"`, `"The Many Adventures of Winnie the Pooh"`, `"Spaceship Earth"`, `"The Seas with Nemo & Friends"`, `"Journey Into Imagination with Figment"`, `"Gran Fiesta Tour Starring The Three Caballeros"`, `"Remy's Ratatouille Adventure"`, `"Mickey & Minnie's Runaway Railway"`, `"Star Wars: Rise of the Resistance"`, `"Na'vi River Journey"`

9. **Extreme Thrill / 44"+ Height Requirement (`amethyst_max_g_force`)**:
   - `"Space Mountain"`, `"TRON Lightcycle / Run"`, `"Guardians of the Galaxy: Cosmic Rewind"`, `"Mission: SPACE"`, `"Test Track"`, `"The Twilight Zone Tower of Terror"`, `"Rock 'n' Roller Coaster Starring Aerosmith"`, `"Expedition Everest - Legend of the Forbidden Mountain"`

10. **Flight Simulator Ace (`silver_flight_sim_ace`)**:
    - `"Soarin' Around the World"`, `"Avatar Flight of Passage"`, `"Star Tours - The Adventures Continue"`, `"Millennium Falcon: Smugglers Run"`

11. **Interstellar Pilot (`silver_interstellar_pilot`)**:
    - `"Space Mountain"`, `"Mission: SPACE"`, `"Star Tours - The Adventures Continue"`

12. **Target Shooters / Blasters (`silver_target_blaster`)**:
    - `"Buzz Lightyear's Space Ranger Spin"`, `"Toy Story Mania!"`

13. **Rail & Transit (`silver_rail_transit`)**:
    - `"Walt Disney World Railroad"`, `"Tomorrowland Transit Authority PeopleMover"`, `"Wildlife Express Train"`

14. **Audio-Animatronics Heritage (`silver_animatronics_veteran`)**:
    - `"Walt Disney's Carousel of Progress"`, `"Walt Disney's Enchanted Tiki Room"`, `"The Hall of Presidents"`, `"Country Bear Musical Jamboree"`

15. **Broadway at Disney Live Shows (`gold_broadway_disney`)**:
    - `"Festival of the Lion King"`, `"Finding Nemo: The Big Blue... and Beyond!"`, `"Beauty and the Beast - Live on Stage"`, `"Indiana Jones Epic Stunt Spectacular!"`

16. **Nighttime Spectaculars & Fireworks (`gold_fireworks_master`)**:
    - `"Happily Ever After"`, `"Luminous The Symphony of Us"`, `"Fantasmic!"`

17. **Princess Encounters (`bronze_royal_encounter_1` >= 1, `gold_princess_court` >= 4)**:
    - `"Princess Fairytale Hall"`, `"Cinderella's Royal Table"`, `"Akershus Royal Banquet Hall"`, `"Enchanted Tales with Belle"`, `"Meet Ariel at Her Grotto"`

18. **7 Character Dining Restaurants (`silver_char_dining_2` >= 2, `gold_char_dining_3` >= 3)**:
    - `"Chef Mickey's"`, `"Cinderella's Royal Table"`, `"Akershus Royal Banquet Hall"`, `"'Ohana"`, `"Topolino's Terrace - Flavors of the Riviera"`, `"The Crystal Palace"`, `"Tusker House Restaurant"`

19. **8 Signature / Fine Dining Restaurants (`silver_signature_dining_2` >= 2, `gold_signature_4` >= 4, `amethyst_signature_6` >= 6)**:
    - `"Victoria & Albert's"`, `"California Grill"`, `"Le Cellier Steakhouse"`, `"Tiffins Restaurant"`, `"The Hollywood Brown Derby"`, `"Jiko - The Cooking Place"`, `"Flying Fish"`, `"Yachtsman Steakhouse"`

20. **8 Deluxe Resorts (`pearl_deluxe_royalty` all 8)**:
    - `"Disney's Grand Floridian Resort & Spa"`, `"Disney's Contemporary Resort"`, `"Disney's Polynesian Village Resort"`, `"Disney's Wilderness Lodge"`, `"Disney's Animal Kingdom Lodge"`, `"Disney's BoardWalk Inn"`, `"Disney's Yacht Club Resort"`, `"Disney's Beach Club Resort"`

21. **The 3 Resort Transportation Loops**:
    - **Monorail Loop (`silver_monorail_resorts`)**: `"Disney's Contemporary Resort"`, `"Disney's Polynesian Village Resort"`, `"Disney's Grand Floridian Resort & Spa"`
    - **Crescent Lake Loop (`silver_crescent_lake_resorts`)**: `"Disney's BoardWalk Inn"`, `"Disney's Yacht Club Resort"`, `"Disney's Beach Club Resort"`
    - **Skyliner Loop (`silver_skyliner_resorts`)**: `"Disney's Riviera Resort"`, `"Disney's Caribbean Beach Resort"`, `"Disney's Pop Century Resort"`, `"Disney's Art of Animation Resort"`

22. **3 Circle-Vision 360 & Panoramic Films (`bronze_cinema_buff` >= 1, `prism_global_ambassador` all 3)**:
    - `"Reflections of China"`, `"Canada Far and Wide in Circle-Vision 360"`, `"Impressions de France"`

23. **The Land Triplets**:
    - **Galaxy's Edge Trio (`silver_galaxys_edge_100`)**: `"Star Wars: Rise of the Resistance"`, `"Millennium Falcon: Smugglers Run"`, `"Oga's Cantina"`
    - **Toy Story Land Trio (`silver_toy_story_100`)**: `"Slinky Dog Dash"`, `"Toy Story Mania!"`, `"Alien Swirling Saucers"`
    - **Pandora Duo + Dining (`silver_pandora_100`)**: `"Avatar Flight of Passage"`, `"Na'vi River Journey"`, `"Satu'li Canteen"`

24. **Prism Grand Slam (`prism_grand_slam`)**:
    - `single_day_parks == 4` AND `single_day_rides >= 15` AND 100% of Magic Kingdom rides completed.

---

## The Challenge Catalog Specification

> **Superseded by the track-based design above (Series 1 restructure).** The concrete Series 1
> roster — all ~174 pins with tier, track, and criteria — is defined by the track sections above
> (Progression Ladders, Completion Apexes, Land Completion Model + Places Roster, Activity &
> Social Tracks, Thematic Sets) and enumerated in **`pin-roster-v2.html`**, which is the current
> source of truth for *which* pins exist. The old per-tier tables that lived here listed the
> legacy 167-pin set and were removed to stop them contradicting the new design. Assigning
> art/motifs and building the rendered catalogue is the materialization phase (see Open Items).
>
> **Art direction lives in [`docs/pin-art-direction.md`](../../../docs/pin-art-direction.md)** —
> the standing contract (die-cut vs contained, tier rims, palette, `emblemGate` screening,
> provenance). Do not restate its rules here.

---

## Configuration & Constants

Pin counts are **derived from the catalog, not hardcoded** (`verify/catalog.js` fails on any
hardcoded count). The Series 1 roster and its per-tier distribution are being finalized during
the current restructure; see "Open Items" above. The earlier `TOTAL_CHALLENGES_COUNT` (167) /
`TIER_COUNTS` (which summed to 162) are removed for that reason — they were three disagreeing
numbers across two files.

| Constant | Value | Purpose |
|---|---|---|
| `TIERS` | `['bronze','silver','gold','amethyst','pearl','prism','mythic']` | Seven-tier rarity axis (`mythic` = 1-of-1 capstone) |
| `RIM_BY_TIER` | bronze 4.2 · silver 5.2 · gold 6.2 · amethyst 7.2 · pearl 8.2 · prism 9.2 px | Die-cut rim width (`mythic` rim bespoke, pending art amendment) |
| `MAX_LADDER_LEVEL` | `5` | Maximum intra-tier ornament progression level |
| `RESTAURANT_LADDER` | `[3,10,20,30,45,60,80,100,120,145,170,193]` | Restaurants ladder; apex 193 = All Restaurants (Culinary Legend) |
| `FESTIVAL_LADDER` | `[1,5,10,20,30]` | Festival Foodie, Series 1 (bronze→gold) |
| `SNACK_LADDER` | `[5,15,30,50,75]` | Snacks & Lounges casual ladder (bronze→gold) |
| `PIN_RECONCILE_CRON_SECRET` | env var, required, `min(1)` (mirrors `SAMPLING_CRON_SECRET`) | Shared secret gating `POST`/`HEAD /internal/pins/reconcile`; supplied via the `x-cron-secret` header. A dedicated secret (not reused from `SAMPLING_CRON_SECRET`) per the existing one-secret-per-cron-endpoint convention. |

## Error Handling

- `401 Unauthorized`: Unauthenticated request to `/me/pins` or `/me/pins/:pinId/claim`.
- `404 Not Found`: Pin ID not found in catalog.
- `409 Conflict` (`pin_not_eligible`): `POST /me/pins/:pinId/claim` targeted a Pin with no
  `user_pins` row yet — i.e. the Pin has not been awarded (Requirement 20.4). Claiming an
  already-claimed Pin is NOT an error (see Data Models — `ClaimResult`); it returns `200` with the
  existing `claimedAt`.
- `401 Unauthorized`: `/internal/pins/reconcile` called with a missing or invalid `x-cron-secret` header.
- `500 Internal Error`: Evaluator or snapshot creation failure.

## Correctness Properties

### Property 1: Award Idempotency & Monotonicity
*For any user and challenge definition, once a Pin is unlocked (`awarded_at` recorded in `user_pins`), it remains unlocked regardless of subsequent mutations, and evaluating the challenge again never inserts duplicate awards.*
**Validates: Requirements 2.4, 3.1**

### Property 2: Deterministic Catalog Coverage Evaluation
*For any park or land mastery challenge, the challenge evaluates to unlocked if and only if the intersection of the user's completed experience IDs with the active catalog experiences in that park/land equals the set of all active experiences in that park/land.*
**Validates: Requirements 1.3**

### Property 3: Single-Day Grouping Invariant
*For any single-day challenge (e.g. Four Parks in One Day or 15-Ride Marathon), the challenge evaluates to unlocked if and only if there exists at least one calendar date `D` where the subset of `experience_logs` matching `visited_on === D` satisfies the challenge criteria.*
**Validates: Requirements 1.4**

### Property 4: Progress Calculation Clamping
*For any locked pin, the computed `percent_complete` is strictly clamped within `[0, 99]`; once criteria are 100% satisfied, the pin transitions to `unlocked: true`.*
**Validates: Requirements 3.1**

### Property 5: Intra-Tier Visual Complexity Monotonicity
*For any multi-rung ladder pin of the same tier and shape, ascending ladder rungs have strictly greater or equal ray counts, spark counts, and inner bezel density than preceding rungs (`ladderLevel[k+1] >= ladderLevel[k]`).*
**Validates: Requirements 4.4**

### Property 6: Rim Scaling by Tier Invariant
*For any rendered pin, the outer metallic rim width strictly follows the monotonic sequence: `RIM_BY_TIER.bronze < RIM_BY_TIER.silver < RIM_BY_TIER.gold < RIM_BY_TIER.amethyst < RIM_BY_TIER.pearl < RIM_BY_TIER.prism`.*
**Validates: Requirements 4.6**

### Property 7: Attribution Completeness
*Every motif referenced in the pin definitions has a corresponding valid asset path in `motif-paths.js` and an attribution record in `CREDITS.md`.*
**Validates: Requirements 6.1, 6.2**

### Property 8: Attraction Countable-Set Determinism
*The attractions ladder and every attraction-completion Pin count exactly the Attraction category
set (`Ride`, `Show`, `Character_Meet`, `Walkthrough`, `Parade`, `PlayArea`). Completing a
`Restaurant`, `Resort`, `Event`, `Tour`, `Recreation`, `Spa`, or `Game` experience never changes
any attractions-ladder or attraction-completion value.*
**Validates: Requirements 9.1, 9.2, 9.3**

### Property 9: Land-Completion Tier Matches Size Band
*For any land-completion Pin, its tier equals the band derived from the land's active attraction
count (≤4 → none; 5–7 → silver; 8+ → gold; World Showcase → amethyst), so a land's completion Pin
can never sit in a tier its attraction count does not justify.*
**Validates: Requirements 11.1, 11.2, 11.3**

### Property 10: Seven-Tier Rarity Monotonicity
*Rim width is non-decreasing across the rendered ramp `bronze < silver < gold < amethyst < pearl
< prism`, and the capstone tier ranks strictly above prism in rarity while rendering with its own
bespoke treatment rather than a ramp rim.*
**Validates: Requirements 7.1, 7.4**

### Property 11: Dining Ladder Monotonicity & Independence
*The Restaurants-ladder thresholds are strictly increasing, the ladder counts only distinct
completed real restaurants, and the three dining tracks are independent of the attractions ladder
and of one another (completing an attraction never advances any dining track, and the three
dining tracks never advance each other).*
**Validates: Requirements 10.2, 10.5**

### Property 12: Completion-Apex Correctness
*"All Attractions" (Prism) unlocks if and only if the user's completed attractions equal the full
set of active attractions; "The Whole Catalog" (capstone) unlocks if and only if the user's
completed experiences equal the full set of active experiences.*
**Validates: Requirements 12.1, 12.2**

### Property 13: Claim Requires a Prior Award
*For any user and pin id, `claimPin` transitions `claimed_at` from `null` to a timestamp if and
only if a `user_pins` row already exists for that (user, pin) pair (i.e. `awarded_at` is set);
claiming a pin with no existing award row never creates one and never sets `claimed_at`.*
**Validates: Requirements 20.1, 20.4**

### Property 14: Claim Idempotency & Board-Total Independence
*Claiming an already-claimed pin is a no-op that returns the existing `claimed_at` without
changing it or re-triggering a celebration; and for any user, the tier summary counts and
`overallPercent` returned by `GET /me/pins` are a pure function of `awarded_at` alone — they are
identical whether a given awarded pin's `claimed_at` is `null` or set.*
**Validates: Requirements 20.4, 20.5**

### Property 15: Reconciliation Never Duplicates an Award
*Running `reconcileAll` (or `awardNewly` for one user) any number of times, in any interleaving
with a synchronous award for the same user, never inserts more than one `user_pins` row for the
same (user, pin) pair — reconciliation is Property 1 (Award Idempotency) applied across the whole
user base rather than a single user.*
**Validates: Requirements 21.2**

### Property 16: Claimable-First Sort Stability
*For any board response, sorting by `claimableFirstComparator` places every ready-to-claim Pin
strictly before every non-ready-to-claim Pin, and within each of those two groups the relative
order of Pins is identical to sorting by catalog order alone (the comparator never reorders two
Pins that are equally ready or equally not-ready).*
**Validates: Requirements 22.1**

### Property 17: Claim-All Count Coherence
*For any board response, the "Claim all" button's displayed count equals `readyIds.length` (the
number of Pins for which `isReadyToClaim` is true), and pressing the button enqueues exactly that
set of pin ids — no more, no fewer, and none already claimed or locked — into the claim queue, in
the same claimable-first catalog order the grid already renders them in.*
**Validates: Requirements 23.4**

## Testing Strategy

- **Pure Evaluation Engine Property Tests (`evaluator.prop.test.ts`)**:
  - Tests Properties 1, 2, 3, and 4 over randomized `fast-check` activity snapshots (>=100 runs).
- **Visual Parametric Property Tests (`pinView.prop.test.ts`)**:
  - Tests Properties 5 and 6 over rendered SVG parameters.
- **Fastify Route Integration Tests (`apps/api/src/services/pins/__tests__/routes.test.ts`)**:
  - Test `GET /me/pins` and verify synchronous `newlyAwardedPinIds` payload on `POST /me/experiences/:id/logs`.
  - Test `POST /me/pins/:pinId/claim`: claiming an awarded pin sets `claimedAt` (Property 13);
    claiming an unawarded pin returns `pin_not_eligible` (409); claiming an already-claimed pin is
    a no-op returning the existing `claimedAt` (Property 14).
  - Test `POST`/`HEAD /internal/pins/reconcile`: missing/invalid `x-cron-secret` is rejected;
    a valid call returns `202` immediately regardless of how long reconciliation takes.
- **`PinRepo` pg-mem Tests (`apps/api/src/services/pins/__tests__/repo.integration.test.ts`)**:
  - Test `claimPin`'s three `ClaimResult` branches directly against a real `user_pins` row, and
    `reconcileAll`/repeated `awardNewly` for the same user never duplicating a row (Property 15).
- **Award-Wiring Regression Tests**: a `server.inject` test against `PUT
  /me/experiences/:id/completion` and one against `POST /trips/:id/log-entries`, each asserting
  `newlyAwardedPinIds` is populated when the write satisfies a pin's criteria — this is the
  regression guard for the bug fixed by Requirement 21.1 (both would have failed before the fix).
- **Mobile Component Tests (`apps/mobile/src/screens/profile/__tests__/PinBoardScreen.test.tsx`)**:
  - Test tier filters, unearned silhouette rendering, and `PinCelebrationModal` triggers.
  - Test the ready-to-claim visual state, tapping a ready-to-claim pin firing the claim mutation
    and opening `PinCelebrationModal` (not `PinDetailModal`), tapping a locked or already-claimed
    pin still opening `PinDetailModal`, and chaining through multiple ready-to-claim pins in one
    sitting without leaving the board (Requirement 20.6).
  - Test the claimable-first sort (Property 16): a board with a ready-to-claim Pin below several
    non-ready Pins in catalog order renders that Pin's cell first in the grid. Test the
    Unlocked/Locked filter narrowing the grid independently of and combined with the tier/track
    filters (Requirement 22.2).
- **Claimable-Pin Badge Tests (`apps/mobile/src/components/pins/__tests__/useClaimablePinsBadge.test.ts`)**:
  - Test `display`/`count` derivation from a seeded `['me','pins']` cache: zero ready-to-claim
    pins → `hidden`; 1–99 → `count` with the exact number; ≥100 → `overflow` (Requirement 22.3).
  - Test that the hook reads the identical cache entry `PinBoardScreen` populates (same
    `pinBoardKey`), so seeding the cache once and rendering both never disagree (Requirement 22.4).
- **Tab-Icon Badge Test (`apps/mobile/src/navigation/__tests__/pinTabBadge.test.tsx`)**:
  - Test the profile-tab badge reflects the claimable pin count when pins are ready and notifications are zero.
  - Test the badge is hidden when both pin and notification counts are zero.
  - Test the badge shows the combined sum when both notifications and claimable pins are present.
  - Test overflow display ('99+') when the combined total reaches 100 or more.
- **Profile-Screen Badge Test (`apps/mobile/src/screens/__tests__/profilePinBadge.test.tsx`)**:
  - Test the "View your pins" entry control's badge shows the exact claimable count and is hidden
    at zero, mirroring the existing "View notifications" entry's badge test coverage (Requirement
    22.6).
- **Claim Reveal & Fanfare Tests (`apps/mobile/src/screens/profile/__tests__/PinBoardScreen.test.tsx`,
  extended)**:
  - Test a ready-to-claim pin's cell passes `unlocked={false}` to `PinView` (i.e. renders the
    locked/dimmed treatment) despite `item.unlocked === true`, distinguished from a truly locked
    pin only by the `Tap to claim` badge (Requirement 23.1).
  - Test that after a claim resolves, the cell's `PinView` receives `unlocked={true}` (the reveal),
    asserting the prop/render change rather than just the absence of the ready-badge (Requirement
    23.2 — this is already partially covered by the existing "claiming clears the ready-to-claim
    badge" test; extend it to also assert the `unlocked` prop transition).
  - Test `PinCelebrationModal`'s heading and primary button read "Pin claimed!" / "Awesome!" (or "Next" when queued) rather
    than "New pin unlocked!" / "Add to collection" (Requirement 23.3).
  - Test the `pin-board-claim-all` button is absent with 0 or 1 ready-to-claim pins, shows the
    exact count with 2+, and pressing it fires a claim call for every ready-to-claim pin id
    (Requirement 23.4, Property 17).
  - Test that with 2+ pins queued (via `Claim all` or `celebratePinIds`), each shown celebration
    carries the correct "`{index} of {total}`" position text, and that `total` does not shrink as
    the queue drains (Requirement 23.5).
  - Test (via `jest.useFakeTimers`) that advancing from one queued celebration to the next does not
    happen synchronously on dismiss — the next claim call only fires after the paced delay elapses
    (Requirement 23.6).
  - Test that a successful claim fires the two-part haptic pattern (`impactAsync(Heavy)` then,
    after the pacing delay, `notificationAsync(Success)`), replacing the previous single-call
    assertion (Requirement 23.7).
  - Test that pressing "Skip all" during a multi-pin claim batch dismisses the modal, claims all remaining
    queued pins in the batch, and renders them as claimed on the board without further celebration modals (Requirement 23.8).
- **Celebration Confetti/Reduce-Motion Test (`apps/mobile/src/screens/profile/__tests__/PinCelebrationModal.test.tsx`,
  new)**:
  - Test confetti particle views are present on a normal claim celebration and absent when
    `AccessibilityInfo.isReduceMotionEnabled` resolves `true` (Requirement 23.7).
  - Test the modal renders without a position line when `position` is omitted or `total <= 1`
    (single-pin claim, unchanged from today), and with a "`{index} of {total}`" line when
    `position` is provided with `total > 1` (Requirement 23.5).
  - Test that "Skip all" renders when `position.total > 1` and `position.index < position.total` and fires `onSkipAll`
    when pressed, and is omitted when on the final pin (`position.index === position.total`) or for single claims (Requirement 23.8).

## Pin Showcase (additive)

*Backs Requirement 24. A new, small persistence surface and two new endpoints; does not touch
`user_pins`, the evaluator, `GET /me/pins`, or any existing claim/award/reconcile path. The
Showcase only ever references Pins a User has already claimed — it has no opinion on award or
claim logic and reads that state, never writes it.*

### Why a separate surface, not a Pin Board feature

The Pin Board (`PinBoardScreen`) is a fixed-layout scrollable grid driven by tier/track/ownership
filters — its whole design (Requirements 3, 5, 22) assumes a stable, catalog-ordered arrangement
so filtering and claimable-first sorting behave predictably (Property 16). Freeform drag placement
is the opposite of that: a User-chosen, unordered `(x, y)` layout with no filter/sort semantics.
Rather than overload the grid screen with two incompatible layout models, the Showcase is a
distinct screen and a distinct persisted resource, reachable from both the Profile screen and the
Pin Board (R24.7), that happens to draw its Pin art from the same `PinView` component and the same
shared catalog.

### Data model — `pin_showcase_placements`

```sql
-- Migration 0037_pin_showcase.sql (additive; number confirmed against the
-- actual latest migration in apps/api/migrations/ before authoring — 0036 is
-- the current latest as of this revision).
BEGIN;

CREATE TABLE IF NOT EXISTS pin_showcase_placements (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_id      TEXT         NOT NULL,
    -- Free placement, not a grid cell. Stored as a fraction of the board's
    -- own width/height (0.0-1.0), NOT device pixels, so a placement made on
    -- one screen size renders proportionally correct on any other (phone,
    -- tablet, future web) without a migration or per-device scaling table.
    pos_x       REAL         NOT NULL,
    pos_y       REAL         NOT NULL,
    -- Stacking order for overlapping pins (last-touched renders on top),
    -- separate from pos_x/pos_y so a re-drag doesn't require renumbering.
    z_index     INTEGER      NOT NULL DEFAULT 0,
    placed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pin_showcase_unique UNIQUE (user_id, pin_id),
    CONSTRAINT pin_showcase_pin_id_length_chk CHECK (char_length(pin_id) BETWEEN 1 AND 100),
    CONSTRAINT pin_showcase_pos_x_chk CHECK (pos_x >= 0.0 AND pos_x <= 1.0),
    CONSTRAINT pin_showcase_pos_y_chk CHECK (pos_y >= 0.0 AND pos_y <= 1.0)
);

-- Read: "all of this User's placements" (the whole showcase, always read as one page).
CREATE INDEX IF NOT EXISTS pin_showcase_user_id_idx ON pin_showcase_placements(user_id);

COMMIT;
```

`pin_id` is a catalog id, not a foreign key, for the same reason `user_pins.pin_id` isn't (the
catalog lives in `@dwt/shared`, not a table). `UNIQUE (user_id, pin_id)` makes "place" idempotent
per Pin — placing an already-placed Pin again is an upsert of its position, never a duplicate row.
The `SHOWCASE_MAX_PINS` cap (Configuration & Constants) is enforced in the repo at insert time, not
by a `CHECK` — it's a count over existing rows for that `user_id`, which Postgres `CHECK`
constraints cannot express.

### Shared DTOs (`packages/shared/src/dto/PinShowcase.ts`, additive)

```ts
/** One Pin's placement on a Showcase. `posX`/`posY` are fractions of the board's own
 *  rendered width/height (Requirement 24.2, 24.3) — device-size-independent. */
export interface PinShowcasePlacementDTO {
  readonly pinId: string;
  readonly posX: number; // 0.0-1.0
  readonly posY: number; // 0.0-1.0
  readonly zIndex: number;
}

/** A full Showcase read — either the owner's own (editable) or a Friend's (read-only). */
export interface PinShowcaseDTO {
  readonly ownerId: string;
  readonly placements: readonly PinShowcasePlacementDTO[];
  /** Pins the User has claimed but has NOT placed — only present on the owner's own read,
   *  omitted (undefined) on a Friend's read, since a Friend never sees the unplaced pool. */
  readonly unplaced?: readonly string[];
}

/** Body for `PUT /me/pin-showcase/:pinId` — place or move one Pin. */
export interface PlacePinRequest {
  readonly posX: number;
  readonly posY: number;
}
```

`unplaced` is derived server-side from `user_pins` (claimed Pins) minus the placement table — the
client never has to separately fetch `GET /me/pins` just to know which claimed Pins are available
to drag in (Requirement 24.8).

### API surface (`apps/api/src/services/pins/showcaseRoutes.ts`, additive)

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /me/pin-showcase` | session | Owner's own Showcase, including `unplaced`. |
| `GET /users/:userId/pin-showcase` | session + `assertOwnerOrFriend` | A Friend's (or the User's own, via this same route) Showcase, `unplaced` omitted for a non-owner viewer. Modeled exactly on `GET /users/:userId/profile` (`apps/api/src/services/auth/profileRoutes.ts`) — same gate, same deny shape (R24.7). |
| `PUT /me/pin-showcase/:pinId` | session | Place or move `:pinId` to `{ posX, posY }`. 404-shaped `pin_not_eligible` (reusing the existing error code) if the Pin is not claimed by the caller (Requirement 24.1). `409 showcase_full` if placing a NOT-already-placed Pin would exceed `SHOWCASE_MAX_PINS` (Requirement 24.5). `409 showcase_position_overlap` if `{ posX, posY }` would place this Pin within `SHOWCASE_MIN_PIN_CLEARANCE` of any other of the caller's already-placed Pins (Requirement 24.11, Property 22). Upserts by `(user_id, pin_id)`, so re-placing an already-placed Pin only updates its position/z-index. |
| `DELETE /me/pin-showcase/:pinId` | session | Remove a placement. No-op (200) if the Pin was not placed — mirrors the claim endpoint's already-claimed no-op philosophy: a repeated identical action is not an error. |

No batch/reorder endpoint: each drag-end calls `PUT` for the one Pin that moved. A User rearranging
several Pins in one sitting issues one request per Pin, each idempotent and independently
retryable — simpler than reconciling a batch payload against concurrent edits from the same User
on two devices.

### Cork-board rendering (Requirement 24.10)

`PinShowcaseScreen`'s board container renders a tan/brown cork-textured background instead of the
App's usual `theme.color.surface` card styling — a static cork-texture image (an original or
license-compatible seamless tileable PNG/SVG bundled as a local asset, `require`d like the app's
avatar presets) rendered full-bleed behind the placements via `ImageBackground`, with a thin darker
wood-frame border (`theme.radius.lg` corners) around the board's edge to read as a mounted display
case rather than a screen background. Each placed Pin's `PinView` gets a small offset drop shadow
(`shadowColor`/`shadowOffset`/`shadowOpacity`, matching the elevation pattern `theme.shadow`
already defines for cards) so it visually sits slightly above the cork surface, reinforcing the
physical-board metaphor Requirement 24 asks for. No new asset pipeline: this is one static image
asset plus existing `theme.shadow`/`theme.radius` tokens, not a new design-system layer.

### Non-overlap placement (Requirement 24.11)

Each Pin renders at a fixed on-screen size (`SHOWCASE_PIN_SIZE`, matching the board's fixed tile
size rather than the grid's responsive `tileSize`), so its rendered bounding box at any `(posX,
posY)` is computable without a layout pass. A drop is validated against every OTHER already-placed
Pin's bounds using a simple circular clearance check (Pins are circular, so a center-to-center
distance test is exact and cheap, unlike a rectangular AABB test which would be conservative for a
round pin):

```ts
const SHOWCASE_MIN_PIN_CLEARANCE = 60; // Outer visual metal rims (~60px diameter in 72px box) touch tangent with zero gap/overlap, Requirement 24.11

function overlapsAnyOtherPin(
  candidate: { readonly pinId: string; readonly x: number; readonly y: number }, // px, board-space
  placements: readonly { readonly pinId: string; readonly x: number; readonly y: number }[],
): boolean {
  return placements.some(
    (p) =>
      p.pinId !== candidate.pinId &&
      Math.hypot(p.x - candidate.x, p.y - candidate.y) < SHOWCASE_MIN_PIN_CLEARANCE,
  );
}
```

This runs entirely client-side, on every `onPanResponderMove`/`onPanResponderRelease`, against the
placements already rendered on screen — no server round-trip needed to reject an overlapping drop.
`onPanResponderRelease` calls `overlapsAnyOtherPin` with the release point: if it returns `true`,
the drag snaps back to the Pin's last valid position (an `Animated.spring` back to the pre-drag
`(x, y)`) and no `PUT` is sent; otherwise the `PUT` fires with the release point converted to the
`0.0-1.0` fraction the DTO stores. The server independently re-validates the same clearance rule on
`PUT` (Property 22) so a stale or bypassed client can never persist an overlapping placement — the
client check is purely for responsive UX (instant snap-back with no request latency), not the
authority.

Server-side, `placePin` reads the caller's existing placements (already fetched for the `unplaced`
computation) and runs the identical `overlapsAnyOtherPin` check (ported to the repo, operating on
stored `pos_x`/`pos_y` scaled by a fixed reference board size shared by both client and server —
`SHOWCASE_REFERENCE_SIZE` — so the clearance distance means the same thing in both places despite
positions being stored as device-independent fractions) before writing, rejecting with a new
`showcase_position_overlap` error if it would collide.

### Sharing the Showcase (Requirement 24.12, 24.13, 24.14)

The Pin Showcase is shared through the App's existing Sharing_Service — the same `POST /me/shares`
/ Inbox delivery already used for `experience` and `progress` shares — rather than a new sharing
mechanism. This adds a third `SharePayload` variant:

```ts
// packages/shared/src/dto/Share.ts (additive)
export interface PinShowcaseSharePayload {
  readonly kind: 'pinShowcase';
  readonly ownerId: string;
  readonly ownerDisplayName: string;
}
export type SharePayload =
  | ExperienceSharePayload
  | ProgressSharePayload
  | PinShowcaseSharePayload; // extended union, additive
```

Unlike `progress` (which snapshots stats at send time, Requirement 9.7 of the social-sharing-loop
design), a `pinShowcase` payload carries no snapshot at all — just the `ownerId` needed to fetch
the CURRENT Showcase when opened (Requirement 24.14). This is a deliberate asymmetry: a Showcase is
a living display the owner keeps rearranging, not a point-in-time stat to preserve.

`SHARE_PAYLOAD_KINDS` (`packages/shared/src/enums.ts`) gains `'pinShowcase'`, extending the
existing closed union additively; the `shares` table's `payload_kind` CHECK constraint
(`0001_init.sql`) is extended via a new migration (`ALTER TABLE shares DROP CONSTRAINT ... ADD
CONSTRAINT ... CHECK (payload_kind IN ('experience','progress','pinShowcase'))`) rather than
editing the original — additive per the migration convention (never edit an applied migration).
The existing `shares_experience_payload_chk` (`experience_id IS NOT NULL` iff `payload_kind =
'experience'`) is unaffected: a `pinShowcase` share has a NULL `experience_id`, satisfying the
existing `OR (payload_kind = 'progress' AND experience_id IS NULL)` branch only if that branch is
also widened to `payload_kind IN ('progress', 'pinShowcase')` — the same migration updates both
constraints together.

**Composer entry point:** `PinShowcaseScreen.tsx` (owner mode only) gains a "Share my Showcase"
control that opens the existing `ShareComposerScreen` with a new discriminated `ShareComposerParams`
variant (`{ kind: 'pinShowcase' }`, no snapshot fields — mirroring how `progress` today carries its
own fields, but this variant carries none since nothing is captured at send time) — reusing the
composer's existing recipient-picker and submit flow unchanged; only `shareBody.ts`'s
`buildShareCreateBody` gains a `pinShowcase` branch producing `{ kind: 'pinShowcase',
recipientIds }`.

**Inbox tap-through:** `InboxScreen.tsx`'s `handleSelect` gains a `pinShowcase` branch, modeled
directly on the existing `progress` branch (verify the sender is still a Friend against the cached
`GET /me/friends`, else show the existing "friend's profile is no longer available" per-row
message) but navigating to `PinShowcase` with `{ userId: item.senderId, readOnly: true }` instead
of `FriendProfile` — landing the recipient directly on the Showcase, not the Profile screen or Pin
Board first (Requirement 24.13). Because `PinShowcaseScreen` always fetches fresh from
`GET /users/:userId/pin-showcase` (no client cache of a Friend's Showcase, unlike the send-time
`payloadSnapshot` a `progress`/`experience` share carries), the recipient sees the owner's CURRENT
arrangement, satisfying Requirement 24.14 with no new mechanism — it is simply what the existing
read endpoint from task 16 always returns.

### Mobile Structure (additive to the existing Mobile Structure list)

- `PinShowcaseScreen.tsx` (`apps/mobile/src/screens/profile/`): the freeform board. Renders
  `GET /me/pin-showcase` (own) or `GET /users/:userId/pin-showcase` (Friend, read-only prop). Owner
  mode renders each placement as a draggable `PinView` positioned via `posX`/`posY` scaled to the
  board's measured `onLayout` size; a "+" tray along one edge lists `unplaced` claimed Pins a User
  can drag onto the board. Friend mode renders the identical layout with no `Pressable`/gesture
  wiring at all — a plain positioned `View` per placement.
- **Drag mechanic**: React Native's built-in `Animated` + a raw `PanResponder` (consistent with
  this app's existing pattern of using RN's own animation/gesture primitives rather than adding
  `react-native-gesture-handler` or `react-native-reanimated` — see `PinBoardScreen.tsx`'s claim
  cross-fade/pop, which are pure `Animated`, no new dependency). `onPanResponderMove` updates the
  dragged Pin's on-screen position live; `onPanResponderRelease` computes the released `(x, y)` as
  a fraction of the board's measured size and fires the `PUT` mutation. No library addition.
- `useOwnerOrFriendGate` is NOT a new hook — the existing `assertOwnerOrFriend`-gated pattern (see
  `FriendProfileScreen.tsx`'s handling of a `profile_forbidden` deny) is reused as-is for the
  Friend-viewing-Showcase case; `PinShowcaseScreen` renders the same "Profile unavailable"
  empty-state on that error.
- **Entry points** (Requirement 24.7): a "My Showcase" `SecondaryButton` on `ProfileScreen.tsx`
  (own) and on `PinBoardScreen.tsx`'s header (own), and a read-only Showcase section added to
  `FriendProfileScreen.tsx`'s existing Overview tab (Friend's).

### Configuration & Constants (additive to the existing table)

| Constant | Value | Purpose |
|---|---|---|
| `SHOWCASE_MAX_PINS` | `24` | Maximum Pins a User may place on their Showcase at once (Requirement 24.5) — enough for a real display case's worth of favorites, not a duplicate of the ~174-pin full collection. |
| `SHOWCASE_PIN_SIZE` | `72` px | Fixed on-screen diameter of a placed Pin on the Showcase board (distinct from the Pin Board grid's responsive `tileSize`), used by both the client's optimistic overlap check and to derive `SHOWCASE_MIN_PIN_CLEARANCE`. |
| `SHOWCASE_MIN_PIN_CLEARANCE` | `60` px | Minimum center-to-center distance between two placed Pins (Requirement 24.11), allowing outer metal rims (~60px visual diameter in 72px container) to touch tangent with zero gap or visual overlap; enforced identically client-side (instant UX) and server-side (authority, Property 22). |
| `SHOWCASE_REFERENCE_SIZE` | `{ width: 360, height: 640 }` px | The fixed reference board size both the server's overlap check and the `0.0-1.0` fraction storage assume, so a clearance distance in pixels means the same thing however large a given device actually renders the board. |

### Error Handling (additive to the existing list)

- `404`/`409` (`pin_not_eligible`, reused): `PUT /me/pin-showcase/:pinId` targeted a Pin the caller
  has not claimed.
- `409 showcase_full` (new `ErrorCode`): placing a new (not-already-placed) Pin when the caller
  already has `SHOWCASE_MAX_PINS` placements.
- `409 showcase_position_overlap` (new `ErrorCode`): the requested `{ posX, posY }` would place
  this Pin within `SHOWCASE_MIN_PIN_CLEARANCE` of another of the caller's already-placed Pins
  (Requirement 24.11).
- `403` (`profile_forbidden`, reused): `GET /users/:userId/pin-showcase` for a non-owner,
  non-Friend requester — identical deny shape to every other owner-or-friend-gated read, no
  analytics/audit on deny (matches `assertOwnerOrFriend`'s existing no-disclosure guarantee).

### Correctness Properties (additive)

### Property 18: Placement Requires Current Ownership
*For any user and pin id, `PUT /me/pin-showcase/:pinId` succeeds if and only if a `user_pins` row
exists for that (user, pin) with a non-null `claimed_at` at the time of the call; it never creates
or modifies a `user_pins` row itself.*
**Validates: Requirement 24.1**

### Property 19: Placement Upsert Idempotency
*Placing the same pin id twice for the same user never creates a second `pin_showcase_placements`
row (the `UNIQUE (user_id, pin_id)` constraint backs an upsert); the second call's `posX`/`posY`
fully replace the first's.*
**Validates: Requirement 24.3, 24.4**

### Property 20: Showcase Capacity Invariant
*For any user, the number of rows in `pin_showcase_placements` for that user never exceeds
`SHOWCASE_MAX_PINS`; an attempted placement of a pin not already placed, when the user is already
at capacity, is rejected with `showcase_full` and leaves every existing placement — count, pins,
and positions — unchanged.*
**Validates: Requirement 24.5**

### Property 21: Showcase Visibility Mirrors Owner-Or-Friend
*For any requester and target user, `GET /users/:userId/pin-showcase` returns the target's
placements if and only if the requester is the target or an accepted Friend of the target, and
denies with an identical `profile_forbidden` in every other case — the same partition
`assertOwnerOrFriend` already proves for Profile/Stats/Completions reads.*
**Validates: Requirement 24.7**

### Property 22: No Two Placements Overlap
*For any user, at every point in time, every pair of that user's `pin_showcase_placements` rows
has a center-to-center distance (computed in `SHOWCASE_REFERENCE_SIZE` pixel-space from their
stored `pos_x`/`pos_y` fractions) of at least `SHOWCASE_MIN_PIN_CLEARANCE`; `placePin` never
commits a write that would violate this for any pair.*
**Validates: Requirement 24.11**

### Property 23: Showcase Share Always Reflects Current State
*For any user who has sent a `pinShowcase` share, and for any subsequent change to that user's
placements (add, move, or remove), a recipient opening that share afterward is served the
placements as they exist at OPEN time, never the placements as they existed at SEND time — i.e.
`GET /users/:userId/pin-showcase` never consults `shares.payload_snapshot` and a `pinShowcase`
payload carries no placement data to consult.*
**Validates: Requirement 24.14**

### Property 24: Unplaced Pin Tray Filtering, Sorting, and Non-Overlapping Auto-Placement
*For any set of unplaced pins, search filtering by query string matches pins whose name, description, or track contains the query (case-insensitive); sorting by catalog order preserves catalog index, sorting by name orders alphabetically, and sorting by tier ranks Prism > Amethyst > Gold > Silver > Bronze. When auto-placing a pin via tap, `findAvailablePlacement` returns a coordinate that maintains >= `SHOWCASE_MIN_PIN_CLEARANCE` from all existing placements, or `null` if the board is saturated.*
**Validates: Requirement 24.15, 24.16, 24.17**

## Testing Strategy — Pin Showcase (additive to the existing Testing Strategy section)

- **Repo Tests (`apps/api/src/services/pins/__tests__/showcaseRepo.integration.test.ts`,
  pg-mem)**: place a claimed pin and read back its exact `posX`/`posY`/`zIndex`; placing an
  unclaimed pin id is rejected without inserting a row (Property 18); placing an already-placed
  pin twice leaves exactly one row with the second call's position (Property 19); placing a
  `SHOWCASE_MAX_PINS + 1`th new pin is rejected and the prior `SHOWCASE_MAX_PINS` rows are
  byte-identical before/after (Property 20); removing a placement then re-placing the same pin
  succeeds (proves `DELETE` truly removed the row rather than soft-deleting it); placing a pin
  within `SHOWCASE_MIN_PIN_CLEARANCE` of an existing placement is rejected with no row inserted or
  updated, and placing it just outside the clearance succeeds (Property 22).
- **Route Integration Tests (`apps/api/src/services/pins/__tests__/showcaseRoutes.test.ts`,
  `server.inject`)**: `GET /me/pin-showcase` returns `unplaced` computed from claimed-minus-placed;
  `GET /users/:userId/pin-showcase` for self, an accepted Friend, and a non-Friend (403,
  Property 21) — the non-Friend case asserts zero extra queries beyond the single friendship
  lookup, mirroring `ownerOrFriend.noanalytics.test.ts`'s no-disclosure assertion; `PUT` happy
  path, `pin_not_eligible` for an unclaimed pin, `showcase_full` at capacity, `showcase_position_
  overlap` for a too-close drop; `DELETE` happy path and its already-removed no-op.
- **Property Tests (`apps/api/src/services/pins/__tests__/showcase.prop.test.ts`, fast-check,
  ≥100 runs, tagged `Feature: pin-collection, Property N`)**: Properties 18, 19, 20, 22 as
  property-based cases over randomized claimed-pin sets and placement sequences.
- **Mobile Component Tests (`apps/mobile/src/screens/profile/__tests__/PinShowcaseScreen.test.tsx`)**:
  render the owner's Showcase from a seeded `GET /me/pin-showcase` response and assert each
  placement renders at its expected on-screen position (derived from `posX`/`posY` and a mocked
  `onLayout` size), and that the board renders the cork-texture background (Requirement 24.10);
  drag an unplaced tray Pin onto the board and assert the resulting `PUT` call's `posX`/`posY`
  match the drop point; drag an already-placed Pin to a new position and assert the `PUT` call for
  that same pin id (not a new placement); drag a Pin to a point within `SHOWCASE_MIN_PIN_CLEARANCE`
  of another placed Pin and assert NO `PUT` fires and the dragged Pin's rendered position snaps
  back to its pre-drag value (Requirement 24.11); remove a placed Pin and assert the `DELETE` call
  plus the Pin returning to the tray; render a Friend's Showcase (`readOnly` prop) and assert no
  `PanResponder`/drag handlers are attached (a plain `View`, not a `Pressable`) and no place/remove
  controls render; render the Friend empty-state when the owner has placed zero Pins (Requirement
  24.9); render the "Profile unavailable" state on a `profile_forbidden` deny; a "Share my
  Showcase" control opens `ShareComposerScreen` with `{ kind: 'pinShowcase' }` params.
- **Share Integration Tests**: `shareBody.test.ts` (extended) — `buildShareCreateBody` for
  `{ kind: 'pinShowcase' }` params produces `{ kind: 'pinShowcase', recipientIds }` with no
  snapshot fields. `InboxScreen.test.tsx` (extended) — selecting a `pinShowcase` inbox item
  verifies the sender is still a Friend (reusing the existing `progress`-branch guard) then
  navigates to `PinShowcase` with `{ userId: senderId, readOnly: true }` rather than
  `FriendProfile`; the existing "friend's profile no longer available" per-row message covers the
  non-Friend case unchanged. A repo-level test asserts `GET /users/:userId/pin-showcase` reflects a
  placement change made AFTER a `pinShowcase` share was sent (Property 23) — seed a share, mutate
  the owner's placements, then read the Showcase as the recipient and assert the mutated state, not
  a stale snapshot.

## Vector Icon Asset Sources & Open-Source Libraries

All 167 pin motifs and architectural vector shapes are derived from authorized, commercially permissible open-source icon repositories:

1. **Game-Icons.net (CC-BY 3.0)**:
   - Authors: Lorc, Delapouite, Skoll, Cathelineau, Faithtoken, Sbed, Caro-Asercion.
   - Primary source for fantasy, adventure, and landmark icons (*passport, pagoda, compassRose, pocketWatch, peaks, queenCrown*).
2. **Temaki Icons (CC0 1.0 Universal / Public Domain)**:
   - Authors: Bryan Housel & OpenStreetMap Theme Park contributors.
   - Source for theme park cartography and attraction icons (*roller coaster trestle track & train for Coaster Royalty*).
3. **Iconify Open-Source Icon Framework (MIT / Apache 2.0 / CC0)**:
   - Index of 150+ verified open icon collections (Lucide, Tabler, FontAwesome Free, Google Material Symbols, Phosphor).
4. **Tabler Icons & Lucide Icons (MIT)**:
   - Modern UI and vehicle glyphs for transit and facility badges.
