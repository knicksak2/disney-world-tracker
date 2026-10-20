// Feature: photo-uploads, Task 22.6 — Recap photos section in the Trip Recap (TripPhotosSection)
//
// Validates: Requirements 16.8, 26.1, 26.2, 26.5, 26.6, 26.7

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SharedSummaryPhotoDTO, PhotoClientConfigDTO } from '@dwt/shared';
import * as clientModule from '../../api/client';
import { TripPhotosSection } from '../TripPhotosSection';
import { setTestScheme, resetTestScheme } from '../../test/themeTestUtils';
import { lightTheme, darkTheme } from '../../theme/theme';

const mockOpenAlbum = jest.fn();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderWithClient(ui: React.ReactElement, client = createTestQueryClient()) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TRIP_ID = 'trip-abc-123';
const SHARE_ID = 'share-xyz-789';

const DEFAULT_CONFIG: PhotoClientConfigDTO = {
  enabled: true,
  foodEnabled: true,
  tripEnabled: true,
  maxPerFoodLog: 4,
  maxPerTrip: 500,
  maxFeedPostPhotos: 4,
  maxBatch: 10,
  maxBytes: 15_000_000,
  maxThumbBytes: 500_000,
  dailyCap: 20,
  remainingToday: 20,
  experienceStripMax: 8,
};

const PHOTO_1: SharedSummaryPhotoDTO = {
  id: 'photo-1',
  thumbUrl: 'https://r2.test/p/photo-1/t.jpg',
  url: 'https://r2.test/p/photo-1/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-01T12:00:00Z',
  mine: false,
};

const PHOTO_2: SharedSummaryPhotoDTO = {
  id: 'photo-2',
  thumbUrl: 'https://r2.test/p/photo-2/t.jpg',
  url: 'https://r2.test/p/photo-2/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-02T13:00:00Z',
  mine: true,
};

const PHOTO_3: SharedSummaryPhotoDTO = {
  id: 'photo-3',
  thumbUrl: 'https://r2.test/p/photo-3/t.jpg',
  url: 'https://r2.test/p/photo-3/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-03T14:00:00Z',
  mine: false,
};

const PHOTO_4: SharedSummaryPhotoDTO = {
  id: 'photo-4',
  thumbUrl: 'https://r2.test/p/photo-4/t.jpg',
  url: 'https://r2.test/p/photo-4/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-04T15:00:00Z',
  mine: false,
};

describe('TripPhotosSection (Task 22.6)', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    resetTestScheme();
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    resetTestScheme();
  });

  // 1. Member mode: with four highlight photos renders four thumbnails in returned order and requests URL
  it('member mode: with four highlight photos renders four thumbnails in order and requests GET /trips/:id/photos?summary=true', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve(DEFAULT_CONFIG);
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({
          items: [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    // Assert section heading appears
    expect(await screen.findByTestId('trip-photos-heading')).toBeTruthy();

    // Assert four thumbnails appear in order
    expect(screen.getByTestId('trip-photo-highlight-photo-1')).toBeTruthy();
    expect(screen.getByTestId('trip-photo-highlight-photo-2')).toBeTruthy();
    expect(screen.getByTestId('trip-photo-highlight-photo-3')).toBeTruthy();
    expect(screen.getByTestId('trip-photo-highlight-photo-4')).toBeTruthy();

    // Verify URL requested
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', `/trips/${TRIP_ID}/photos?summary=true`);
  });

  // 2. Member mode: "View all in album" navigates to TripAlbum with trip id
  it('member mode: "View all in album" invokes the album callback once', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve(DEFAULT_CONFIG);
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({
          items: [PHOTO_1],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    const albumBtn = await screen.findByTestId('view-all-in-album-btn');
    fireEvent.press(albumBtn);

    expect(mockOpenAlbum).toHaveBeenCalledTimes(1);
  });

  // 3. Member mode: empty list -> section heading and action are absent
  it('member mode: with an empty list the section heading and action are absent', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve(DEFAULT_CONFIG);
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({
          items: [],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    await waitFor(() => {
      expect(screen.queryByTestId('trip-photos-section')).toBeNull();
      expect(screen.queryByTestId('trip-photos-heading')).toBeNull();
      expect(screen.queryByTestId('view-all-in-album-btn')).toBeNull();
    });
  });

  // 4. Member mode: enabled: false -> request is not made and section is absent
  it('member mode: with enabled: false the request is not made and the section is absent', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve({ ...DEFAULT_CONFIG, enabled: false });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    await waitFor(() => {
      expect(screen.queryByTestId('trip-photos-section')).toBeNull();
    });

    // Verify GET /trips/:id/photos?summary=true was NEVER called
    expect(apiRequestSpy).not.toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/photos?summary=true')
    );
  });

  // 5. Member mode: tapping a thumbnail opens viewer with Report and Block for others' photo, and Delete for own
  it('member mode: tapping thumbnail opens viewer with Report & Block for other photo, and Delete for own', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve(DEFAULT_CONFIG);
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({
          items: [PHOTO_1, PHOTO_2], // PHOTO_1 is not mine, PHOTO_2 is mine
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    // 1. Open PHOTO_1 (not mine) -> should show Report and Block uploader, but not Delete
    const thumb1 = await screen.findByTestId('trip-photo-highlight-photo-1');
    fireEvent.press(thumb1);

    expect(await screen.findByTestId('photo-viewer-report')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-block')).toBeTruthy();
    expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();

    // Close viewer
    fireEvent.press(screen.getByTestId('photo-viewer-close'));

    // 2. Open PHOTO_2 (mine) -> should show Delete, and not Report / Block uploader
    const thumb2 = await screen.findByTestId('trip-photo-highlight-photo-2');
    fireEvent.press(thumb2);

    expect(await screen.findByTestId('photo-viewer-delete')).toBeTruthy();
    expect(screen.queryByTestId('photo-viewer-report')).toBeNull();
    expect(screen.queryByTestId('photo-viewer-block')).toBeNull();
  });

  // 6. Recipient mode: renders supplied thumbnails, no "View all in album", no add/edit/delete, and Report/Block send shareId
  it('recipient mode: renders supplied thumbnails, no album action, and Report/Block send shareId', async () => {
    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path === `/photos/${PHOTO_1.id}/report`) {
        return Promise.resolve();
      }
      if (method === 'POST' && path === '/me/blocks') {
        return Promise.resolve({ id: 'block-1', blockedId: 'blocked-user', createdAt: '2026-05-01T00:00:00Z' });
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    });

    renderWithClient(
      <TripPhotosSection
        mode="recipient"
        photos={[PHOTO_1, PHOTO_3]}
        shareId={SHARE_ID}
      />
    );

    // Thumbnails render
    expect(await screen.findByTestId('trip-photo-highlight-photo-1')).toBeTruthy();
    expect(screen.getByTestId('trip-photo-highlight-photo-3')).toBeTruthy();

    // No "View all in album" action and no delete button
    expect(screen.queryByTestId('view-all-in-album-btn')).toBeNull();
    expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();

    // No hook request made for recipient mode: neither the highlights read nor the config read
    expect(apiRequestSpy).not.toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/photos?summary=true')
    );
    expect(apiRequestSpy).not.toHaveBeenCalledWith('GET', '/photos/config');
    expect(apiRequestSpy.mock.calls.filter(([method]) => method === 'GET')).toHaveLength(0);

    // Open viewer for PHOTO_1
    fireEvent.press(screen.getByTestId('trip-photo-highlight-photo-1'));

    // Test Report sends shareId
    const reportBtn = await screen.findByTestId('photo-viewer-report');
    fireEvent.press(reportBtn);

    const inappropriateOption = await screen.findByTestId('report-reason-inappropriate');
    fireEvent.press(inappropriateOption);

    const submitReportBtn = screen.getByTestId('submit-report-button');
    fireEvent.press(submitReportBtn);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith(
        'POST',
        `/photos/${PHOTO_1.id}/report`,
        expect.objectContaining({
          reason: 'inappropriate',
          shareId: SHARE_ID,
        })
      );
    });

    // Dismiss report sheet via Done button
    const doneBtn = await screen.findByText('Done');
    fireEvent.press(doneBtn);

    // Test Block sends photoId and shareId with no userId
    const blockBtn = await screen.findByTestId('photo-viewer-block');
    fireEvent.press(blockBtn);

    const confirmBlockBtn = await screen.findByTestId('confirm-block-button');
    fireEvent.press(confirmBlockBtn);

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/blocks', {
        photoId: PHOTO_1.id,
        shareId: SHARE_ID,
      });
    });
  });

  // D35 / R15.31: "View all photos" in recipient mode only
  it('recipient mode: with onViewAll shows "View all photos" (button) and pressing it calls the handler once', async () => {
    const onViewAll = jest.fn();
    renderWithClient(
      <TripPhotosSection
        mode="recipient"
        photos={[PHOTO_1, PHOTO_3]}
        shareId={SHARE_ID}
        onViewAll={onViewAll}
      />
    );

    const btn = await screen.findByTestId('view-all-photos-btn');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('View all photos');
    expect(screen.getByText('View all photos')).toBeTruthy();
    // The member's album link stays absent in recipient mode.
    expect(screen.queryByTestId('view-all-in-album-btn')).toBeNull();

    fireEvent.press(btn);
    expect(onViewAll).toHaveBeenCalledTimes(1);
    // Recipient mode still makes no request of its own.
    expect(apiRequestSpy).not.toHaveBeenCalled();
  });

  it('recipient mode: without onViewAll the action is absent', () => {
    renderWithClient(
      <TripPhotosSection mode="recipient" photos={[PHOTO_1]} shareId={SHARE_ID} />
    );

    expect(screen.getByTestId('trip-photos-section')).toBeTruthy();
    expect(screen.queryByTestId('view-all-photos-btn')).toBeNull();
    expect(screen.queryByText('View all photos')).toBeNull();
  });

  it('recipient mode: with no photos nothing renders even when onViewAll is given', () => {
    renderWithClient(
      <TripPhotosSection mode="recipient" photos={[]} shareId={SHARE_ID} onViewAll={jest.fn()} />
    );

    expect(screen.queryByTestId('trip-photos-section')).toBeNull();
    expect(screen.queryByTestId('view-all-photos-btn')).toBeNull();
  });

  it('member mode never shows "View all photos"', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') return Promise.resolve(DEFAULT_CONFIG);
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({ items: [PHOTO_1], nextCursor: null });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    renderWithClient(<TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />);

    expect(await screen.findByTestId('view-all-in-album-btn')).toBeTruthy();
    expect(screen.queryByTestId('view-all-photos-btn')).toBeNull();
    expect(screen.queryByText('View all photos')).toBeNull();
  });

  // 7. Theme repaint test
  it('theme: repaints when theme scheme switches between light and dark', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path === '/photos/config') {
        return Promise.resolve(DEFAULT_CONFIG);
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return Promise.resolve({
          items: [PHOTO_1],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    setTestScheme('light');
    const { rerender } = renderWithClient(
      <TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />
    );

    const heading = await screen.findByTestId('trip-photos-heading');
    expect(heading).toBeTruthy();
    expect(heading.props.style.color).toBe(lightTheme.color.textPrimary);

    setTestScheme('dark');
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <TripPhotosSection mode="member" tripId={TRIP_ID} onNavigateToAlbum={mockOpenAlbum} />
      </QueryClientProvider>
    );

    const headingDark = await screen.findByTestId('trip-photos-heading');
    expect(headingDark.props.style.color).toBe(darkTheme.color.textPrimary);
    expect(headingDark.props.style.color).not.toBe(lightTheme.color.textPrimary);
  });
});
