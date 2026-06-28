// Feature: disney-world-tracker, Task 17.1 — Completion mark / unmark / edit-date UI
//
// Validates: Requirements R2.1, R2.2, R2.4, R2.5, R2.6, R2.7, R2.8
//
// Behavior summary:
//   - When the User has no Completion for the displayed Experience the
//     control renders a "Mark as visited" button. Tapping it issues
//     `PUT /me/experiences/:id/completion` with `{ completedOn, userTz }`
//     where `completedOn` is "today in the device local TZ" and
//     `userTz` is the IANA identifier reported by `Intl.DateTimeFormat`
//     (R2.1).
//   - When a Completion exists the control shows the stored date and
//     two buttons:
//       * **Edit date** — opens a modal asking for a `YYYY-MM-DD` date
//         and issues `PATCH /me/experiences/:id/completion` (R2.5).
//         The date picker disables future dates client-side: any value
//         strictly after `today_in_local_tz` is rejected before the
//         request leaves the device, matching the server's R2.6 guard.
//       * **Unmark** — confirms with the user, then issues
//         `DELETE /me/experiences/:id/completion` (R2.2). The confirm
//         step exists because unmarking is destructive (R2.7 forbids
//         silent removal of a missing Completion, but a successful
//         removal is also irreversible from the App's perspective).
//   - On every successful mutation the parent's `onMutated` callback
//     fires so the parent can refetch the Completion query and the
//     control re-renders against the fresh DTO.
//
// Error mapping (R2.6, R2.7, R2.8):
//   The server's uniform error envelope drives the inline message. The
//   three Completion-specific codes carry a hand-tuned phrase that
//   matches the Tracking_Service's intent rather than the raw server
//   message — the App owns the user-facing copy.
//     completion_future_date            -> "Completion date can't be in the future"
//     completion_not_found              -> "Completion already removed"
//     completion_combined_op_not_allowed -> "Cannot combine remove and edit"
//   Any other `ApiError` falls back to the server-supplied `message`.
//
// Time-zone strategy:
//   The wire contract sends both `completedOn` and `userTz` because the
//   server applies its R2.6 future-date check against the supplied TZ
//   (see `apps/api/src/services/tracking/completion/routes.ts`). The
//   client uses `Intl.DateTimeFormat().resolvedOptions().timeZone` for
//   the TZ id and the same formatter (with `formatToParts`) to derive
//   the local `YYYY-MM-DD` so the client and server agree on
//   "today_in_user_tz" without bundling a TZ database.
//
// Why a plain `TextInput` modal rather than a native picker:
//   The mobile workspace does not depend on
//   `@react-native-community/datetimepicker` (see
//   `apps/mobile/package.json`); pulling it in is out of scope for
//   17.1. A `YYYY-MM-DD` `TextInput` is sufficient for the spec's "edit
//   date" use case and the future-date constraint is enforced both
//   client-side and server-side. The format requirement is documented
//   inline next to the field so users see exactly what is accepted.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CompletionDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface CompletionControlsProps {
  /**
   * UUID of the Experience this control acts on. Used as the path
   * segment in the three Completion endpoints.
   */
  readonly experienceId: string;

  /**
   * Current Completion record from the parent's react-query state, or
   * `null` when the User has no Completion for this Experience. The
   * control renders a different affordance for each case.
   */
  readonly completion: CompletionDTO | null;

  /**
   * Called after every successful mark / edit / unmark mutation so the
   * parent can refetch the Completion query (and any dependent stats)
   * and pass a fresh `completion` prop.
   */
  readonly onMutated: () => void;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the device's IANA time zone via `Intl`. The resolver is
 * guaranteed to return a non-empty string in modern Node / Hermes
 * runtimes; the empty-string guard is paranoia for very old engines
 * that fall back to `'UTC'` or empty values.
 */
function deviceTimeZone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC';
}

/**
 * Format `now` as a `YYYY-MM-DD` calendar date in `timeZone`. Mirrors
 * the server-side `formatYmdInTimeZone` so client and server agree on
 * "today_in_user_tz" without bundling a TZ database. Uses
 * `formatToParts` because the default `format` output is locale-
 * dependent; locale-independent `{year, month, day}` extraction is the
 * portable shape.
 */
function ymdInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }
  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

/**
 * Strict ISO-8601 calendar-date check. Accepts `YYYY-MM-DD` only and
 * verifies the day actually exists (rejects e.g. `2024-02-30`). The
 * server's `isoDateSchema` performs the same check; doing it on the
 * client first avoids an unnecessary round-trip on obvious typos.
 */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Append `T00:00:00Z` so `Date` parses the value as UTC midnight, then
  // re-format and compare. `Date.parse` is lenient enough to accept some
  // out-of-range days by overflowing into the next month, which the
  // round-trip comparison catches.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, '0');
  const mm = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = parsed.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` === value;
}

/**
 * Translate an `ApiError` from a Completion mutation into the
 * user-facing copy. The three R2.x codes get hand-tuned phrasing per
 * the task spec; everything else falls back to the server-supplied
 * `message` so transient transport failures still surface useful
 * detail.
 */
function completionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'completion_future_date':
        return "Completion date can't be in the future";
      case 'completion_not_found':
        return 'Completion already removed';
      case 'completion_combined_op_not_allowed':
        return 'Cannot combine remove and edit';
      default:
        return err.message.length > 0
          ? err.message
          : 'Could not update completion. Please try again.';
    }
  }
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }
  return 'Could not update completion. Please try again.';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompletionControls({
  experienceId,
  completion,
  onMutated,
}: CompletionControlsProps): JSX.Element {
  // Resolve the encoded id once per render. Re-encoding inside each
  // handler would be free but the variable doubles as a readability
  // anchor for the three endpoints below.
  const encodedId = encodeURIComponent(experienceId);

  // Single in-flight mutation gate. Any of mark / edit / unmark sets
  // `busy` to disable every button at once — concurrent mutations on
  // the same (user, experience) pair would race the server's
  // single-row constraint and produce confusing UI.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit-date modal state. The modal owns its own draft + inline error
  // so the inline error on the main affordance does not flicker every
  // time the user types in the modal.
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorDraft, setEditorDraft] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);

  // `today_in_local_tz` is recomputed on each render so the
  // future-date rule reflects the current wall clock. The ref captures
  // the device TZ once because TZ changes mid-session are vanishingly
  // rare and the value is needed in multiple handlers.
  const userTz = useMemo(() => deviceTimeZone(), []);
  const todayLocal = ymdInTimeZone(new Date(), userTz);

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  async function handleMark(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiRequest<CompletionDTO>(
        'PUT',
        `/me/experiences/${encodedId}/completion`,
        { completedOn: todayLocal, userTz },
      );
      onMutated();
    } catch (err) {
      setError(completionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSubmit(): Promise<void> {
    const draft = editorDraft.trim();

    // Client-side guards mirror the server: structural ISO-8601 first,
    // then the future-date rule (R2.6). Failing here keeps the modal
    // open and shows the inline message right next to the input.
    if (!isValidIsoDate(draft)) {
      setEditorError('Enter a date as YYYY-MM-DD.');
      return;
    }
    if (draft > todayLocal) {
      setEditorError("Completion date can't be in the future");
      return;
    }

    setBusy(true);
    setEditorError(null);
    setError(null);
    try {
      await apiRequest<CompletionDTO>(
        'PATCH',
        `/me/experiences/${encodedId}/completion`,
        { completedOn: draft, userTz },
      );
      setEditorVisible(false);
      onMutated();
    } catch (err) {
      // Server-side rejection: surface in the modal so the user can
      // correct without losing their input. We do not auto-close the
      // modal on error.
      setEditorError(completionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openEditor(): void {
    // Seed the input with the current date so users editing a typo
    // don't have to retype the whole value.
    setEditorDraft(completion?.completedOn ?? todayLocal);
    setEditorError(null);
    setEditorVisible(true);
  }

  function closeEditor(): void {
    if (busy) return;
    setEditorVisible(false);
    setEditorError(null);
  }

  function handleUnmark(): void {
    Alert.alert(
      'Unmark this experience?',
      'This removes your completion record. You can re-mark it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmark',
          style: 'destructive',
          onPress: () => {
            void performUnmark();
          },
        },
      ],
    );
  }

  async function performUnmark(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiRequest<null>(
        'DELETE',
        `/me/experiences/${encodedId}/completion`,
      );
      onMutated();
    } catch (err) {
      setError(completionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <View style={styles.container} testID="completion-controls">
      {completion === null ? (
        // R2.4 — empty state with the affordance to create a Completion.
        <View style={styles.row}>
          <Text style={styles.statusEmpty} testID="completion-empty-status">
            Not visited yet
          </Text>
          <PrimaryButton
            label={busy ? 'Marking\u2026' : 'Mark as visited'}
            icon="checkmark-circle-outline"
            accessibilityLabel="Mark as visited"
            onPress={() => {
              void handleMark();
            }}
            disabled={busy}
            testID="completion-mark-button"
          />
        </View>
      ) : (
        // R2.4 — populated state with edit / remove affordances.
        <View style={styles.populated}>
          <View style={styles.statusFilledRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={theme.color.success}
              style={styles.statusIcon}
            />
            <Text style={styles.statusFilled} testID="completion-date">
              Completed on {completion.completedOn}
            </Text>
          </View>
          <View style={styles.row}>
            <SecondaryButton
              label="Edit date"
              icon="calendar-outline"
              accessibilityLabel="Edit completion date"
              onPress={openEditor}
              disabled={busy}
              testID="completion-edit-button"
              style={styles.flexBtn}
            />
            <SecondaryButton
              label="Unmark"
              icon="close-circle-outline"
              tone="danger"
              accessibilityLabel="Unmark completion"
              onPress={handleUnmark}
              disabled={busy}
              testID="completion-unmark-button"
              style={styles.flexBtn}
            />
          </View>
        </View>
      )}

      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Updating completion"
          color={theme.color.primary}
          style={styles.spinner}
        />
      ) : null}

      {error !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Modal
        visible={editorVisible}
        transparent
        animationType="fade"
        onRequestClose={closeEditor}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="completion-edit-modal">
            <Text style={styles.modalTitle}>Edit completion date</Text>
            <Text style={styles.modalHint}>
              Enter the date you visited (YYYY-MM-DD). Future dates aren&apos;t
              allowed.
            </Text>
            <TextInput
              value={editorDraft}
              onChangeText={(value) => {
                setEditorDraft(value);
                if (editorError !== null) setEditorError(null);
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.color.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              style={styles.input}
              accessibilityLabel="Completion date"
              testID="completion-edit-input"
            />
            <Text style={styles.modalMeta}>Today: {todayLocal}</Text>
            {editorError !== null ? (
              <Text style={styles.error} accessibilityRole="alert">
                {editorError}
              </Text>
            ) : null}
            <View style={styles.row}>
              <PrimaryButton
                label={busy ? 'Saving\u2026' : 'Save'}
                onPress={() => {
                  void handleEditSubmit();
                }}
                disabled={busy}
                testID="completion-edit-submit"
                style={styles.flexBtn}
              />
              <SecondaryButton
                label="Cancel"
                onPress={closeEditor}
                disabled={busy}
                testID="completion-edit-cancel"
                style={styles.flexBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
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
  populated: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  statusEmpty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
    flexGrow: 1,
  },
  statusFilledRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    marginRight: theme.spacing.sm,
  },
  statusFilled: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  spinner: {
    alignSelf: 'flex-start',
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
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
    maxWidth: 400,
    gap: theme.spacing.sm,
    ...theme.shadow.floating,
  },
  modalTitle: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  modalHint: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  modalMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
