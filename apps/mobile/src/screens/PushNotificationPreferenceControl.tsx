// Feature: social-sharing-loop, Task 19.1 — push notification preference control
//
// Validates: Requirements 9.3, 9.6, 9.8
//
// Behavior summary:
//   - R9.3: reads the User's push notification preference from
//     `GET /me/notification-preferences` (defaulting to enabled when the User
//     has never set it) and renders a toggle that lets the User enable or
//     disable all push notifications (Share deliveries and friend requests).
//     Flipping the toggle persists the new value with
//     `PUT /me/notification-preferences`.
//   - R9.6: the operating-system Notification_Permission can be revoked outside
//     the App (in system settings) at any time. This control checks the OS
//     permission on mount and again every time the App next becomes active
//     (foreground) via `AppState`. When the permission is not granted, the
//     control renders an "unavailable until permission re-granted" state and
//     disables the toggle regardless of the stored preference value.
//   - R9.8: when the API cannot persist a preference change, the control
//     retains the previously persisted value (the cache is never mutated
//     optimistically) and surfaces a message that the change did not save.
//
// Styling: uses the shared "Magical / Whimsical" theme tokens and React
// Native's `Switch`, matching the self-mode Profile controls.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Switch,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { NotificationPreferenceDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import { loadNotifications } from '../env/notifications';
import { theme } from '../theme/theme';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const TITLE = 'Push notifications';
const DESCRIPTION =
  'Get a push notification when a friend shares with you or sends you a friend request.';
const PERSIST_FAILED_MESSAGE =
  "We couldn't save that change. Your notification preference is unchanged.";
const LOAD_FAILED_MESSAGE = "We couldn't load your notification preference.";
// R9.6: shown when the OS permission has been revoked, regardless of the
// stored preference value.
const PERMISSION_REVOKED_MESSAGE =
  'Notifications are turned off for this app in your device settings. Re-enable them there to receive notifications.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Self-contained push notification preference control for the signed-in user.
 * Owns its own preference read, OS-permission gate, and persistence mutation so
 * the parent `ProfileScreen` only has to render
 * `<PushNotificationPreferenceControl />` in its self-mode block.
 */
export default function PushNotificationPreferenceControl(): JSX.Element {
  const queryClient = useQueryClient();

  // R9.3 / R9.7: read the stored preference. The server returns the default
  // (`enabled`) when the User has never set it, so no client-side default is
  // required — but we still guard the render with `?? true`.
  const preferenceQuery = useQuery<NotificationPreferenceDTO, ApiError>({
    queryKey: ['notificationPreference'],
    queryFn: () =>
      apiRequest<NotificationPreferenceDTO>(
        'GET',
        '/me/notification-preferences',
      ),
  });

  // R9.6: OS-level permission gate. `null` = not yet determined; we only treat
  // the control as unavailable once we have positively observed `granted:
  // false`, so a transient permission-read failure never hides the control.
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkPermission = async (): Promise<void> => {
      // In Expo Go (SDK 53+) remote push is unsupported and loading
      // expo-notifications would crash, so there is no OS permission to gate
      // on — leave the control in its normal (stored-preference) state.
      const notifications = loadNotifications();
      if (notifications === null) {
        return;
      }
      try {
        const settings = await notifications.getPermissionsAsync();
        if (!cancelled) {
          setPermissionGranted(settings.granted === true);
        }
      } catch {
        // Leave the last known value in place on a read failure rather than
        // flipping the control into the unavailable state on a transient error.
        if (!cancelled) {
          setPermissionGranted((prev) => prev);
        }
      }
    };

    // Initial check when the control mounts.
    void checkPermission();

    // R9.6: re-check every time the App next becomes active (foreground) so a
    // permission revoked while the App was backgrounded is reflected on return.
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          void checkPermission();
        }
      },
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const setPreferenceMutation = useMutation<
    NotificationPreferenceDTO,
    ApiError,
    boolean
  >({
    mutationFn: (enabled) =>
      apiRequest<NotificationPreferenceDTO>(
        'PUT',
        '/me/notification-preferences',
        { pushNotificationsEnabled: enabled },
      ),
    onSuccess: (updated) => {
      // Persist the server-echoed value into the cache so the toggle reflects
      // the stored preference without an extra GET.
      queryClient.setQueryData<NotificationPreferenceDTO>(
        ['notificationPreference'],
        updated,
      );
      setSaveError(null);
    },
    onError: () => {
      // R9.8: the cache was never optimistically mutated, so it still holds the
      // previously persisted value. Surface a message that the change did not
      // save; the Notification_Service sending behavior is unchanged because the
      // persisted value never moved.
      setSaveError(PERSIST_FAILED_MESSAGE);
    },
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (preferenceQuery.isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{TITLE}</Text>
        <View style={styles.loadingRow} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </View>
    );
  }

  if (preferenceQuery.isError || preferenceQuery.data === undefined) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{TITLE}</Text>
        <Text style={styles.message} testID="notification-preference-load-error">
          {LOAD_FAILED_MESSAGE}
        </Text>
      </View>
    );
  }

  const storedEnabled = preferenceQuery.data.pushNotificationsEnabled ?? true;
  // R9.6: once we know the OS permission is revoked, the control is unavailable
  // regardless of the stored value.
  const permissionRevoked = permissionGranted === false;

  // When the permission is revoked the toggle reads as off and is disabled,
  // never reflecting the stored value (R9.6). Otherwise it reflects the stored
  // preference (R9.3).
  const toggleValue = permissionRevoked ? false : storedEnabled;
  const toggleDisabled = permissionRevoked || setPreferenceMutation.isPending;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.textWrap}>
          <Text style={styles.title}>{TITLE}</Text>
          <Text style={styles.description}>{DESCRIPTION}</Text>
        </View>
        <Switch
          value={toggleValue}
          disabled={toggleDisabled}
          onValueChange={(next) => {
            if (saveError !== null) {
              setSaveError(null);
            }
            setPreferenceMutation.mutate(next);
          }}
          trackColor={{
            false: theme.color.border,
            true: theme.color.primary,
          }}
          accessibilityLabel="Push notifications"
          accessibilityState={{
            disabled: toggleDisabled,
            checked: toggleValue,
          }}
          testID="notification-preference-switch"
        />
      </View>

      {permissionRevoked ? (
        <Text
          style={styles.message}
          accessibilityRole="alert"
          testID="notification-preference-permission-revoked"
        >
          {PERMISSION_REVOKED_MESSAGE}
        </Text>
      ) : null}

      {saveError !== null ? (
        <Text
          style={styles.error}
          accessibilityRole="alert"
          testID="notification-preference-save-error"
        >
          {saveError}
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
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  textWrap: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  title: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  description: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  loadingRow: {
    alignItems: 'flex-start',
  },
  message: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  error: {
    color: theme.color.danger,
    fontSize: 14,
  },
});
