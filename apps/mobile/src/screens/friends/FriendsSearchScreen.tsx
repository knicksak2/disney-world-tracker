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

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import { useDebounce } from '../../hooks/useDebounce';
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
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search by name or email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={SEARCH_MAX_LENGTH}
          accessibilityLabel="Search for friends"
          style={styles.input}
          testID="friends-search-input"
        />
        {inlineLengthError !== null ? (
          <Text style={styles.inlineError} accessibilityRole="alert">
            {inlineLengthError}
          </Text>
        ) : null}
      </View>

      {lengthStatus === 'idle' ? (
        <View style={styles.center} testID="friends-search-idle">
          <Text style={styles.helperText}>
            Type a name or email to find friends.
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.center} testID="friends-search-loading">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Search failed</Text>
          <Text style={styles.errorBody}>
            {friendsErrorMessage(searchQuery.error)}
          </Text>
        </View>
      ) : showEmpty ? (
        <View style={styles.center} testID="friends-search-empty">
          <Text style={styles.helperText}>No matching users.</Text>
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
    </View>
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
    <View style={styles.row} testID={`friends-search-row-${hit.id}`}>
      <View style={styles.rowMain}>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{hit.displayName}</Text>
          <Text style={styles.rowMeta}>{hit.email}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onSend}
          disabled={busy || sent}
          style={[
            styles.button,
            (busy || sent) && styles.buttonDisabled,
          ]}
          testID={`friends-send-${hit.id}`}
        >
          <Text style={styles.buttonText}>
            {sent ? 'Sent' : busy ? 'Sending\u2026' : 'Send request'}
          </Text>
        </Pressable>
      </View>
      {error !== null ? (
        <Text style={styles.rowError} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dddddd',
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  inlineError: {
    color: '#b91c1c',
    fontSize: 13,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  helperText: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222222',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
    gap: 6,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {
    flexShrink: 1,
  },
  rowName: {
    fontSize: 16,
    color: '#111111',
  },
  rowMeta: {
    fontSize: 12,
    color: '#666666',
  },
  rowError: {
    fontSize: 13,
    color: '#b91c1c',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
