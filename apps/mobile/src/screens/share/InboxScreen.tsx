/**
 * InboxScreen — Share inbox (task 18.3).
 *
 * Renders the recipient's Share inbox per the design's Sharing_Service
 * routes:
 *
 *   GET    /me/inbox                 → { unread, items[] }
 *   POST   /me/inbox/:shareId/open   → mark opened, return full payload
 *   DELETE /me/inbox/:shareId        → recipient-side soft delete
 *
 * The route layer's `listInbox` projection (see
 * `apps/api/src/services/sharing/repo.ts`) is the privacy boundary:
 * unopened entries return ONLY `{ shareId, isOpened: false }` on the
 * wire; opened entries also include `senderId, payloadKind, payload,
 * sentAt`. This screen mirrors that disclosure rule on the render side
 * — even if a future server change starts including extra fields for
 * unopened items, this component will not surface them.
 *
 * Behaviors and acceptance criteria covered here:
 *
 *   - **Unopened disclosure (R9.8).** Each unopened entry renders a
 *     single neutral row "Unopened share" with a tap affordance to
 *     open it. The screen header shows the unread count, computed from
 *     the items whose `isOpened === false` (and cross-checked against
 *     the server's `unread` field for defense in depth).
 *
 *   - **Open reveal (R9.9).** Tapping an unopened row fires the open
 *     mutation. On success, react-query invalidates the inbox list, the
 *     new fetch returns the full `senderId / payload / sentAt`, and the
 *     row re-renders with sender, content summary, and the timestamp.
 *     A subsequent tap on an already-opened row is a no-op.
 *
 *   - **Recipient delete (R9.10).** Long-press (or tap "Delete") on any
 *     row prompts an `Alert.alert` confirmation. On confirm, fires the
 *     delete mutation, which only removes the row from this user's
 *     inbox (the sender's `shares` row is untouched, per the repo).
 *     The list is invalidated on success so the row disappears.
 *
 *   - **Sender display.** The inbox API returns `senderId` only; we
 *     fetch the sender's `ProfileDTO` lazily via a per-sender query so
 *     the UI surfaces `displayName` rather than a raw uuid. The
 *     react-query cache deduplicates lookups across rows — opening
 *     three Shares from the same friend results in one HTTP fetch.
 *
 * Styling: uses the shared "Magical / Whimsical" theme — a gradient
 * hero header showing the unread count as a `Badge`, rows as `Card`s,
 * a calm `EmptyState` for the empty inbox, and themed open / delete
 * actions. See `theme/theme.ts` and `theme/components.tsx`.
 *
 * Validates: Requirements R9.8, R9.9, R9.10
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
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
  type ProfileDTO,
  type SharePayload,
  type SharePayloadKind,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * One row of `GET /me/inbox`. Mirrors `InboxItem` from
 * `apps/api/src/services/sharing/repo.ts`. Unopened rows surface only
 * `shareId` and `isOpened: false`; opened rows additionally surface
 * `senderId`, `payloadKind`, `payload`, and `sentAt`.
 */
interface InboxItem {
  readonly shareId: string;
  readonly isOpened: boolean;
  readonly senderId?: string;
  readonly payloadKind?: SharePayloadKind;
  readonly payload?: SharePayload;
  readonly sentAt?: string;
}

interface InboxResponse {
  readonly unread: number;
  readonly items: ReadonlyArray<InboxItem>;
}

/**
 * Response from `POST /me/inbox/:shareId/open`. Mirrors
 * `OpenedShareDetail` in the repo. We use it solely as a trigger to
 * invalidate the list query — the list is the source of truth for
 * what gets rendered.
 */
interface OpenedShareDetail {
  readonly shareId: string;
  readonly senderId: string;
  readonly payloadKind: SharePayloadKind;
  readonly payload: SharePayload;
  readonly sentAt: string;
}

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const INBOX_QUERY_KEY = ['inbox'] as const;

/**
 * Format an ISO-8601 timestamp into a human-readable local string. We
 * keep this dependency-free (no `date-fns` etc.) per the task brief
 * which forbids new deps; `toLocaleString` honors the device locale.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Render a category enum literal (e.g. `Character_Meet`) as user-facing
 * text by replacing underscores with spaces.
 */
function formatCategory(category: ExperienceCategory): string {
  return category.replace(/_/g, ' ');
}

/**
 * Compose a one-line summary of the share payload for the row body.
 * Detailed payload rendering (full per-Park / per-category breakdown,
 * embedded experience metadata) is intentionally out of scope for this
 * task — opening the share to see the summary satisfies R9.9, and a
 * dedicated detail view can be added later without touching this file.
 */
function summarizePayload(payload: SharePayload): string {
  if (payload.kind === 'experience') {
    const parts: string[] = ['Experience share'];
    if (typeof payload.rating === 'number') {
      parts.push(`rating ${payload.rating}/10`);
    } else if (payload.ratingUnavailable === true) {
      parts.push('rating unavailable');
    }
    if (typeof payload.note === 'string' && payload.note.length > 0) {
      // Inline a short preview; the full note is shown beneath the row
      // header by `renderPayloadBody` below.
      const preview = payload.note.length > 60
        ? `${payload.note.slice(0, 60)}\u2026`
        : payload.note;
      parts.push(`note: ${preview}`);
    }
    return parts.join(' \u00b7 ');
  }
  // progress
  return `Progress share \u00b7 overall ${payload.overallPercent.toFixed(1)}%`;
}

/**
 * Render the body block for an opened share — additional rows of detail
 * below the one-line summary so the recipient can read the share
 * without leaving the inbox.
 */
function renderPayloadBody(payload: SharePayload): JSX.Element {
  if (payload.kind === 'experience') {
    return (
      <View>
        <Text style={styles.bodyLine}>
          Experience id: {payload.experienceId}
        </Text>
        {typeof payload.note === 'string' && payload.note.length > 0 && (
          <Text style={styles.bodyLine}>Note: {payload.note}</Text>
        )}
      </View>
    );
  }
  // progress: list each Park / category percentage in stable enum order so
  // the layout is predictable across renders (R3.6, R3.7 — empty
  // dimensions are still listed with no value).
  return (
    <View>
      <Text style={styles.bodyLine}>
        Overall: {payload.overallPercent.toFixed(1)}%
      </Text>
      {PARKS.map((park: Park) => {
        const v = payload.perParkPercent[park];
        if (typeof v !== 'number') return null;
        return (
          <Text key={park} style={styles.bodyLine}>
            {park}: {v.toFixed(1)}%
          </Text>
        );
      })}
      {EXPERIENCE_CATEGORIES.map((cat: ExperienceCategory) => {
        const v = payload.perCategoryPercent[cat];
        if (typeof v !== 'number') return null;
        return (
          <Text key={cat} style={styles.bodyLine}>
            {formatCategory(cat)}: {v.toFixed(1)}%
          </Text>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sender name lookup
// ---------------------------------------------------------------------------

/**
 * Resolve a `senderId` to a `displayName` via the Profile route
 * (`GET /users/:userId/profile`). The query is keyed by sender id so
 * react-query naturally deduplicates lookups across rows: if the same
 * friend sent five Shares, the Profile is fetched once.
 *
 * On any failure (including `profile_forbidden`) we fall back to the
 * raw `senderId`. R7.8 forbids retrying on the deny path; we suppress
 * react-query retries here for the same reason as the Profile screen.
 */
function SenderName(props: { senderId: string }): JSX.Element {
  const { senderId } = props;
  const profileQuery = useQuery<ProfileDTO, ApiError>({
    queryKey: ['profile', senderId],
    queryFn: () =>
      apiRequest<ProfileDTO>(
        'GET',
        `/users/${encodeURIComponent(senderId)}/profile`,
      ),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const name = profileQuery.data?.displayName ?? senderId;
  return <Text style={styles.sender}>{name}</Text>;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const ERROR_COPY = 'Couldn\u2019t load your inbox. Please try again later.';
const EMPTY_COPY = 'Your inbox is empty.';

export default function InboxScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const navigation = useNavigation();

  // -------------------------------------------------------------------------
  // List query
  // -------------------------------------------------------------------------

  const inboxQuery = useQuery<InboxResponse, ApiError>({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => apiRequest<InboxResponse>('GET', '/me/inbox'),
  });

  // -------------------------------------------------------------------------
  // Open mutation (R9.9)
  // -------------------------------------------------------------------------
  // We invalidate the list on success so the next render reflects the
  // server-side projection (which now includes sender / content /
  // sentAt for the just-opened row). Optimistically updating the local
  // cache instead would require synthesizing the same fields the server
  // computes (ordering, unread count) — invalidation is cheaper and
  // keeps a single source of truth.

  const openMutation = useMutation<OpenedShareDetail, ApiError, string>({
    mutationFn: (shareId: string) =>
      apiRequest<OpenedShareDetail>(
        'POST',
        `/me/inbox/${encodeURIComponent(shareId)}/open`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    },
    // No automatic retries: opening is a state-changing mutation, and a
    // silent retry on a transient failure could double-open if the
    // server processed the first request. The user can tap again.
    retry: false,
  });

  // -------------------------------------------------------------------------
  // Delete mutation (R9.10)
  // -------------------------------------------------------------------------

  const deleteMutation = useMutation<null, ApiError, string>({
    mutationFn: (shareId: string) =>
      apiRequest<null>(
        'DELETE',
        `/me/inbox/${encodeURIComponent(shareId)}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    },
    retry: false,
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleOpen = (item: InboxItem): void => {
    if (item.isOpened) return;
    openMutation.mutate(item.shareId);
  };

  const handleDelete = (item: InboxItem): void => {
    // R9.10: confirm before destroying. The destroy is local to this
    // recipient — we communicate that in the prompt body so the user
    // does not assume it un-sends the share.
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
  // Render
  // -------------------------------------------------------------------------

  if (inboxQuery.isLoading) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Inbox"
          icon="mail"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.centerWrap}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (inboxQuery.isError || inboxQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Inbox"
          icon="mail"
          onBack={() => navigation.goBack()}
        />
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
  // Cross-check: prefer the server's `unread` field but fall back to a
  // local recount if it ever drifts. Both should agree under R9.8.
  const localUnread = items.reduce(
    (acc, item) => (item.isOpened ? acc : acc + 1),
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
            onOpen={() => handleOpen(item)}
            onDelete={() => handleDelete(item)}
            isOpening={
              openMutation.isPending &&
              openMutation.variables === item.shareId
            }
            isDeleting={
              deleteMutation.isPending &&
              deleteMutation.variables === item.shareId
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
 * Single inbox row.
 *
 * The row is the disclosure boundary in the UI: when `item.isOpened`
 * is `false`, only the generic "Unopened share" label and a Delete
 * affordance are rendered — the props themselves do not carry sender
 * / payload / sentAt for unopened items per the wire contract, so the
 * component cannot accidentally surface them (R9.8). When opened, the
 * row renders sender displayName, payload summary + body, and the
 * timestamp (R9.9).
 */
function InboxRow(props: {
  item: InboxItem;
  onOpen: () => void;
  onDelete: () => void;
  isOpening: boolean;
  isDeleting: boolean;
}): JSX.Element {
  const { item, onOpen, onDelete, isOpening, isDeleting } = props;

  if (!item.isOpened) {
    return (
      <Card
        {...(isOpening ? {} : { onPress: onOpen })}
        accentColor={theme.color.accent}
        style={styles.row}
      >
        <View style={styles.rowInner}>
          <View style={styles.unopenedMain}>
            <Ionicons
              name="ellipse"
              size={10}
              color={theme.color.accent}
              style={styles.unopenedDot}
            />
            <Text style={styles.unopenedLabel}>
              {isOpening ? 'Opening\u2026' : 'Unopened share'}
            </Text>
          </View>
          <SecondaryButton
            label={isDeleting ? '\u2026' : 'Delete'}
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

  // Opened — sender, content, and timestamp must all be present
  // because the wire shape guarantees them when `isOpened === true`.
  // We narrow defensively so a malformed payload still renders
  // something rather than crashing.
  const { senderId, payload, sentAt } = item;
  return (
    <Card accentColor={theme.color.primary} style={styles.row}>
      <View style={styles.openedTopRow}>
        <View style={styles.openedMain}>
          <View style={styles.openedHeader}>
            {senderId !== undefined && <SenderName senderId={senderId} />}
            {sentAt !== undefined && (
              <Text style={styles.timestamp}>{formatTimestamp(sentAt)}</Text>
            )}
          </View>
          {payload !== undefined && (
            <View style={styles.payloadWrap}>
              <Text style={styles.summary}>{summarizePayload(payload)}</Text>
              {renderPayloadBody(payload)}
            </View>
          )}
        </View>
      </View>
      <View style={styles.openedActions}>
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
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  unopenedMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  unopenedDot: {
    marginRight: theme.spacing.sm,
  },
  unopenedLabel: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  openedTopRow: {
    flexDirection: 'row',
  },
  openedMain: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  openedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sender: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  timestamp: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  payloadWrap: {
    gap: 2,
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
  openedActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
