/**
 * ShareComposerScreen — Pick recipients and confirm a pre-populated Share.
 *
 * The composer no longer lets the User choose a payload kind or type a raw
 * Experience identifier. Every `Share_Entry_Point` (the Experience_Detail_View
 * and the Progress_Screen) opens the composer with a fully derived,
 * discriminated `ShareComposerParams`; the screen simply renders a read-only
 * preview of that content, offers include/exclude toggles for the sender's
 * Rating and Note (when present), lets the User pick 1..50 recipient friends,
 * and submits to `POST /me/shares`.
 *
 * Behavior for this task (5.1 — preview + toggles):
 *
 *   - **Kind is derived (R2.1).** The payload kind comes from
 *     `route.params.kind`; there is no kind picker.
 *
 *   - **Read-only preview (R2.2, R2.3, R2.4).** For an `experience` payload the
 *     preview shows the Experience name, Park, and Experience_Category, plus
 *     each value currently marked for inclusion (the Rating and/or Note). For a
 *     `progress` payload the preview shows the overall completion percentage to
 *     one decimal place.
 *
 *   - **No free-text identifier (R2.5).** The `experienceId` comes from params;
 *     the screen never renders a raw-identifier input.
 *
 *   - **Include/exclude toggles (R2.14).** When the `experience` payload carries
 *     a Rating and/or a Note, the screen renders an independent include toggle
 *     for each, defaulting to included. Excluding a value removes it from the
 *     preview and (task 5.3) from the submitted body.
 *
 * The recipient picker (task 5.2) and submission wiring (task 5.3) are refined
 * in their own tasks; this task establishes the kind-derived preview and the
 * inclusion toggles they build on.
 *
 * Styling: uses the shared "Magical / Whimsical" theme components — a gradient
 * hero header, the friend picker as selectable `Card`s, `Chip` include toggles,
 * and a themed Send `PrimaryButton`. See `theme/theme.ts` and
 * `theme/components.tsx`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ApiError, apiRequest } from '../../api/client';
import type {
  RootStackParamList,
  ShareComposerParams,
} from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';
import {
  MAX_RECIPIENTS,
  canSend,
  hasNoFriends,
  isRecipientCountValid,
} from './recipientGating';
import { buildShareCreateBody, type ShareCreateBody } from './shareBody';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * One entry in the `friends` array of `GET /me/friends`. Mirrors
 * `FriendListEntry` from `apps/api/src/services/friends/repo.ts`. The
 * shape is part of the public route contract; the mobile client must
 * not import backend internals, so the shape is restated here.
 */
interface FriendsListEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly establishedAt: string;
}

interface FriendRequestListEntry {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

interface FriendsAndRequestsResponse {
  readonly friends: ReadonlyArray<FriendsListEntry>;
  readonly incomingRequests: ReadonlyArray<FriendRequestListEntry>;
  readonly outgoingRequests: ReadonlyArray<FriendRequestListEntry>;
}

interface ShareCreateResponse {
  readonly shareId: string;
  readonly deliveredTo: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRIENDS_QUERY_KEY = ['me-friends'] as const;

const ERROR_NO_FRIENDS = 'Add friends before sharing.';

const ERROR_RECIPIENT_COUNT = 'Pick between 1 and 50 friends.';
const ERROR_ATOMIC_REJECTED =
  'Some recipients are no longer your friends. Refresh and try again.';
const ERROR_GENERIC = 'Couldn\u2019t send right now. Try again.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<RootStackParamList, 'ShareComposer'>;

export default function ShareComposerScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const params = route.params;

  // -------------------------------------------------------------------------
  // Friends list (the recipient picker source)
  // -------------------------------------------------------------------------

  const friendsQuery = useQuery<FriendsAndRequestsResponse, ApiError>({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: () =>
      apiRequest<FriendsAndRequestsResponse>('GET', '/me/friends'),
  });

  // -------------------------------------------------------------------------
  // Composer state
  // -------------------------------------------------------------------------

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Include/exclude toggles for the experience payload's Rating and Note
  // (R2.14). Each defaults to included; the toggle only appears when the
  // corresponding value is present in the params.
  const [includeRating, setIncludeRating] = useState<boolean>(true);
  const [includeNote, setIncludeNote] = useState<boolean>(true);

  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<boolean>(false);

  // Holds the pending success-indication timer (R2.10) so it can be cleared if
  // the screen unmounts before the 250 ms window elapses, avoiding a stray
  // `goBack()`/state update on an unmounted component.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    },
    [],
  );

  const toggleRecipient = useCallback((userId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  const sendMutation = useMutation<ShareCreateResponse, ApiError, ShareCreateBody>(
    {
      mutationFn: (body) =>
        apiRequest<ShareCreateResponse>('POST', '/me/shares', body),
      onSuccess: () => {
        // Success path (R2.10): show the "Sent" indication for 250 ms, then
        // return to the screen the composer was opened from. The timer id is
        // tracked so an early unmount cancels the pending navigation.
        setSubmissionError(null);
        setJustSent(true);
        if (successTimerRef.current !== null) {
          clearTimeout(successTimerRef.current);
        }
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          if (navigation.canGoBack()) {
            navigation.goBack();
          }
        }, 250);
      },
      onError: (err) => {
        setJustSent(false);
        setSubmissionError(mapServerError(err));
      },
    },
  );

  // -------------------------------------------------------------------------
  // Submit — derives the body from params plus the inclusion toggles.
  // -------------------------------------------------------------------------

  const friendCount = friendsQuery.data?.friends.length ?? 0;
  const recipientCount = selected.size;
  const recipientCountValid = isRecipientCountValid(recipientCount);
  const noFriends = hasNoFriends(friendCount);

  const handleSend = useCallback((): void => {
    setSubmissionError(null);

    if (noFriends) {
      setSubmissionError(ERROR_NO_FRIENDS);
      return;
    }

    if (!recipientCountValid) {
      setSubmissionError(ERROR_RECIPIENT_COUNT);
      return;
    }

    const recipientIds = Array.from(selected);

    const body: ShareCreateBody = buildShareCreateBody(
      params,
      { includeRating, includeNote },
      recipientIds,
    );
    sendMutation.mutate(body);
  }, [
    includeNote,
    includeRating,
    noFriends,
    params,
    recipientCountValid,
    selected,
    sendMutation,
  ]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (friendsQuery.isLoading && friendsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Share"
          icon="share-social"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (friendsQuery.isError && friendsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Share"
          icon="share-social"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centered}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load friends"
            body="Pull back and try again."
          />
        </View>
      </ScreenContainer>
    );
  }

  const friends = friendsQuery.data?.friends ?? [];

  // No-friends empty state (R2.15): the User has zero Friends to share with, so
  // show a dedicated empty-state indication and keep the send control disabled.
  if (noFriends) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Share"
          icon="share-social"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centered}>
          <EmptyState
            icon="people-outline"
            title="No friends to share with"
            body="Add friends before sharing."
          />
          <PrimaryButton
            label="Send"
            icon="send"
            disabled
            onPress={handleSend}
            accessibilityLabel="Send share"
            style={styles.sendButton}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Send is gated by the recipient count and no-friends rule (R2.6, R2.7,
  // R2.15) plus the in-flight/just-sent UI lifecycle (R2.9).
  const sendDisabled =
    !canSend(recipientCount, friendCount) || sendMutation.isPending || justSent;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Share with friends"
        subtitle={`${recipientCount}/${MAX_RECIPIENTS} selected`}
        icon="share-social"
        onBack={() => navigation.goBack()}
      />

      <FlatList
        data={friends}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <SharePreview
            params={params}
            includeRating={includeRating}
            includeNote={includeNote}
            onToggleRating={() => setIncludeRating((v) => !v)}
            onToggleNote={() => setIncludeNote((v) => !v)}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <EmptyState
              icon="people-outline"
              title="No friends yet"
              body="Add friends before sharing."
            />
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.userId);
          return (
            <Card
              onPress={() => toggleRecipient(item.userId)}
              {...(isSelected ? { accentColor: theme.color.primary } : {})}
              style={[styles.friendRow, isSelected && styles.friendRowSelected]}
            >
              <View style={styles.friendRowInner}>
                <Text style={styles.friendName}>{item.displayName}</Text>
                <Ionicons
                  name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={
                    isSelected ? theme.color.primary : theme.color.borderStrong
                  }
                />
              </View>
            </Card>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            {submissionError !== null ? (
              <Text style={styles.error} accessibilityRole="alert">
                {submissionError}
              </Text>
            ) : null}

            {justSent ? (
              <View style={styles.successRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={theme.color.success}
                />
                <Text style={styles.success}>Sent</Text>
              </View>
            ) : null}

            <PrimaryButton
              label="Send"
              icon="send"
              loading={sendMutation.isPending}
              disabled={sendDisabled}
              onPress={handleSend}
              accessibilityLabel="Send share"
              style={styles.sendButton}
            />
          </View>
        }
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Read-only preview (R2.2, R2.3, R2.4) + include/exclude toggles (R2.14)
// ---------------------------------------------------------------------------

function SharePreview({
  params,
  includeRating,
  includeNote,
  onToggleRating,
  onToggleNote,
}: {
  readonly params: ShareComposerParams;
  readonly includeRating: boolean;
  readonly includeNote: boolean;
  readonly onToggleRating: () => void;
  readonly onToggleNote: () => void;
}): JSX.Element {
  if (params.kind === 'experience') {
    const showRating = params.rating !== undefined;
    const showNote = params.note !== undefined && params.note.length > 0;
    return (
      <View style={styles.previewBlock}>
        <SectionLabel style={styles.previewLabel}>Sharing</SectionLabel>
        <Card style={styles.previewCard}>
          <Text style={styles.previewTitle} testID="preview-experience-name">
            {params.experienceName}
          </Text>
          <Text style={styles.previewMeta} testID="preview-experience-meta">
            {params.park} {'\u00b7'} {categoryLabel(params.category)}
          </Text>

          {showRating && includeRating ? (
            <Text style={styles.previewValue} testID="preview-rating">
              Rating: {params.rating}/10
            </Text>
          ) : null}

          {showNote && includeNote ? (
            <Text style={styles.previewValue} testID="preview-note">
              {params.note}
            </Text>
          ) : null}
        </Card>

        {showRating || showNote ? (
          <View style={styles.toggleRow}>
            {showRating ? (
              <Chip
                label={includeRating ? 'Rating included' : 'Rating excluded'}
                active={includeRating}
                onPress={onToggleRating}
                testID="toggle-rating"
                accessibilityLabel={`Include rating, ${
                  includeRating ? 'included' : 'excluded'
                }`}
              />
            ) : null}
            {showNote ? (
              <Chip
                label={includeNote ? 'Note included' : 'Note excluded'}
                active={includeNote}
                onPress={onToggleNote}
                testID="toggle-note"
                accessibilityLabel={`Include note, ${
                  includeNote ? 'included' : 'excluded'
                }`}
              />
            ) : null}
          </View>
        ) : null}

        <SectionLabel style={styles.pickerLabel}>Recipients</SectionLabel>
      </View>
    );
  }

  return (
    <View style={styles.previewBlock}>
      <SectionLabel style={styles.previewLabel}>Sharing</SectionLabel>
      <Card style={styles.previewCard}>
        <Text style={styles.previewTitle}>Progress</Text>
        <Text style={styles.previewValue} testID="preview-overall-percent">
          {formatPercent(params.overallPercent)}% complete overall
        </Text>
      </Card>
      <SectionLabel style={styles.pickerLabel}>Recipients</SectionLabel>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Friendly label for an Experience_Category. The enum members use
 * underscores (e.g. `Character_Meet`); render them with spaces, mirroring
 * `ExperienceDetailScreen`.
 */
function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}

/**
 * Render a completion percentage to exactly one decimal place (R2.4). The
 * value arrives already rounded to one decimal from the Progress_Screen; this
 * formats it consistently regardless of trailing-zero representation.
 */
function formatPercent(value: number): string {
  return value.toFixed(1);
}

/**
 * Map a server `ApiError` to user-facing copy. Recipient-count and
 * non-friend-recipient errors get dedicated messages; everything else
 * (including the catch-all `internal_error`) collapses to the generic copy.
 */
function mapServerError(err: ApiError): string {
  if (err.code === 'share_recipient_count_invalid') {
    return ERROR_RECIPIENT_COUNT;
  }
  if (err.code === 'share_atomic_rejected') {
    return ERROR_ATOMIC_REJECTED;
  }
  return ERROR_GENERIC;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  previewBlock: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  previewLabel: {
    marginBottom: theme.spacing.xs,
  },
  previewCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  previewTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  previewMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  previewValue: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pickerLabel: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  friendRow: {
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  friendRowSelected: {
    backgroundColor: theme.color.surfaceAlt,
  },
  friendRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  footer: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  error: {
    color: theme.color.danger,
    fontSize: 14,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  success: {
    color: theme.color.success,
    ...theme.typography.subtitle,
  },
  sendButton: {
    marginTop: theme.spacing.sm,
  },
});
