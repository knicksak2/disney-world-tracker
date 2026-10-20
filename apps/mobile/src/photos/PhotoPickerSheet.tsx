import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import {
  PHOTO_PICKER_GUIDANCE_BY_TARGET,
  type PhotoPickerTarget,
  PRIVACY_POLICY_URL,
  PHOTOS_DISCLOSURE_STORAGE_KEY,
} from './constants';
import {
  pickFromLibrary,
  captureFromCamera,
  requestLibraryPermission,
  requestCameraPermission,
  type PickedPhotoResult,
} from './photoPicker';
import { prepareImage, type PreparedImages } from './imagePrep';

export interface PhotoPickerSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onConfirm?: ((prepared: PreparedImages, takenAt?: string) => Promise<void> | void) | undefined;
  readonly onConfirmBatch?: ((items: readonly { prepared: PreparedImages; takenAt?: string }[]) => Promise<void> | void) | undefined;
  /** What the photo is for. Selects the guidance copy; there is no default (Requirement 23.9). */
  readonly target: PhotoPickerTarget;
  /** Optional override of the guidance copy chosen by `target`. */
  readonly guidanceText?: string;
  readonly title?: string;
  readonly allowsMultipleSelection?: boolean | undefined;
  readonly maxSelection?: number | undefined;
}

export function PhotoPickerSheet({
  visible,
  onClose,
  onConfirm,
  onConfirmBatch,
  target,
  guidanceText: guidanceOverride,
  title = 'Add Photo',
  allowsMultipleSelection = false,
  maxSelection,
}: PhotoPickerSheetProps) {
  const guidanceText = guidanceOverride ?? PHOTO_PICKER_GUIDANCE_BY_TARGET[target];
  const styles = useStyles();
  const t = useAppTheme();

  const [pickedPhotos, setPickedPhotos] = useState<readonly PickedPhotoResult[]>([]);
  const pickedPhoto = pickedPhotos[0] || null;
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState<boolean | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  // Check if third-party disclosure was previously acknowledged
  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(PHOTOS_DISCLOSURE_STORAGE_KEY).then((value) => {
      if (isMounted) {
        setDisclosureAccepted(value === 'true');
      }
    });
    return () => {
      isMounted = false;
    };
  }, [visible]);

  const handleAcceptDisclosure = async () => {
    await AsyncStorage.setItem(PHOTOS_DISCLOSURE_STORAGE_KEY, 'true');
    setDisclosureAccepted(true);
  };

  const handlePickFromLibrary = async () => {
    setPrepError(null);
    const perm = await requestLibraryPermission();
    if (!perm.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    const res = await pickFromLibrary({ allowsMultipleSelection });
    if (!res.canceled && res.photos.length > 0) {
      const selected = maxSelection ? res.photos.slice(0, maxSelection) : res.photos;
      setPickedPhotos(selected);
    }
  };

  const handleCaptureCamera = async () => {
    setPrepError(null);
    const perm = await requestCameraPermission();
    if (!perm.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    const res = await captureFromCamera();
    if (!res.canceled && res.photos.length > 0) {
      setPickedPhotos(res.photos.slice(0, 1));
    }
  };

  const handleConfirm = async () => {
    if (pickedPhotos.length === 0) {
      return;
    }

    // Must accept disclosure before uploading
    if (disclosureAccepted !== true) {
      return;
    }

    try {
      setIsPreparing(true);
      setPrepError(null);

      if (onConfirmBatch) {
        const preparedBatch = await Promise.all(
          pickedPhotos.map(async (photo) => {
            const prepared = await prepareImage(photo.uri, photo.width, photo.height);
            return { prepared, ...(photo.takenAt ? { takenAt: photo.takenAt } : {}) };
          })
        );
        await onConfirmBatch(preparedBatch);
      } else if (onConfirm) {
        const first = pickedPhotos[0]!;
        const prepared = await prepareImage(
          first.uri,
          first.width,
          first.height
        );
        await onConfirm(prepared, first.takenAt);
      }

      handleClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Could not prepare image. Tap to retry.';
      setPrepError(msg);
    } finally {
      setIsPreparing(false);
    }
  };

  const handleClose = () => {
    setPickedPhotos([]);
    setPermissionDenied(false);
    setPrepError(null);
    setIsPreparing(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet} testID="photo-picker-sheet">
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close photo picker"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={t.color.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* Guidance copy */}
            <View style={styles.guidanceBanner}>
              <Ionicons name="bulb-outline" size={18} color={t.color.primaryFg} />
              <Text
                style={styles.guidanceText}
                accessibilityRole="text"
                accessibilityLabel={guidanceText}
              >
                {guidanceText}
              </Text>
            </View>

            {/* Permission Denied Notice */}
            {permissionDenied ? (
              <View style={styles.permissionCard} testID="photo-permission-denied">
                <Ionicons name="alert-circle-outline" size={24} color={t.color.danger} />
                <Text style={styles.permissionTitle}>Photo permission required</Text>
                <Text style={styles.permissionBody}>
                  Please enable photo library or camera access in Settings to attach photos.
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openSettings()}
                  style={styles.settingsButton}
                  accessibilityRole="button"
                  accessibilityLabel="Open device settings"
                >
                  <Text style={styles.settingsButtonText}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* One-time Third Party Disclosure */}
            {disclosureAccepted === false ? (
              <View style={styles.disclosureCard} testID="photo-disclosure-card">
                <Ionicons name="shield-outline" size={22} color={t.color.primaryFg} />
                <Text style={styles.disclosureTitle}>Photo Moderation Notice</Text>
                <Text style={styles.disclosureBody}>
                  Uploaded photos are processed through automated safety checks using OpenAI and
                  Google to ensure all content meets community guidelines.
                </Text>

                {PRIVACY_POLICY_URL ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                    style={styles.policyLink}
                    accessibilityRole="link"
                    accessibilityLabel="Read the privacy policy"
                  >
                    <Text style={styles.policyLinkText}>Read the privacy policy</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  testID="accept-disclosure-button"
                  onPress={handleAcceptDisclosure}
                  style={styles.acceptButton}
                  accessibilityRole="button"
                  accessibilityLabel="Accept photo policy"
                >
                  <Text style={styles.acceptButtonText}>I Understand & Agree</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Image Preview / Selection */}
            {pickedPhotos.length > 0 ? (
              <View style={styles.previewContainer} testID="photo-preview-container">
                {pickedPhotos.length === 1 && pickedPhoto ? (
                  <Image
                    source={{ uri: pickedPhoto.uri }}
                    style={styles.previewImage}
                    accessibilityRole="image"
                    accessibilityLabel="Selected photo preview"
                    resizeMode="cover"
                  />
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.multiPreviewScroll}
                  >
                    {pickedPhotos.map((p, idx) => (
                      <Image
                        key={`${p.uri}-${idx}`}
                        source={{ uri: p.uri }}
                        style={styles.multiPreviewThumb}
                        accessibilityRole="image"
                        accessibilityLabel={`Selected photo ${idx + 1}`}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                )}
                <TouchableOpacity
                  onPress={() => setPickedPhotos([])}
                  style={styles.changePhotoButton}
                  accessibilityRole="button"
                  accessibilityLabel="Change photo"
                >
                  <Ionicons name="repeat" size={16} color={t.color.textSecondary} />
                  <Text style={styles.changePhotoText}>
                    {pickedPhotos.length > 1
                      ? `Change Photos (${pickedPhotos.length} selected)`
                      : 'Choose Different Photo'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.pickButtonsContainer}>
                <TouchableOpacity
                  testID="choose-from-library-button"
                  onPress={handlePickFromLibrary}
                  style={styles.pickButton}
                  accessibilityRole="button"
                  accessibilityLabel="Choose from Library"
                >
                  <Ionicons name="images-outline" size={24} color={t.color.primaryFg} />
                  <Text style={styles.pickButtonText}>Choose from Library</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="take-photo-camera-button"
                  onPress={handleCaptureCamera}
                  style={styles.pickButton}
                  accessibilityRole="button"
                  accessibilityLabel="Take Photo with Camera"
                >
                  <Ionicons name="camera-outline" size={24} color={t.color.primaryFg} />
                  <Text style={styles.pickButtonText}>Take Photo</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Image preparation error */}
            {prepError ? (
              <TouchableOpacity
                onPress={handleConfirm}
                style={styles.errorBanner}
                testID="image-prep-error"
                accessibilityRole="alert"
                accessibilityLabel={prepError}
              >
                <Ionicons name="alert-circle" size={18} color={t.color.danger} />
                <Text style={styles.errorText}>{prepError}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Actions */}
            <View style={styles.footerRow}>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.cancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="confirm-photo-upload-button"
                onPress={handleConfirm}
                disabled={pickedPhotos.length === 0 || isPreparing || disclosureAccepted !== true}
                style={[
                  styles.confirmButton,
                  (pickedPhotos.length === 0 || isPreparing || disclosureAccepted !== true) &&
                    styles.buttonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Confirm photo upload"
                accessibilityState={{
                  disabled: pickedPhotos.length === 0 || isPreparing || disclosureAccepted !== true,
                }}
              >
                {isPreparing ? (
                  <ActivityIndicator size="small" color={t.color.textOnPrimary} />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    {pickedPhotos.length > 1
                      ? `Upload ${pickedPhotos.length} Photos`
                      : 'Upload Photo'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    maxHeight: '90%',
    paddingBottom: t.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  title: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  closeButton: {
    padding: t.spacing.xs,
  },
  body: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.md,
  },
  guidanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.md,
  },
  guidanceText: {
    ...t.typography.body,
    color: t.color.textPrimary,
    flex: 1,
    fontWeight: '500',
  },
  permissionCard: {
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    alignItems: 'center',
    marginBottom: t.spacing.md,
    borderWidth: 1,
    borderColor: t.color.danger,
  },
  permissionTitle: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginTop: t.spacing.xs,
  },
  permissionBody: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    textAlign: 'center',
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.sm,
  },
  settingsButton: {
    backgroundColor: t.color.primary,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
  },
  settingsButtonText: {
    ...t.typography.meta,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
  disclosureCard: {
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.md,
    borderWidth: 1,
    borderColor: t.color.primaryFg,
  },
  disclosureTitle: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginTop: t.spacing.xs,
  },
  disclosureBody: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: t.spacing.xs,
    lineHeight: 18,
  },
  policyLink: {
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  policyLinkText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    textDecorationLine: 'underline',
  },
  acceptButton: {
    backgroundColor: t.color.primary,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    alignSelf: 'flex-start',
    marginTop: t.spacing.sm,
  },
  acceptButtonText: {
    ...t.typography.meta,
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
  pickButtonsContainer: {
    flexDirection: 'row',
    gap: t.spacing.md,
    marginVertical: t.spacing.lg,
  },
  pickButton: {
    flex: 1,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingVertical: t.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.sm,
  },
  pickButtonText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  previewContainer: {
    alignItems: 'center',
    marginVertical: t.spacing.md,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: t.radius.md,
  },
  multiPreviewScroll: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  multiPreviewThumb: {
    width: 140,
    height: 140,
    borderRadius: t.radius.md,
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    marginTop: t.spacing.sm,
    padding: t.spacing.xs,
  },
  changePhotoText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.danger,
    marginBottom: t.spacing.md,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.sm,
    marginTop: t.spacing.md,
    marginBottom: t.spacing.lg,
  },
  cancelButton: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  cancelButtonText: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  confirmButton: {
    backgroundColor: t.color.primary,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
