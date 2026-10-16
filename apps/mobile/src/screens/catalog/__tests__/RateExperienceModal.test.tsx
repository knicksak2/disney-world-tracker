// Feature: experience-detail-redesign — RateExperienceModal interaction tests

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { RATE_DIALOG } from '../RateExperienceModal.palette';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import RateExperienceModal from '../RateExperienceModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const EXPERIENCE_ID = 'exp-123';
const EXPERIENCE_NAME = 'Pirates of the Caribbean';

describe('RateExperienceModal', () => {
  const mockOnClose = jest.fn();
  const mockOnRated = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with title, experience name, and 10 rating tiles', () => {
    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={null}
        onClose={mockOnClose}
        onRated={mockOnRated}
      />,
    );

    expect(screen.getByText('Rate Experience')).toBeTruthy();
    expect(screen.getByText(EXPERIENCE_NAME)).toBeTruthy();
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByTestId(`rating-tile-${i}`)).toBeTruthy();
    }
  });

  it('selects rating, displays score descriptor, and saves via PUT on Save Rating tap', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'rating-1',
      experienceId: EXPERIENCE_ID,
      rating: 9,
      ratedAt: '2026-09-24T20:00:00Z',
    });

    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={null}
        onClose={mockOnClose}
        onRated={mockOnRated}
      />,
    );

    // Tap tile 9
    fireEvent.press(screen.getByTestId('rating-tile-9'));

    expect(screen.getByTestId('selected-rating-display')).toBeTruthy();
    expect(screen.getByText('Exceptional / Top tier')).toBeTruthy();

    // Tap Save Rating
    fireEvent.press(screen.getByTestId('save-rating-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/me/experiences/${encodeURIComponent(EXPERIENCE_ID)}/rating`,
        { rating: 9 },
      );
      expect(mockOnRated).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('shows Remove button when currentRating is non-null and sends DELETE on tap', async () => {
    apiRequestMock.mockResolvedValueOnce(null);

    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={8}
        onClose={mockOnClose}
        onRated={mockOnRated}
      />,
    );

    const removeButton = screen.getByTestId('remove-rating-button');
    expect(removeButton).toBeTruthy();

    fireEvent.press(removeButton);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/me/experiences/${encodeURIComponent(EXPERIENCE_ID)}/rating`,
      );
      expect(mockOnRated).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('invokes onClose when close button is pressed', () => {
    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={null}
        onClose={mockOnClose}
        onRated={mockOnRated}
      />,
    );

    fireEvent.press(screen.getByTestId('close-rate-modal'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('displays error message when PUT fails', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        code: 'rating_out_of_range',
        message: 'Rating must be 1-10.',
        status: 400,
      }),
    );

    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={null}
        onClose={mockOnClose}
        onRated={mockOnRated}
      />,
    );

    fireEvent.press(screen.getByTestId('rating-tile-5'));
    fireEvent.press(screen.getByTestId('save-rating-button'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-error-text')).toBeTruthy();
      expect(screen.getByText('Rating must be 1-10.')).toBeTruthy();
    });
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});

/** Nearest painted `backgroundColor` at or above `node` (dialog surface lookup). */
function paintedBackground(node: ReactTestInstance | null): unknown {
  for (let n = node; n !== null; n = n.parent) {
    const style = n.props.style;
    if (style === undefined || typeof style === 'function') continue;
    const flat = StyleSheet.flatten(style) as { backgroundColor?: unknown } | undefined;
    if (flat?.backgroundColor !== undefined) return flat.backgroundColor;
  }
  return undefined;
}

describe('RateExperienceModal — dark mode', () => {
  afterEach(resetTestScheme);

  it('paints the dialog, title and rating tiles with dark values', () => {
    setTestScheme('dark');
    render(
      <RateExperienceModal
        experienceId={EXPERIENCE_ID}
        experienceName={EXPERIENCE_NAME}
        visible={true}
        currentRating={4}
        onClose={jest.fn()}
        onRated={jest.fn()}
      />,
    );

    // (a) dialog surface (rule 1: `#ffffff` background → surface).
    const title = screen.getByText('Rate Experience');
    expect(paintedBackground(title)).toBe(darkTheme.color.surface);
    // (b) the dialog's primary text — its violet title literal (rule 3 T).
    expect(StyleSheet.flatten(title.props.style).color).toBe(RATE_DIALOG.dark.title);
    // (c) idle tile (lavender subtle → surfaceAlt), active tile (primary fill,
    // white number) and the red Remove button (rule 3 S / T).
    expect(StyleSheet.flatten(screen.getByTestId('rating-tile-1').props.style).backgroundColor).toBe(
      darkTheme.color.surfaceAlt,
    );
    expect(StyleSheet.flatten(screen.getByTestId('rating-tile-4').props.style).backgroundColor).toBe(
      darkTheme.color.primary,
    );
    expect(StyleSheet.flatten(screen.getByText('4', { exact: true }).props.style).color).toBe(
      darkTheme.color.textOnPrimary,
    );
    expect(StyleSheet.flatten(screen.getByText('Remove').props.style).color).toBe(
      RATE_DIALOG.dark.removeText,
    );
  });
});
