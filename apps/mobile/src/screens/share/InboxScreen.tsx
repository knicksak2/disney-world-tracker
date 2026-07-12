/**
 * InboxScreen — Human-readable Share inbox (Social Sharing Loop, R4/R6).
 *
 * Reads the reworked `Sharing_Service.listInbox` projection:
 *
 *   GET    /me/inbox                 → { unread, items[] }  (InboxResponse)
 *   POST   /me/inbox/:shareId/open   → mark Read_State=read (tap-through, 8.x)
 *   DELETE /me/inbox/:shareId        → recipient-side soft delete
 *
 * Unlike the previous projection, `GET /me/inbox` now discloses the sender,
 * the `Share_Payload`, the delivery timestamp, and the recipient's own
 * `Read_State` for EVERY delivered Share regardless of that Read_State. The
 * `recipient_id = $1` predicate on the server remains the privacy boundary
 * (R6.1); `Read_State` drives only the unread count (R6.2).
 *
 * Task coverage in this file:
 *   - **7.1 (this task).** Render the sender display name and timestamp for
 *     every delivered Share regardless of Read_State (R4.1); derive the unread
 *     count from items whose `read` is `false` (R6.2); render `progress`
 *     shares' overall, per-Park, and per-Experience_Category percentages to
 *     one decimal place (R4.9).
 *
 *   - **7.2 (this task).** Resolve `experience` metadata (name/Park/category)
 *     via a deduplicated `GET /catalog/:experienceId` read keyed by
 *     `['experience', experienceId]`. While in flight and under 10 s the row
 *     shows a loading indication (R4.10); on a failed read or after the 10 s
 *     window it shows an Experience-unavailable fallback label while keeping
 *     the remaining Share content visible (R4.11). The raw internal
 *     identifier is never the primary label (R4.3). This uniformly covers
 *     pre-feature payloads that lack embedded metadata (R6.3, R6.4).
 *
 *   - **7.3 (this task).** Renders the sender's Rating and Note per payload
 *     state inside `ExperienceRatingNote`, below the resolved/fallback metadata
 *     block so they remain visible even when the Experience is unavailable
 *     (R4.11): Rating as `N/10` when present (R4.4), a rating-unavailable
 *     indication when the payload marks it unavailable (R4.5), nothing
 *     otherwise (R4.6); the full Note when present (R4.7), nothing when absent
 *     (R4.8).
 *
 *   - **8.1 (this task).** Tap-through navigation with read-state and
 *     single-flight verification. Selecting an `experience` Share verifies the
 *     referenced Experience is retrievable (the deduplicated catalog read) and
 *     then navigates cross-navigator to `ExperienceDetail` on the `RootStack`
 *     (R5.1, R5.4); selecting a `progress` Share verifies the sender is still a
 *     Friend (against the cached `GET /me/friends`) and then navigates to
 *     `FriendProfile` (R5.2). Selecting an unread Share sets `Read_State=read`
 *     via `POST /me/inbox/:shareId/open` and updates the unread count (R5.3).
 *     An unavailable destination keeps the User on the Inbox with a per-share
 *     message while retaining the remaining content (R5.5, R5.6). While a
 *     Share's destination is being verified the row shows a loading indication
 *     and a second navigation for the same Share is suppressed until the
 *     verification completes (R5.7).
 *
 *   - **21.1 (this task).** Reaction controls on each delivered Share
 *     (`ShareReactions`). The recipient may attach at most one
 *     `Share_Reaction` drawn only from the closed `Reaction_Vocabulary`
 *     (`SHARE_REACTION_VALUES`) rendered as tappable chips — there is no
 *     free-text reaction input (R11.2). The recipient's current reaction
 *     (`item.myReaction`, delivered inline with the inbox projection) marks
 *     the active chip; tapping a different value submits/replaces it via
 *     `POST /me/inbox/:shareId/reactions`, and tapping the active value
 *     removes it via `DELETE /me/inbox/:shareId/reactions`. While a
 *     submit/remove is in flight the row shows a loading indication (R11.9);
 *     with no reaction attached it shows an empty-state indication (R11.10);
 *     if the reaction state cannot be resolved it shows an unavailable message
 *     while keeping the remaining Share content visible (R11.11). A
 *     submit/remove failure other than an authorization error shows a message,
 *     retains the Share view, and preserves the prior reaction state — the
 *     inbox cache is patched only on success, so a failed action never mutates
 *     the displayed reaction (R11.12).
 *
 * Styling uses the shared "Magical / Whimsical" theme.
 *
 *   - **26.1 (this task).** A `progress` Share tap deep-links into the Compare
 *     pane: the `FriendProfile` navigation passes `initialSection: 'comparison'`
 *     so the Friend_Profile_View opens on the Progress_Comparison (R14.1),
 *     navigating cross-navigator so the view is presented from its FriendsStack
 *     host (R14.2). The pre-existing sender-still-a-Friend guard keeps the User
 *     on the Inbox with a message when the sender is no longer a Friend (R14.3);
 *     when the comparison data cannot be retrieved the navigation still
 *     completes and the comparison-unavailable indication is shown (R14.4).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10,
 * 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.2, 6.3, 6.4, 11.2, 11.9, 11.10,
 * 11.11, 11.12, 14.1, 14.2, 14.3, 14.4
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  CompositeNavigationProp,
  RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  SHARE_REACTION_VALUES,
  type ExperienceCategory,
  type ExperienceSharePayload,
  type InboxItemDTO,
  type InboxResponse,
  type Park,
  type ProgressSharePayload,
  type ShareReactionValue,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { FriendsStackParamList } from '../../navigation/FriendsStack';
import type {
  MainTabParamList,
  RootStackParamList,
} from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Navigation typing
// ---------------------------------------------------------------------------

/**
 * The Inbox lives inside `FriendsStack`, which is a screen on the `Friends`
 * tab of `MainTabs`, which is itself a screen on the root-level `RootStack`.
 * Composing those navigators lets one `navigate` call resolve either a sibling
 * within `FriendsStack` (`FriendProfile`, R5.2) or a screen up on the
 * `RootStack` (`ExperienceDetail`, R5.1/R5.4) — the request bubbles up past the
 * tab navigator to the root stack for the latter.
 */
type InboxNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<FriendsStackParamList, 'Inbox'>,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Route for the Inbox. Carries an optional deep-link `shareId` when reached
 * from a tapped Share push notification (task 20.1). When present the Inbox
 * auto-drives the Share's tap-through — navigating to its destination and
 * marking it read (R10.2) — or shows a "no longer available" message when the
 * Share is gone (R10.4).
 */
type InboxRoute = RouteProp<FriendsStackParamList, 'Inbox'>;

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const INBOX_QUERY_KEY = ['inbox'] as const;

/**
 * Query key for the cached `GET /me/friends` read, shared with
 * `FriendsListScreen`. Tap-through on a `progress` Share verifies the sender is
 * still a Friend against this read (R5.2).
 */
const FRIENDS_QUERY_KEY = ['friends'] as const;

/**
 * Reuse a recent friends read (up to a minute old) when verifying a
 * `progress` Share's destination so the tap resolves without a mandatory
 * round-trip while still catching a recently-removed Friend (R5.2, R5.6).
 */
const FRIENDS_STALE_MS = 60 * 1000;

const ERROR_COPY = 'Couldn\u2019t load your inbox. Please try again later.';
const EMPTY_COPY = 'Your inbox is empty.';

/**
 * Upper bound on the per-share Experience metadata retrieval window (R4.10,
 * R4.11). While the catalog read is in flight and fewer than 10 seconds have
 * elapsed the row shows a loading indication; once the window elapses without
 * a resolved read the row falls back to the Experience-unavailable label.
 */
const METADATA_TIMEOUT_MS = 10_000;

/**
 * Keep resolved Experience metadata fresh for a short while so scrolling the
 * Inbox (or re-opening it) reuses the cached catalog read rather than
 * re-fetching. The React Query key `['experience', experienceId]` matches the
 * key `ExperienceDetailScreen` uses, so the read is deduplicated app-wide.
 */
const METADATA_STALE_MS = 5 * 60 * 1000;

/** Fallback primary label when Experience metadata cannot be resolved (R4.11). */
const EXPERIENCE_UNAVAILABLE_COPY = 'Experience unavailable';

/**
 * Per-share message shown when a tapped `experience` Share's referenced
 * Experience cannot be retrieved. The User stays on the Inbox and the rest of
 * the Inbox content is retained (R5.5).
 */
const EXPERIENCE_TAP_UNAVAILABLE_COPY =
  'This experience is unavailable right now.';

/**
 * Per-share message shown when a tapped `progress` Share's sender is no longer
 * a Friend. The User stays on the Inbox and the rest of the Inbox content is
 * retained (R5.6).
 */
const SENDER_TAP_UNAVAILABLE_COPY =
  'This friend\u2019s profile is no longer available.';

/**
 * Shown when the payload marks the sender's Rating as unavailable — the sender
 * chose to include a Rating but none existed at delivery time (R4.5).
 */
const RATING_UNAVAILABLE_COPY = 'Rating unavailable';

/**
 * Shown when a tapped Share push notification deep-links to a Share that is no
 * longer in the recipient's inbox. The Inbox opens with its current contents
 * and surfaces this message rather than navigating anywhere (R10.4).
 */
const SHARE_NO_LONGER_AVAILABLE_COPY =
  'That share is no longer available.';

// ---------------------------------------------------------------------------
// Reaction vocabulary (task 21.1, R11.2)
// ---------------------------------------------------------------------------

/**
 * User-facing chip labels for each closed `Reaction_Vocabulary` value. The
 * `like`/`love` glyphs mirror the glossary (👍 / ❤️); `been_there` and
 * `want_to_go` render as plain words. Keyed by the vocabulary value so the
 * chips cannot drift from `SHARE_REACTION_VALUES`.
 */
const REACTION_LABELS: Readonly<Record<ShareReactionValue, string>> = {
  like: '\uD83D\uDC4D Like',
  love: '\u2764\uFE0F Love',
  been_there: 'Been there',
  want_to_go: 'Want to go',
};

/**
 * Screen-reader labels for the reaction chips — the visible labels embed emoji
 * that do not read well, so assistive tech gets the plain word plus the chip's
 * selected/not-selected state.
 */
const REACTION_A11Y_LABELS: Readonly<Record<ShareReactionValue, string>> = {
  like: 'Like',
  love: 'Love',
  been_there: 'Been there',
  want_to_go: 'Want to go',
};

/** Empty-state indication shown when the recipient has not reacted (R11.10). */
const REACTION_EMPTY_COPY = 'No reaction yet.';

/**
 * Shown when the recipient's reaction state cannot be resolved for a Share,
 * keeping the remaining Share content visible (R11.11).
 */
const REACTION_UNAVAILABLE_COPY = 'Reactions are unavailable right now.';

/**
 * Shown when submitting or removing a reaction fails for a reason other than
 * an authorization error; the Share view and the prior reaction state are
 * retained (R11.12).
 */
const REACTION_ACTION_FAILED_COPY =
  'Couldn\u2019t update your reaction. Please try again.';

/**
 * Format an ISO-8601 timestamp into a human-readable local string. Kept
 * dependency-free; `toLocaleString` honors the device locale. Falls back to
 * the raw string if the timestamp cannot be parsed.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Render a category enum literal (e.g. `Character_Meet`) as user-facing text
 * by replacing underscores with spaces.
 */
function formatCategory(category: ExperienceCategory): string {
  return category.replace(/_/g, ' ');
}

/**
 * Format a completion percentage to exactly one decimal place (R4.9, R1.8).
 */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Minimal shape read from `GET /me/friends` (shared with `FriendsListScreen`).
 * Tap-through only needs each current Friend's `userId` to verify a
 * `progress` Share's sender is still a Friend (R5.2); the rest of the response
 * is ignored here so the read stays tolerant of unrelated response changes.
 */
interface FriendsListSnapshot {
  readonly friends: ReadonlyArray<{ readonly userId: string }>;
}

export default function InboxScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const navigation = useNavigation<InboxNavigation>();
  const route = useRoute<InboxRoute>();
  const deepLinkShareId = route.params?.shareId;

  const inboxQuery = useQuery<InboxResponse, ApiError>({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => apiRequest<InboxResponse>('GET', '/me/inbox'),
  });

  // Recipient-side soft delete. Removes the row from this user's inbox only;
  // the sender's `shares` row is untouched (see repo).
  const deleteMutation = useMutation<null, ApiError, string>({
    mutationFn: (shareId: string) =>
      apiRequest<null>('DELETE', `/me/inbox/${encodeURIComponent(shareId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    },
    retry: false,
  });

  // -------------------------------------------------------------------------
  // Tap-through: read-state + single-flight destination verification (8.1)
  // -------------------------------------------------------------------------

  // R5.3 — selecting an unread Share sets its Read_State to `read`. On success
  // we patch the cached inbox so the tapped item flips to read and the unread
  // count drops by one, then reconcile with the server on settle.
  const openMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (shareId: string) =>
      apiRequest<unknown>(
        'POST',
        `/me/inbox/${encodeURIComponent(shareId)}/open`,
      ),
    onSuccess: (_data, shareId) => {
      queryClient.setQueryData<InboxResponse>(INBOX_QUERY_KEY, (prev) => {
        if (prev === undefined) return prev;
        let changed = false;
        const items = prev.items.map((it) => {
          if (it.shareId === shareId && !it.read) {
            changed = true;
            return { ...it, read: true };
          }
          return it;
        });
        if (!changed) return prev;
        return { unread: Math.max(0, prev.unread - 1), items };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    },
    retry: false,
  });

  // Mark a Share read if (and only if) it is currently unread, reusing the
  // tap-through open mutation. Reading the cached read-state first keeps this
  // idempotent on the client so an already-read Share never fires a redundant
  // request — used by both tap-through selection (R5.3) and reacting.
  const markShareRead = React.useCallback(
    (shareId: string): void => {
      const cached = queryClient.getQueryData<InboxResponse>(INBOX_QUERY_KEY);
      const target = cached?.items.find((it) => it.shareId === shareId);
      if (target !== undefined && !target.read) {
        openMutation.mutate(shareId);
      }
    },
    [queryClient, openMutation],
  );

  // "Mark all read": one request flips every unread Share server-side. On
  // success we patch the cache so all rows read and the unread count is 0,
  // then reconcile on settle. The invalidation prefix-matches the
  // `['inbox', 'unread']` count key, so the tab-bar and Friends-page badges
  // clear too.
  const markAllReadMutation = useMutation<
    { updated: number; unread: number },
    ApiError,
    void
  >({
    mutationFn: () =>
      apiRequest<{ updated: number; unread: number }>(
        'POST',
        '/me/inbox/read-all',
      ),
    onSuccess: () => {
      queryClient.setQueryData<InboxResponse>(INBOX_QUERY_KEY, (prev) => {
        if (prev === undefined) return prev;
        if (prev.unread === 0 && prev.items.every((it) => it.read)) return prev;
        return {
          unread: 0,
          items: prev.items.map((it) => (it.read ? it : { ...it, read: true })),
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    },
    retry: false,
  });

  // R5.7 — a Share whose destination is currently being verified. The ref is
  // the authoritative single-flight guard (immune to stale render closures);
  // the state mirror drives the per-row loading indication.
  const verifyingRef = React.useRef<Set<string>>(new Set());
  const [verifyingIds, setVerifyingIds] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // R5.5 / R5.6 — per-share "destination unavailable" messages.
  const [rowMessages, setRowMessages] = React.useState<
    Readonly<Record<string, string>>
  >({});

  const beginVerifying = React.useCallback((shareId: string): void => {
    verifyingRef.current.add(shareId);
    setVerifyingIds(new Set(verifyingRef.current));
  }, []);

  const endVerifying = React.useCallback((shareId: string): void => {
    verifyingRef.current.delete(shareId);
    setVerifyingIds(new Set(verifyingRef.current));
  }, []);

  const setRowMessage = React.useCallback(
    (shareId: string, message: string | null): void => {
      setRowMessages((prev) => {
        if (message === null) {
          if (!(shareId in prev)) return prev;
          const next = { ...prev };
          delete next[shareId];
          return next;
        }
        if (prev[shareId] === message) return prev;
        return { ...prev, [shareId]: message };
      });
    },
    [],
  );

  const handleSelect = React.useCallback(
    (item: InboxItemDTO): void => {
      // R5.7 — suppress a second navigation for the same Share while its
      // destination verification is still in flight.
      if (verifyingRef.current.has(item.shareId)) return;

      // R5.3 — mark an unread Share read on selection regardless of whether
      // its destination turns out to be reachable.
      markShareRead(item.shareId);

      // Clear any stale unavailable message from a previous attempt.
      setRowMessage(item.shareId, null);
      beginVerifying(item.shareId);

      void (async () => {
        try {
          if (item.payload.kind === 'experience') {
            // R5.1 — verify the referenced Experience is retrievable via the
            // deduplicated catalog read, then navigate cross-navigator to the
            // detail view on the RootStack (R5.4).
            const experienceId = item.payload.experienceId;
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
              // R5.5 — keep the User on the Inbox with a message; content stays.
              setRowMessage(item.shareId, EXPERIENCE_TAP_UNAVAILABLE_COPY);
              return;
            }
            navigation.navigate('ExperienceDetail', { experienceId });
            return;
          }

          // R5.2 — verify the sender is still a Friend against the cached
          // friends read, then navigate to their profile.
          let stillFriend = false;
          try {
            const snapshot = await queryClient.fetchQuery<
              FriendsListSnapshot,
              ApiError
            >({
              queryKey: FRIENDS_QUERY_KEY,
              queryFn: () =>
                apiRequest<FriendsListSnapshot>('GET', '/me/friends'),
              staleTime: FRIENDS_STALE_MS,
              retry: false,
            });
            stillFriend = snapshot.friends.some(
              (f) => f.userId === item.senderId,
            );
          } catch {
            stillFriend = false;
          }
          if (!stillFriend) {
            // R5.6 — keep the User on the Inbox with a message; content stays.
            setRowMessage(item.shareId, SENDER_TAP_UNAVAILABLE_COPY);
            return;
          }
          // R14.1 — a Progress_Share deep-links into the Compare pane so the
          // shared snapshot lands directly on the Progress_Comparison. The
          // navigate call bubbles up past the tab navigator to present
          // FriendProfile from its FriendsStack host (R14.2). If the sender is
          // no longer a Friend the guard above already kept the User on the
          // Inbox (R14.3); if the comparison data can't be retrieved the view
          // still opens and ComparisonMode shows the unavailable indication
          // (R14.4).
          navigation.navigate('FriendProfile', {
            friendId: item.senderId,
            displayName: item.senderDisplayName,
            initialSection: 'comparison',
          });
        } finally {
          endVerifying(item.shareId);
        }
      })();
    },
    [
      beginVerifying,
      endVerifying,
      navigation,
      markShareRead,
      queryClient,
      setRowMessage,
    ],
  );

  // -------------------------------------------------------------------------
  // Notification deep-link: auto tap-through the deep-linked Share (20.1)
  // -------------------------------------------------------------------------

  // R10.4 — screen-level message shown (with the current inbox contents) when
  // a tapped notification deep-links to a Share that is no longer in the inbox.
  const [deepLinkMessage, setDeepLinkMessage] = React.useState<string | null>(
    null,
  );
  // Ensures each distinct deep-link `shareId` is auto-processed exactly once,
  // so returning to the Inbox (e.g. via back) does not re-trigger navigation.
  const processedDeepLinkRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (deepLinkShareId === undefined) {
      return;
    }
    // Wait until the inbox has loaded before resolving the deep-linked Share.
    if (!inboxQuery.isSuccess || inboxQuery.data === undefined) {
      return;
    }
    if (processedDeepLinkRef.current === deepLinkShareId) {
      return;
    }
    processedDeepLinkRef.current = deepLinkShareId;

    const target = inboxQuery.data.items.find(
      (it) => it.shareId === deepLinkShareId,
    );
    if (target === undefined) {
      // R10.4 — the Share is gone: keep the User on the Inbox with its current
      // contents and surface the "no longer available" message.
      setDeepLinkMessage(SHARE_NO_LONGER_AVAILABLE_COPY);
      return;
    }
    // R10.2 — navigate to the Share's destination and mark it read by reusing
    // the same tap-through path an in-app selection takes (Requirement 5).
    setDeepLinkMessage(null);
    handleSelect(target);
  }, [deepLinkShareId, inboxQuery.isSuccess, inboxQuery.data, handleSelect]);

  const handleDelete = (item: InboxItemDTO): void => {
    Alert.alert(
      'Delete share?',
      'This removes the share from your inbox. The sender\u2019s record is unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(item.shareId),
        },
      ],
    );
  };

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (inboxQuery.isLoading) {
    return (
      <ScreenContainer>
        <GradientHeader title="Inbox" icon="mail" onBack={() => navigation.goBack()} />
        <View style={styles.centerWrap}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (inboxQuery.isError || inboxQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Inbox" icon="mail" onBack={() => navigation.goBack()} />
        <View style={styles.centerWrap}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load your inbox"
            body={ERROR_COPY}
          />
        </View>
      </ScreenContainer>
    );
  }

  const { unread, items } = inboxQuery.data;

  // Unread count is derived from the items whose `read` is `false` (R6.2). We
  // prefer the locally derived count as the source of truth for what is on
  // screen, and reconcile with the server's `unread` should either drift.
  const localUnread = items.reduce(
    (acc, item) => (item.read ? acc : acc + 1),
    0,
  );
  const displayedUnread = Math.max(unread, localUnread);

  return (
    <ScreenContainer>
      <GradientHeader
        title="Inbox"
        subtitle="Shares your friends sent your way."
        icon="mail"
        onBack={() => navigation.goBack()}
        right={
          <Badge
            label={`${displayedUnread} unread`}
            color={theme.color.accent}
            icon="ellipse"
            testID="inbox-unread-badge"
          />
        }
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.shareId}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {deepLinkMessage !== null ? (
              <View
                style={styles.deepLinkBanner}
                testID="inbox-deeplink-message"
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={theme.color.danger}
                  style={styles.deepLinkBannerIcon}
                />
                <Text style={styles.deepLinkBannerText}>{deepLinkMessage}</Text>
              </View>
            ) : null}
            {displayedUnread > 0 ? (
              <View style={styles.markAllRow}>
                <SecondaryButton
                  label={
                    markAllReadMutation.isPending
                      ? 'Marking\u2026'
                      : 'Mark all read'
                  }
                  icon="checkmark-done-outline"
                  onPress={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  testID="inbox-mark-all-read"
                />
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <View style={styles.centerWrap}>
            <EmptyState
              icon="mail-open-outline"
              title={EMPTY_COPY}
              body="When friends share with you, it'll show up here."
            />
          </View>
        }
        renderItem={({ item }) => (
          <InboxRow
            item={item}
            onSelect={() => handleSelect(item)}
            onReacted={() => markShareRead(item.shareId)}
            isVerifying={verifyingIds.has(item.shareId)}
            message={rowMessages[item.shareId] ?? null}
            onDelete={() => handleDelete(item)}
            isDeleting={
              deleteMutation.isPending && deleteMutation.variables === item.shareId
            }
          />
        )}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

/**
 * A single delivered Share.
 *
 * Every row shows the sender display name and the delivery timestamp
 * regardless of `read` (R4.1, R6.2); an unread dot marks items whose
 * `read` is `false`. The payload body is delegated by kind so `progress`
 * (fully rendered here, R4.9) and `experience` (metadata/rating/note) evolve
 * independently.
 *
 * The whole card is pressable and drives tap-through (8.1): pressing it selects
 * the Share, which marks it read (R5.3) and verifies + navigates to its
 * destination (R5.1, R5.2). While that verification is in flight the row shows
 * a loading indication (R5.7); when the destination is unavailable the row
 * shows a message and the User stays on the Inbox (R5.5, R5.6). The Delete
 * button is its own pressable, so tapping it does not trigger tap-through.
 */
function InboxRow(props: {
  item: InboxItemDTO;
  onSelect: () => void;
  onReacted: () => void;
  isVerifying: boolean;
  message: string | null;
  onDelete: () => void;
  isDeleting: boolean;
}): JSX.Element {
  const { item, onSelect, onReacted, isVerifying, message, onDelete, isDeleting } =
    props;

  return (
    <Card
      accentColor={item.read ? theme.color.primary : theme.color.accent}
      style={styles.row}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`Open share from ${item.senderDisplayName}`}
      testID={`inbox-row-${item.shareId}`}
    >
      <View style={styles.header}>
        <View style={styles.headerMain}>
          {!item.read && (
            <Ionicons
              name="ellipse"
              size={10}
              color={theme.color.accent}
              style={styles.unreadDot}
              testID={`inbox-unread-dot-${item.shareId}`}
            />
          )}
          <Text style={styles.sender} testID={`inbox-sender-${item.shareId}`}>
            {item.senderDisplayName}
          </Text>
        </View>
        <Text style={styles.timestamp} testID={`inbox-timestamp-${item.shareId}`}>
          {formatTimestamp(item.sentAt)}
        </Text>
      </View>

      <ShareContent item={item} />

      <ShareReactions item={item} onReacted={onReacted} />

      {isVerifying && (
        <View style={styles.verifyingRow}>
          <ActivityIndicator
            color={theme.color.primary}
            testID={`inbox-verifying-${item.shareId}`}
          />
        </View>
      )}

      {message !== null && (
        <Text
          style={styles.rowMessage}
          testID={`inbox-tap-message-${item.shareId}`}
        >
          {message}
        </Text>
      )}

      <View style={styles.actions}>
        <SecondaryButton
          label={isDeleting ? 'Deleting\u2026' : 'Delete'}
          icon="trash-outline"
          tone="danger"
          onPress={onDelete}
          disabled={isDeleting}
          accessibilityLabel="Delete share"
        />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payload content (delegated by kind)
// ---------------------------------------------------------------------------

/**
 * Route the payload to its kind-specific renderer. `progress` is fully
 * rendered here (task 7.1, R4.9); `experience` is a seam for tasks 7.2
 * (resolved name/Park/category) and 7.3 (rating/note).
 */
function ShareContent(props: { item: InboxItemDTO }): JSX.Element {
  const { payload } = props.item;
  if (payload.kind === 'progress') {
    return <ProgressShareContent payload={payload} shareId={props.item.shareId} />;
  }
  return <ExperienceShareContent payload={payload} shareId={props.item.shareId} />;
}

/**
 * `progress` Share content (R4.9). Renders the overall completion percentage
 * and every provided per-Park and per-Experience_Category percentage to one
 * decimal place, in stable enum order so the layout is predictable.
 */
function ProgressShareContent(props: {
  payload: ProgressSharePayload;
  shareId: string;
}): JSX.Element {
  const { payload, shareId } = props;
  return (
    <View style={styles.payloadWrap}>
      <Text style={styles.summary} testID={`inbox-progress-overall-${shareId}`}>
        Overall: {formatPercent(payload.overallPercent)}
      </Text>
      {PARKS.map((park: Park) => {
        const v = payload.perParkPercent[park];
        if (typeof v !== 'number') return null;
        return (
          <Text
            key={park}
            style={styles.bodyLine}
            testID={`inbox-progress-park-${shareId}-${park}`}
          >
            {park}: {formatPercent(v)}
          </Text>
        );
      })}
      {EXPERIENCE_CATEGORIES.map((cat: ExperienceCategory) => {
        const v = payload.perCategoryPercent[cat];
        if (typeof v !== 'number') return null;
        return (
          <Text
            key={cat}
            style={styles.bodyLine}
            testID={`inbox-progress-category-${shareId}-${cat}`}
          >
            {formatCategory(cat)}: {formatPercent(v)}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * Minimal shape read from `GET /catalog/:experienceId`. The catalog detail
 * response carries many more fields (see `ExperienceDetailScreen`), but the
 * Inbox only needs the three display fields R4.2 requires. Typing just these
 * keeps the read tolerant of unrelated response changes.
 */
interface ExperienceMetadata {
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
}

/**
 * `experience` Share content — resolves the referenced Experience's name,
 * Park, and Experience_Category for display (task 7.2, R4.2).
 *
 * The metadata is NOT carried in the payload snapshot (the write contract is
 * frozen, R6.5), so it is resolved at display time from the catalog via a
 * `GET /catalog/:experienceId` read keyed by `['experience', experienceId]`.
 * That key is shared with `ExperienceDetailScreen`, so React Query
 * deduplicates the read across every Share that references the same
 * Experience and across the detail screen (R4.2). This is the same path used
 * for pre-feature payloads that lack embedded metadata (R6.3, R6.4).
 *
 * Display states:
 *   - **Resolved.** Render the Experience name as the primary label with its
 *     Park and Experience_Category. The raw internal identifier is NEVER the
 *     primary label (R4.3).
 *   - **Loading (< 10 s).** Show a per-share loading indication while the read
 *     is in flight and the 10-second window has not elapsed (R4.10).
 *   - **Unavailable.** On a failed read, or once the 10-second window elapses
 *     without a resolved read, show an Experience-unavailable fallback label
 *     while keeping the remaining Share content visible (R4.11).
 *
 * The Rating and Note (task 7.3, `ExperienceRatingNote`) render below this
 * block regardless of the metadata state, so an unavailable Experience never
 * hides the rest of the Share (R4.11 "keep the remaining Share content
 * visible").
 */
function ExperienceShareContent(props: {
  payload: ExperienceSharePayload;
  shareId: string;
}): JSX.Element {
  const { payload, shareId } = props;
  const encodedId = encodeURIComponent(payload.experienceId);

  const metaQuery = useQuery<ExperienceMetadata, ApiError>({
    queryKey: ['experience', payload.experienceId] as const,
    queryFn: () =>
      apiRequest<ExperienceMetadata>('GET', `/catalog/${encodedId}`),
    staleTime: METADATA_STALE_MS,
    // A single failed read is a genuine "unavailable" signal (R4.11); we do
    // not want react-query's backoff to keep the row in a loading state past
    // the 10-second window.
    retry: false,
  });

  // R4.10 / R4.11: bound the loading window to 10 seconds. While the read is
  // in flight the timer arms; if it fires before the read resolves, the row
  // falls back to the unavailable label even though the request may still be
  // outstanding. A resolved read (success or error) short-circuits the timer.
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    setTimedOut(false);
    if (metaQuery.isSuccess || metaQuery.isError) return undefined;
    const handle = setTimeout(() => setTimedOut(true), METADATA_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [metaQuery.isSuccess, metaQuery.isError, payload.experienceId]);

  const meta = metaQuery.data;

  // The metadata block resolves to exactly one of three states, but the
  // Rating and Note (task 7.3) render BELOW it regardless of which state wins,
  // so an unavailable or still-loading Experience never hides the rest of the
  // Share content (R4.11 "keep the remaining Share content visible").
  let metadataBlock: JSX.Element;
  if (meta !== undefined && !metaQuery.isError) {
    // Resolved metadata wins whenever it is available — including the case
    // where a slow read lands after the window elapsed.
    metadataBlock = (
      <>
        <Text
          style={styles.summary}
          testID={`inbox-experience-name-${shareId}`}
        >
          {meta.name}
        </Text>
        <Text
          style={styles.bodyLine}
          testID={`inbox-experience-context-${shareId}`}
        >
          {`${meta.park} \u00b7 ${formatCategory(meta.category)}`}
        </Text>
      </>
    );
  } else if (metaQuery.isError || timedOut) {
    // Failed read or elapsed 10-second window: fallback label (R4.11). The raw
    // identifier is never shown as the primary label (R4.3).
    metadataBlock = (
      <Text
        style={styles.summary}
        testID={`inbox-experience-unavailable-${shareId}`}
      >
        {EXPERIENCE_UNAVAILABLE_COPY}
      </Text>
    );
  } else {
    // In flight and within the 10-second window: per-share loading (R4.10).
    metadataBlock = (
      <View style={styles.experienceLoading}>
        <ActivityIndicator
          color={theme.color.primary}
          testID={`inbox-experience-loading-${shareId}`}
        />
      </View>
    );
  }

  return (
    <View style={styles.payloadWrap}>
      {metadataBlock}
      <ExperienceRatingNote payload={payload} shareId={shareId} />
    </View>
  );
}

/**
 * Renders the sender's Rating and Note captured in an `experience` payload
 * snapshot (task 7.3). Both render below the resolved/fallback metadata block
 * so they stay visible even when the Experience itself is unavailable (R4.11).
 *
 * Rating (per the frozen payload shape in `@dwt/shared`):
 *   - `rating` is an integer `1..10` → render it as `N/10` (R4.4).
 *   - `rating` is `null` with `ratingUnavailable === true` → the sender chose
 *     to include a Rating but none existed at send time; render a
 *     rating-unavailable indication (R4.5).
 *   - neither a numeric Rating nor the unavailable marker → render nothing
 *     (R4.6).
 *
 * Note:
 *   - `note` present → render the complete text (the payload schema already
 *     bounds it to ≤2000 chars, R4.7); it is not truncated for display.
 *   - `note` absent → render nothing (R4.8).
 */
function ExperienceRatingNote(props: {
  payload: ExperienceSharePayload;
  shareId: string;
}): JSX.Element | null {
  const { payload, shareId } = props;

  const ratingLine =
    typeof payload.rating === 'number' ? (
      <Text style={styles.bodyLine} testID={`inbox-experience-rating-${shareId}`}>
        {`Rating: ${payload.rating}/10`}
      </Text>
    ) : payload.ratingUnavailable === true ? (
      <Text
        style={styles.bodyLine}
        testID={`inbox-experience-rating-unavailable-${shareId}`}
      >
        {RATING_UNAVAILABLE_COPY}
      </Text>
    ) : null;

  const noteLine =
    typeof payload.note === 'string' ? (
      <Text style={styles.note} testID={`inbox-experience-note-${shareId}`}>
        {payload.note}
      </Text>
    ) : null;

  if (ratingLine === null && noteLine === null) return null;

  return (
    <>
      {ratingLine}
      {noteLine}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reactions (task 21.1)
// ---------------------------------------------------------------------------

/**
 * Patch the recipient's own reaction (`myReaction`) for a single Share in the
 * cached inbox response so the active chip reflects the new state immediately.
 * Called only on a confirmed submit/remove success, so a failed action never
 * mutates the displayed reaction (R11.12).
 */
function patchInboxReaction(
  queryClient: ReturnType<typeof useQueryClient>,
  shareId: string,
  reaction: ShareReactionValue | null,
): void {
  queryClient.setQueryData<InboxResponse>(INBOX_QUERY_KEY, (prev) => {
    if (prev === undefined) return prev;
    let changed = false;
    const items = prev.items.map((it) => {
      if (it.shareId === shareId && it.myReaction !== reaction) {
        changed = true;
        return { ...it, myReaction: reaction };
      }
      return it;
    });
    if (!changed) return prev;
    return { ...prev, items };
  });
}

/**
 * Reaction controls for a single delivered Share (R11.2, R11.9–R11.12).
 *
 * The recipient may attach at most one `Share_Reaction` drawn only from the
 * closed `Reaction_Vocabulary` (`SHARE_REACTION_VALUES`), rendered as tappable
 * chips — there is no free-text input (R11.2). The recipient's current
 * reaction arrives inline on the inbox item (`myReaction`), so no separate
 * retrieval is needed to render the controls; the chip matching `myReaction`
 * is active.
 *
 * Interactions map onto the `Reaction_Service` contract:
 *   - Tapping a value that is not the current reaction submits/replaces it via
 *     `POST /me/inbox/:shareId/reactions { reaction }` (R11.1, R11.5).
 *   - Tapping the current reaction removes it via
 *     `DELETE /me/inbox/:shareId/reactions` (R11.6).
 *
 * States:
 *   - **Loading (R11.9).** While a submit/remove request is in flight the row
 *     shows a loading indication and further taps are ignored.
 *   - **Empty (R11.10).** When no reaction is attached (and nothing is in
 *     flight) an empty-state indication is shown alongside the chips.
 *   - **Unavailable (R11.11).** If the reaction state cannot be resolved for
 *     the Share (the item carries no `myReaction` field) an unavailable
 *     message is shown; the remaining Share content stays visible because this
 *     block is separate from the payload content rendered above it.
 *   - **Action failed (R11.12).** A submit/remove failure that is NOT an
 *     authorization error (`reaction_forbidden`) shows a message and leaves the
 *     displayed reaction unchanged — the inbox cache is patched only on
 *     success, so the prior reaction state is preserved without an optimistic
 *     update to roll back.
 */
function ShareReactions(props: {
  item: InboxItemDTO;
  /** Called after a reaction is successfully attached, so the parent can mark
   * the Share read — reacting counts as engaging with it. */
  onReacted: () => void;
}): JSX.Element {
  const { item, onReacted } = props;
  const { shareId } = item;
  const queryClient = useQueryClient();

  const [failureMessage, setFailureMessage] = React.useState<string | null>(
    null,
  );

  // The reaction is delivered inline with the inbox projection. Read it
  // defensively so a malformed item (missing the field entirely) resolves to
  // the unavailable state (R11.11) rather than silently rendering as "no
  // reaction". A well-formed item always carries `myReaction` (value or null).
  const rawReaction = (
    item as { readonly myReaction?: ShareReactionValue | null }
  ).myReaction;
  const reactionsUnavailable = rawReaction === undefined;
  const current: ShareReactionValue | null = rawReaction ?? null;

  const submitMutation = useMutation<unknown, ApiError, ShareReactionValue>({
    mutationFn: (reaction) =>
      apiRequest<unknown>(
        'POST',
        `/me/inbox/${encodeURIComponent(shareId)}/reactions`,
        { reaction },
      ),
    onSuccess: (_data, reaction) => {
      setFailureMessage(null);
      patchInboxReaction(queryClient, shareId, reaction);
      // Attaching a reaction is engagement with the Share, so mark it read.
      onReacted();
    },
    onError: (error) => {
      // R11.12 — only non-authorization failures surface the retry message;
      // the prior reaction state is preserved because we never patched it.
      if (error.code !== 'reaction_forbidden') {
        setFailureMessage(REACTION_ACTION_FAILED_COPY);
      }
    },
    retry: false,
  });

  const removeMutation = useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      apiRequest<unknown>(
        'DELETE',
        `/me/inbox/${encodeURIComponent(shareId)}/reactions`,
      ),
    onSuccess: () => {
      setFailureMessage(null);
      patchInboxReaction(queryClient, shareId, null);
    },
    onError: (error) => {
      if (error.code !== 'reaction_forbidden') {
        setFailureMessage(REACTION_ACTION_FAILED_COPY);
      }
    },
    retry: false,
  });

  const isPending = submitMutation.isPending || removeMutation.isPending;

  const handlePress = React.useCallback(
    (value: ShareReactionValue): void => {
      // R11.9 — ignore taps while a submit/remove is already in flight so a
      // single reaction action resolves before the next begins.
      if (isPending) return;
      setFailureMessage(null);
      if (current === value) {
        // Tapping the active reaction toggles it off (R11.6).
        removeMutation.mutate();
      } else {
        // Submit or replace the reaction (R11.1, R11.5).
        submitMutation.mutate(value);
      }
    },
    [current, isPending, removeMutation, submitMutation],
  );

  // R11.11 — reaction state could not be resolved for this Share.
  if (reactionsUnavailable) {
    return (
      <View style={styles.reactionsWrap} testID={`inbox-reactions-${shareId}`}>
        <Text
          style={styles.reactionMessage}
          testID={`inbox-reaction-unavailable-${shareId}`}
        >
          {REACTION_UNAVAILABLE_COPY}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.reactionsWrap} testID={`inbox-reactions-${shareId}`}>
      <View style={styles.reactionChips}>
        {SHARE_REACTION_VALUES.map((value: ShareReactionValue) => (
          <Chip
            key={value}
            label={REACTION_LABELS[value]}
            active={current === value}
            onPress={() => handlePress(value)}
            testID={`inbox-reaction-chip-${shareId}-${value}`}
            accessibilityLabel={`${REACTION_A11Y_LABELS[value]}, ${
              current === value ? 'selected' : 'not selected'
            }`}
          />
        ))}
      </View>

      {isPending ? (
        // R11.9 — a submit/remove is in flight.
        <View style={styles.reactionStatus}>
          <ActivityIndicator
            color={theme.color.primary}
            testID={`inbox-reaction-loading-${shareId}`}
          />
        </View>
      ) : current === null ? (
        // R11.10 — no reaction attached.
        <Text
          style={styles.reactionEmpty}
          testID={`inbox-reaction-empty-${shareId}`}
        >
          {REACTION_EMPTY_COPY}
        </Text>
      ) : null}

      {failureMessage !== null && (
        // R11.12 — action failed for a non-authorization reason.
        <Text
          style={styles.reactionMessage}
          testID={`inbox-reaction-message-${shareId}`}
        >
          {failureMessage}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
    flexGrow: 1,
  },
  markAllRow: {
    alignItems: 'flex-end',
    marginBottom: theme.spacing.md,
  },
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  unreadDot: {
    marginRight: theme.spacing.sm,
  },
  sender: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  timestamp: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  payloadWrap: {
    gap: 2,
  },
  experienceLoading: {
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.xs,
  },
  summary: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    marginTop: 2,
  },
  bodyLine: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  note: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    marginTop: theme.spacing.xs,
  },
  verifyingRow: {
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.xs,
  },
  rowMessage: {
    ...theme.typography.meta,
    color: theme.color.danger,
    marginTop: theme.spacing.xs,
  },
  deepLinkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  deepLinkBannerIcon: {
    marginRight: theme.spacing.xs,
  },
  deepLinkBannerText: {
    ...theme.typography.meta,
    color: theme.color.danger,
    flexShrink: 1,
  },

  reactionsWrap: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  reactionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  reactionStatus: {
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.xs,
  },
  reactionEmpty: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  reactionMessage: {
    ...theme.typography.meta,
    color: theme.color.danger,
    marginTop: theme.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
