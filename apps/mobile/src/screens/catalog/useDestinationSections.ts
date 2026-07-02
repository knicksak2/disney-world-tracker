import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type GroupSectionState,
  isExpanded as isExpandedPure,
  toggle as togglePure,
} from '../navigation/groupSectionState';

/**
 * Per-Screen_Session React state for the Destination_Screen's collapsible
 * sections, with a **default-expanded** policy (R6.4, R7.3).
 *
 * The proven pure reducer in `navigation/groupSectionState.ts` models the
 * expanded-set as membership, so its natural empty state is "all collapsed".
 * The Destination_Screen inverts that default without touching the reducer: this
 * hook seeds the initial expanded set with every provided section key, so the
 * first render is fully expanded, and thereafter `toggle` behaves identically to
 * the pure reducer (it flips exactly the one key, leaving every other untouched).
 *
 * Section keys can arrive after mount (the screen renders a loading state before
 * the Destination's Experiences fetch resolves, so the grouped section keys are
 * empty on the first render and populate once data lands). To keep the
 * default-expanded guarantee under that async flow, any key seen for the first
 * time after mount is also seeded as expanded, while keys the user has already
 * toggled keep their state. The state is in-memory only and is never persisted.
 *
 * Validates: Requirements 6.4, 6.5, 7.3, 7.4
 */
export function useDestinationSections(keys: readonly string[]): {
  readonly isExpanded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
} {
  const [state, setState] = useState<GroupSectionState>(() => new Set(keys));

  // Every key already seeded as default-expanded, so we only ever expand a key
  // the first time we see it and never re-expand one the user later collapsed.
  const seededRef = useRef<Set<string>>(new Set(keys));

  useEffect(() => {
    const unseen = keys.filter((key) => !seededRef.current.has(key));
    if (unseen.length === 0) {
      return;
    }
    setState((current) => {
      const next = new Set(current);
      for (const key of unseen) {
        next.add(key);
      }
      return next;
    });
    for (const key of unseen) {
      seededRef.current.add(key);
    }
  }, [keys]);

  const isExpanded = useCallback(
    (key: string): boolean => isExpandedPure(state, key),
    [state],
  );

  const toggle = useCallback((key: string): void => {
    setState((current) => togglePure(current, key));
  }, []);

  return { isExpanded, toggle };
}
