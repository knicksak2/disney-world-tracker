import type {
  PickedPhotoResult,
  PickPhotoOptions,
  PickerPermissionResult,
} from './photoPicker.native';

export * from './photoPicker.pure';

export type { PickedPhotoResult, PickPhotoOptions, PickerPermissionResult };

export async function requestLibraryPermission(): Promise<PickerPermissionResult> {
  return { granted: true, canAskAgain: true };
}

export async function requestCameraPermission(): Promise<PickerPermissionResult> {
  return { granted: true, canAskAgain: true };
}

export async function pickFromLibrary(
  _options: PickPhotoOptions = {}
): Promise<{ canceled: boolean; photos: readonly PickedPhotoResult[] }> {
  return { canceled: true, photos: [] };
}

export async function captureFromCamera(): Promise<{
  canceled: boolean;
  photos: readonly PickedPhotoResult[];
}> {
  return { canceled: true, photos: [] };
}
