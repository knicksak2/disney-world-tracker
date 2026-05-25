// Feature: disney-world-tracker, Task 16.2 — Catalog search debounce
//
// `useDebounce` returns a value that lags behind the input by the given
// `delayMs` window. It is used by `CatalogListScreen` to throttle the
// rate at which keystrokes in the search box become network requests so
// that typing "Magic Kingdom" produces a single search request instead of
// fourteen (R1.20, R1.21).
//
// The hook intentionally has no domain knowledge — it is a pure timing
// helper over the standard React state model. The only subtlety is that
// the timer is reset whenever `value` changes (so the user sees the
// debounce window restart on every keystroke) and is also reset when
// `delayMs` changes (so a reactive component can dial the debounce up
// or down at runtime without leaking stale timers).
//
// On unmount the pending timer is cleared so the component does not
// produce a "set state on unmounted component" warning if the user
// navigates away mid-typing.

import { useEffect, useState } from 'react';

/**
 * Debounce a value. Returns the most recent `value` once `delayMs`
 * milliseconds have elapsed without a further change.
 *
 * Example:
 *
 * ```ts
 * const [query, setQuery] = useState('');
 * const debounced = useDebounce(query, 300);
 * // `debounced` updates 300ms after the last keystroke.
 * ```
 *
 * The hook does no trimming or normalization — callers that need a
 * canonical form for comparison (e.g. the catalog search, which trims
 * before checking the non-empty rule of R1.20) should apply that
 * transformation on the returned value.
 *
 * @param value     The latest source value.
 * @param delayMs   Debounce window in milliseconds. Non-negative.
 *                  Values less than or equal to zero produce a synchronous
 *                  passthrough on the next tick.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, Math.max(0, delayMs));
    return () => {
      clearTimeout(handle);
    };
  }, [value, delayMs]);

  return debounced;
}

export default useDebounce;
