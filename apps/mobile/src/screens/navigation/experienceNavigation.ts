/**
 * experienceNavigation — navigation logic for opening an Experience's detail
 * page from a completed-Experience row.
 *
 * This module isolates the pure navigation-target resolution and the
 * cross-stack navigation hook so the target logic is unit/property-testable
 * apart from React Navigation.
 *
 * Validates: Requirements 2.1, 3.1, 5.1, 5.2, 5.3, 6.1, 6.2
 */

import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import type { CompletionEntryDTO } from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// resolveExperienceTarget
// ---------------------------------------------------------------------------

/**
 * Resolve the navigation target (an `Experience_Id`) for a Completion_Entry,
 * or `null` when no target is available.
 *
 * Returns `entry.experienceId` **unmodified** when it is a present, non-empty
 * string, so the exact catalog Experience_Id is used as the ExperienceDetail
 * navigation target (R6.2). Returns `null` when the Experience_Id is missing,
 * null, or blank, signalling that the row should carry no navigation affordance
 * (R6.1).
 *
 * Validates: Requirements 6.1, 6.2
 */
export function resolveExperienceTarget(entry: CompletionEntryDTO): string | null {
  const experienceId = entry.experienceId;
  if (typeof experienceId !== 'string' || experienceId.trim() === '') {
    return null;
  }
  return experienceId;
}

// ---------------------------------------------------------------------------
// useOpenExperience
// ---------------------------------------------------------------------------

/**
 * Hook returning `openExperience(experienceId)`, which dispatches the
 * root-level navigation into the `ExperienceDetail` screen for the given
 * `Experience_Id`:
 *
 *   navigation.navigate('ExperienceDetail', { experienceId })
 *
 * `ExperienceDetail` is registered on the root-level stack (`RootStack`),
 * above `MainTabs`. A `navigate('ExperienceDetail', { experienceId })` from
 * the originating screen (Stats tab, or `FriendProfileScreen` nested in the
 * Friends stack) bubbles up past the tab navigator to the root stack, which
 * pushes `ExperienceDetail` on top of the current tab. Because the originating
 * tab/screen stays mounted underneath, a back request returns to that exact
 * origin rather than unwinding into the Catalog stack (R2.1, R3.1).
 *
 * Repeat-tap guard (R5.1, R5.2, R5.3): an in-flight flag held in a `useRef`
 * ensures a burst of taps before the detail screen is presented dispatches
 * exactly one navigation. The first call sets the flag and dispatches;
 * subsequent calls are ignored while the flag is set, so no duplicate
 * `ExperienceDetail` instances are stacked. The flag is cleared when the
 * originating screen regains focus (`useFocusEffect`) — which fires both on
 * initial mount and on returning from the detail screen — so a deliberate
 * later tap navigates again (R5.3).
 *
 * Validates: Requirements 2.1, 3.1, 5.1, 5.2, 5.3, 6.2
 */
export function useOpenExperience(): (experienceId: string) => void {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const inFlightRef = useRef(false);

  // Clear the in-flight guard whenever the originating screen regains focus
  // (including the initial focus on mount). After returning from the detail
  // screen, this re-arms `openExperience` so a deliberate later tap navigates
  // again (R5.3).
  useFocusEffect(
    useCallback(() => {
      inFlightRef.current = false;
    }, []),
  );

  return useCallback(
    (experienceId: string) => {
      if (inFlightRef.current) {
        // A navigation for this tap burst is already in flight; collapse the
        // repeated taps into the single presentation already dispatched
        // (R5.1, R5.2).
        return;
      }
      inFlightRef.current = true;
      navigation.navigate('ExperienceDetail', { experienceId });
    },
    [navigation],
  );
}
