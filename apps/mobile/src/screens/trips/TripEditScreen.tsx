// Feature: trips, Task 22 — Trip edit (name, description, dates, resorts)
//
// Validates: Requirements 3.1, 3.4, 3.5, 3.6, 3.8, 21.1, 21.5
//
// Behavior summary:
//   - The edit counterpart to the create modal. Reached from the organizer-only
//     Edit control on the Trip_Detail_View. Reads `GET /trips/:id` (sharing the
//     detail screen's query cache) to pre-fill the form, and `GET /resorts` to
//     populate the "where you stayed" picker.
//   - Submitting sends `PATCH /trips/:id` with the full editable field set —
//     name, description, start/end dates, and `resortIds`. The body is
//     validated client-side by the shared `tripEditSchema` (identical rules to
//     create) before the request. `resortIds` is always sent, so the recorded
//     Resort stay is replaced wholesale with the current selection; clearing it
//     is an empty array (R21.5).
//   - Editing is Organizer-gated server-side (R3.8): a non-organizer / missing
//     Trip collapses to `trip_forbidden`, surfaced as friendly copy. On success
//     the detail and list queries are invalidated so both reflect the edit, and
//     the screen pops back to the hub.
//
// Styling follows the shared "Magical / Whimsical" theme, mirroring
// `TripDetailScreen` and the create modal in `TripsListScreen`.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  tripEditSchema,
  TRIP_RESORT_LIMIT,
  type ResortDTO,
  type TripDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { ResortPicker } from '../../components/ResortPicker';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { tripDetailKeys } from './TripDetailScreen';
import { tripsListKeys } from './TripsListScreen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripEdit'>;

/** Wire shape of `GET /trips/:id`: the Trip being edited. */
type TripDetailResponse = TripDTO;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripEditScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const tripQuery = useQuery<TripDetailResponse, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDetailResponse>('GET', `/trips/${tripId}`),
  });

  // Catalog Resort options for the "where you stayed" picker (R21.1). The field
  // is optional, so a failed/empty read simply hides the picker.
  const resortsQuery = useQuery<readonly ResortDTO[], ApiError>({
    queryKey: ['resorts', 'list'],
    queryFn: async () => {
      const res = await apiRequest<{ resorts: readonly ResortDTO[] }>(
        'GET',
        '/resorts',
      );
      return res.resorts;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Draft state, initialized once from the loaded Trip so in-flight edits are
  // never clobbered by a background refetch.
  const [initialized, setInitialized] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftResortIds, setDraftResortIds] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized && tripQuery.data !== undefined) {
      const trip = tripQuery.data;
      setDraftName(trip.name);
      setDraftDescription(trip.description);
      setDraftStart(trip.startDate);
      setDraftEnd(trip.endDate);
      setDraftResortIds(trip.resorts.map((resort) => resort.id));
      setInitialized(true);
    }
  }, [initialized, tripQuery.data]);

  const clearError = (): void => {
    if (formError !== null) setFormError(null);
  };

  const toggleResort = (resortId: string): void => {
    setDraftResortIds((current) => {
      if (current.includes(resortId)) {
        return current.filter((id) => id !== resortId);
      }
      if (current.length >= TRIP_RESORT_LIMIT) {
        return current;
      }
      return [...current, resortId];
    });
    clearError();
  };

  const editMutation = useMutation<TripDTO, ApiError, void>({
    mutationFn: async () => {
      // Validate client-side with the shared edit schema so the form enforces
      // the same Trip_Name/description/date rules as the server. `resortIds` is
      // always sent so the recorded stay is replaced with the current
      // selection (empty clears it, R21.5).
      const parsed = tripEditSchema.safeParse({
        name: draftName,
        description: draftDescription,
        startDate: draftStart.trim(),
        endDate: draftEnd.trim(),
        resortIds: draftResortIds,
      });
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: firstIssueMessage(parsed.error),
          status: 400,
        });
      }
      return apiRequest<TripDTO>('PATCH', `/trips/${tripId}`, parsed.data);
    },
    onSuccess: (updated) => {
      // Keep the detail cache warm with the fresh Trip and refresh the list so
      // both surfaces reflect the edit immediately.
      queryClient.setQueryData(tripDetailKeys.detail(tripId), updated);
      void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
      navigation.goBack();
    },
    onError: (err) => {
      setFormError(editErrorMessage(err));
    },
  });

  const busy = editMutation.isPending;

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (tripQuery.isLoading && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Edit Trip"
          icon="create"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.center} testID="trip-edit-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Error + Retry (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (tripQuery.isError && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Edit Trip"
          icon="create"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.center} testID="trip-edit-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this trip"
            body={editErrorMessage(tripQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tripQuery.refetch();
            }}
            testID="trip-edit-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const resorts = resortsQuery.data ?? [];

  return (
    <ScreenContainer>
      <GradientHeader
        title="Edit Trip"
        icon="create"
        compact
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="trip-edit-form"
      >
        <Text style={styles.label}>Trip name</Text>
        <TextInput
          value={draftName}
          onChangeText={(value) => {
            setDraftName(value);
            clearError();
          }}
          placeholder="e.g. Spring Break at WDW"
          placeholderTextColor={theme.color.textSecondary}
          maxLength={100}
          editable={!busy}
          style={styles.input}
          accessibilityLabel="Trip name"
          testID="trip-edit-name"
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          value={draftDescription}
          onChangeText={(value) => {
            setDraftDescription(value);
            clearError();
          }}
          placeholder="What's the plan?"
          placeholderTextColor={theme.color.textSecondary}
          multiline
          maxLength={2000}
          editable={!busy}
          style={[styles.input, styles.inputMultiline]}
          accessibilityLabel="Trip description"
          testID="trip-edit-description"
        />

        <Text style={styles.label}>Start date</Text>
        <DatePickerField
          value={draftStart}
          onChange={(value) => {
            setDraftStart(value);
            clearError();
          }}
          placeholder="Select a date"
          disabled={busy}
          accessibilityLabel="Trip start date"
          testID="trip-edit-start"
        />

        <Text style={styles.label}>End date</Text>
        <DatePickerField
          value={draftEnd}
          onChange={(value) => {
            setDraftEnd(value);
            clearError();
          }}
          placeholder="Select a date"
          disabled={busy}
          {...(draftStart.trim().length > 0 ? { minimumDate: draftStart } : {})}
          accessibilityLabel="Trip end date"
          testID="trip-edit-end"
        />

        {resorts.length > 0 ? (
          <>
            <Text style={styles.label}>Where you stayed (optional)</Text>
            <ResortPicker
              resorts={resorts}
              selectedIds={draftResortIds}
              onToggle={toggleResort}
              disabled={busy}
              testIDPrefix="trip-edit"
            />
          </>
        ) : null}

        {formError !== null ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            testID="trip-edit-error-message"
          >
            {formError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={busy ? 'Saving\u2026' : 'Save changes'}
            onPress={() => {
              setFormError(null);
              editMutation.mutate();
            }}
            disabled={busy}
            testID="trip-edit-submit"
            style={styles.flexBtn}
          />
          <SecondaryButton
            label="Cancel"
            onPress={() => navigation.goBack()}
            disabled={busy}
            testID="trip-edit-cancel"
            style={styles.flexBtn}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Surface the first Zod issue message, falling back to a generic one. */
function firstIssueMessage(error: {
  readonly issues: readonly { readonly message: string }[];
}): string {
  const first = error.issues[0]?.message;
  if (first === undefined || first === 'trip_validation_failed') {
    return 'Please check the trip name and dates and try again.';
  }
  return first;
}

/** Map an API/validation error to user-facing copy for the edit form. */
function editErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available, or you can no longer edit it.';
    case 'trip_validation_failed':
      return err.message.length > 0
        ? err.message
        : 'Please check the trip name and dates and try again.';
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
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.typography.body,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surface,
  },
  inputMultiline: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  error: {
    ...theme.typography.meta,
    color: theme.color.danger,
    marginTop: theme.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  flexBtn: {
    flex: 1,
  },
});
