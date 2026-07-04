/**
 * useViewMode — the selection state machine for the tabbed navigation
 * (task 1.1).
 *
 * This is the single source of truth for which mode (tab) is active in both
 * the Friend_Profile_View's View_Selector and the Own_Stats_View's
 * Own_Stats_Selector. It is generic over a non-empty tuple of mode strings so
 * both screens reuse it unchanged.
 *
 * The invariant the requirements demand is "exactly one mode selected at all
 * times" (R1.4 / R8.4), with a defined recovery when that invariant is somehow
 * violated (R1.8 / R8.8) and a defined initial selection (R1.3 / R8.3). Rather
 * than model the selection as independent per-tab booleans — which can
 * represent zero or two selected tabs — the active mode is a single value, and
 * every transition is routed through `resolveSelectedMode`. That makes the
 * degenerate "no mode" / "more than one mode" states unrepresentable as a
 * persisted value and makes the recovery total and unit/property-testable in
 * isolation.
 *
 * `modes[0]` is the canonical default (Overview / Own_Overview).
 *
 * Validates: Requirements 1.3, 1.4, 1.8, 8.3, 8.4, 8.8, 8.9, 14.1
 */

import { useCallback, useState } from 'react';

/**
 * Pure resolver (exported for tests): given any candidate selection set,
 * return the single mode to display.
 *
 * Returns the sole element when exactly one valid mode is selected; otherwise
 * returns the default `modes[0]`. "Exactly one valid mode" means the selection,
 * after discarding any value not present in `modes` and de-duplicating, is a
 * singleton. This covers:
 *
 *   - the no-selection / no-mode-selected state (R1.8, R8.8),
 *   - the more-than-one-mode-selected state (R1.8, R8.8),
 *   - the initial render with an empty selection (R1.3, R8.3).
 */
export function resolveSelectedMode<M extends string>(
  modes: readonly [M, ...M[]],
  selected: readonly M[],
): M {
  const valid = new Set<M>();
  for (const candidate of selected) {
    if (modes.includes(candidate)) {
      valid.add(candidate);
    }
  }

  if (valid.size === 1) {
    // Exactly one valid mode is selected — display it.
    const [sole] = valid;
    return sole as M;
  }

  // Zero or more-than-one valid modes selected: resolve to the default.
  return modes[0];
}

/**
 * Holds the active mode and guarantees exactly one mode is selected.
 *
 * `select(next)` makes a tapped, currently-unselected mode the sole selected
 * mode (R1.5, R8.5); tapping the already-active mode leaves it active (R8.9).
 * Either way the next state is funnelled through `resolveSelectedMode`, so the
 * stored value is always exactly one valid mode.
 *
 * `initialSelection` seeds the first render (R14.1): callers that deep-link to
 * a specific section (e.g. a `Progress_Share` tap opening the Compare pane)
 * pass a singleton selection so the resolver yields that mode initially. It is
 * routed through `resolveSelectedMode` like every other transition, so an
 * empty, unknown, or ambiguous seed still falls back to the default `modes[0]`
 * (R1.3, R8.3). Only the initial render reads it; later selections are
 * user-driven.
 */
export function useViewMode<M extends string>(
  modes: readonly [M, ...M[]],
  initialSelection: readonly M[] = [],
): { readonly mode: M; readonly select: (next: M) => void } {
  // Initialise from the (optional) seed selection so the resolver yields the
  // seeded mode on first render, or the default when no valid seed is given
  // (R1.3, R8.3, R14.1).
  const [mode, setMode] = useState<M>(() =>
    resolveSelectedMode(modes, initialSelection),
  );

  const select = useCallback(
    (next: M): void => {
      // Route the candidate selection through the resolver so a tap on an
      // unselected mode makes it the sole selection, a tap on the active mode
      // keeps it active (idempotent), and an unknown value falls back to the
      // default — never a zero/two-selected state.
      setMode(resolveSelectedMode(modes, [next]));
    },
    [modes],
  );

  return { mode, select };
}
