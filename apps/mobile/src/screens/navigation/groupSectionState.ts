/**
 * Pure state model for collapsible Group_Sections in the grouped views.
 *
 * A GroupSectionState is the set of keys of currently-Expanded Group_Sections.
 * Modeling Expanded membership as a set makes "default Collapsed" the natural
 * empty state (R8.1) and makes toggle-isolation (R10.1) and toggle self-inverse
 * (R7.3) trivially provable: every key absent from the set is Collapsed, so the
 * initial empty set reports every section Collapsed, and toggling adds or
 * removes exactly one key while leaving every other key untouched.
 *
 * This module is framework-free; the per-Screen_Session React wrapper lives in
 * useGroupSections.ts (task 6.2).
 *
 * Validates: Requirements 7.3, 8.1, 10.1, 10.3
 */

/** The keys of currently-Expanded Group_Sections. Empty ⇒ every section Collapsed. */
export type GroupSectionState = ReadonlySet<string>;

/**
 * The initial state on first display of a Grouped_View_Mode: an empty set, so
 * every Group_Section is Collapsed (R8.1, R10.3).
 */
export function initialGroupSectionState(): GroupSectionState {
  return new Set<string>();
}

/**
 * Whether the Group_Section identified by `key` is Expanded. A key absent from
 * the state is Collapsed.
 */
export function isExpanded(state: GroupSectionState, key: string): boolean {
  return state.has(key);
}

/**
 * Return a new state that flips only `key`'s Expanded/Collapsed state, leaving
 * every other key unchanged (R10.1). Applying `toggle` twice with the same key
 * returns an equivalent state, so it is its own inverse (R7.3).
 */
export function toggle(state: GroupSectionState, key: string): GroupSectionState {
  const next = new Set(state);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
