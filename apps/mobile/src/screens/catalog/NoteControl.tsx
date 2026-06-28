// Feature: disney-world-tracker, Task 17.3 — Note save/edit/delete control
//
// Validates: Requirements R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8,
//            R5.9, R5.10
//
// Behavior summary:
//   - Renders the User's own Note for a single Experience and lets them
//     create, replace, or remove it. The View mode shows the persisted
//     body when one exists (R5.8) or an "Add note" affordance when no
//     Note has been recorded (R5.9). When a Note is present, "Edit" and
//     "Delete" affordances are surfaced; deleting fires the request
//     immediately (R5.6) and falls back to a no-op on `note_not_found`
//     (R5.7) because the parent screen will refetch and the empty state
//     is reachable without a separate confirmation.
//
//   - Edit mode is a multiline TextInput with a `current/2000` counter.
//     The Save handler trims the draft client-side and validates it
//     against the shared `noteInputSchema` so whitespace-only or
//     over-length submissions never leave the device — the server
//     applies the same rule (R5.2, R5.10) and surfaces
//     `note_length_invalid` for any defense-in-depth path that does.
//     PUT covers both "create" (R5.3) and "replace" (R5.4, R5.5)
//     because the server upserts on `(userId, experienceId)`.
//
//   - On any successful mutation we call `onMutated()` so the parent
//     screen can refresh the cached `NoteDTO` (R5.8 / R5.9 render
//     parity). `note_not_found` returned from a Delete is mapped to a
//     silent `onMutated()` rather than an error: the local cache was
//     already stale, the server confirms the row is gone, and the
//     parent's refetch will land on the empty state.
//
// File scope: this control is mounted by `ExperienceDetailScreen` in the
// "Your Note" section. Layout/typography mirrors the existing
// CompletionControls / RatingControl scaffolding so the three sections
// of the detail screen read consistently.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { type NoteDTO, noteInputSchema } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum trimmed length accepted by `noteBodySchema` (R5.2). Mirrored
 * locally so the character counter and the `maxLength` cap on the
 * TextInput don't drift from the validator.
 */
const MAX_NOTE_BODY_LENGTH = 2000;

/**
 * Inline message surfaced when the local schema parse fails *or* the
 * server returns `note_length_invalid`. Both paths share the same copy
 * so the UI reads identically regardless of where the rejection
 * happened.
 */
const NOTE_LENGTH_INVALID_MESSAGE =
  'Note must be 1 to 2000 characters with at least one non-whitespace character';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NoteControlProps {
  /**
   * The Experience the Note belongs to. Used to construct the
   * `/me/experiences/:id/note` URL; the parent encodes it once for the
   * detail fetches but we re-encode here so the component is safe to
   * mount in isolation (e.g. by future Share / Inbox screens).
   */
  readonly experienceId: string;

  /**
   * The current persisted Note for this `(user, experience)` pair, or
   * `null` when no Note exists. The parent owns the fetch and re-passes
   * the value after each `onMutated()` callback so this control stays
   * stateless across saves.
   */
  readonly note: NoteDTO | null;

  /**
   * Called after any successful save or delete (and after the silent
   * `note_not_found` fallback on delete). The parent should invalidate
   * its `experience-note` query so this control re-renders with the
   * fresh value.
   */
  readonly onMutated: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NoteControl({
  experienceId,
  note,
  onMutated,
}: NoteControlProps): JSX.Element {
  const encodedId = encodeURIComponent(experienceId);

  // Local edit state. The control toggles between "view" (showing the
  // persisted body or the "Add note" affordance) and "edit" (multiline
  // TextInput + counter + Save / Cancel buttons). The draft seeds from
  // the persisted body when entering edit mode for an existing Note
  // (R5.4 — the user is editing in place) and from the empty string
  // when adding the first Note (R5.3).
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // If the persisted Note changes from underneath us (e.g. a parent
  // refresh while we're in view mode), reset the buffered draft so a
  // subsequent "Edit" press doesn't show a value from a prior render.
  useEffect(() => {
    if (!isEditing) {
      setDraft(note?.body ?? '');
    }
  }, [note, isEditing]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const saveMutation = useMutation<NoteDTO, ApiError, string>({
    mutationFn: (trimmedBody: string) =>
      apiRequest<NoteDTO>('PUT', `/me/experiences/${encodedId}/note`, {
        body: trimmedBody,
      }),
    onSuccess: () => {
      // Drop the editor and let the parent refetch — we render off the
      // re-supplied `note` prop so we don't need to keep the response
      // around locally.
      setIsEditing(false);
      setDraft('');
      setError(null);
      onMutated();
    },
    onError: (err) => {
      // R5.10 defense-in-depth: client-side trim+length validation
      // already gates the PUT, but a server that produces a stricter
      // signal (e.g. an unusual Unicode trim disagreement) still maps
      // back to the same inline message so the UX is uniform.
      if (err.code === 'note_length_invalid') {
        setError(NOTE_LENGTH_INVALID_MESSAGE);
        return;
      }
      setError(err.message);
    },
  });

  const deleteMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiRequest<null>('DELETE', `/me/experiences/${encodedId}/note`);
    },
    onSuccess: () => {
      setError(null);
      onMutated();
    },
    onError: (err) => {
      // R5.7: a 404 `note_not_found` on delete means the Note was
      // already gone (e.g. another device removed it, or the cache was
      // stale). The user's intent — "make sure no Note is stored" — is
      // satisfied either way, so we silently treat it as a successful
      // removal and nudge the parent to refresh.
      if (err.code === 'note_not_found') {
        setError(null);
        onMutated();
        return;
      }
      setError(err.message);
    },
  });

  const isMutating = saveMutation.isPending || deleteMutation.isPending;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleStartAdd = (): void => {
    setDraft('');
    setError(null);
    setIsEditing(true);
  };

  const handleStartEdit = (): void => {
    setDraft(note?.body ?? '');
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = (): void => {
    setDraft(note?.body ?? '');
    setError(null);
    setIsEditing(false);
  };

  const handleChangeDraft = (next: string): void => {
    setDraft(next);
    if (error !== null) {
      setError(null);
    }
  };

  const handleSave = (): void => {
    // Client-side validation: trim then length-check via the shared
    // schema so the same rule that runs server-side gates the request
    // before bytes hit the wire (R5.2, R5.10). `noteInputSchema` is the
    // PUT body shape `{ body }`, and its `body` field is the trimmed
    // 1..2000 primitive — so `parsed.data.body` is the value we send.
    const parsed = noteInputSchema.safeParse({ body: draft });
    if (!parsed.success) {
      setError(NOTE_LENGTH_INVALID_MESSAGE);
      return;
    }
    saveMutation.mutate(parsed.data.body);
  };

  const handleDelete = (): void => {
    setError(null);
    deleteMutation.mutate();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isEditing) {
    // The counter reflects the *current* (un-trimmed) draft length so
    // the user sees their input shrink/grow as they type. The validator
    // applies the trim before the bounds check, so a draft of length
    // 2000 with leading whitespace is still accepted as long as the
    // trimmed length is within bounds. We cap input at 2000 chars to
    // keep the counter meaningful and prevent runaway pastes.
    const counter = `${draft.length}/${MAX_NOTE_BODY_LENGTH}`;
    return (
      <View style={styles.editor}>
        <TextInput
          value={draft}
          onChangeText={handleChangeDraft}
          placeholder="Write a note about this experience"
          multiline
          maxLength={MAX_NOTE_BODY_LENGTH}
          editable={!isMutating}
          style={styles.input}
          accessibilityLabel="Note body"
          testID="note-input"
        />
        <View style={styles.counterRow}>
          <Text style={styles.counter} testID="note-counter">
            {counter}
          </Text>
        </View>
        {error !== null ? (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            testID="note-error"
          >
            {error}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          <PrimaryButton
            label="Save"
            loading={saveMutation.isPending}
            onPress={handleSave}
            disabled={isMutating}
            testID="note-save"
            style={styles.flexBtn}
          />
          <SecondaryButton
            label="Cancel"
            onPress={handleCancel}
            disabled={isMutating}
            testID="note-cancel"
            style={styles.flexBtn}
          />
        </View>
      </View>
    );
  }

  // View mode: empty state if no Note (R5.9) or persisted body + edit /
  // delete affordances (R5.8). We show the same inline error slot here
  // so a delete failure (other than the silent `note_not_found` case)
  // is visible without losing the rendered body.
  if (note === null) {
    return (
      <View style={styles.viewer}>
        <Text style={styles.empty} testID="note-empty">
          No note yet
        </Text>
        {error !== null ? (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            testID="note-error"
          >
            {error}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          <PrimaryButton
            label="Add note"
            icon="add-circle-outline"
            onPress={handleStartAdd}
            disabled={isMutating}
            testID="note-add"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.viewer}>
      <Text style={styles.body} testID="note-body">
        {note.body}
      </Text>
      {error !== null ? (
        <Text
          style={styles.errorText}
          accessibilityRole="alert"
          testID="note-error"
        >
          {error}
        </Text>
      ) : null}
      <View style={styles.buttonRow}>
        <SecondaryButton
          label="Edit"
          icon="create-outline"
          onPress={handleStartEdit}
          disabled={isMutating}
          testID="note-edit"
          style={styles.flexBtn}
        />
        <SecondaryButton
          label="Delete"
          icon="trash-outline"
          tone="danger"
          onPress={handleDelete}
          disabled={isMutating}
          testID="note-delete"
          style={styles.flexBtn}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  viewer: {
    gap: theme.spacing.md,
  },
  editor: {
    gap: theme.spacing.sm,
  },
  body: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    lineHeight: 20,
  },
  empty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 14,
    minHeight: 96,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
    textAlignVertical: 'top',
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  counter: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 14,
  },
});
