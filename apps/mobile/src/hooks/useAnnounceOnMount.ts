import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Announce `message` to the screen reader exactly once per mounted message
 * (account-deletion R1.14).
 *
 * `accessibilityLiveRegion` is Android-only in React Native, so a banner that
 * relies on `accessibilityRole="alert"` alone is not announced on iOS. Calling
 * `AccessibilityInfo.announceForAccessibility` from a mount effect closes that
 * gap. Shared by the deletion and restored notices so the logic exists once.
 */
export function useAnnounceOnMount(message: string): void {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
