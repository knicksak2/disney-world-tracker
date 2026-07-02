import { useCallback, useState } from 'react';

import {
  type GroupSectionState,
  initialGroupSectionState,
  isExpanded as isExpandedPure,
  toggle as togglePure,
} from './groupSectionState';

/**
 * Per-Screen_Session React state for collapsible Group_Sections.
 *
 * A thin `useState(initialGroupSectionState)` wrapper over the pure reducer in
 * `groupSectionState.ts`. Because the screen component mounts this hook, the
 * state lives for the whole Screen_Session and survives mode switches and
 * re-renders that do not present the screen anew (R10.2). Presenting the screen
 * anew remounts the hook, which re-initializes the state to the empty set so
 * every Group_Section is Collapsed (R8.1, R10.3). The state is in-memory only
 * and is never persisted.
 *
 * ## Key namespacing
 *
 * A single hook instance backs every Grouped_View_Mode on its screen, so callers
 * MUST namespace each Group_Section key by mode to avoid collisions between
 * groups that share a name across modes. The convention is `${mode}:${groupName}`,
 * for example `parks:Magic Kingdom` for a Park section in the Parks/Own_Parks
 * mode and `categories:Ride` for an Experience_Category section in the
 * Categories/Own_Categories mode.
 *
 * Validates: Requirements 8.1, 10.2, 10.3
 */
export function useGroupSections(): {
  readonly isExpanded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
} {
  const [state, setState] = useState<GroupSectionState>(initialGroupSectionState);

  const isExpanded = useCallback(
    (key: string): boolean => isExpandedPure(state, key),
    [state],
  );

  const toggle = useCallback((key: string): void => {
    setState((current) => togglePure(current, key));
  }, []);

  return { isExpanded, toggle };
}
