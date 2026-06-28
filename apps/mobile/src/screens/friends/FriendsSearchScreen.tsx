// Feature: disney-world-tracker, Task 18.1 — Friends search screen
//
// Validates: Requirements R8.1, R8.2, R8.3, R8.7, R8.8, R8.10
//
// Behavior summary:
//   - Drives `GET /users/search?q=...` from a debounced search box.
//   - Forwards 1..100-character queries to the server (R8.1, R8.2). Inputs
//     outside that range surface an inline message before any network call,
//     mirroring the server's `search_query_length_invalid` error.
//   - Each result row offers a "Send request" button that posts to
//     `POST /me/friend-requests` (R8.3). Per-row errors are mapped to
//     friendly messages via `friendsErrorMessage`, covering self-target
//     (R8.8), duplicates (R8.7), and unknown recipient (R8.10).
//   - Successful sends invalidate the `['friends']` cache so when the user
//     navigates back to `FriendsList`, the new outgoing request is visible
//     without a second fetch.
//
// Styling: uses the shared "Magical / Whimsical" theme — a gradient hero
// header, a themed search field matching CatalogScreen, result rows as
// `Card`s with a "Send request" PrimaryButton, and calm muted helper/empty
// states. See `theme/theme.ts` and `theme/components.tsx`.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import { useDebounce } from '../../hooks/useDebounce';
import { theme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { friendsErrorMessage } from './errorMessages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Wire shape for `GET /users/search`. Mirrors the route handler in
 * `apps/api/src/services/friends/routes.ts`, which returns
 * `{ results: FriendSearchHit[] }`.
 */
interface SearchResponse {
  readonly results: readonly UserSearchHit[];
}

interface UserSearchHit {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

interface FriendRequestResponse {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Search query length bounds (R8.1, R8.2). Mirrors `searchQuerySchema` in
 * `packages/shared/src/schemas/primitives.ts` so the client and server
 * agree on the same window.
 */
const SEARCH_MIN_LENGTH = 1;
const SEARCH_MAX_LENGTH = 100;

/**
 * Debounce window for the search input. 250ms keeps the UI responsive
 * while avoiding a per-keystroke fetch storm. Same window used by the
 * Catalog screen.
 */
const SEARCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FriendsSearchScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const debouncedInput = useDebounce(input, SEARCH_DEBOUNCE_MS);

  // Pre-validate the (debounced) query against the same length window the
  // server enforces. The trimmed length is the metric the server uses, so
  // we trim here too — a query that is purely whitespace still fails the
  // min-length check.
  const trimmed = debouncedInput.trim();
  const inputLength = trimmed.length;

  // Status of the input window: `idle` (empty), `valid` (1..100), or
  // `invalid` (>100). The server-side schema rejects 0-length, but we
  // never send an empty query so that branch maps to "idle, hide
  // results".
  const lengthStatus: 'idle' | 'valid' | 'invalid' =
    inputLength === 0
      ? 'idle'
      : inputLength > SEARCH_MAX_LENGTH
      ? 'invalid'
      : 'valid';

  const searchQuery = useQuery<SearchResponse, ApiError>({
    queryKey: ['users-search', trimmed],
    enabled: lengthStatus === 'valid',
    queryFn: () =>
      apiRequest<SearchResponse>(
        'GET',
        `/users/search?q=${encodeURIComponent(trimmed)}`,
      ),
    // Search results expire quickly: a fresh fetch is cheap and a stale
    // result risks showing users who have since been removed.
    staleTime: 30 * 1000,
    retry: false,
  });

  // Per-row error and per-row "request sent" success markers, both keyed
  // by the result row's user id. Successes survive across re-renders so
  // a user who sends a request to multiple people in a row can see each
  // confirmation persist until they retype.
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [sentTo, setSentTo] = useState<Readonly<Record<string, true>>>({});

  // Reset row state whenever the active query changes — stale "sent"
  // markers from a previous search should not bleed into a new result
  // set.
  useEffect(() => {
    setRowErrors({});
    setSentTo({});
  }, [trimmed]);

  const sendRequestMutation = useMutation<
    FriendRequestResponse,
    ApiError,
    string
  >({
    mutationFn: (recipientId) =>
      apiRequest<FriendRequestResponse>('POST', '/me/friend-requests', {
        recipientId,
      }),
    onSuccess: (_data, recipientId) => {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[recipientId];
        return next;
      });
      setSentTo((prev) => ({ ...prev, [recipientId]: true }));
      // Refresh the friends list cache so the outgoing request shows up
      // when the user navigates back to FriendsList.
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (err, recipientId) => {
      setRowErrors((prev) => ({
        ...prev,
        [recipientId]: friendsErrorMessage(err),
      }));
    },
  });

  const inlineLengthError = useMemo<string | null>(() => {
    if (lengthStatus === 'invalid') {
      return `Search must be ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters.`;
    }
    return null;
  }, [lengthStatus]);

  const showResultsArea = lengthStatus === 'valid';
  const isLoading =
    showResultsArea &&
    searchQuery.isLoading &&
    searchQuery.data === undefined;
  const isError =
    showResultsArea && searchQuery.isError && searchQuery.data === undefined;
  const results = searchQuery.data?.results ?? [];
  const showEmpty =
    showResultsArea &&
    !isLoading &&
    !isError &&
    results.length === 0 &&
    searchQuery.fetchStatus !== 'fetching';

  return (
    <ScreenContainer>
      <GradientHeader title="Find Friends" icon="search" />

      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <Ionicons
            name="search"
            size={18}
            color={theme.color.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Search by name or email"
            placeholderTextColor={theme.color.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxLength={SEARCH_MAX_LENGTH}
            accessibilityLabel="Search for friends"
            style={styles.searchInput}
            testID="friends-search-input"
          />
        </View>
        {inlineLengthError !== null ? (
          <Text style={styles.inlineError} accessibilityRole="alert">
            {inlineLengthError}
          </Text>
        ) : null}
      </View>

      {lengthStatus === 'idle' ? (
        <View style={styles.center} testID="friends-search-idle">
          <EmptyState
            icon="people-outline"
            title="Find your friends"
            body="Type a name or email to search."
          />
        </View>
      ) : isLoading ? (
        <View style={styles.center} testID="friends-search-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <EmptyState
            icon="alert-circle-outline"
            title="Search failed"
            body={friendsErrorMessage(searchQuery.error)}
          />
        </View>
      ) : showEmpty ? (
        <View style={styles.center} testID="friends-search-empty">
          <EmptyState
            icon="search-outline"
            title="No matching users"
            body="Try a different name or email."
          />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const inFlight =
              sendRequestMutation.isPending &&
              sendRequestMutation.variables === item.id;
            return (
              <ResultRow
                hit={item}
                busy={inFlight}
                sent={sentTo[item.id] === true}
                error={rowErrors[item.id] ?? null}
                onSend={() => {
                  setRowErrors((prev) => {
                    const next = { ...prev };
                    delete next[item.id];
                    return next;
                  });
                  sendRequestMutation.mutate(item.id);
                }}
              />
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

interface ResultRowProps {
  readonly hit: UserSearchHit;
  readonly busy: boolean;
  readonly sent: boolean;
  readonly error: string | null;
  readonly onSend: () => void;
}

function ResultRow({
  hit,
  busy,
  sent,
  error,
  onSend,
}: ResultRowProps): JSX.Element {
  return (
    <Card style={styles.row} testID={`friends-search-row-${hit.id}`}>
      <View style={styles.rowMain}>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{hit.displayName}</Text>
          <Text style={styles.rowMeta}>{hit.email}</Text>
        </View>
        <PrimaryButton
          label={sent ? 'Sent' : busy ? 'Sending\u2026' : 'Send request'}
          icon={sent ? 'checkmark-outline' : 'person-add-outline'}
          onPress={onSend}
          disabled={busy || sent}
          loading={busy}
          testID={`friends-send-${hit.id}`}
        />
      </View>
      {error !== null ? (
        <Text style={styles.rowError} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    marginTop: -theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  searchIcon: {
    marginRight: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  inlineError: {
    color: theme.color.danger,
    fontSize: 13,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  rowText: {
    flexShrink: 1,
    gap: 2,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rowMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  rowError: {
    ...theme.typography.meta,
    color: theme.color.danger,
  },
});
