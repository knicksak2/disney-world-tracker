/**
 * Claimable-Pin Badge hook (Requirement 22.3, 22.4).
 *
 * `useClaimablePinsBadge()` mirrors the notification `useAttentionBadge()` shape and
 * cache-sharing property exactly, but is scoped to Pins rather than the four notification
 * domains: it reads the Pin Board under the exact same `pinBoardKey` `PinBoardScreen` uses (with
 * the same 60s `POLLING_INTERVAL_MS` cadence the notification badge already established), derives
 * the ready-to-claim count via the board screen's own `isReadyToClaim` predicate (so the badge
 * can never define "claimable" any differently than the grid does), and converts that count to a
 * `BadgeDisplay` mode via the shared `badgeDisplayFor` — the same pure function the notification
 * badge uses, so both badges follow identical hidden/count/"99+" rules.
 *
 * Because it keys on the identical `pinBoardKey` tuple, this hook and `PinBoardScreen` can never
 * disagree about which pins are ready to claim: seeding or updating the `['me','pins']` cache
 * (e.g. after a claim) updates both simultaneously.
 */
import { useQuery } from '@tanstack/react-query';
import { badgeDisplayFor, type BadgeDisplay, type PinBoardDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { POLLING_INTERVAL_MS } from '../../features/notifications/useAttention';
import { isReadyToClaim, pinBoardKey } from '../../screens/profile/PinBoardScreen';

export interface UseClaimablePinsBadgeResult {
  readonly display: BadgeDisplay;
  readonly count: number;
}

/**
 * Observe the claimable-pin badge without opening the Pin Board. Reads the same cache under the
 * same query key the board itself populates, so the tab icon and the open board can never
 * disagree (Requirement 22.4).
 */
export function useClaimablePinsBadge(): UseClaimablePinsBadgeResult {
  const board = useQuery<PinBoardDTO, ApiError>({
    queryKey: pinBoardKey,
    queryFn: () => apiRequest<PinBoardDTO>('GET', '/me/pins'),
    refetchInterval: POLLING_INTERVAL_MS,
  });

  const count = (board.data?.pins ?? []).filter(isReadyToClaim).length;
  return { display: badgeDisplayFor(count), count };
}
