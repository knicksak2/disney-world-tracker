// Feature: social-sharing-loop, Task 4.2 — Progress_Screen Share_Entry_Point core
//
// Validates: Requirements 1.7
//
// Framework-free core (no React, no react-navigation) for the
// Progress_Screen `Share_Entry_Point` enablement rule, mirroring the
// `catalog/shareEntryPoint.ts` pure-core pattern so the rule is unit- and
// property-testable without rendering `StatsScreen`.
//
// The Progress_Screen builds its `progress` composer params from the resolved
// `GET /me/stats` snapshot, so the control has nothing to project while the
// viewer's completion data is still loading. `StatsScreen` models "completion
// data loading" as the absence of that snapshot (`stats === undefined`); this
// predicate captures the same rule in a form that can be tested apart from the
// screen.

/**
 * The Progress_Screen `Share_Entry_Point` is enabled if and only if the
 * viewer's completion data is no longer loading (R1.7). While the
 * `GET /me/stats` read is in flight there is no snapshot to project, so the
 * control is disabled.
 */
export function isProgressShareEntryEnabled(completionLoading: boolean): boolean {
  return !completionLoading;
}
