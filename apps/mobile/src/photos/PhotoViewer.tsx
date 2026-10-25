import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { useDeletePhoto, useAddBlock } from './api';
import { PhotoReportSheet } from './PhotoReportSheet';

export interface PhotoViewerItem {
  readonly id: string;
  readonly url?: string | null | undefined;
  readonly thumbUrl?: string | null | undefined;
  readonly width?: number | null | undefined;
  readonly height?: number | null | undefined;
  readonly uploader?: {
    readonly displayName: string;
    readonly avatarPreset: string | null;
  } | null | undefined;
  readonly mine?: boolean | undefined;
  readonly foodItemName?: string | undefined;
  readonly subtitle?: string | undefined;
}

export interface PhotoViewerAction {
  readonly label: string;
  readonly accessibilityLabel?: string | undefined;
  readonly onPress: () => void;
}

export interface PhotoViewerProps {
  readonly visible: boolean;
  readonly photo: PhotoViewerItem | null;
  readonly shareId?: string | undefined;
  readonly canDelete?: boolean | undefined;
  readonly onClose: () => void;
  readonly onDeleted?: (() => void) | undefined;
  readonly onBlocked?: (() => void) | undefined;
  readonly footerAction?: React.ReactNode | PhotoViewerAction | undefined;
}

export function PhotoViewer({
  visible,
  photo,
  shareId,
  canDelete: canDeleteProp,
  onClose,
  onDeleted,
  onBlocked,
  footerAction,
}: PhotoViewerProps) {
  const styles = useStyles();
  const t = useAppTheme();

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteMutation = useDeletePhoto();
  const blockMutation = useAddBlock();

  if (!photo) {
    return null;
  }

  const imageUrl = photo.url || photo.thumbUrl || '';
  const isMine = Boolean(photo.mine);
  const showDelete = isMine || Boolean(canDeleteProp);
  const uploaderName = photo.uploader ? photo.uploader.displayName : 'Another guest';

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(photo.id);
      setShowDeleteConfirm(false);
      if (onDeleted) {
        onDeleted();
      }
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to delete photo. Please try again.');
    }
  };

  const handleBlockConfirm = async () => {
    try {
      // Must pass photoId, never userId (plus shareId if viewing via share)
      await blockMutation.mutateAsync({
        photoId: photo.id,
        ...(shareId ? { shareId } : {}),
      });
      setShowBlockConfirm(false);
      setBlockedNotice('Uploader blocked. Their photos will no longer be visible.');
      if (onBlocked) {
        onBlocked();
      }
      setTimeout(() => {
        setBlockedNotice(null);
        onClose();
      }, 1200);
    } catch {
      Alert.alert('Error', 'Failed to block user. Please try again.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop} testID="photo-viewer-modal">
        {/* Header / close bar */}
        <View style={styles.topBar}>
          <View style={styles.bylineBlock}>
            <Ionicons name="person-circle-outline" size={24} color={t.color.textSecondary} />
            <View style={styles.bylineTextContainer}>
              <Text
                style={styles.bylineText}
                accessibilityLabel={`Photo by ${uploaderName}`}
                accessibilityRole="text"
              >
                {uploaderName}
              </Text>
              {photo.subtitle ? (
                <Text
                  style={styles.bylineSubtitle}
                  numberOfLines={1}
                  accessibilityRole="text"
                >
                  {photo.subtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <TouchableOpacity
            testID="photo-viewer-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            style={styles.iconButton}
          >
            <Ionicons name="close" size={26} color={t.color.textPrimary} />
          </TouchableOpacity>
        </View>

        {photo.foodItemName ? (
          <View style={styles.dishNameBar}>
            <Text style={styles.dishNameText} numberOfLines={1}>
              {photo.foodItemName}
            </Text>
          </View>
        ) : null}

        {/* Main image */}
        <View style={styles.imageContainer}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.fullImage}
              resizeMode="contain"
              accessibilityLabel={photo.foodItemName ? `Photo of ${photo.foodItemName}` : 'Guest photo'}
              accessibilityRole="image"
            />
          ) : (
            <View style={styles.placeholderImage}>
              <Ionicons name="image-outline" size={48} color={t.color.textSecondary} />
              <Text style={styles.placeholderText}>Photo unavailable</Text>
            </View>
          )}
        </View>

        {/* Notice banner */}
        {blockedNotice ? (
          <View style={styles.noticeBanner} testID="block-confirmation-notice">
            <Ionicons name="shield-checkmark" size={20} color={t.color.success} />
            <Text style={styles.noticeText}>{blockedNotice}</Text>
          </View>
        ) : null}

        {/* Delete confirmation inline sheet */}
        {showDeleteConfirm ? (
          <View style={styles.confirmCard} testID="delete-confirmation-dialog">
            <Text style={styles.confirmTitle}>Delete photo?</Text>
            <Text style={styles.confirmBody}>
              This will permanently delete this photo from all places in the app.
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(false)}
                style={styles.confirmCancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="confirm-delete-button"
                onPress={handleDelete}
                style={styles.confirmDeleteButton}
                accessibilityRole="button"
                accessibilityLabel="Confirm delete"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator size="small" color={t.color.textOnPrimary} />
                ) : (
                  <Text style={styles.confirmDeleteText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Block confirmation inline sheet */}
        {showBlockConfirm ? (
          <View style={styles.confirmCard} testID="block-confirmation-dialog">
            <Text style={styles.confirmTitle}>Block uploader?</Text>
            <Text style={styles.confirmBody}>
              You will no longer see photos uploaded by this guest, and they will not see yours.
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                onPress={() => setShowBlockConfirm(false)}
                style={styles.confirmCancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel block"
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="confirm-block-button"
                onPress={handleBlockConfirm}
                style={styles.confirmBlockButton}
                accessibilityRole="button"
                accessibilityLabel="Confirm block uploader"
              >
                {blockMutation.isPending ? (
                  <ActivityIndicator size="small" color={t.color.textOnPrimary} />
                ) : (
                  <Text style={styles.confirmBlockText}>Block</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Bottom actions toolbar */}
        <View style={styles.bottomBar}>
          {footerAction ? (
            <View style={styles.footerActionContainer}>
              {React.isValidElement(footerAction) ? (
                footerAction
              ) : typeof footerAction === 'object' && 'label' in footerAction ? (
                <TouchableOpacity
                  testID="photo-viewer-footer-action"
                  onPress={(footerAction as PhotoViewerAction).onPress}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel={
                    (footerAction as PhotoViewerAction).accessibilityLabel ??
                    (footerAction as PhotoViewerAction).label
                  }
                >
                  <Text style={styles.actionButtonText}>
                    {(footerAction as PhotoViewerAction).label}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actionButtonsRow}>
            {showDelete ? (
              <TouchableOpacity
                testID="photo-viewer-delete"
                onPress={() => setShowDeleteConfirm(true)}
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel="Delete photo"
              >
                <Ionicons name="trash-outline" size={20} color={t.color.danger} />
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
            {!isMine ? (
              <>
                <TouchableOpacity
                  testID="photo-viewer-report"
                  onPress={() => setIsReportOpen(true)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Report photo"
                >
                  <Ionicons name="flag-outline" size={20} color={t.color.textSecondary} />
                  <Text style={styles.actionButtonText}>Report</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="photo-viewer-block"
                  onPress={() => setShowBlockConfirm(true)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Block uploader"
                >
                  <Ionicons name="hand-left-outline" size={20} color={t.color.danger} />
                  <Text style={styles.blockButtonText}>Block uploader</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>

        {/* Report modal */}
        <PhotoReportSheet
          visible={isReportOpen}
          photoId={photo.id}
          {...(shareId ? { shareId } : {})}
          onClose={() => setIsReportOpen(false)}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: t.color.background,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.sm,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  bylineBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    flex: 1,
  },
  bylineTextContainer: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  bylineText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  bylineSubtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: 1,
  },
  iconButton: {
    padding: t.spacing.xs,
  },
  dishNameBar: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
  },
  dishNameText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.spacing.sm,
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: t.spacing.xs,
  },
  bottomBar: {
    backgroundColor: t.color.surface,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    paddingBottom: t.spacing.lg,
  },
  footerActionContainer: {
    marginBottom: t.spacing.sm,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  actionButtonText: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  deleteButtonText: {
    ...t.typography.body,
    color: t.color.danger,
    fontWeight: '500',
  },
  blockButtonText: {
    ...t.typography.body,
    color: t.color.danger,
    fontWeight: '500',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.md,
    marginHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.success,
  },
  noticeText: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    flex: 1,
  },
  confirmCard: {
    backgroundColor: t.color.surface,
    padding: t.spacing.md,
    marginHorizontal: t.spacing.md,
    marginBottom: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  confirmTitle: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginBottom: t.spacing.xs,
  },
  confirmBody: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: t.spacing.md,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.sm,
  },
  confirmCancelButton: {
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  confirmCancelText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  confirmDeleteButton: {
    backgroundColor: t.color.danger,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
  },
  confirmDeleteText: {
    ...t.typography.meta,
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
  confirmBlockButton: {
    backgroundColor: t.color.danger,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
  },
  confirmBlockText: {
    ...t.typography.meta,
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
}));
