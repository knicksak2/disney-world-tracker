/**
 * AvatarUpload — Profile avatar picker and uploader.
 *
 * Used by `ProfileScreen` (task 15.2) to let the signed-in user pick
 * a PNG or JPEG image from the photo library and upload it to
 * `PUT /me/profile/avatar`.
 *
 * Validation strategy (R7.3, R7.7):
 *   1. Client-side format check  — only `image/png` and `image/jpeg`
 *      are allowed; anything else is rejected before any bytes leave
 *      the device.
 *   2. Client-side size check    — `fileSize > 5 MB` is rejected with
 *      a human-readable message.
 *   3. Server-side authority     — the server re-validates with a
 *      magic-byte sniff (defense in depth against type-confusion).
 *      Any `ApiError` with `code === 'avatar_invalid'` is surfaced as
 *      an inline error string returned by the server.
 *
 * On a successful upload the parent is notified via
 * `onUploaded(avatarUrl)` so it can re-render the new avatar without
 * a full profile refetch.
 *
 * Validates: Requirements R7.3, R7.7
 */

import React, { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ApiError, uploadAvatar, type AvatarMimeType } from '../api/client';

/** 5 MB hard limit — matches the server's `MAX_AVATAR_BYTES` (R7.3, R7.7). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const FORMAT_ERROR = 'Avatar must be PNG or JPEG.';
const SIZE_ERROR = 'Avatar must be 5 MB or smaller.';

/**
 * Normalize the picker's reported MIME type. `expo-image-picker`
 * returns `mimeType` on most platforms; when missing, fall back to
 * the file extension on the URI. Anything we can't classify as PNG
 * or JPEG returns `null`, which the caller treats as a format
 * rejection (R7.7).
 */
function classifyMime(asset: ImagePicker.ImagePickerAsset): AvatarMimeType | null {
  const reported = asset.mimeType?.toLowerCase();
  if (reported === 'image/png') return 'image/png';
  if (reported === 'image/jpeg' || reported === 'image/jpg') return 'image/jpeg';

  // Fall back to the URI's extension. The picker's `uri` is always a
  // local file path on iOS/Android; on web it may be a `blob:` URL,
  // in which case there is no extension to inspect and we reject.
  const uri = asset.uri.toLowerCase();
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.jpg') || uri.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

export interface AvatarUploadProps {
  /**
   * Currently-displayed avatar URL, if any. Rendered as a small
   * indicator label so the user can tell at a glance whether they
   * already have an avatar set. The image itself is rendered by the
   * parent `ProfileScreen`; this component owns only the picker
   * affordance and error/status text.
   */
  readonly currentAvatarUrl?: string | null;

  /**
   * Called with the new public avatar URL after a successful upload
   * so the parent can update its local state without a refetch.
   */
  readonly onUploaded: (avatarUrl: string) => void;
}

/** Distinct UI states for the avatar-upload affordance. */
type Status =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export default function AvatarUpload({
  currentAvatarUrl,
  onUploaded,
}: AvatarUploadProps): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function handlePress(): Promise<void> {
    setStatus({ kind: 'uploading' });

    // Permission request: launchImageLibraryAsync triggers the OS
    // permission flow on first use, but requesting up front lets us
    // surface a friendlier message if the user denies.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus({
        kind: 'error',
        message: 'Photo library permission is required to change your avatar.',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled) {
      // User backed out of the picker — return to idle without an
      // error message.
      setStatus({ kind: 'idle' });
      return;
    }

    const asset = result.assets[0];
    if (!asset) {
      setStatus({ kind: 'error', message: FORMAT_ERROR });
      return;
    }

    // 1) Format check (R7.3, R7.7).
    const mime = classifyMime(asset);
    if (mime === null) {
      setStatus({ kind: 'error', message: FORMAT_ERROR });
      return;
    }

    // 2) Size check (R7.3, R7.7). `fileSize` is best-effort — when the
    // picker omits it (some Android paths) we let the server enforce
    // the limit. The server's `multipart` config caps the streamed
    // body at 5 MB and rejects with `avatar_invalid` past that point.
    if (asset.fileSize !== undefined && asset.fileSize > MAX_AVATAR_BYTES) {
      setStatus({ kind: 'error', message: SIZE_ERROR });
      return;
    }

    // 3) Upload. The server re-validates format with a magic-byte
    // sniff and the size against its own limit, so a successful
    // response means the new avatar is durably stored.
    try {
      const profile = await uploadAvatar({
        uri: asset.uri,
        mime,
        fileName: asset.fileName ?? null,
      });

      if (profile.avatarUrl !== null) {
        onUploaded(profile.avatarUrl);
      }
      setStatus({ kind: 'success' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'avatar_invalid') {
        // Server rejected the upload — surface its message inline so
        // the user can correct and retry. The server's message is
        // already user-facing per the route handler.
        setStatus({ kind: 'error', message: err.message });
        return;
      }

      // Any other failure: network error, 5xx, etc. Show a generic
      // message and keep the prior avatar (R7.7).
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Avatar upload failed. Please try again.';
      setStatus({ kind: 'error', message });
    }
  }

  const uploading = status.kind === 'uploading';

  return (
    <View style={styles.container}>
      <Button
        title={uploading ? 'Uploading…' : 'Change avatar'}
        onPress={() => {
          // Fire-and-forget: any error is captured into `status`.
          void handlePress();
        }}
        disabled={uploading}
      />

      {uploading ? (
        <ActivityIndicator
          accessibilityLabel="Uploading avatar"
          style={styles.spinner}
        />
      ) : null}

      {status.kind === 'error' ? (
        <Text style={styles.error} accessibilityRole="alert">
          {status.message}
        </Text>
      ) : null}

      {status.kind === 'success' ? (
        <Text style={styles.success}>Avatar updated.</Text>
      ) : null}

      {status.kind === 'idle' && currentAvatarUrl === null ? (
        <Text style={styles.hint}>No avatar set.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  spinner: {
    marginTop: 8,
  },
  error: {
    color: '#b00020',
    marginTop: 4,
  },
  success: {
    color: '#1b5e20',
    marginTop: 4,
  },
  hint: {
    color: '#666',
    marginTop: 4,
  },
});
