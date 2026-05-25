// Feature: disney-world-tracker, Task 15.2 — Profile view and edit screen
//
// Validates: Requirements R7.1, R7.2, R7.4, R7.6, R7.8
//
// Behavior summary:
//   - Reads `route.params.userId` to decide whose Profile to render. When
//     the param is absent or matches the signed-in user, the screen renders
//     in self-mode: the user can edit their display name and log out. For
//     any other user the screen renders read-only and, on `profile_forbidden`,
//     shows an empty state with no retry / no analytics surface (R7.8).
//   - Self-mode primes the user identity with `GET /me` (so we know our own
//     id without round-tripping the friends list) and then fetches the full
//     `ProfileDTO` (avatar, display name, overall completion percent) from
//     `GET /users/{ownId}/profile` so the same render path is used for self
//     and friend reads (R7.1, R7.4).
//   - Display-name edits are validated client-side via the shared
//     `displayNameSchema`, then submitted with `PATCH /me/profile` which
//     applies the same rule server-side and surfaces `display_name_invalid`
//     when violated (R7.2, R7.6).
//   - Logout calls `POST /auth/logout` and clears the session token so the
//     navigator flips back to the auth stack (R6.10).

import React, { useEffect, useMemo, useState } from 'react';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Image,
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

import {
  displayNameSchema,
  type ProfileDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { MainTabParamList } from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';

// ---------------------------------------------------------------------------
// Route + response shapes
// ---------------------------------------------------------------------------

type ProfileRouteProp = RouteProp<MainTabParamList, 'Profile'>;

/**
 * Shape of `GET /me`. Matches `MeResponseBody` in
 * `apps/api/src/services/auth/routes.ts`. Used only to discover the
 * signed-in user's id so we can fetch the full Profile DTO through the
 * same route the friends UI uses.
 */
interface MeResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: { readonly displayName: string };
}

// Distinct sentinel for "the server denied this read" (`profile_forbidden`).
// We surface it through a discriminated union returned from the query so the
// UI never has to inspect an `ApiError` instance directly — the empty-state
// branch and the success branch both come out of the same `useQuery` result
// (R7.8: no retry surface that would re-emit the read).
type ProfileQueryResult =
  | { readonly kind: 'ok'; readonly profile: ProfileDTO }
  | { readonly kind: 'forbidden' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISPLAY_NAME_INVALID_MESSAGE =
  'Display name must be 1-50 characters with at least one non-whitespace character.';

/**
 * Format the `[0, 100]` overall completion percentage to one decimal place
 * for display (R7.4 + R3.1, R3.8). The server already rounds; we still pin
 * the format here so a server that ever drifts to two decimals does not
 * regress the UI contract.
 */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProfileScreen(): JSX.Element {
  const route = useRoute<ProfileRouteProp>();
  const targetUserIdParam = route.params?.userId;

  const queryClient = useQueryClient();
  const clearToken = useSessionStore((state) => state.clearToken);

  // -------------------------------------------------------------------------
  // Self-mode resolution
  // -------------------------------------------------------------------------
  // To know whether the route param refers to "me" we need our own user id.
  // `GET /me` is cheap, cached by react-query, and is the canonical "who am
  // I" probe (it doubles as a session liveness check on app launch).

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });

  const ownUserId = meQuery.data?.user.id;
  const isSelf =
    targetUserIdParam === undefined ||
    (ownUserId !== undefined && targetUserIdParam === ownUserId);

  // The id used for the full-profile fetch. For self we resolve it from
  // `/me`; for other users we use the route param directly.
  const targetUserId = isSelf ? ownUserId : targetUserIdParam;

  // -------------------------------------------------------------------------
  // Profile fetch (full DTO)
  // -------------------------------------------------------------------------

  const profileQuery = useQuery<ProfileQueryResult, ApiError>({
    // The key is partitioned by target so navigating between "self" and a
    // friend's Profile does not show a stale render of the previous user.
    queryKey: ['profile', targetUserId ?? null],
    enabled: targetUserId !== undefined,
    queryFn: async () => {
      try {
        const profile = await apiRequest<ProfileDTO>(
          'GET',
          `/users/${encodeURIComponent(targetUserId as string)}/profile`,
        );
        return { kind: 'ok' as const, profile };
      } catch (err) {
        if (err instanceof ApiError && err.code === 'profile_forbidden') {
          // R7.8: present a hard-stop empty state. Translating to a value
          // (rather than rethrowing) means react-query treats this as a
          // success and will not surface a retry button via `isError`.
          return { kind: 'forbidden' as const };
        }
        throw err;
      }
    },
    // R7.8: no automatic retries on the forbidden path. We disable retries
    // entirely on this query because the only "errors" worth retrying for
    // a Profile read are network blips, and re-emitting reads silently
    // would be the kind of analytics-adjacent behavior R7.8 forbids when
    // combined with the deny path.
    retry: false,
  });

  // -------------------------------------------------------------------------
  // Display-name editor state (self-only)
  // -------------------------------------------------------------------------

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const currentDisplayName =
    profileQuery.data?.kind === 'ok'
      ? profileQuery.data.profile.displayName
      : undefined;

  // Whenever the persisted display name changes, refresh the draft so that
  // toggling the editor does not show a stale value from a prior session.
  useEffect(() => {
    if (currentDisplayName !== undefined && !isEditing) {
      setDraftName(currentDisplayName);
    }
  }, [currentDisplayName, isEditing]);

  const saveNameMutation = useMutation<ProfileDTO, ApiError, string>({
    mutationFn: (displayName: string) =>
      apiRequest<ProfileDTO>('PATCH', '/me/profile', { displayName }),
    onSuccess: (updated) => {
      // Refresh the cached `ProfileQueryResult` so the view reflects the
      // saved name without an extra GET.
      const next: ProfileQueryResult = { kind: 'ok', profile: updated };
      queryClient.setQueryData<ProfileQueryResult>(
        ['profile', updated.userId],
        next,
      );
      setIsEditing(false);
      setNameError(null);
    },
    onError: (err) => {
      if (err.code === 'display_name_invalid') {
        // R7.6: surface the same inline message regardless of which exact
        // sub-rule (length / whitespace) the server tripped on.
        setNameError(DISPLAY_NAME_INVALID_MESSAGE);
        return;
      }
      setNameError(err.message);
    },
  });

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  const logoutMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiRequest<null>('POST', '/auth/logout');
    },
    onSettled: async () => {
      // Clear the token regardless of whether the server responded with 204
      // or 401 — the client's job is to drop the credential locally so the
      // navigator flips back to the auth stack (R6.10). Drop cached server
      // state too, otherwise `react-query` would happily replay it the
      // next time someone signs in on the same device.
      await clearToken();
      queryClient.clear();
    },
  });

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  // While we are still resolving identity / fetching the profile we show a
  // single spinner. We treat `meQuery` as required for the "is this self?"
  // decision but only when no `userId` param was passed — a friend Profile
  // does not depend on knowing our own id.
  const stillResolvingSelf = isSelf && ownUserId === undefined;
  if (
    (stillResolvingSelf && meQuery.isLoading) ||
    profileQuery.isLoading ||
    profileQuery.fetchStatus === 'fetching' && profileQuery.data === undefined
  ) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  // `/me` failed and we cannot resolve who we are. The api client's 401
  // interceptor will already have routed unauthenticated callers to the
  // auth stack; anything else is a transient error worth surfacing.
  if (stillResolvingSelf && meQuery.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          We couldn&apos;t load your profile. Please try again later.
        </Text>
      </View>
    );
  }

  const result = profileQuery.data;

  // R7.8: when the read is denied, render a terminal empty state. We do
  // not render a retry button — the deny outcome is intentional, and
  // re-issuing the same read would be analytics-adjacent behavior.
  if (result?.kind === 'forbidden') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Profile unavailable</Text>
        <Text style={styles.emptyBody}>
          You don&apos;t have permission to view this profile.
        </Text>
      </View>
    );
  }

  if (result?.kind !== 'ok') {
    // Generic transport / 5xx fallback. Every user-facing error code the
    // Profile read can produce is either handled above (forbidden) or
    // routed through the global 401 path (`unauthorized`).
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          We couldn&apos;t load this profile. Please try again later.
        </Text>
      </View>
    );
  }

  const profile = result.profile;
  return (
    <ProfileContent
      profile={profile}
      isSelf={isSelf}
      isEditing={isEditing}
      draftName={draftName}
      nameError={nameError}
      onStartEdit={() => {
        setDraftName(profile.displayName);
        setNameError(null);
        setIsEditing(true);
      }}
      onCancelEdit={() => {
        setDraftName(profile.displayName);
        setNameError(null);
        setIsEditing(false);
      }}
      onChangeDraft={(value) => {
        setDraftName(value);
        if (nameError !== null) {
          setNameError(null);
        }
      }}
      onSave={() => {
        // Client-side validation against the shared schema (R7.2, R7.6).
        // The server applies the same rule, so the inline error reads
        // identically whether the rejection happens locally or on the
        // server.
        const parsed = displayNameSchema.safeParse(draftName);
        if (!parsed.success) {
          setNameError(DISPLAY_NAME_INVALID_MESSAGE);
          return;
        }
        const normalized = parsed.data;
        if (normalized === profile.displayName) {
          setIsEditing(false);
          setNameError(null);
          return;
        }
        saveNameMutation.mutate(normalized);
      }}
      saving={saveNameMutation.isPending}
      onLogout={() => logoutMutation.mutate()}
      loggingOut={logoutMutation.isPending}
    />
  );
}

// ---------------------------------------------------------------------------
// Stateless presentational shell
// ---------------------------------------------------------------------------

interface ProfileContentProps {
  readonly profile: ProfileDTO;
  readonly isSelf: boolean;
  readonly isEditing: boolean;
  readonly draftName: string;
  readonly nameError: string | null;
  readonly onStartEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onChangeDraft: (value: string) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly onLogout: () => void;
  readonly loggingOut: boolean;
}

function ProfileContent({
  profile,
  isSelf,
  isEditing,
  draftName,
  nameError,
  onStartEdit,
  onCancelEdit,
  onChangeDraft,
  onSave,
  saving,
  onLogout,
  loggingOut,
}: ProfileContentProps): JSX.Element {
  const percentLabel = useMemo(
    () => formatPercent(profile.overallCompletionPercent),
    [profile.overallCompletionPercent],
  );

  return (
    <View style={styles.container}>
      <View style={styles.avatarWrap}>
        {profile.avatarUrl !== null ? (
          <Image
            source={{ uri: profile.avatarUrl }}
            style={styles.avatar}
            accessibilityLabel={`${profile.displayName}'s avatar`}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarPlaceholderText}>
              {profile.displayName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {isSelf && isEditing ? (
        <View style={styles.editor}>
          <TextInput
            value={draftName}
            onChangeText={onChangeDraft}
            placeholder="Display name"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={50}
            editable={!saving}
            style={styles.input}
            accessibilityLabel="Display name"
          />
          {nameError !== null ? (
            <Text style={styles.inlineError} accessibilityRole="alert">
              {nameError}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={onSave}
              disabled={saving}
              style={[styles.button, saving && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onCancelEdit}
              disabled={saving}
              style={[styles.button, styles.buttonSecondary]}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.headerBlock}>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          {isSelf ? (
            <Pressable
              accessibilityRole="button"
              onPress={onStartEdit}
              style={[styles.button, styles.buttonSecondary]}
            >
              <Text style={styles.buttonText}>Edit display name</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.statBlock}>
        <Text style={styles.statLabel}>Overall completion</Text>
        <Text style={styles.statValue}>{percentLabel}</Text>
      </View>

      {isSelf ? (
        <View style={styles.logoutBlock}>
          <Pressable
            accessibilityRole="button"
            onPress={onLogout}
            disabled={loggingOut}
            style={[
              styles.button,
              styles.buttonDanger,
              loggingOut && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {loggingOut ? 'Logging out…' : 'Log out'}
            </Text>
          </Pressable>
        </View>
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
    padding: 24,
    gap: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  avatarWrap: {
    alignItems: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#e5e7eb',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    fontSize: 36,
    fontWeight: '600',
    color: '#374151',
  },
  headerBlock: {
    alignItems: 'center',
    gap: 12,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '600',
  },
  editor: {
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  inlineError: {
    color: '#b91c1c',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  statBlock: {
    alignItems: 'center',
    gap: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  logoutBlock: {
    marginTop: 'auto',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#6b7280',
  },
  buttonDanger: {
    backgroundColor: '#b91c1c',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  errorText: {
    color: '#b91c1c',
    textAlign: 'center',
  },
});
