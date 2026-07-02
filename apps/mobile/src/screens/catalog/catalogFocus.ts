/**
 * Focus-management helpers for the two-level catalog navigation (R12.6, R12.7).
 *
 * The redesigned catalog drill-down must move screen-reader / keyboard focus
 * sensibly as a guest navigates between the Catalog_Home Destination grid and a
 * Level-2 Destination_Screen:
 *
 *   - **R12.6 — focus into the Destination_Screen.** When a guest opens a
 *     Destination_Screen, focus must move to that screen's primary heading.
 *     `useAccessibilityFocusOnMount` returns a ref to attach to the heading
 *     region; on mount it moves accessibility focus there.
 *
 *   - **R12.7 — focus restore on back.** When a guest returns from a
 *     Destination_Screen to the Catalog_Home, focus must be restored to the
 *     Destination card that was activated to open it. `useCardFocusRestore`
 *     tracks a ref per Destination card and the last-activated Destination, and
 *     restores focus to that card whenever the Catalog_Home regains focus.
 *
 *   - **R12.8 — result-count announcement.** When the set of visible
 *     Experiences changes as a result of a filter (category chip) or search
 *     action, the updated result count must be announced to assistive tech
 *     within 1 second. `useResultCountAnnouncement` fires
 *     `AccessibilityInfo.announceForAccessibility` in the same effect that
 *     observes the recomputed visible-Experience count, skipping the initial
 *     baseline so only genuine changes (filter/search actions) are announced.
 *
 * These wrap the platform `AccessibilityInfo.setAccessibilityFocus` +
 * `findNodeHandle` primitives (React Native's supported way to move
 * accessibility focus to a specific node) and React Navigation's
 * `useFocusEffect` (which fires both on initial mount and whenever a screen
 * regains focus), keeping the imperative a11y wiring out of the screen bodies.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle } from 'react-native';
import type { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Move accessibility focus to `node` if it resolves to a native handle.
 *
 * Centralizes the `findNodeHandle` + `setAccessibilityFocus` dance so callers
 * do not repeat the null-guarding. Safe to call with a null ref target (it is a
 * no-op), so it never throws if a component has not laid out yet.
 */
function focusNode(target: View | null): void {
  if (target === null) {
    return;
  }
  const handle = findNodeHandle(target);
  if (handle !== null) {
    AccessibilityInfo.setAccessibilityFocus(handle);
  }
}

/**
 * Return a ref to attach to a screen's primary heading region; on mount, move
 * screen-reader / keyboard focus to it (R12.6).
 *
 * Attach the returned ref to a non-collapsible `View` wrapping the heading
 * (e.g. the `GradientHeader`) with `collapsable={false}` so a native node
 * handle exists on Android. The focus move is deferred to the next tick so the
 * node is committed and laid out before focus is requested.
 */
export function useAccessibilityFocusOnMount<T extends View = View>(): React.RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    // Defer to the next tick so the heading node is committed/laid out before
    // requesting focus (Android in particular ignores focus on a not-yet-laid-
    // out node).
    const handle = setTimeout(() => {
      focusNode(ref.current);
    }, 0);
    return () => {
      clearTimeout(handle);
    };
  }, []);

  return ref;
}

/**
 * Track per-card refs and the last-activated key so the Catalog_Home can restore
 * focus to the activated Destination card when it regains focus (R12.7).
 *
 * Usage:
 *   const { registerCardRef, markActivated } = useCardFocusRestore<DestinationId>();
 *   // when a card is tapped, before navigating:
 *   markActivated(destination.id);
 *   // on each card:
 *   <View ref={registerCardRef(destination.id)} collapsable={false}>…</View>
 *
 * `useFocusEffect` fires on initial mount (when nothing has been activated yet —
 * a no-op) and whenever the screen regains focus after returning from a
 * Destination_Screen, at which point focus is moved to the activated card.
 */
export function useCardFocusRestore<K>(): {
  readonly registerCardRef: (key: K) => (node: View | null) => void;
  readonly markActivated: (key: K) => void;
} {
  const cardRefs = useRef<Map<K, View | null>>(new Map());
  const activatedKey = useRef<K | null>(null);

  const registerCardRef = useCallback(
    (key: K) => (node: View | null) => {
      if (node === null) {
        cardRefs.current.delete(key);
      } else {
        cardRefs.current.set(key, node);
      }
    },
    [],
  );

  const markActivated = useCallback((key: K) => {
    activatedKey.current = key;
  }, []);

  useFocusEffect(
    useCallback(() => {
      const key = activatedKey.current;
      if (key === null) {
        return;
      }
      // Defer so the restored screen has committed before moving focus.
      const handle = setTimeout(() => {
        focusNode(cardRefs.current.get(key) ?? null);
      }, 0);
      return () => {
        clearTimeout(handle);
      };
    }, []),
  );

  return { registerCardRef, markActivated };
}

/**
 * Announce the updated visible-Experience count to assistive technologies when
 * that count changes as a result of a filter or search action (R12.8).
 *
 * Attach this hook to the derivation that recomputes the visible Experiences:
 * pass the current visible count and (optionally) whether announcing is
 * currently enabled. Whenever the count changes while enabled, the hook fires
 * `AccessibilityInfo.announceForAccessibility(`${n} experiences`)` synchronously
 * inside the effect — well within the 1-second budget R12.8 requires.
 *
 * The very first observed count after mount (or after re-enabling) is recorded
 * as a baseline and is NOT announced: mounting a screen or opening a filter row
 * is not itself a filter/search action, and R12.6's focus-move already directs
 * the screen reader to the heading on entry. Only subsequent changes — a
 * category chip toggle re-partitioning the sections, or a search returning a
 * different number of matches — are announced.
 *
 * @param count   the current number of visible Experiences
 * @param enabled when false the hook is dormant (no announcement, baseline
 *                reset) so, e.g., clearing a search does not announce; defaults
 *                to true for always-on surfaces like the category-filtered
 *                Destination layout.
 */
export function useResultCountAnnouncement(
  count: number,
  enabled = true,
): void {
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Dormant: forget the baseline so re-enabling re-establishes it rather
      // than announcing a stale delta.
      previous.current = null;
      return;
    }
    if (previous.current === null) {
      // First observation after mount / re-enable: record the baseline without
      // announcing (entering a screen or opening a filter is not an action).
      previous.current = count;
      return;
    }
    if (previous.current !== count) {
      previous.current = count;
      const noun = count === 1 ? 'experience' : 'experiences';
      AccessibilityInfo.announceForAccessibility(`${count} ${noun}`);
    }
  }, [count, enabled]);
}
