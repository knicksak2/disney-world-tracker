import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme, darkTheme } from '../../theme/theme';
import { setTestScheme, resetTestScheme } from '../../test/themeTestUtils';
import { PhotoStatusChip } from '../PhotoStatusChip';
import { PhotoReportSheet } from '../PhotoReportSheet';
import { PhotoViewer } from '../PhotoViewer';
import { PhotoPickerSheet } from '../PhotoPickerSheet';
import * as clientModule from '../../api/client';
import * as imagePrepModule from '../imagePrep';
import * as photoPickerModule from '../photoPicker';
import { PHOTOS_DISCLOSURE_STORAGE_KEY } from '../constants';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('Photo components (Task 13.4)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let openUrlSpy: jest.SpyInstance;

  beforeEach(async () => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
    openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    openUrlSpy.mockRestore();
  });

  describe('PhotoStatusChip', () => {
    it('shows text label and icon for every status and does not rely on color alone', () => {
      const { rerender, getByText, getByTestId } = render(
        <PhotoStatusChip status="uploading" />
      );
      expect(getByText('Uploading…')).toBeTruthy();
      expect(getByTestId('photo-status-chip').props.accessibilityLabel).toBe('Uploading…');

      rerender(<PhotoStatusChip status="checking" />);
      expect(getByText('Checking…')).toBeTruthy();

      rerender(<PhotoStatusChip status="approved" />);
      expect(getByText('Approved')).toBeTruthy();

      rerender(
        <PhotoStatusChip
          status="rejected"
          rejectMessage="Too much text on receipt"
        />
      );
      expect(getByText('Rejected')).toBeTruthy();
      expect(getByText('Too much text on receipt')).toBeTruthy();
      expect(getByTestId('photo-status-chip').props.accessibilityLabel).toBe(
        'Rejected: Too much text on receipt'
      );

      rerender(<PhotoStatusChip status="hidden" />);
      expect(getByText('Under review')).toBeTruthy();

      rerender(<PhotoStatusChip status="needs_review" />);
      expect(getByText('Under review')).toBeTruthy();

      const onRetry = jest.fn();
      rerender(<PhotoStatusChip status="retry" onRetry={onRetry} />);
      expect(getByText('Upload failed. Tap to retry')).toBeTruthy();
      fireEvent.press(getByTestId('photo-status-chip-retry'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('pairs every status label with its icon, and wraps the retry label instead of clamping it', () => {
      const cases: ReadonlyArray<readonly [React.ComponentProps<typeof PhotoStatusChip>['status'], string, string]> = [
        ['uploading', 'Uploading…', 'cloud-upload-outline'],
        ['checking', 'Checking…', 'sync-outline'],
        ['approved', 'Approved', 'checkmark-circle-outline'],
        ['rejected', 'Rejected', 'close-circle-outline'],
        ['hidden', 'Under review', 'time-outline'],
        ['retry', 'Upload failed. Tap to retry', 'refresh-outline'],
      ];
      for (const [status, label, icon] of cases) {
        const view = render(<PhotoStatusChip status={status} onRetry={jest.fn()} testID="chip" />);
        expect(view.getByText(label).props.numberOfLines).toBeUndefined();
        expect(view.UNSAFE_getByType(Ionicons).props.name).toBe(icon);
        view.unmount();
      }
    });

    it('renders the rejected reason as its own unclamped line tinted from the active theme', () => {
      resetTestScheme();
      const { getByTestId, rerender } = render(
        <PhotoStatusChip status="rejected" rejectMessage="Try framing just the dish." testID="chip" />
      );
      const light = getByTestId('chip-message');
      expect(light.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(light.props.style).color).toBe(lightTheme.color.danger);

      setTestScheme('dark');
      rerender(
        <PhotoStatusChip status="rejected" rejectMessage="Try framing just the dish." testID="chip" />
      );
      expect(StyleSheet.flatten(getByTestId('chip-message').props.style).color).toBe(
        darkTheme.color.danger
      );
      resetTestScheme();
    });

    it('shows no reason line when a rejected photo carries no message', () => {
      const { queryByTestId, getByText } = render(<PhotoStatusChip status="rejected" testID="chip" />);
      expect(getByText('Rejected')).toBeTruthy();
      expect(queryByTestId('chip-message')).toBeNull();
    });

    it('repaints with dark colors when theme scheme switches to dark', () => {
      resetTestScheme();
      const { getByTestId, rerender } = render(<PhotoStatusChip status="approved" />);
      const lightWrapper = getByTestId('photo-status-chip');
      const lightInner = lightWrapper.children[0] as any;
      const lightBg = StyleSheet.flatten(lightInner.props.style).backgroundColor;
      expect(lightBg).toBe(lightTheme.color.surfaceAlt);

      setTestScheme('dark');
      rerender(<PhotoStatusChip status="approved" />);
      const darkWrapper = getByTestId('photo-status-chip');
      const darkInner = darkWrapper.children[0] as any;
      const darkBg = StyleSheet.flatten(darkInner.props.style).backgroundColor;
      expect(darkBg).toBe(darkTheme.color.surfaceAlt);
      expect(darkBg).not.toBe(lightBg);

      resetTestScheme();
    });
  });

  describe('PhotoReportSheet', () => {
    it('opens, selects reason, inputs note, submits POST, and shows on-screen confirmation', async () => {
      apiRequestSpy.mockResolvedValueOnce(undefined);
      const onClose = jest.fn();
      const onReported = jest.fn();

      const { getByText, getByTestId } = render(
        <PhotoReportSheet
          visible
          photoId="photo-report-123"
          onClose={onClose}
          onReported={onReported}
        />,
        { wrapper: createWrapper() }
      );

      expect(getByText('Report Photo')).toBeTruthy();

      // Select 'inappropriate' reason
      fireEvent.press(getByTestId('report-reason-inappropriate'));

      // Enter note
      fireEvent.changeText(getByTestId('report-note-input'), 'Violates guidelines');

      // Submit
      fireEvent.press(getByTestId('submit-report-button'));

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith(
          'POST',
          '/photos/photo-report-123/report',
          {
            reason: 'inappropriate',
            note: 'Violates guidelines',
          }
        );
      });

      expect(onReported).toHaveBeenCalled();

      // On-screen confirmation
      await waitFor(() => {
        expect(getByTestId('photo-report-confirmation')).toBeTruthy();
        expect(getByText('Report Submitted')).toBeTruthy();
      });

      // Press done to close
      fireEvent.press(getByText('Done'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('PhotoViewer', () => {
    it('renders another guest photo with "Another guest" label, allows Report and Block uploader (no userId)', async () => {
      apiRequestSpy.mockResolvedValueOnce({
        blockId: 'blk-456',
        displayName: null,
        avatarPreset: null,
        createdAt: '2026-10-18T12:00:00.000Z',
      });

      const onClose = jest.fn();
      const onBlocked = jest.fn();

      const strangerPhoto = {
        id: 'photo-stranger-1',
        url: 'https://cdn.example/full.jpg',
        thumbUrl: 'https://cdn.example/thumb.jpg',
        uploader: null,
        mine: false,
        foodItemName: 'Dole Whip',
      };

      const { getByText, getByTestId, queryByTestId } = render(
        <PhotoViewer
          visible
          photo={strangerPhoto}
          onClose={onClose}
          onBlocked={onBlocked}
        />,
        { wrapper: createWrapper() }
      );

      // Verify "Another guest" byline
      expect(getByText('Another guest')).toBeTruthy();
      expect(getByText('Dole Whip')).toBeTruthy();

      // Delete should NOT be present
      expect(queryByTestId('photo-viewer-delete')).toBeNull();

      // Report button is present
      expect(getByTestId('photo-viewer-report')).toBeTruthy();

      // Block uploader flow
      fireEvent.press(getByTestId('photo-viewer-block'));

      // Confirmation dialog appears
      expect(getByTestId('block-confirmation-dialog')).toBeTruthy();
      expect(getByText('Block uploader?')).toBeTruthy();

      // Confirm block
      fireEvent.press(getByTestId('confirm-block-button'));

      await waitFor(() => {
        // Assert payload has photoId and NO userId
        expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/blocks', {
          photoId: 'photo-stranger-1',
        });
      });

      expect(onBlocked).toHaveBeenCalled();

      // On-screen notice banner appears
      await waitFor(() => {
        expect(getByTestId('block-confirmation-notice')).toBeTruthy();
      });
    });

    it('renders own photo with display name and Delete flow with confirmation', async () => {
      apiRequestSpy.mockResolvedValueOnce(undefined);
      const onClose = jest.fn();
      const onDeleted = jest.fn();

      const myPhoto = {
        id: 'photo-mine-1',
        url: 'https://cdn.example/my.jpg',
        uploader: {
          displayName: 'Mickey Mouse',
          avatarPreset: 'castle',
        },
        mine: true,
      };

      const { getByText, getByTestId, queryByTestId } = render(
        <PhotoViewer
          visible
          photo={myPhoto}
          onClose={onClose}
          onDeleted={onDeleted}
        />,
        { wrapper: createWrapper() }
      );

      expect(getByText('Mickey Mouse')).toBeTruthy();

      // Report and Block should not be present on own photo
      expect(queryByTestId('photo-viewer-report')).toBeNull();
      expect(queryByTestId('photo-viewer-block')).toBeNull();

      // Delete button is present
      fireEvent.press(getByTestId('photo-viewer-delete'));

      // Confirmation dialog appears
      expect(getByTestId('delete-confirmation-dialog')).toBeTruthy();
      expect(getByText('Delete photo?')).toBeTruthy();

      // Confirm delete
      fireEvent.press(getByTestId('confirm-delete-button'));

      await waitFor(() => {
        expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/photos/photo-mine-1');
      });

      expect(onDeleted).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('PhotoPickerSheet', () => {
    it('shows guidance text, disables confirm until preview exists, handles disclosure and policy link', async () => {
      // First time user: disclosure not yet accepted
      await AsyncStorage.removeItem(PHOTOS_DISCLOSURE_STORAGE_KEY);

      const onConfirm = jest.fn();
      const onClose = jest.fn();

      const { getByText, getByTestId } = render(
        <PhotoPickerSheet
          visible
          target="food"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );

      // 1. Guidance text renders
      expect(getByText('Frame just the dish. No people or text.')).toBeTruthy();

      // 2. Confirm button disabled initially
      const confirmBtn = getByTestId('confirm-photo-upload-button');
      expect(confirmBtn.props.accessibilityState.disabled).toBe(true);

      // 3. Disclosure card appears, naming OpenAI and Google
      await waitFor(() => {
        expect(getByTestId('photo-disclosure-card')).toBeTruthy();
      });
      expect(
        getByText(
          /Uploaded photos are processed through automated safety checks using OpenAI and Google/i
        )
      ).toBeTruthy();

      // 4. Accept disclosure
      fireEvent.press(getByTestId('accept-disclosure-button'));

      await waitFor(async () => {
        const stored = await AsyncStorage.getItem(PHOTOS_DISCLOSURE_STORAGE_KEY);
        expect(stored).toBe('true');
      });

      // 5. Mock picking a photo from library
      jest.spyOn(photoPickerModule, 'requestLibraryPermission').mockResolvedValue({
        granted: true,
        canAskAgain: true,
      });
      jest.spyOn(photoPickerModule, 'pickFromLibrary').mockResolvedValue({
        canceled: false,
        photos: [
          {
            uri: 'file:///selected.jpg',
            width: 1000,
            height: 800,
            takenAt: '2026-10-18T11:00:00.000Z',
            source: 'library',
          },
        ],
      });

      fireEvent.press(getByTestId('choose-from-library-button'));

      await waitFor(() => {
        expect(getByTestId('photo-preview-container')).toBeTruthy();
      });

      // Confirm button is now enabled
      expect(confirmBtn.props.accessibilityState.disabled).toBe(false);

      // 6. Mock successful image preparation
      const fakeBlob = new Blob(['123'], { type: 'image/jpeg' });
      jest.spyOn(imagePrepModule, 'prepareImage').mockResolvedValue({
        full: { uri: 'file:///full.jpg', width: 1000, height: 800, blob: fakeBlob },
        thumb: { uri: 'file:///thumb.jpg', width: 320, height: 256, blob: fakeBlob },
      });

      fireEvent.press(confirmBtn);

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            full: expect.any(Object),
            thumb: expect.any(Object),
          }),
          '2026-10-18T11:00:00.000Z'
        );
      });
    });

    it('target "food" shows exactly the food guidance, labelled with its own text (Requirement 23.1)', () => {
      const { getByText } = render(
        <PhotoPickerSheet visible target="food" onClose={jest.fn()} onConfirm={jest.fn()} />
      );
      const guidance = getByText('Frame just the dish. No people or text.');
      expect(guidance.props.accessibilityLabel).toBe('Frame just the dish. No people or text.');
    });

    it('target "trip" shows the trip guidance and never the food guidance (Requirement 23.9)', () => {
      const { getByText, queryByText } = render(
        <PhotoPickerSheet visible target="trip" onClose={jest.fn()} onConfirmBatch={jest.fn()} />
      );
      const guidance = getByText(
        'Share your favorite moments with your crew. People and text are welcome.'
      );
      expect(guidance.props.accessibilityLabel).toBe(
        'Share your favorite moments with your crew. People and text are welcome.'
      );
      expect(queryByText(/Frame just the dish/)).toBeNull();
      expect(queryByText(/No people or text/)).toBeNull();
    });

    it('guidanceText overrides the copy chosen by target', () => {
      const { getByText, queryByText } = render(
        <PhotoPickerSheet
          visible
          target="trip"
          guidanceText="Custom tip"
          onClose={jest.fn()}
          onConfirmBatch={jest.fn()}
        />
      );
      expect(getByText('Custom tip').props.accessibilityLabel).toBe('Custom tip');
      expect(queryByText(/People and text are welcome/)).toBeNull();
    });

    it('mocked imagePrep failure shows retryable error and does not call initiate or onConfirm (Requirement 2.5)', async () => {
      await AsyncStorage.setItem(PHOTOS_DISCLOSURE_STORAGE_KEY, 'true');

      const onConfirm = jest.fn();
      const onClose = jest.fn();

      jest.spyOn(photoPickerModule, 'requestLibraryPermission').mockResolvedValue({
        granted: true,
        canAskAgain: true,
      });
      jest.spyOn(photoPickerModule, 'pickFromLibrary').mockResolvedValue({
        canceled: false,
        photos: [
          {
            uri: 'file:///bad.jpg',
            width: 1000,
            height: 800,
            source: 'library',
          },
        ],
      });

      // Mock imagePrep failure
      jest.spyOn(imagePrepModule, 'prepareImage').mockRejectedValue(
        new Error('Failed to decode image buffer')
      );

      const { getByTestId, getByText } = render(
        <PhotoPickerSheet
          visible
          target="food"
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );

      fireEvent.press(getByTestId('choose-from-library-button'));

      await waitFor(() => {
        expect(getByTestId('photo-preview-container')).toBeTruthy();
      });

      fireEvent.press(getByTestId('confirm-photo-upload-button'));

      // Error banner appears with retryable message
      await waitFor(() => {
        expect(getByTestId('image-prep-error')).toBeTruthy();
        expect(getByText('Failed to decode image buffer')).toBeTruthy();
      });

      // onConfirm NOT called
      expect(onConfirm).not.toHaveBeenCalled();
      expect(apiRequestSpy).not.toHaveBeenCalledWith('/photos/uploads', expect.anything());
    });
  });
});
