/**
 * NotificationCenterScreen — the Notification_Center's Attention_Feed surface
 * (task 13.3).
 *
 * Composes the read/action hook layer and the pure attention model into the
 * single in-app surface for acting on Pending_Items:
 *
 * - Hosts the Attention_Feed (a list of {@link AttentionItemRow}s) plus a sort
 *   control that switches the feed between the default source-timestamp
 *   descending order and a group-by-domain-type order (R1.7). The active
 *   {@link SortMode} is local screen state passed straight to `useAttention`,
 *   which returns the already-ordered feed for that mode; in group-by-domain
 *   mode a domain header is rendered above the first row of each group.
 *
 * - Renders exactly one of the loading / empty / error / feed views at a time
 *   (R9.6). View selection combines the pure `classifyView` (loading wins while
 *   any read is in flight; empty only when all four succeed with zero items —
 *   R9.1, R9.2, R9.3, R9.5) with the derived `state.allFailed`: a total failure
 *   shows the error view with a retry control and never an empty-success state
 *   (R8.3), while a partial failure still renders every successfully loaded item
 *   (R8.1).
 *
 * - When at least one — but not every — Domain_Source read failed, shows a
 *   partial-failure banner naming each failed domain type (R8.1) with an enabled
 *   retry control that re-requests ONLY the failed sources via
 *   `useAttention`'s `retryFailed` (R8.2, R8.5); the previously loaded
 *   successful items stay put and are merged with any retried successes (R8.6).
 *
 * - Exposes a control that opens the full Share_Inbox surface (R2.9, R12.2),
 *   cross-navigating to the `Inbox` route hosted on the Friends tab's stack.
 *
 * Each row's inline actions are wired to `useAttentionActions` (accept /
 * decline / confirm / mark-read), with per-row pending + error state threaded
 * through. A Share that references a Share_Destination gets an "Open" control
 * whose handler reuses the Inbox screen's destination-verify + cross-navigate
 * logic (a deduplicated catalog read gate before navigating to the Experience
 * detail; R2.3).
 *
 * The Profile_Notifications_Entry that reaches this screen and the Profile-tab
 * Attention_Badge are wired by task 14.1; this file implements the screen only.
 *
 * Validates: Requirements 1.7, 2.9, 8.1, 8.2, 8.3, 8.5, 9.1, 9.2, 9.3, 9.5,
 * 9.6, 12.2
 */

import React from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useQueryClient } from '@tanstack/react-query';

import {
  classifyView,
  type AttentionDomain,
  type AttentionItem,
  type AttentionItemRef,
  type Park,
  type SortMode,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { MainTabParamList, RootStackParamList } from '../../navigation/RootNavigator';
import type { ProfileStackParamList } from '../../navigation/ProfileStack';
import { theme } from '../../theme/theme';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { useAttention } from '../../features/notifications/useAttention';
import { useAttentionActions } from '../../features/notifications/useAttentionActions';
import { AttentionItemRow } from '../../features/notifications/AttentionItemRow';

// ---------------------------------------------------------------------------
// Navigation typing
// ---------------------------------------------------------------------------

/**
 * The Notification_Center is hosted on the Profile tab's stack
 * (`ProfileStack`, wired in task 14.1). Composing that stack with the tab
 * navigator and the root stack lets a single `navigate` reach the Share inbox
 * on the Friends tab (`navigate('Friends', { screen: 'Inbox' })`, R2.9/R12.2)
 * or a Share_Destination on the root stack (`navigate('ExperienceDetail', …)`,
 * R2.3) — the request bubbles up past the tab navigator for either.
 */
type NotificationCenterNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList>,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * User-facing label for each Domain_Source domain type, used to name the
 * failed domains in the partial-failure banner (R8.1) and to head each group
 * in group-by-domain sort mode (R1.7). Keyed by the closed
 * {@link AttentionDomain} union so it cannot drift from the aggregated domains.
 */
const DOMAIN_LABELS: Readonly<Record<AttentionDomain, string>> = {
  friendRequest: 'Friend requests',
  tripInvite: 'Trip invites',
  rodeWithTag: 'Rode-with tags',
  share: 'Shares',
};

/** Copy shown in the total-failure error view (R8.3). */
const ERROR_TITLE = "Couldn't load your notifications";
const ERROR_BODY =
  'Something went wrong loading your pending items. Please try again.';

/** Copy shown in the empty-state view when nothing is pending (R9.2). */
const EMPTY_TITLE = "You're all caught up";
const EMPTY_BODY = 'New friend requests, trip invites, tags, and shares will show up here.';

/**
 * Reuse a resolved Experience metadata read (up to 5 minutes old) when
 * verifying a Share's destination so the "Open" tap resolves without a
 * mandatory round-trip. The key `['experience', experienceId]` matches the one
 * `ExperienceDetailScreen` / the Inbox use, so the read is deduplicated
 * app-wide.
 */
const METADATA_STALE_MS = 5 * 60 * 1000;

/** Per-tap message when a Share's Experience destination cannot be retrieved. */
const DESTINATION_UNAVAILABLE_COPY = 'This experience is unavailable right now.';

/**
 * Copy shown in the push-focus "no longer available" indication (R13.3): the
 * item a tapped push referenced is no longer a Pending_Item (already resolved
 * or otherwise gone), so it cannot be surfaced for an Inline_Action. The rest
 * of the feed still opens where possible.
 */
const FOCUS_UNAVAILABLE_TITLE = 'That item is no longer available';
const FOCUS_UNAVAILABLE_BODY =
  "The notification you tapped has already been handled or is no longer waiting. Here's everything else in your feed.";

/**
 * Match an Attention_Item's {@link AttentionItemRef} against the `focusRef`
 * carried by a tapped push (task 16.1). A push references exactly one domain,
 * so it carries exactly one of the domain identifiers; we compare on whichever
 * identifier the `focusRef` provides so a still-pending referenced item is
 * found in the loaded feed (R13.2). Returns `false` when the `focusRef` carries
 * no usable identifier.
 */
function matchesFocusRef(
  itemRef: AttentionItemRef,
  focusRef: AttentionItemRef,
): boolean {
  if (focusRef.requestId !== undefined) {
    return itemRef.requestId === focusRef.requestId;
  }
  if (focusRef.inviteId !== undefined) {
    return itemRef.inviteId === focusRef.inviteId;
  }
  if (focusRef.tagId !== undefined) {
    return itemRef.tagId === focusRef.tagId;
  }
  if (focusRef.shareId !== undefined) {
    return itemRef.shareId === focusRef.shareId;
  }
  return false;
}

/**
 * Minimal Experience metadata shape read from `GET /catalog/:experienceId`
 * purely to verify the destination is retrievable before navigating; only the
 * successful resolution matters here, so the fields are kept tolerant.
 */
interface ExperienceMetadata {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function NotificationCenterScreen(): JSX.Element {
  const navigation = useNavigation<NotificationCenterNavigation>();
  const route = useRoute<RouteProp<ProfileStackParamList, 'NotificationCenter'>>();
  const queryClient = useQueryClient();

  // The Attention_Item a tapped push asked the center to surface, when opened
  // from a push (task 16.1); undefined when opened from the
  // Profile_Notifications_Entry, in which case the full feed renders as usual.
  const focusRef = route.params?.focusRef;

  // The active sort mode (R1.7). Default is source-timestamp descending; the
  // toggle flips it to group-by-domain-type. `useAttention` returns the feed
  // already ordered for the selected mode.
  const [sortMode, setSortMode] = React.useState<SortMode>('timestampDesc');

  const { state, outcomes, inFlight, retryFailed } = useAttention(sortMode);
  const actions = useAttentionActions();

  // Push-focus resolution (R13.2, R13.3). When opened from a tapped push, once
  // the feed has settled (not inFlight) we attempt to surface the referenced
  // Attention_Item: a still-pending match is highlighted so its Inline_Action
  // is easy to find (R13.2); if no match remains, the "no longer available"
  // indication is shown while the rest of the feed still opens (R13.3). We only
  // evaluate after loading completes so a still-loading feed never prematurely
  // reports "no longer available".
  const [highlightedItemId, setHighlightedItemId] = React.useState<string | null>(
    null,
  );
  const [focusUnavailable, setFocusUnavailable] = React.useState(false);
  // Resolve each distinct focusRef exactly once (per settled feed), so polling
  // refreshes don't re-trigger the indication after the User has moved on.
  const resolvedFocusRef = React.useRef<AttentionItemRef | null>(null);

  React.useEffect(() => {
    // Nothing to surface when the center was opened without a push focus.
    if (focusRef === undefined) {
      return;
    }
    // Wait until every read has settled before deciding found / not-found, so a
    // still-loading feed doesn't prematurely show "no longer available" (R13.3).
    if (inFlight) {
      return;
    }
    // Evaluate a given focusRef only once.
    if (resolvedFocusRef.current === focusRef) {
      return;
    }
    resolvedFocusRef.current = focusRef;

    const match = state.items.find((item) => matchesFocusRef(item.ref, focusRef));
    if (match !== undefined) {
      // Still pending → surface it (R13.2).
      setHighlightedItemId(match.id);
      setFocusUnavailable(false);
    } else {
      // No longer pending/available → show the indication, still open the feed
      // where possible (R13.3).
      setHighlightedItemId(null);
      setFocusUnavailable(true);
    }
  }, [focusRef, inFlight, state.items]);

  const dismissFocusUnavailable = React.useCallback(() => {
    setFocusUnavailable(false);
  }, []);

  // Which of the four mutually-exclusive views to render (R9.6). `classifyView`
  // decides loading (in flight) / empty (all succeeded, zero items) / error
  // (any failure) / list; we split its `error` result by `state.allFailed` so a
  // *partial* failure still shows the successfully loaded items with a banner
  // (R8.1) while only a *total* failure shows the full error view (R8.3).
  const view = classifyView(inFlight, outcomes);
  const isLoading = view === 'loading';
  const isEmpty = view === 'empty';
  const isTotalFailure = state.allFailed;
  const isPartialFailure = state.failedDomains.length > 0 && !state.allFailed;

  const toggleSort = React.useCallback(() => {
    setSortMode((prev) =>
      prev === 'timestampDesc' ? 'groupByDomain' : 'timestampDesc',
    );
  }, []);

  // Open the full Share_Inbox surface (R2.9, R12.2). The Inbox lives on the
  // Friends tab's stack; the nested navigate bubbles up through the tab
  // navigator to reach it.
  const openFullInbox = React.useCallback(() => {
    navigation.navigate('Friends', { screen: 'Inbox' });
  }, [navigation]);

  // Reuse the Inbox screen's destination-verify + cross-navigate logic for a
  // Share that references a Share_Destination (R2.3): gate on a deduplicated
  // catalog read so a gone Experience keeps the User on the feed with a
  // message, then navigate cross-navigator to the detail view on the RootStack.
  const openDestination = React.useCallback(
    (item: AttentionItem) => {
      const destination = item.ref.destination;
      if (destination === undefined || destination.kind !== 'experience') {
        return;
      }
      const experienceId = destination.id;
      void (async () => {
        try {
          await queryClient.fetchQuery<ExperienceMetadata, ApiError>({
            queryKey: ['experience', experienceId] as const,
            queryFn: () =>
              apiRequest<ExperienceMetadata>(
                'GET',
                `/catalog/${encodeURIComponent(experienceId)}`,
              ),
            staleTime: METADATA_STALE_MS,
            retry: false,
          });
        } catch {
          // Keep the User on the feed with an indication; the rest of the feed
          // stays visible (mirrors the Inbox's R5.5 handling).
          Alert.alert('Experience unavailable', DESTINATION_UNAVAILABLE_COPY);
          return;
        }
        navigation.navigate('ExperienceDetail', { experienceId });
      })();
    },
    [navigation, queryClient],
  );

  const renderRow = React.useCallback(
    (item: AttentionItem, index: number): JSX.Element => {
      // In group-by-domain mode, head each domain group with its label (R1.7).
      // The feed is already grouped in DOMAIN_ORDER, so a header is shown
      // wherever a row's domain differs from the previous row's.
      const showGroupHeader =
        sortMode === 'groupByDomain' &&
        (index === 0 || state.items[index - 1]?.domain !== item.domain);

      return (
        <View>
          {showGroupHeader ? (
            <Text
              style={styles.groupHeader}
              testID={`notification-group-${item.domain}`}
            >
              {DOMAIN_LABELS[item.domain]}
            </Text>
          ) : null}
          <AttentionItemRow
            item={item}
            pending={actions.pendingItemIds.has(item.id)}
            error={actions.errors[item.id] ?? null}
            highlighted={highlightedItemId === item.id}
            onAcceptFriendRequest={actions.acceptFriendRequest}
            onDeclineFriendRequest={actions.declineFriendRequest}
            onAcceptTripInvite={actions.acceptTripInvite}
            onDeclineTripInvite={actions.declineTripInvite}
            onConfirmRodeWithTag={actions.confirmRodeWithTag}
            onDeclineRodeWithTag={actions.declineRodeWithTag}
            onMarkShareRead={actions.markShareRead}
            onOpenDestination={openDestination}
          />
        </View>
      );
    },
    [sortMode, state.items, actions, openDestination, highlightedItemId],
  );

  return (
    <ScreenContainer>
      <GradientHeader
        title="Notifications"
        subtitle="Everything waiting for you, in one place."
        icon="notifications"
        onBack={() => navigation.goBack()}
      />

      {/* Controls: sort toggle (R1.7) + open full Share_Inbox (R2.9, R12.2). */}
      {!isLoading ? (
        <View style={styles.controlsRow}>
          <SecondaryButton
            label={
              sortMode === 'timestampDesc' ? 'Sort: Newest' : 'Sort: By type'
            }
            icon={sortMode === 'timestampDesc' ? 'time-outline' : 'layers-outline'}
            onPress={toggleSort}
            testID="notification-sort-toggle"
            accessibilityLabel={
              sortMode === 'timestampDesc'
                ? 'Sort by newest first. Switch to group by type.'
                : 'Grouped by type. Switch to newest first.'
            }
            style={styles.controlBtn}
          />
          <SecondaryButton
            label="Full inbox"
            icon="mail-outline"
            onPress={openFullInbox}
            testID="notification-open-inbox"
            style={styles.controlBtn}
          />
        </View>
      ) : null}

      {/* Partial-failure banner (R8.1, R8.2, R8.5). */}
      {isPartialFailure ? (
        <View style={styles.banner} testID="notification-failure-banner">
          <View style={styles.bannerTextWrap}>
            <View style={styles.bannerTitleRow}>
              <Ionicons
                name="warning-outline"
                size={16}
                color={theme.color.warningText}
                style={styles.bannerIcon}
              />
              <Text style={styles.bannerTitle}>Some sources didn't load</Text>
            </View>
            <Text style={styles.bannerBody}>
              {`Couldn't load: ${state.failedDomains
                .map((domain) => DOMAIN_LABELS[domain])
                .join(', ')}.`}
            </Text>
          </View>
          <SecondaryButton
            label="Retry"
            icon="refresh"
            onPress={retryFailed}
            testID="notification-retry"
            style={styles.bannerRetry}
          />
        </View>
      ) : null}

      {/* Push-focus "no longer available" indication (R13.3). Shown when a
          tapped push referenced an item that is no longer pending/available;
          dismissible, and the rest of the feed still renders below. */}
      {focusUnavailable ? (
        <View style={styles.banner} testID="notification-focus-unavailable">
          <View style={styles.bannerTextWrap}>
            <View style={styles.bannerTitleRow}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={theme.color.warningText}
                style={styles.bannerIcon}
              />
              <Text style={styles.bannerTitle}>{FOCUS_UNAVAILABLE_TITLE}</Text>
            </View>
            <Text style={styles.bannerBody}>{FOCUS_UNAVAILABLE_BODY}</Text>
          </View>
          <SecondaryButton
            label="Dismiss"
            icon="close"
            onPress={dismissFocusUnavailable}
            testID="notification-focus-unavailable-dismiss"
            style={styles.bannerRetry}
          />
        </View>
      ) : null}

      {/* Exactly one of loading / error / empty / feed (R9.6). */}
      {isLoading ? (
        <View style={styles.centerWrap} testID="notification-loading">
          <ActivityIndicator color={theme.color.primary} size="large" />
          <Text style={styles.loadingText}>Loading your notifications…</Text>
        </View>
      ) : isTotalFailure ? (
        <View style={styles.centerWrap} testID="notification-error">
          <EmptyState icon="cloud-offline-outline" title={ERROR_TITLE} body={ERROR_BODY} />
          <PrimaryButton
            label="Retry"
            icon="refresh"
            onPress={retryFailed}
            testID="notification-retry"
            style={styles.errorRetry}
          />
        </View>
      ) : isEmpty ? (
        <View style={styles.centerWrap} testID="notification-empty">
          <EmptyState icon="sparkles-outline" title={EMPTY_TITLE} body={EMPTY_BODY} />
        </View>
      ) : (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => renderRow(item, index)}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  controlBtn: {
    flex: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.warningSurface,
    borderWidth: 1,
    borderColor: theme.color.warning,
  },
  bannerTextWrap: {
    flex: 1,
    gap: 2,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  bannerIcon: {
    marginRight: 2,
  },
  bannerTitle: {
    ...theme.typography.subtitle,
    color: theme.color.warningText,
  },
  bannerBody: {
    ...theme.typography.meta,
    color: theme.color.warningText,
  },
  bannerRetry: {
    alignSelf: 'center',
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  loadingText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  errorRetry: {
    minWidth: 160,
  },
  listContent: {
    padding: theme.spacing.lg,
  },
  groupHeader: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
});
