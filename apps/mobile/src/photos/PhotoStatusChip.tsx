import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PhotoStatus } from '@dwt/shared';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';

export type DisplayPhotoStatus = PhotoStatus | 'uploading' | 'checking' | 'retry';

export interface PhotoStatusChipProps {
  readonly status: DisplayPhotoStatus;
  readonly rejectMessage?: string | null;
  readonly onRetry?: () => void;
  readonly testID?: string;
}

export function PhotoStatusChip({
  status,
  rejectMessage,
  onRetry,
  testID,
}: PhotoStatusChipProps) {
  const styles = useStyles();
  const t = useAppTheme();

  let label = '';
  let message: string | null = null;
  let messageStyle = styles.message;
  let iconName: keyof typeof Ionicons.glyphMap = 'information-circle-outline';
  let iconColor = t.color.textSecondary;
  let isRetry = false;
  let containerStyle = styles.containerDefault;

  switch (status) {
    case 'uploading':
      label = 'Uploading…';
      iconName = 'cloud-upload-outline';
      iconColor = t.color.primaryFg;
      containerStyle = styles.containerUploading;
      break;

    case 'checking':
      label = 'Checking…';
      iconName = 'sync-outline';
      iconColor = t.color.primaryFg;
      containerStyle = styles.containerChecking;
      break;

    case 'approved':
      label = 'Approved';
      iconName = 'checkmark-circle-outline';
      iconColor = t.color.success;
      containerStyle = styles.containerApproved;
      break;

    case 'rejected':
      // The short label stays in the pill; the reason renders below it as its
      // own wrapping line so a narrow card never truncates the actionable text.
      label = 'Rejected';
      message = rejectMessage ? rejectMessage : null;
      messageStyle = styles.messageRejected;
      iconName = 'close-circle-outline';
      iconColor = t.color.danger;
      containerStyle = styles.containerRejected;
      break;

    case 'hidden':
    case 'needs_review':
      label = 'Under review';
      iconName = 'time-outline';
      iconColor = t.color.warning;
      containerStyle = styles.containerReview;
      break;

    case 'retry':
      label = 'Upload failed. Tap to retry';
      iconName = 'refresh-outline';
      iconColor = t.color.danger;
      containerStyle = styles.containerRetry;
      isRetry = true;
      break;

    case 'pending':
    default:
      label = 'Processing…';
      iconName = 'time-outline';
      iconColor = t.color.textSecondary;
      containerStyle = styles.containerDefault;
      break;
  }

  const content = (
    <View style={[styles.base, containerStyle]}>
      <Ionicons name={iconName} size={14} color={iconColor} style={styles.icon} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );

  const resolvedTestID = testID ?? 'photo-status-chip';

  if (isRetry && onRetry) {
    return (
      <TouchableOpacity
        testID={testID ?? 'photo-status-chip-retry'}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onRetry}
        activeOpacity={0.7}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View
      testID={resolvedTestID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={message ? `${label}: ${message}` : label}
    >
      {content}
      {message ? (
        <Text style={messageStyle} testID={`${resolvedTestID}-message`}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  containerDefault: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.border,
  },
  containerUploading: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.primaryFg,
  },
  containerChecking: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.primaryFg,
  },
  containerApproved: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.success,
  },
  containerRejected: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.danger,
  },
  containerReview: {
    backgroundColor: t.color.warningSurface,
    borderColor: t.color.warning,
  },
  containerRetry: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.danger,
  },
  icon: {
    marginRight: t.spacing.xs,
  },
  label: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  message: {
    ...t.typography.meta,
    fontWeight: '400',
    color: t.color.textSecondary,
    marginTop: t.spacing.xs,
  },
  messageRejected: {
    ...t.typography.meta,
    fontWeight: '400',
    color: t.color.danger,
    marginTop: t.spacing.xs,
  },
}));
