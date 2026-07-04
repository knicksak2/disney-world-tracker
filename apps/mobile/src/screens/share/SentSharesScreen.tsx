/**
 * SentSharesScreen — the sender's view of Shares they sent and the reactions
 * their recipients attached (Social Sharing Loop, task 21.2).
 *
 * This is the minimal "Sent Shares" surface the design calls for (design.md →
 * Reaction_Service, "a minimal Sent Shares surface on mobile … lists the
 * User's sent shares and, per share, its reactions with reactor display
 * names"). It is reachable from the Friends page (the "Sent" control) and
 * lives inside `FriendsStack`.
 *
 * Reads:
 *
 *   GET /me/shares                          → SentShareDTO[]  (the caller's sent shares)
 *   GET /me/shares/:shareId/reactions       → ShareReactionDTO[]  (sender-gated, R11.7)
 *
 * Task coverage in this file:
 *
 *   - **21.2 (this task).** Lists the User's sent Shares, most-recent first,
 *     and for each Share its reactions with the reactor's display name (R11.7).
 *     Each Share's reactions are fetched from the sender-gated
 *     `GET /me/shares/:shareId/reactions` endpoint. While a Share's reactions
 *     are being retrieved the row shows a loading indication (R11.9); when a
 *     Share has no reactions it shows an empty-state indication (R11.10); if a
 *     Share's reactions cannot be retrieved it shows an unavailable message
 *     while keeping the remaining Share content visible (R11.11).
 *
 * The reaction UI-state tests are covered by task 21.3; this file only wires
 * the screen.
 *
 * Styling uses the shared "Magical / Whimsical" theme.
 *
 * Validates: Requirements 11.7, 11.9, 11.10, 11.11
 */

import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type ExperienceSharePayload,
  type Park,
  type ProgressSharePayload,
  type SentShareDTO,
  type ShareReactionDTO,
  type ShareReactionValue,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { FriendsStackParamList } from '../../navigation/FriendsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Navigation typing
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<FriendsStackParamList, 'Sent'>;

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

/** Query key for the caller's list of sent Shares (`GET /me/shares`). */
const SENT_SHARES_QUERY_KEY = ['sent-shares'] as const;

/**
 * Query-key factory for one Share's reactions. Keyed by `shareId` so React
 * Query caches and dedupes each Share's reactions independently.
 */
function reactionsQueryKey(shareId: string): readonly [string, string] {
  return ['share-reactions', shareId];
}

const LIST_ERROR_COPY =
  'Couldn\u2019t load the things you\u2019ve shared. Please try again later.';
const LIST_EMPTY_COPY = 'You haven\u2019t shared anything yet.';

/** Empty-state indication shown when a Share has no reactions (R11.10). */
const REACTIONS_EMPTY_COPY = 'No reactions yet.';

/**
 * Shown when a Share's reactions cannot be retrieved; the rest of the Share
 * content stays visible (R11.11).
 */
const REACTIONS_UNAVAILABLE_COPY = 'Reactions are unavailable right now.';

/** Fallback primary label when Experience metadata cannot be resolved. */
const EXPERIENCE_UNAVAILABLE_COPY = 'Experience unavailable';

/**
 * Keep resolved Experience metadata fresh for a short while so the shared
 * `['experience', experienceId]` catalog read is reused across the app.
 */
const METADATA_STALE_MS = 5 * 60 * 1000;

/**
 * User-facing labels for each closed `Reaction_Vocabulary` value. The
 * `like`/`love` glyphs mirror the glossary (👍 / ❤️); `been_there` and
 * `want_to_go` render as plain words. Keyed by the vocabulary value so the
 * labels cannot drift from the enum.
 */
const REACTION_LABELS: Readonly<Record<ShareReactionValue, string>> = {
  like: '\uD83D\uDC4D Like',
  love: '\u2764\uFE0F Love',
  been_there: 'Been there',
  want_to_go: 'Want to go',
};

/**
 * Format an ISO-8601 timestamp into a human-readable local string. Falls back
 * to the raw string if the timestamp cannot be parsed.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Render a category enum literal (e.g. `Character_Meet`) as user-facing text. */
function formatCategory(category: ExperienceCategory): string {
  return category.replace(/_/g, ' ');
}

/** Format a completion percentage to exactly one decimal place. */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SentSharesScreen({ navigation }: Props): JSX.Element {
  const sentQuery = useQuery<SentShareDTO[], ApiError>({
    queryKey: SENT_SHARES_QUERY_KEY,
    queryFn: () => apiRequest<SentShareDTO[]>('GET', '/me/shares'),
  });

  if (sentQuery.isLoading) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Sent"
          icon="paper-plane"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centerWrap}>
          <ActivityIndicator color={theme.color.primary} testID="sent-loading" />
        </View>
      </ScreenContainer>
    );
  }

  if (sentQuery.isError || sentQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Sent"
          icon="paper-plane"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centerWrap}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load your sent shares"
            body={LIST_ERROR_COPY}
            testID="sent-error"
          />
        </View>
      </ScreenContainer>
    );
  }

  const shares = sentQuery.data;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Sent"
        subtitle="See how friends reacted to what you shared."
        icon="paper-plane"
        onBack={() => navigation.goBack()}
      />
      <FlatList
        data={shares}
        keyExtractor={(item) => item.shareId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.centerWrap}>
            <EmptyState
              icon="paper-plane-outline"
              title={LIST_EMPTY_COPY}
              body="Share an experience or your progress to start the conversation."
              testID="sent-empty"
            />
          </View>
        }
        renderItem={({ item }) => <SentShareRow share={item} />}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

/**
 * A single sent Share: its content summary followed by the reactions its
 * recipients attached, each with the reactor's display name (R11.7).
 */
function SentShareRow(props: { share: SentShareDTO }): JSX.Element {
  const { share } = props;
  return (
    <Card style={styles.row} testID={`sent-row-${share.shareId}`}>
      <View style={styles.header}>
        <Text style={styles.timestamp} testID={`sent-timestamp-${share.shareId}`}>
          {formatTimestamp(share.sentAt)}
        </Text>
      </View>

      <ShareContent share={share} />

      <ShareReactions shareId={share.shareId} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payload content (delegated by kind)
// ---------------------------------------------------------------------------

function ShareContent(props: { share: SentShareDTO }): JSX.Element {
  const { payload } = props.share;
  if (payload.kind === 'progress') {
    return <ProgressShareContent payload={payload} shareId={props.share.shareId} />;
  }
  return <ExperienceShareContent payload={payload} shareId={props.share.shareId} />;
}

/**
 * `progress` Share content. Renders the overall completion percentage and each
 * provided per-Park and per-Experience_Category percentage to one decimal
 * place, in stable enum order.
 */
function ProgressShareContent(props: {
  payload: ProgressSharePayload;
  shareId: string;
}): JSX.Element {
  const { payload, shareId } = props;
  return (
    <View style={styles.payloadWrap}>
      <Text style={styles.summary} testID={`sent-progress-overall-${shareId}`}>
        {`Progress \u00b7 Overall: ${formatPercent(payload.overallPercent)}`}
      </Text>
      {PARKS.map((park: Park) => {
        const v = payload.perParkPercent[park];
        if (typeof v !== 'number') return null;
        return (
          <Text key={park} style={styles.bodyLine}>
            {park}: {formatPercent(v)}
          </Text>
        );
      })}
      {EXPERIENCE_CATEGORIES.map((cat: ExperienceCategory) => {
        const v = payload.perCategoryPercent[cat];
        if (typeof v !== 'number') return null;
        return (
          <Text key={cat} style={styles.bodyLine}>
            {formatCategory(cat)}: {formatPercent(v)}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * Minimal shape read from `GET /catalog/:experienceId`. Only the display name
 * is needed for the sent-share summary; typing just this keeps the read
 * tolerant of unrelated response changes.
 */
interface ExperienceMetadata {
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
}

/**
 * `experience` Share content. Resolves the referenced Experience's name from
 * the catalog via the shared `['experience', experienceId]` query key so the
 * summary never shows a raw identifier. While the read is in flight it shows a
 * loading indication; on failure it falls back to an Experience-unavailable
 * label. The reactions below stay visible regardless of this state.
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
    retry: false,
  });

  const meta = metaQuery.data;

  let block: JSX.Element;
  if (meta !== undefined && !metaQuery.isError) {
    block = (
      <>
        <Text style={styles.summary} testID={`sent-experience-name-${shareId}`}>
          {meta.name}
        </Text>
        <Text style={styles.bodyLine}>
          {`${meta.park} \u00b7 ${formatCategory(meta.category)}`}
        </Text>
      </>
    );
  } else if (metaQuery.isError) {
    block = (
      <Text
        style={styles.summary}
        testID={`sent-experience-unavailable-${shareId}`}
      >
        {EXPERIENCE_UNAVAILABLE_COPY}
      </Text>
    );
  } else {
    block = (
      <View style={styles.experienceLoading}>
        <ActivityIndicator
          color={theme.color.primary}
          testID={`sent-experience-loading-${shareId}`}
        />
      </View>
    );
  }

  return <View style={styles.payloadWrap}>{block}</View>;
}

// ---------------------------------------------------------------------------
// Reactions (sender view, R11.7 / R11.9 / R11.10 / R11.11)
// ---------------------------------------------------------------------------

/**
 * Reactions attached to one sent Share, read from the sender-gated
 * `GET /me/shares/:shareId/reactions` (R11.7). Renders exactly one of:
 *
 *   - **Loading (R11.9).** A per-Share loading indication while the read is in
 *     flight.
 *   - **Unavailable (R11.11).** A message when the read fails; the Share's
 *     content above stays visible.
 *   - **Empty (R11.10).** An indication that no reactions exist yet.
 *   - **Resolved (R11.7).** Each reaction with its reactor's display name.
 */
function ShareReactions(props: { shareId: string }): JSX.Element {
  const { shareId } = props;

  const reactionsQuery = useQuery<ShareReactionDTO[], ApiError>({
    queryKey: reactionsQueryKey(shareId),
    queryFn: () =>
      apiRequest<ShareReactionDTO[]>(
        'GET',
        `/me/shares/${encodeURIComponent(shareId)}/reactions`,
      ),
    retry: false,
  });

  if (reactionsQuery.isLoading) {
    // R11.9 — reactions are being retrieved.
    return (
      <View style={styles.reactionsWrap}>
        <ActivityIndicator
          color={theme.color.primary}
          testID={`sent-reactions-loading-${shareId}`}
        />
      </View>
    );
  }

  if (reactionsQuery.isError || reactionsQuery.data === undefined) {
    // R11.11 — reactions cannot be retrieved; keep the Share content visible.
    return (
      <View style={styles.reactionsWrap}>
        <Text
          style={styles.reactionsUnavailable}
          testID={`sent-reactions-unavailable-${shareId}`}
        >
          {REACTIONS_UNAVAILABLE_COPY}
        </Text>
      </View>
    );
  }

  const reactions = reactionsQuery.data;

  if (reactions.length === 0) {
    // R11.10 — no reactions yet.
    return (
      <View style={styles.reactionsWrap}>
        <Text
          style={styles.reactionsEmpty}
          testID={`sent-reactions-empty-${shareId}`}
        >
          {REACTIONS_EMPTY_COPY}
        </Text>
      </View>
    );
  }

  // R11.7 — each reaction with the reactor's display name.
  return (
    <View style={styles.reactionsWrap} testID={`sent-reactions-${shareId}`}>
      {reactions.map((reaction) => (
        <View
          key={reaction.reactorId}
          style={styles.reactionRow}
          testID={`sent-reaction-${shareId}-${reaction.reactorId}`}
        >
          <Text style={styles.reactorName}>{reaction.reactorDisplayName}</Text>
          <Badge
            label={REACTION_LABELS[reaction.reaction]}
            color={theme.color.accent}
          />
        </View>
      ))}
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
  },
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  timestamp: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  payloadWrap: {
    gap: theme.spacing.xs,
  },
  summary: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  bodyLine: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  experienceLoading: {
    paddingVertical: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  reactionsWrap: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    gap: theme.spacing.sm,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  reactorName: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  reactionsEmpty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  reactionsUnavailable: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
});
