/**
 * Notification_Center Attention_Badge hook (task 11.4).
 *
 * `useAttentionBadge()` is a thin wrapper over {@link useAttention} that exposes
 * only what the Profile tab's badge icon needs: the derived `badgeDisplay` mode
 * (`'hidden' | 'count' | 'overflow'`) and the `badgeCount` that supplies the
 * display value. It deliberately does not surface the feed items, per-source
 * status, or `inFlight` — the badge is a single-glance indicator, not a feed.
 *
 * Because it calls `useAttention` — which keys every read on the surviving
 * domain screens' existing React Query tuples — the badge shares the exact same
 * query keys and cache as the open Attention_Feed. The two therefore always
 * observe identical data: the count on the Profile tab can never drift from the
 * items rendered when the feed is opened (R4.5, R5.6, R10.6).
 *
 * The sort mode does not affect the badge (ordering changes the feed's sequence,
 * not its size, and `badgeCount === items.length`), so we pass the default
 * `'timestampDesc'`.
 *
 * Validates: Requirements 4.5, 5.6, 10.6
 */

import { type BadgeDisplay } from '@dwt/shared';

import { useAttention } from './useAttention';

/**
 * What `useAttentionBadge` returns: the badge's derived display mode and the
 * count that backs it. `display` is `'hidden'` when there is nothing pending,
 * `'count'` for 1–99, and `'overflow'` at 100+ (rendered as "99+"); `count` is
 * the exact number of pending Attention_Items and equals the open feed's size.
 */
export interface UseAttentionBadgeResult {
  readonly display: BadgeDisplay;
  readonly count: number;
}

/**
 * Observe the Notification_Center's Attention_Badge without opening the feed.
 *
 * A thin projection of {@link useAttention}: it reads the same cache under the
 * same query keys, so the badge and the open feed can never disagree (R4.5,
 * R5.6, R10.6).
 */
export function useAttentionBadge(): UseAttentionBadgeResult {
  const { state } = useAttention('timestampDesc');
  return {
    display: state.badgeDisplay,
    count: state.badgeCount,
  };
}
