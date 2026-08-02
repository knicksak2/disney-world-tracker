// Feature: trips, Task 19.2 — Trip_Activity (consolidated feed + logging)
//
// Validates: Requirements 20.1–20.5, 13.3, 13.4, 13.7, 13.8, 13.11, 12.4, 12.8
//
// Behavior summary:
//   - This is the Trip_Activity section of the Trip_Detail_View hub (the
//     `TripFeed` route, R18.1/R18.6): the single surface that combines the
//     activity feed with the control to log a Completion (R20.1). The prior
//     Shared_Log screen is folded in here — there is no separate destination.
//   - It reads `GET /trips/:id/feed`, already ordered reverse-chronologically
//     (see `services/trips/feedOrder.ts::orderFeed`, R13.3), and renders each
//     item. A `completion_logged` item carries — folded into its `metadata` by
//     the read projection — the Experience name/Park, the logging Member's live
//     canonical Rating (or an unrated indicator, R12.4/R12.8), and each
//     Rode_With_Tag's Tagged_Member and confirmation state (R20.3).
//   - A "Log a completion" control at the head opens the log + rode-with picker
//     that assembles the same `POST /trips/:id/log-entries` body as before
//     (R20.2, R10). An All / Completions filter narrows the stream to
//     `completion_logged` items (R20.4); because completions are feed items,
//     they keep their reactions and comments in either view (R20.5).
//   - Each feed item exposes reaction controls over the closed `Trip_Reaction`
//     vocabulary (R13.4/R13.6/R13.7) and a comment composer (R13.8/R13.11),
//     rendered from the server projection and reconciled via optimistic cache
//     updates + a background refetch.
//
// READ CONTRACT: `GET /trips/:id/feed` returns `TripFeedItemDTO[]`, each item
// carrying its identity/type/actor/timestamp/metadata plus the group's
// engagement (aggregated Trip_Reactions with the caller's `mine` state and the
// Trip_Comments with a `mine` flag). The rode-with picker additionally reads
// `GET /trips/:id/members` (the only Users it may tag, R10.4) and `GET /me` (to
// exclude the logging Member, R10.5).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  TRIP_REACTION_VALUES,
  tripCommentInputSchema,
  tripLogEntryCreateSchema,
  tripReactionValueSchema,
  type RodeWithTagState,
  type TripFeedItemDTO,
  type TripFeedTargetType,
  type TripMemberDTO,
  type TripReactionValue,
} from '@dwt/shared';

import { Ionicons } from '@expo/vector-icons';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { ExperiencePicker } from './ExperiencePicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripFeed'>;

/** Wire shape of `GET /trips/:id/feed`: the ordered Trip_Feed_Items (R13.3). */
type TripFeedResponse = readonly TripFeedItemDTO[];

/** Wire shape of `GET /me`: the caller's identity (to exclude self, R10.5). */
interface MeResponse {
  readonly user: { readonly id: string };
}

/** Wire shape of `GET /trips/:id/members`: the Trip's current Members. */
type TripMembersResponse = readonly TripMemberDTO[];

/** Wire shape of `POST .../comments`: the created Trip_Comment's identity. */
interface TripCommentCreatedResponse {
  readonly id: string;
}

/**
 * The minimal Experience shape the `Log_Composer` needs: the `id` it submits on
 * `POST /trips/:id/log-entries` plus the `name`/`park` it shows in the selected
 * row. An `ExperienceDTO` from the picker is structurally assignable to it, and
 * a `Planned_Item` can pre-fill it directly (its `experienceId`/`experienceName`
 * /`park`), so `TripPlannedListScreen` can open the same composer pre-filled
 * without forking it (planned-list-completion-sync R1.2).
 */
export interface PickedExperience {
  readonly id: string;
  readonly name: string;
  readonly park: string | null;
}

/** One rode-with tag as folded into a `completion_logged` item's metadata. */
interface FeedRodeWith {
  readonly taggedMemberId: string;
  readonly displayName: string;
  readonly state: RodeWithTagState;
}

/**
 * Rollback context for the optimistic feed mutations: the feed snapshot taken
 * before the optimistic patch, restored if the request fails.
 */
interface FeedPatchContext {
  readonly previous: readonly TripFeedItemDTO[] | undefined;
}

/** Which slice of the activity stream is shown (R20.4). */
type ActivityFilter = 'all' | 'completions';

/**
 * Apply a reaction add/remove to an item's aggregated reaction list for the
 * optimistic cache update: toggling the caller's own `mine` flag and adjusting
 * the count, dropping a summary that falls to zero.
 */
function applyReaction(
  list: readonly { reaction: TripReactionValue; count: number; mine: boolean }[],
  reaction: TripReactionValue,
  remove: boolean,
): { reaction: TripReactionValue; count: number; mine: boolean }[] {
  const map = new Map(list.map((s) => [s.reaction, { ...s }]));
  const current = map.get(reaction) ?? { reaction, count: 0, mine: false };
  if (remove) {
    if (current.mine) {
      current.count = Math.max(0, current.count - 1);
      current.mine = false;
    }
    if (current.count === 0) {
      map.delete(reaction);
    } else {
      map.set(reaction, current);
    }
  } else if (!current.mine) {
    current.count += 1;
    current.mine = true;
    map.set(reaction, current);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query keys for the reads the Trip_Activity surface depends on. */
export const tripFeedKeys = {
  feed: (tripId: string) => ['trips', 'feed', tripId] as const,
  members: (tripId: string) => ['trips', 'members', tripId] as const,
};

/**
 * R13.3-style deadline reused from the Trips list: a retrieval that does not
 * complete within 10 seconds is treated as a failure rather than surfaced as an
 * empty feed. Enforced per attempt via `AbortController`.
 */
const FEED_LOAD_TIMEOUT_MS = 10_000;

/**
 * The feed items are the Trip_Feed's reaction/comment targets, so every target
 * addressed from this screen is a `feed_item` (R13.10).
 */
const FEED_TARGET_TYPE: TripFeedTargetType = 'feed_item';

/** The selectable canonical Rating values, a whole number 1–10 (R10.10). */
const RATING_VALUES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Display label + both an outline (idle) and solid (active) glyph for each
 * supported Trip_Reaction (closed set, R13.6). The solid glyph is shown when
 * the caller has applied that reaction so the control reads as "on".
 */
const REACTION_META: Record<
  TripReactionValue,
  {
    readonly label: string;
    readonly icon: keyof typeof Ionicons.glyphMap;
    readonly iconActive: keyof typeof Ionicons.glyphMap;
    readonly tint: string;
  }
> = {
  like: { label: 'Like', icon: 'thumbs-up-outline', iconActive: 'thumbs-up', tint: '#2f80ed' },
  love: { label: 'Love', icon: 'heart-outline', iconActive: 'heart', tint: '#d6336c' },
  celebrate: { label: 'Celebrate', icon: 'sparkles-outline', iconActive: 'sparkles', tint: '#f6a609' },
  wow: { label: 'Wow', icon: 'happy-outline', iconActive: 'happy', tint: '#7e57c2' },
};

/** Human copy + glyph + accent tone for the known Trip_Feed_Item types (R13.1). */
const FEED_TYPE_META: Record<
  string,
  {
    readonly label: string;
    readonly icon: keyof typeof Ionicons.glyphMap;
    readonly tone: string;
  }
> = {
  trip_created: { label: 'created the trip', icon: 'flag', tone: '#7e57c2' },
  member_joined: { label: 'joined the trip', icon: 'person-add', tone: '#2f80ed' },
  completion_logged: { label: 'logged a completion', icon: 'checkmark-circle', tone: '#2e9e6b' },
  rating_recorded: { label: 'recorded a rating', icon: 'star', tone: '#f6a609' },
  rode_with_confirmed: { label: 'confirmed riding along', icon: 'people', tone: '#d6336c' },
};

/** Per-state visuals for a rode-with tag chip (R10.3 lifecycle). */
const RODE_WITH_VISUAL: Record<
  RodeWithTagState,
  { readonly bg: string; readonly fg: string; readonly icon: keyof typeof Ionicons.glyphMap }
> = {
  confirmed: { bg: 'rgba(46, 158, 107, 0.14)', fg: theme.color.success, icon: 'checkmark-circle' },
  pending: { bg: theme.color.warningSurface, fg: theme.color.warningText, icon: 'time-outline' },
  declined: { bg: 'rgba(214, 51, 108, 0.12)', fg: theme.color.danger, icon: 'close-circle-outline' },
  cancelled: { bg: theme.color.surfaceAlt, fg: theme.color.textSecondary, icon: 'remove-circle-outline' },
};

/** Palette for the initials avatar, chosen by a stable hash of the name. */
const AVATAR_COLORS: readonly string[] = [
  '#7e57c2',
  '#2f80ed',
  '#2e9e6b',
  '#e8505b',
  '#f6a609',
  '#00897b',
  '#8e24aa',
  '#d6336c',
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripFeedScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const feedQuery = useQuery<TripFeedResponse, ApiError>({
    queryKey: tripFeedKeys.feed(tripId),
    // A retrieval that fails or exceeds the 10s ceiling surfaces as an error
    // rather than an empty feed. Each attempt gets its own AbortController and
    // retries are disabled so the error shows on the first failure/timeout.
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, FEED_LOAD_TIMEOUT_MS);
      try {
        return await apiRequest<TripFeedResponse>(
          'GET',
          `/trips/${tripId}/feed`,
          undefined,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    retry: false,
  });

  // The caller's own id (to exclude the logging Member from the picker, R10.5)
  // and the Trip's current Members (the only Users the picker may tag, R10.4).
  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });
  const membersQuery = useQuery<TripMembersResponse, ApiError>({
    queryKey: tripFeedKeys.members(tripId),
    queryFn: () =>
      apiRequest<TripMembersResponse>('GET', `/trips/${tripId}/members`),
  });

  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [composerVisible, setComposerVisible] = useState(false);

  const ownUserId = meQuery.data?.user.id ?? null;
  const candidates = useMemo<readonly TripMemberDTO[]>(() => {
    const members = membersQuery.data ?? [];
    return members.filter((m) => m.userId !== ownUserId);
  }, [membersQuery.data, ownUserId]);

  const backToHub = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripDetail', { tripId });
  };

  const openComposer = (): void => {
    setComposerVisible(true);
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (feedQuery.isLoading && feedQuery.data === undefined) {
    return (
      <ScreenContainer>
        <ActivityHeader onBack={backToHub} onLog={openComposer} />
        <View style={styles.center} testID="trip-feed-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Load error (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (feedQuery.isError && feedQuery.data === undefined) {
    return (
      <ScreenContainer>
        <ActivityHeader onBack={backToHub} onLog={openComposer} />
        <View style={styles.center} testID="trip-feed-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this activity"
            body={readErrorMessage(feedQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void feedQuery.refetch();
            }}
            testID="trip-feed-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const allItems = feedQuery.data ?? [];
  const items =
    filter === 'completions'
      ? allItems.filter((item) => item.type === 'completion_logged')
      : allItems;

  return (
    <ScreenContainer>
      <ActivityHeader onBack={backToHub} onLog={openComposer} />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedItemCard tripId={tripId} item={item} />}
        contentContainerStyle={styles.listContent}
        testID="trip-feed"
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <PrimaryButton
              label="Log a completion"
              icon="add-circle-outline"
              onPress={openComposer}
              testID="trip-activity-log-cta"
              style={styles.logBtn}
            />
            <View style={styles.filterRow} testID="trip-activity-filter">
              <Chip
                label="All"
                active={filter === 'all'}
                onPress={() => setFilter('all')}
                testID="trip-activity-filter-all"
              />
              <Chip
                label="Completions"
                active={filter === 'completions'}
                onPress={() => setFilter('completions')}
                testID="trip-activity-filter-completions"
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center} testID="trip-feed-empty">
            <EmptyState
              icon={filter === 'completions' ? 'sparkles-outline' : 'megaphone-outline'}
              title={
                filter === 'completions'
                  ? 'No completions yet'
                  : 'Nothing here yet'
              }
              body={
                filter === 'completions'
                  ? 'Log an Experience your group did together and it’ll show up here.'
                  : "As the group plans, logs, and rides together, it'll show up in this feed."
              }
            />
          </View>
        }
      />

      <LogComposerModal
        visible={composerVisible}
        tripId={tripId}
        candidates={candidates}
        onClose={() => setComposerVisible(false)}
        onLogged={() => {
          setComposerVisible(false);
          void queryClient.invalidateQueries({
            queryKey: tripFeedKeys.feed(tripId),
          });
        }}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Feed item card — reactions + comments (+ rich completion detail)
// ---------------------------------------------------------------------------

function FeedItemCard({
  tripId,
  item,
}: {
  readonly tripId: string;
  readonly item: TripFeedItemDTO;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const reactionByValue = useMemo(() => {
    const map = new Map<TripReactionValue, { count: number; mine: boolean }>();
    for (const summary of item.reactions) {
      map.set(summary.reaction, { count: summary.count, mine: summary.mine });
    }
    return map;
  }, [item.reactions]);

  const feedKey = tripFeedKeys.feed(tripId);

  const patchItem = (
    updater: (current: TripFeedItemDTO) => TripFeedItemDTO,
  ): readonly TripFeedItemDTO[] | undefined => {
    const previous = queryClient.getQueryData<readonly TripFeedItemDTO[]>(feedKey);
    queryClient.setQueryData<readonly TripFeedItemDTO[]>(feedKey, (prev) =>
      prev?.map((it) => (it.id === item.id ? updater(it) : it)),
    );
    return previous;
  };

  const invalidateFeed = (): void => {
    void queryClient.invalidateQueries({ queryKey: feedKey });
  };

  const meta = FEED_TYPE_META[item.type] ?? {
    label: item.type.replace(/_/g, ' '),
    icon: 'ellipse-outline' as const,
    tone: theme.color.primary,
  };

  // Human context folded into the feed item by the read projection.
  const experienceName = readString(item.metadata, 'experienceName');
  const park = readString(item.metadata, 'park');
  const rating = readNumber(item.metadata, 'rating');
  const rodeWith = readRodeWith(item.metadata);

  const reactionMutation = useMutation<
    void,
    ApiError,
    { readonly reaction: TripReactionValue; readonly remove: boolean },
    FeedPatchContext
  >({
    mutationFn: async ({ reaction, remove }) => {
      const parsed = tripReactionValueSchema.safeParse(reaction);
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: 'trip_validation_failed',
          status: 400,
        });
      }
      const base = `/trips/${tripId}/feed/${FEED_TARGET_TYPE}/${item.id}/reactions`;
      if (remove) {
        await apiRequest<void>('DELETE', `${base}/${parsed.data}`);
      } else {
        await apiRequest<void>('POST', base, { reaction: parsed.data });
      }
    },
    onMutate: async ({ reaction, remove }) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const previous = patchItem((current) => ({
        ...current,
        reactions: applyReaction(current.reactions, reaction, remove),
      }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(feedKey, context.previous);
      }
      setError(actionErrorMessage(err));
    },
    onSettled: () => {
      invalidateFeed();
    },
  });

  const addCommentMutation = useMutation<
    TripCommentCreatedResponse,
    ApiError,
    string,
    FeedPatchContext
  >({
    mutationFn: async (bodyText) => {
      const parsed = tripCommentInputSchema.safeParse({ body: bodyText });
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: 'trip_validation_failed',
          status: 400,
        });
      }
      return apiRequest<TripCommentCreatedResponse>(
        'POST',
        `/trips/${tripId}/feed/${FEED_TARGET_TYPE}/${item.id}/comments`,
        parsed.data,
      );
    },
    onMutate: async (bodyText) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const trimmed = bodyText.trim();
      const previous = patchItem((current) => ({
        ...current,
        comments: [
          ...current.comments,
          {
            id: `optimistic-${Date.now()}`,
            authorId: '',
            authorDisplayName: 'You',
            body: trimmed,
            createdAt: new Date().toISOString(),
            mine: true,
          },
        ],
      }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(feedKey, context.previous);
      }
      setError(actionErrorMessage(err));
    },
    onSettled: () => {
      invalidateFeed();
    },
  });

  const removeCommentMutation = useMutation<void, ApiError, string, FeedPatchContext>({
    mutationFn: async (commentId) => {
      await apiRequest<void>('DELETE', `/trips/${tripId}/comments/${commentId}`);
    },
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const previous = patchItem((current) => ({
        ...current,
        comments: current.comments.filter((c) => c.id !== commentId),
      }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(feedKey, context.previous);
      }
      setError(actionErrorMessage(err));
    },
    onSettled: () => {
      invalidateFeed();
    },
  });

  const busy =
    reactionMutation.isPending ||
    addCommentMutation.isPending ||
    removeCommentMutation.isPending;

  const canSubmit = draft.trim().length > 0 && !addCommentMutation.isPending;
  const commentCount = item.comments.length;

  return (
    <Card style={styles.itemCard} testID={`trip-feed-item-${item.id}`}>
      {/* Header: initials avatar, actor + what they did, relative time. */}
      <View style={styles.itemHeader}>
        <Avatar name={item.actorDisplayName} />
        <View style={styles.itemIdentity}>
          <Text style={styles.itemActorLine} numberOfLines={2}>
            <Text style={styles.itemActor}>{item.actorDisplayName}</Text>
            <Text style={styles.itemAction}> {meta.label}</Text>
          </Text>
          <Text style={styles.itemMeta}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: withAlpha(meta.tone, 0.14) }]}>
          <Ionicons name={meta.icon} size={16} color={meta.tone} />
        </View>
      </View>

      {/* What the activity was about — the completed/confirmed Experience. */}
      {experienceName !== null ? (
        <View
          style={styles.experiencePill}
          testID={`trip-feed-experience-${item.id}`}
        >
          <View style={styles.experienceIcon}>
            <Ionicons name="rocket" size={16} color={theme.color.primary} />
          </View>
          <View style={styles.experienceText}>
            <Text style={styles.experienceName} numberOfLines={2}>
              {experienceName}
            </Text>
            <View style={styles.experienceMetaRow}>
              {park !== null ? (
                <Badge label={park} color={theme.color.primary} />
              ) : null}
              {rating !== null ? (
                <View style={styles.ratingPill}>
                  <Ionicons name="star" size={12} color={theme.color.accentDark} />
                  <Text style={styles.ratingText}>{rating}/10</Text>
                </View>
              ) : null}
            </View>
            {rodeWith.length > 0 ? (
              <View style={styles.rodeWithChips} testID={`trip-feed-rodewith-${item.id}`}>
                {rodeWith.map((tag) => {
                  const visual = RODE_WITH_VISUAL[tag.state];
                  return (
                    <View
                      key={tag.taggedMemberId}
                      style={[styles.tagChip, { backgroundColor: visual.bg }]}
                    >
                      <Ionicons name={visual.icon} size={12} color={visual.fg} />
                      <Text
                        style={[styles.tagChipText, { color: visual.fg }]}
                        numberOfLines={1}
                      >
                        {tag.displayName}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Reaction controls over the closed Trip_Reaction vocabulary. */}
      <View style={styles.reactions} testID={`trip-feed-reactions-${item.id}`}>
        {TRIP_REACTION_VALUES.map((reaction) => {
          const summary = reactionByValue.get(reaction);
          const active = summary?.mine ?? false;
          const count = summary?.count ?? 0;
          const rmeta = REACTION_META[reaction];
          return (
            <Pressable
              key={reaction}
              onPress={() => {
                if (reactionMutation.isPending) return;
                setError(null);
                reactionMutation.mutate({ reaction, remove: active });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${rmeta.label}${count > 0 ? `, ${count}` : ''}, ${active ? 'selected' : 'not selected'}`}
              testID={`trip-feed-reaction-${item.id}-${reaction}`}
              style={({ pressed }) => [
                styles.reactionPill,
                active && { backgroundColor: withAlpha(rmeta.tint, 0.14), borderColor: rmeta.tint },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={active ? rmeta.iconActive : rmeta.icon}
                size={15}
                color={active ? rmeta.tint : theme.color.textSecondary}
              />
              <Text style={[styles.reactionText, active && { color: rmeta.tint }]}>
                {count > 0 ? `${rmeta.label} ${count}` : rmeta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />

      {/* Every Member's comments, oldest-first; a remove control appears only
          on the caller's own comments (author-scoped, R13.11/R13.12). */}
      {item.comments.length > 0 ? (
        <View style={styles.comments}>
          {item.comments.map((comment) => (
            <View
              key={comment.id}
              style={styles.commentRow}
              testID={`trip-feed-comment-${comment.id}`}
            >
              <View style={styles.commentContent}>
                <Text style={styles.commentAuthorLine} numberOfLines={1}>
                  <Text style={styles.commentAuthor}>
                    {comment.mine ? 'You' : comment.authorDisplayName}
                  </Text>
                  <Text style={styles.commentTime}>
                    {'  '}
                    {formatRelativeTime(comment.createdAt)}
                  </Text>
                </Text>
                <Text style={styles.commentBody}>{comment.body}</Text>
              </View>
              {comment.mine ? (
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={theme.color.danger}
                  onPress={() => {
                    if (removeCommentMutation.isPending) return;
                    setError(null);
                    removeCommentMutation.mutate(comment.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove comment"
                  testID={`trip-feed-comment-remove-${comment.id}`}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Collapsed by default: a single "Comment" action opens the composer. */}
      {composerOpen ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              if (error !== null) setError(null);
            }}
            placeholder="Add a comment"
            placeholderTextColor={theme.color.textSecondary}
            multiline
            maxLength={2000}
            editable={!addCommentMutation.isPending}
            autoFocus
            style={styles.composerInput}
            accessibilityLabel="Add a comment"
            testID={`trip-feed-comment-input-${item.id}`}
          />
          <Ionicons
            name="send"
            size={20}
            color={canSubmit ? theme.color.primary : theme.color.textSecondary}
            onPress={() => {
              if (!canSubmit) return;
              const bodyText = draft;
              setError(null);
              setDraft('');
              setComposerOpen(false);
              addCommentMutation.mutate(bodyText);
            }}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            testID={`trip-feed-comment-submit-${item.id}`}
            style={styles.composerSend}
          />
        </View>
      ) : (
        <Pressable
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add a comment"
          testID={`trip-feed-comment-open-${item.id}`}
          style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}
        >
          <Ionicons
            name="chatbubble-outline"
            size={16}
            color={theme.color.textSecondary}
          />
          <Text style={styles.commentActionText}>
            {commentCount > 0 ? 'Add another comment' : 'Add a comment'}
          </Text>
        </Pressable>
      )}

      {error !== null ? (
        <Text
          style={styles.error}
          accessibilityRole="alert"
          testID={`trip-feed-item-error-${item.id}`}
        >
          {error}
        </Text>
      ) : null}

      {busy ? (
        <ActivityIndicator
          color={theme.color.primary}
          style={styles.itemBusy}
          testID={`trip-feed-item-busy-${item.id}`}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log composer modal — the log + rode-with picker (R10, R20.2)
// ---------------------------------------------------------------------------

export function LogComposerModal({
  visible,
  tripId,
  candidates,
  initialExperience = null,
  onClose,
  onLogged,
}: {
  readonly visible: boolean;
  readonly tripId: string;
  readonly candidates: readonly TripMemberDTO[];
  /**
   * When provided, the composer opens with this Experience pre-selected — the
   * one-tap "log from a plan" path (planned-list-completion-sync R1.2). The
   * rode-with tagging, optional Rating, and the `POST /trips/:id/log-entries`
   * submission are otherwise identical to opening it empty from the feed.
   */
  readonly initialExperience?: PickedExperience | null;
  readonly onClose: () => void;
  readonly onLogged: () => void;
}): JSX.Element {
  const [experience, setExperience] = useState<PickedExperience | null>(
    initialExperience,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed a fresh form on the hidden→visible edge so re-opening the composer
  // (from the feed empty, or from a Planned_Item pre-filled) always starts from
  // the intended Experience without stale state from a prior open.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setExperience(initialExperience);
      setSelected(new Set());
      setRating(null);
      setError(null);
    }
    wasVisible.current = visible;
  }, [visible, initialExperience]);

  const resetForm = (): void => {
    setExperience(initialExperience);
    setSelected(new Set());
    setRating(null);
    setError(null);
  };

  const logMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      const draft = {
        experienceId: experience?.id ?? '',
        rodeWith: [...selected],
        ...(rating !== null ? { rating } : {}),
      };
      const parsed = tripLogEntryCreateSchema.safeParse(draft);
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: 'trip_validation_failed',
          status: 400,
        });
      }
      await apiRequest<void>('POST', `/trips/${tripId}/log-entries`, parsed.data);
    },
    onSuccess: () => {
      resetForm();
      onLogged();
    },
    onError: (err) => {
      setError(logErrorMessage(err));
    },
  });

  const busy = logMutation.isPending;

  const toggleMember = (userId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
    if (error !== null) setError(null);
  };

  const closeAndReset = (): void => {
    if (busy) return;
    resetForm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeAndReset}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="activity-log-composer">
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>Log a completion</Text>
            <Pressable
              onPress={closeAndReset}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
              testID="activity-log-close"
            >
              <Ionicons name="close" size={22} color={theme.color.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={styles.label}>Experience</Text>
            {experience === null ? (
              <ExperiencePicker
                enabled={visible}
                onSelect={(picked) => {
                  setExperience(picked);
                  if (error !== null) setError(null);
                }}
                testIDPrefix="activity-log"
              />
            ) : (
              <View style={styles.selectedRow} testID="activity-log-selected">
                <View style={styles.selectedText}>
                  <Text style={styles.selectedName} numberOfLines={2}>
                    {experience.name}
                  </Text>
                  {experience.park !== null ? (
                    <Badge label={experience.park} color={theme.color.primary} />
                  ) : null}
                </View>
                <SecondaryButton
                  label="Change"
                  onPress={() => {
                    if (busy) return;
                    setExperience(null);
                  }}
                  disabled={busy}
                  testID="activity-log-change-experience"
                />
              </View>
            )}

            <Text style={styles.label}>Rode with</Text>
            {candidates.length === 0 ? (
              <Text style={styles.helper} testID="activity-log-no-candidates">
                No other Members to tag yet. You can still log this on your own.
              </Text>
            ) : (
              <View style={styles.chips} testID="activity-log-rodewith">
                {candidates.map((member) => (
                  <Chip
                    key={member.userId}
                    label={member.displayName}
                    active={selected.has(member.userId)}
                    onPress={() => {
                      if (busy) return;
                      toggleMember(member.userId);
                    }}
                    testID={`activity-log-member-${member.userId}`}
                  />
                ))}
              </View>
            )}

            <Text style={styles.label}>Your rating (optional)</Text>
            <Text style={styles.helper}>
              {rating === null
                ? 'No rating selected — none will be recorded.'
                : `Selected ${rating}/10 — tap it again to clear.`}
            </Text>
            <View style={styles.chips} testID="activity-log-rating">
              {RATING_VALUES.map((value) => (
                <Chip
                  key={value}
                  label={String(value)}
                  active={rating === value}
                  onPress={() => {
                    if (busy) return;
                    setRating(rating === value ? null : value);
                    if (error !== null) setError(null);
                  }}
                  testID={`activity-log-rating-${value}`}
                />
              ))}
            </View>

            {error !== null ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                testID="activity-log-composer-error"
              >
                {error}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <PrimaryButton
                label={busy ? 'Logging\u2026' : 'Log it'}
                icon="checkmark-circle-outline"
                onPress={() => {
                  setError(null);
                  logMutation.mutate();
                }}
                disabled={busy || experience === null}
                testID="activity-log-submit"
                style={styles.flexBtn}
              />
              <SecondaryButton
                label="Cancel"
                onPress={closeAndReset}
                disabled={busy}
                testID="activity-log-cancel"
                style={styles.flexBtn}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Avatar — initials in a color derived from the actor's name
// ---------------------------------------------------------------------------

function Avatar({ name }: { readonly name: string }): JSX.Element {
  const initials = initialsOf(name);
  const bg = AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length]!;
  return (
    <View style={[styles.avatar, { backgroundColor: bg }]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Shared compact header for every state of the Trip_Activity screen. */
function ActivityHeader({
  onBack,
  onLog,
}: {
  readonly onBack: () => void;
  readonly onLog: () => void;
}): JSX.Element {
  return (
    <GradientHeader
      title="Trip Activity"
      subtitle="Log what you did and follow the group."
      icon="megaphone"
      compact
      onBack={onBack}
      right={
        <PrimaryButton
          label="Log"
          icon="add-outline"
          onPress={onLog}
          testID="trip-activity-log-open"
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO-8601 timestamp for display; falls back to the raw value. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Compact "time ago" for the feed: "just now", "5m", "2h", "3d" for recent
 * events, then an absolute date once older than a week.
 */
function formatRelativeTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatTimestamp(iso);
}

/** Read a string field from a feed item's `metadata`, or `null` when absent. */
function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read a finite number field from a feed item's `metadata`, or `null`. */
function readNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read the rode-with tag list folded into a completion item's `metadata`. */
function readRodeWith(metadata: Record<string, unknown>): readonly FeedRodeWith[] {
  const value = metadata.rodeWith;
  if (!Array.isArray(value)) return [];
  const out: FeedRodeWith[] = [];
  for (const entry of value) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { taggedMemberId?: unknown }).taggedMemberId === 'string' &&
      typeof (entry as { displayName?: unknown }).displayName === 'string' &&
      typeof (entry as { state?: unknown }).state === 'string'
    ) {
      out.push(entry as FeedRodeWith);
    }
  }
  return out;
}

/** Up-to-two-letter initials from a display name, uppercased. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable non-negative hash of a string, for picking an avatar color. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Convert a `#rrggbb` hex to an `rgba()` string at the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Map a read error to user-facing copy (non-disclosure, R15.2). */
function readErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map a reaction/comment action error to user-facing copy. */
function actionErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'trip_validation_failed':
      return 'Please enter a comment between 1 and 2000 characters.';
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map a log-entry error to user-facing copy. */
function logErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_validation_failed':
      return 'Please enter a valid Experience and check your tags and rating.';
    case 'rating_out_of_range':
      return 'Please choose a rating from 1 to 10.';
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  listHeader: {
    gap: theme.spacing.md,
  },
  logBtn: {
    alignSelf: 'stretch',
  },
  filterRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  itemCard: {
    gap: theme.spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.color.textOnPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  itemIdentity: {
    flex: 1,
    gap: 2,
  },
  itemActorLine: {
    flexShrink: 1,
  },
  itemActor: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  itemAction: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  itemMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  typeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  experiencePill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  experienceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surface,
  },
  experienceText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  experienceName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  experienceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(246, 195, 67, 0.18)',
  },
  ratingText: {
    ...theme.typography.meta,
    color: theme.color.accentDark,
  },
  rodeWithChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    maxWidth: '100%',
  },
  tagChipText: {
    ...theme.typography.meta,
    flexShrink: 1,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  reactionText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
  divider: {
    height: 1,
    backgroundColor: theme.color.border,
  },
  commentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  commentActionText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  comments: {
    gap: theme.spacing.sm,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  commentContent: {
    flex: 1,
    gap: 2,
  },
  commentAuthorLine: {
    flexShrink: 1,
  },
  commentAuthor: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
  },
  commentTime: {
    ...theme.typography.meta,
    fontWeight: '400',
    color: theme.color.textSecondary,
  },
  commentBody: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
    minHeight: 44,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  composerSend: {
    padding: theme.spacing.sm,
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
  },
  itemBusy: {
    alignSelf: 'flex-start',
  },
  // Log composer modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    ...theme.shadow.floating,
  },
  modalScroll: {
    gap: theme.spacing.sm,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  modalTitle: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  modalClose: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.sm,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.sm,
  },
  helper: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  selectedText: {
    flexShrink: 1,
    flexGrow: 1,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  selectedName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
