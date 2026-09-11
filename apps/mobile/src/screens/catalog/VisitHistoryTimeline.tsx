// Feature: experience-activity-logging, Task 5.2 — collapsible Visit History
//
// Validates: Requirements 6.4 (collapsible timeline of past visit date, rating,
//            and note), 5.1 (delete a log entry)
//
// Renders the caller's Visit_History for one Experience as a collapsible list.
// Collapsed by default; expanding reveals each past visit (date, optional
// rating, optional note) newest-first, with a delete affordance per entry that
// issues `DELETE /me/experiences/:id/logs/:logId` and calls `onDeleted` so the
// parent can refresh the dependent queries.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { ExperienceLogDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface VisitHistoryTimelineProps {
  readonly experienceId: string;
  /** Visit logs newest-first (the server orders visited_on DESC, logged_at DESC). */
  readonly logs: readonly ExperienceLogDTO[];
  /** Invoked after a successful delete so the parent can invalidate queries. */
  readonly onDeleted: () => void;
}

export default function VisitHistoryTimeline({
  experienceId,
  logs,
  onDeleted,
}: VisitHistoryTimelineProps): JSX.Element | null {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const encodedId = encodeURIComponent(experienceId);

  // Nothing to show until at least one visit exists (R6.4 gates the timeline
  // on one-or-more logs).
  if (logs.length === 0) {
    return null;
  }

  async function handleDelete(logId: string): Promise<void> {
    if (deletingId !== null) return;
    setDeletingId(logId);
    setError(null);
    try {
      await apiRequest<null>(
        'DELETE',
        `/me/experiences/${encodedId}/logs/${encodeURIComponent(logId)}`,
      );
      onDeleted();
    } catch (err) {
      // A log already gone (e.g. deleted on another device) is the outcome the
      // user wanted; refresh silently. Anything else surfaces inline.
      if (err instanceof ApiError && err.code === 'log_not_found') {
        onDeleted();
      } else {
        setError(messageForError(err));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <View style={styles.container} testID="visit-history-timeline">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Hide visit history' : 'Show visit history'
        }
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.header}
        testID="visit-history-toggle"
      >
        <Text style={styles.headerText}>
          Visit history ({logs.length})
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.color.textSecondary}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.list}>
          {logs.map((log) => (
            <View
              key={log.id}
              style={styles.item}
              testID={`visit-history-item-${log.id}`}
            >
              <View style={styles.itemMain}>
                <Text style={styles.itemDate}>{log.visitedOn}</Text>
                <View style={styles.itemMetaRow}>
                  <Ionicons
                    name={log.rating === null ? 'star-outline' : 'star'}
                    size={14}
                    color={theme.color.accent}
                  />
                  <Text style={styles.itemRating}>
                    {log.rating === null ? 'Not rated' : `${log.rating} / 10`}
                  </Text>
                </View>
                {log.note !== null && log.note.length > 0 ? (
                  <Text style={styles.itemNote}>{log.note}</Text>
                ) : null}
              </View>
              {deletingId === log.id ? (
                <ActivityIndicator
                  accessibilityLabel="Deleting visit"
                  color={theme.color.primary}
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete visit on ${log.visitedOn}`}
                  accessibilityState={{ disabled: deletingId !== null }}
                  disabled={deletingId !== null}
                  onPress={() => {
                    void handleDelete(log.id);
                  }}
                  style={styles.deleteButton}
                  testID={`visit-history-delete-${log.id}`}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={theme.color.danger}
                  />
                </Pressable>
              )}
            </View>
          ))}
          {error !== null ? (
            <Text style={styles.errorText} testID="visit-history-error">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Could not delete this visit. Please try again.';
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  headerText: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  list: {
    gap: theme.spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  itemMain: {
    flex: 1,
    gap: 2,
  },
  itemDate: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    fontWeight: '600',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  itemRating: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  itemNote: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  deleteButton: {
    padding: theme.spacing.xs,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
});
