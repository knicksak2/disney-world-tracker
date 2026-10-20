import * as ImagePicker from 'expo-image-picker';
import { pickTakenAt, type PhotoSource } from './photoPicker.pure';

export * from './photoPicker.pure';

export interface PickedPhotoResult {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  readonly takenAt?: string | undefined;
  readonly source: PhotoSource;
}

export interface PickPhotoOptions {
  readonly allowsMultipleSelection?: boolean;
}

export interface PickerPermissionResult {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

export async function requestLibraryPermission(): Promise<PickerPermissionResult> {
  const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return {
    granted: result.granted,
    canAskAgain: result.canAskAgain,
  };
}

export async function requestCameraPermission(): Promise<PickerPermissionResult> {
  const result = await ImagePicker.requestCameraPermissionsAsync();
  return {
    granted: result.granted,
    canAskAgain: result.canAskAgain,
  };
}

export async function pickFromLibrary(
  options: PickPhotoOptions = {}
): Promise<{ canceled: boolean; photos: readonly PickedPhotoResult[] }> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: options.allowsMultipleSelection ?? false,
    quality: 1,
    exif: true,
  });

  if (result.canceled || !result.assets) {
    return { canceled: true, photos: [] };
  }

  const photos: PickedPhotoResult[] = result.assets.map((asset) => {
    const takenAt = pickTakenAt(asset, 'library');
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      ...(takenAt ? { takenAt } : {}),
      source: 'library',
    };
  });

  return { canceled: false, photos };
}

export async function captureFromCamera(): Promise<{
  canceled: boolean;
  photos: readonly PickedPhotoResult[];
}> {
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 1,
    exif: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { canceled: true, photos: [] };
  }

  const asset = result.assets[0];
  if (!asset) {
    return { canceled: true, photos: [] };
  }
  const takenAt = pickTakenAt(asset, 'camera');
  const photos: PickedPhotoResult[] = [
    {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      ...(takenAt ? { takenAt } : {}),
      source: 'camera',
    },
  ];

  return { canceled: false, photos };
}
