// Feature: disney-world-tracker, Task 17.2 — Rating UI (1..10 picker)
//
// Validates: Requirements R4.1, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8
//
// This component renders the User's own Rating control on the
// Experience detail screen. It owns three observable visual states,
// chosen so the UI itself enforces the 1..10 integer invariant
// (R4.1, R4.7) — the picker only emits whole integers from 1 to 10,
// so `rating_out_of_range` from the server is purely defensive and
// surfaces only if the route layer somehow disagrees with the picker
// (R4.7 "defensive" wording in the task).
//
//   1. No Rating yet (R4.6)
//        → empty-state copy plus a "Rate this experience" button that
//          opens the picker. No Rating value is rendered (R4.6
//          forbids displaying any value when none is recorded).
//
//   2. Picker open (R4.1, R4.3)
//        → a horizontal row of 10 Pressables labelled `1..10`. Tapping
//          one issues `PUT /me/experiences/:id/rating` with that
//          integer value. On success we close the picker and invoke
//          `onMutated()` so the parent refetches the rating query and
//          the community aggregate (R4.1 / R4.3 "observable
//          confirmation within 2 seconds"). When a Rating already
//          exists the corresponding button is highlighted so the
//          User can see what they previously chose, since this is the
//          same picker used for replacement (R4.3).
//
//   3. Rating set (R4.5)
//        → the stored value rendered as `N / 10`, plus a "Change"
//          button (re-opens the picker) and a "Remove" button
//          (`DELETE /me/experiences/:id/rating`, R4.4).
//
// Error mapping (only the codes the route layer can surface here are
// handled; everything else falls through to a generic message so the
// UI never silently drops a server-side rejection):
//
//   - `rating_out_of_range`  → render "Rating must be 1-10" inline.
//                              The picker is supposed to make this
//                              unreachable, so its presence indicates
//                              a defensive last-line check (R4.7).
//   - `rating_not_found`     → on DELETE only: silently treat as
//                              already removed (the row was deleted
//                              by another tab / device since the
//                              detail screen loaded). Trigger
//                              `onMutated()` so the parent reflects
//                              the absent state (R4.8 "no Rating
//                              exists" — from the User's POV the
//                              outcome is identical).
//   - any other ApiError     → render the server message so the User
//                              has feedback, but leave any existing
//                              Rating untouched (R4.7 invariant
//                              "leave any existing Rating ...
//                              unchanged" applies to set; the same
//                              shape is convenient for delete).

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { RatingDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RatingControlProps {
  /** Stable internal Experience id (R1.7). */
  readonly experienceId: string;
  /**
   * The User's currently stored Rating, or `null` when no Rating
   * has been recorded yet. The parent owns the source of truth (it
   * holds the `useQuery` result); this component never caches a
   * value of its own across the prop boundary.
   */
  readonly rating: RatingDTO | null;
  /**
   * Invoked after every successful mutation (set, replace, remove,
   * or a silently-coalesced DELETE on a missing row). The parent
   * uses it to invalidate the rating + aggregate queries so the
   * detail screen reflects the new state.
   */
  readonly onMutated: () => void;
}

/**
 * Shape of `PUT /me/experiences/:id/rating`'s success body. Mirrors
 * the route handler in `apps/api/src/services/tracking/rating/routes.ts`.
 * We don't actually consume any of these fields (the parent refetches
 * via `onMutated`), but having a typed shape keeps the call signature
 * honest and stops `apiRequest`'s default `unknown` return from
 * leaking into the call site.
 */
interface SetRatingResponse {
  readonly experienceId: string;
  readonly value: number;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The 10 valid Rating values. Hard-coded as a literal array rather
 * than generated at render time so the picker rows render in a fixed
 * order across re-renders (the column is touch-target sensitive).
 */
const RATING_VALUES: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RatingControl({
  experienceId,
  rating,
  onMutated,
}: RatingControlProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  // `busy` gates every Pressable while a request is in flight to
  // prevent double-submits (e.g. a fast User tapping two buttons in
  // succession). It is local because the parent's query state
  // describes the *server* state, not the in-flight mutation.
  const [busy, setBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const encodedId = encodeURIComponent(experienceId);

  // ---- mutations -------------------------------------------------------

  async function submitValue(value: number): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await apiRequest<SetRatingResponse>(
        'PUT',
        `/me/experiences/${encodedId}/rating`,
        { value },
      );
      setPickerOpen(false);
      onMutated();
    } catch (err) {
      setErrorMessage(messageForSetError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRemoval(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await apiRequest<null>(
        'DELETE',
        `/me/experiences/${encodedId}/rating`,
      );
      setPickerOpen(false);
      onMutated();
    } catch (err) {
      // R4.8: a DELETE on an already-absent row is the *same outcome*
      // the User asked for. Treat as success and let the parent
      // refetch — without surfacing an error message that would
      // contradict what the User just observed.
      if (err instanceof ApiError && err.code === 'rating_not_found') {
        setPickerOpen(false);
        onMutated();
        return;
      }
      setErrorMessage(messageForRemoveError(err));
    } finally {
      setBusy(false);
    }
  }

  // ---- handlers --------------------------------------------------------

  function openPicker(): void {
    setErrorMessage(null);
    setPickerOpen(true);
  }

  function closePicker(): void {
    setErrorMessage(null);
    setPickerOpen(false);
  }

  // ---- render ----------------------------------------------------------

  // The three branches below are mutually exclusive. The picker takes
  // priority when open so the User always sees the picker they just
  // requested, even if a previous mutation left `rating` populated.
  if (pickerOpen) {
    return (
      <View style={styles.container} testID="rating-control">
        <View style={styles.pickerRow}>
          {RATING_VALUES.map((value) => {
            const selected = rating !== null && rating.value === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${value} out of 10`}
                accessibilityState={{ selected, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  void submitValue(value);
                }}
                style={[
                  styles.pickerButton,
                  selected ? styles.pickerButtonSelected : null,
                ]}
                testID={`rating-pick-${value}`}
              >
                <Text
                  style={[
                    styles.pickerButtonText,
                    selected ? styles.pickerButtonTextSelected : null,
                  ]}
                >
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actionRow}>
          <SecondaryButton
            label="Cancel"
            accessibilityLabel="Cancel rating selection"
            disabled={busy}
            onPress={closePicker}
            testID="rating-cancel"
          />
          {busy ? (
            <ActivityIndicator
              accessibilityLabel="Saving rating"
              color={theme.color.primary}
              testID="rating-busy"
            />
          ) : null}
        </View>
        {errorMessage !== null ? (
          <Text style={styles.errorText} testID="rating-error">
            {errorMessage}
          </Text>
        ) : null}
      </View>
    );
  }

  if (rating !== null) {
    return (
      <View style={styles.container} testID="rating-control">
        <View style={styles.ratingValueRow}>
          <Ionicons name="star" size={20} color={theme.color.accent} />
          <Text style={styles.ratingValue} testID="rating-value">
            {rating.value} / 10
          </Text>
        </View>
        <View style={styles.actionRow}>
          <PrimaryButton
            label="Change"
            icon="create-outline"
            accessibilityLabel="Change rating"
            disabled={busy}
            onPress={openPicker}
            testID="rating-change"
          />
          <SecondaryButton
            label="Remove"
            icon="trash-outline"
            tone="danger"
            accessibilityLabel="Remove rating"
            disabled={busy}
            onPress={() => {
              void submitRemoval();
            }}
            testID="rating-remove"
          />
          {busy ? (
            <ActivityIndicator
              accessibilityLabel="Updating rating"
              color={theme.color.primary}
              testID="rating-busy"
            />
          ) : null}
        </View>
        {errorMessage !== null ? (
          <Text style={styles.errorText} testID="rating-error">
            {errorMessage}
          </Text>
        ) : null}
      </View>
    );
  }

  // No Rating recorded — R4.6 empty state.
  return (
    <View style={styles.container} testID="rating-control">
      <Text style={styles.empty} testID="rating-empty">
        Not rated
      </Text>
      <PrimaryButton
        label="Rate this experience"
        icon="star-outline"
        accessibilityLabel="Rate this experience"
        disabled={busy}
        onPress={openPicker}
        testID="rating-open"
      />
      {errorMessage !== null ? (
        <Text style={styles.errorText} testID="rating-error">
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Translate a `PUT` failure into a user-visible string. Only
 * `rating_out_of_range` has a hand-tuned message (R4.7); every other
 * code falls through to the server-provided message because the
 * route layer is the source of human-readable copy for non-rating
 * specific failures (e.g. validation_failed for malformed bodies).
 *
 * The UI restricts taps to the 1..10 integer set (R4.1), so
 * `rating_out_of_range` here is strictly a defense-in-depth path:
 * the only way to reach it is for the picker and the route layer to
 * disagree, which would be a bug. The hand-tuned message is still
 * worth keeping because it gives the User something actionable
 * instead of a stack-trace-shaped string.
 */
function messageForSetError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rating_out_of_range') {
      return 'Rating must be 1-10';
    }
    return err.message;
  }
  return 'Could not save rating. Please try again.';
}

/**
 * Translate a `DELETE` failure into a user-visible string. The
 * `rating_not_found` code is handled inline at the call site (it
 * coalesces to a successful outcome), so only the residual cases
 * need a message here.
 */
function messageForRemoveError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rating_out_of_range') {
      // Shouldn't happen on DELETE — defensive parity with PUT.
      return 'Rating must be 1-10';
    }
    return err.message;
  }
  return 'Could not remove rating. Please try again.';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pickerButton: {
    minWidth: 40,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  pickerButtonText: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  pickerButtonTextSelected: {
    color: theme.color.textOnPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  ratingValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  ratingValue: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
  },
  empty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
});
