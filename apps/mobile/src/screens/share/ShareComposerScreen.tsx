/**
 * ShareComposerScreen — Compose and send a Share to 1..50 friends.
 *
 * Renders a single-screen composer that lets the signed-in user pick
 * 1..50 friends as recipients, choose a payload kind (Experience or
 * Progress), optionally attach a Rating (1..10) and trimmed Note when
 * sharing an Experience, and submit to `POST /me/shares`.
 *
 * Behavior:
 *
 *   - **Friends.** A `useQuery` against `GET /me/friends` populates the
 *     recipient picker. Friends already accepted (the `friends` array
 *     of the bundle) are the only candidates; pending requests are not
 *     selectable. The list is reused — the same query key the Friends
 *     tab (task 18.1) already warms — so the picker shows up instantly
 *     when navigated to from Friends.
 *
 *   - **Selection rules (R9.2).** Selected friends are tracked as a
 *     `Set<string>` of user ids. The Send button is disabled while the
 *     selection size is `0` or `> 50`; the counter renders as
 *     `N/50 selected`. The server re-validates this and surfaces
 *     `share_recipient_count_invalid` if the client invariant ever
 *     slips — we map that code to the same friendly copy.
 *
 *   - **Payload kinds (R9.1, R9.7).** The user picks one of two
 *     branches:
 *       * `experience` — supply an Experience id (free-text for now;
 *         a future picker can swap the input out without changing
 *         this screen's contract). Optional Rating (1..10) and
 *         optional Note (trimmed, ≤ 2000 chars). The Note is trimmed
 *         and length-validated client-side; a server `note_length_invalid`
 *         is the authoritative fallback.
 *       * `progress` — sends the user's current progress snapshot.
 *         The server's contract requires the client to supply the
 *         numeric snapshot in the body (`statsSnapshot`), so we fetch
 *         `GET /me/stats` lazily and project it into the wire shape
 *         only at submit time. This keeps the composer cheap when the
 *         user never picks the progress branch.
 *
 *   - **Errors.** Server error codes are mapped to inline UI copy:
 *       * `share_recipient_count_invalid` → "Pick between 1 and 50 friends."
 *       * `share_atomic_rejected`         → "Some recipients are no
 *         longer your friends. Refresh and try again."
 *       * any other → "Couldn't send right now. Try again." (the
 *         generic `internal_error` lands here too).
 *
 *   - **Success.** On success we navigate back to the previous screen.
 *     The transient `Sent` indicator briefly renders before the
 *     navigation kicks in so the user sees a confirmation even on a
 *     fast network.
 *
 * Styling: uses the shared "Magical / Whimsical" theme — a gradient
 * hero header, the friend picker as selectable `Card`s, payload-kind
 * `Chip`s, themed inputs, and a themed Send PrimaryButton. See
 * `theme/theme.ts` and `theme/components.tsx`.
 *
 * Validates: Requirements R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { FriendsStackParamList } from '../../navigation/FriendsStack';
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

/**
 * Shape mirrors `StatsResponse` from
 * `apps/api/src/services/stats/routes.ts`. Used only when the user
 * picks the progress branch; we project it into `statsSnapshot` for
 * the share body.
 */
interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

interface StatsResponse {
  readonly overall: StatsBreakdown;
  readonly byPark: { readonly [park in Park]: StatsBreakdown };
  readonly byCategory: {
    readonly [category in ExperienceCategory]: StatsBreakdown;
  };
}

/** Body for `POST /me/shares` — Experience branch. */
interface ExperienceShareBody {
  readonly kind: 'experience';
  readonly recipientIds: ReadonlyArray<string>;
  readonly experienceId: string;
  readonly rating?: number;
  readonly includeRating?: boolean;
  readonly note?: string;
}

/** Body for `POST /me/shares` — Progress branch. */
interface ProgressShareBody {
  readonly kind: 'progress';
  readonly recipientIds: ReadonlyArray<string>;
  readonly statsSnapshot: {
    readonly overallPercent: number;
    readonly perParkPercent: { readonly [park in Park]?: number };
    readonly perCategoryPercent: {
      readonly [category in ExperienceCategory]?: number;
    };
  };
}

type ShareCreateBody = ExperienceShareBody | ProgressShareBody;

interface ShareCreateResponse {
  readonly shareId: string;
  readonly deliveredTo: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECIPIENTS = 50;
const MIN_RECIPIENTS = 1;
const MAX_NOTE_LENGTH = 2000;
const MIN_RATING = 1;
const MAX_RATING = 10;

const FRIENDS_QUERY_KEY = ['me-friends'] as const;
const STATS_QUERY_KEY = ['me-stats'] as const;

const ERROR_RECIPIENT_COUNT = 'Pick between 1 and 50 friends.';
const ERROR_ATOMIC_REJECTED =
  'Some recipients are no longer your friends. Refresh and try again.';
const ERROR_GENERIC = 'Couldn\u2019t send right now. Try again.';
const ERROR_NOTE_LENGTH = 'Note must be 1 to 2000 characters.';
const ERROR_RATING_RANGE = 'Rating must be a whole number between 1 and 10.';
const ERROR_EXPERIENCE_REQUIRED = 'Enter an Experience id to share.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<FriendsStackParamList, 'ShareComposer'>;

export default function ShareComposerScreen({
  navigation,
}: Props): JSX.Element {
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
  const [kind, setKind] = useState<'experience' | 'progress'>('experience');
  const [experienceId, setExperienceId] = useState<string>('');
  const [ratingText, setRatingText] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<boolean>(false);

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
  // Stats fetch — only enabled when the user picks the progress branch.
  // The screen does not block the user from selecting "Progress"; we lazy-
  // fetch the snapshot so a user who never picks it pays nothing.
  // -------------------------------------------------------------------------

  const statsQuery = useQuery<StatsResponse, ApiError>({
    queryKey: STATS_QUERY_KEY,
    queryFn: () => apiRequest<StatsResponse>('GET', '/me/stats'),
    enabled: kind === 'progress',
  });

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  const sendMutation = useMutation<ShareCreateResponse, ApiError, ShareCreateBody>(
    {
      mutationFn: (body) =>
        apiRequest<ShareCreateResponse>('POST', '/me/shares', body),
      onSuccess: () => {
        // Briefly flash the inline "Sent" indicator before popping the
        // screen. We schedule the navigation in a microtask so React
        // commits the success state first; without this, fast networks
        // would skip the indicator entirely.
        setSubmissionError(null);
        setJustSent(true);
        setTimeout(() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          }
        }, 600);
      },
      onError: (err) => {
        setJustSent(false);
        setSubmissionError(mapServerError(err));
      },
    },
  );

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const recipientCount = selected.size;
  const recipientCountValid =
    recipientCount >= MIN_RECIPIENTS && recipientCount <= MAX_RECIPIENTS;

  const handleSend = useCallback((): void => {
    setSubmissionError(null);

    if (!recipientCountValid) {
      // Belt-and-braces: the Send button is disabled when the count is
      // out of range, so this branch is only hit if the disabled state
      // is bypassed (e.g. by an automated tool). The message matches
      // the server's `share_recipient_count_invalid` copy.
      setSubmissionError(ERROR_RECIPIENT_COUNT);
      return;
    }

    const recipientIds = Array.from(selected);

    if (kind === 'experience') {
      const trimmedExperienceId = experienceId.trim();
      if (trimmedExperienceId.length === 0) {
        setSubmissionError(ERROR_EXPERIENCE_REQUIRED);
        return;
      }

      const ratingResult = parseRating(ratingText);
      if (ratingResult === 'invalid') {
        setSubmissionError(ERROR_RATING_RANGE);
        return;
      }

      const trimmedNote = noteText.trim();
      if (trimmedNote.length > MAX_NOTE_LENGTH) {
        setSubmissionError(ERROR_NOTE_LENGTH);
        return;
      }

      const body: ExperienceShareBody = {
        kind: 'experience',
        recipientIds,
        experienceId: trimmedExperienceId,
        ...(ratingResult !== 'omitted'
          ? { rating: ratingResult, includeRating: true }
          : {}),
        ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      };
      sendMutation.mutate(body);
      return;
    }

    // kind === 'progress'
    const stats = statsQuery.data;
    if (stats === undefined) {
      // We need the snapshot from the stats endpoint before we can
      // submit. Surface a friendly retry message; the user can hit
      // Send again once the stats query settles.
      setSubmissionError(ERROR_GENERIC);
      return;
    }

    const body: ProgressShareBody = {
      kind: 'progress',
      recipientIds,
      statsSnapshot: buildStatsSnapshot(stats),
    };
    sendMutation.mutate(body);
  }, [
    experienceId,
    kind,
    noteText,
    ratingText,
    recipientCountValid,
    selected,
    sendMutation,
    statsQuery.data,
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
  const sendDisabled =
    !recipientCountValid || sendMutation.isPending || justSent;
  const sendingProgressBlocked =
    kind === 'progress' && statsQuery.isLoading && statsQuery.data === undefined;

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
          <SectionLabel style={styles.pickerLabel}>Recipients</SectionLabel>
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
            <SectionLabel>What to share</SectionLabel>
            <View style={styles.kindRow}>
              <Chip
                label="Experience"
                active={kind === 'experience'}
                onPress={() => {
                  setKind('experience');
                  setSubmissionError(null);
                }}
              />
              <Chip
                label="Progress"
                active={kind === 'progress'}
                onPress={() => {
                  setKind('progress');
                  setSubmissionError(null);
                }}
              />
            </View>

            {kind === 'experience' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Experience id</Text>
                <TextInput
                  value={experienceId}
                  onChangeText={setExperienceId}
                  placeholder="experience-uuid"
                  placeholderTextColor={theme.color.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  accessibilityLabel="Experience id"
                />

                <Text style={styles.label}>Rating (optional, 1-10)</Text>
                <TextInput
                  value={ratingText}
                  onChangeText={setRatingText}
                  keyboardType="number-pad"
                  placeholder="e.g. 8"
                  placeholderTextColor={theme.color.textSecondary}
                  style={styles.input}
                  accessibilityLabel="Rating"
                />

                <Text style={styles.label}>Note (optional)</Text>
                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder="Say something nice"
                  placeholderTextColor={theme.color.textSecondary}
                  multiline
                  maxLength={MAX_NOTE_LENGTH}
                  style={[styles.input, styles.noteInput]}
                  accessibilityLabel="Note"
                />
                <Text style={styles.helper}>
                  {noteText.trim().length}/{MAX_NOTE_LENGTH}
                </Text>
              </View>
            ) : (
              <View style={styles.fieldGroup}>
                <Text style={styles.helper}>
                  {sendingProgressBlocked
                    ? 'Loading your progress\u2026'
                    : 'Your current progress will be shared as a snapshot.'}
                </Text>
              </View>
            )}

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the rating text input. Returns:
 *   - `'omitted'` when the field is empty (no rating attached).
 *   - `'invalid'` when the value is not an integer in `1..10`.
 *   - the integer value otherwise.
 *
 * The server's `ratingValueSchema` enforces integer 1..10; we mirror
 * the rule client-side so the user gets immediate feedback without a
 * round-trip.
 */
function parseRating(raw: string): number | 'omitted' | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'omitted';
  if (!/^-?\d+$/.test(trimmed)) return 'invalid';
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value)) return 'invalid';
  if (value < MIN_RATING || value > MAX_RATING) return 'invalid';
  return value;
}

/**
 * Project a `StatsResponse` into the wire `statsSnapshot` shape the
 * server's `progressShareInputSchema` accepts. We forward the
 * `percent` field of each breakdown verbatim — it is already in
 * `[0, 100]` per `computePercent`. The server re-clamps as defense in
 * depth.
 */
function buildStatsSnapshot(
  stats: StatsResponse,
): ProgressShareBody['statsSnapshot'] {
  const perParkPercent: { [park in Park]?: number } = {};
  for (const park of PARKS) {
    perParkPercent[park] = stats.byPark[park].percent;
  }
  const perCategoryPercent: { [category in ExperienceCategory]?: number } = {};
  for (const category of EXPERIENCE_CATEGORIES) {
    perCategoryPercent[category] = stats.byCategory[category].percent;
  }
  return {
    overallPercent: stats.overall.percent,
    perParkPercent,
    perCategoryPercent,
  };
}

/**
 * Map a server `ApiError` to user-facing copy. Three codes get
 * dedicated messages per the task brief; everything else (including
 * the catch-all `internal_error`) collapses to the generic copy.
 */
function mapServerError(err: ApiError): string {
  if (err.code === 'share_recipient_count_invalid') {
    return ERROR_RECIPIENT_COUNT;
  }
  if (err.code === 'share_atomic_rejected') {
    return ERROR_ATOMIC_REJECTED;
  }
  if (err.code === 'note_length_invalid') {
    return ERROR_NOTE_LENGTH;
  }
  if (err.code === 'rating_out_of_range') {
    return ERROR_RATING_RANGE;
  }
  return ERROR_GENERIC;
}

// `useMemo` is intentionally not used for the friends list above; the
// data is already a stable reference returned by react-query, and the
// `selected` set is the only piece of derived state the UI consumes.

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
  pickerLabel: {
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
  kindRow: {
    flexDirection: 'row',
  },
  fieldGroup: {
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  helper: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
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
