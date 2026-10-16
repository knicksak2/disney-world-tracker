// Feature: food-item-logging, Task 7.7 — CreateLocationModal interaction tests
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4

import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { LocationSuggestionDTO, UserSubmittedLocationDTO } from '@dwt/shared';

import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

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

import CreateLocationModal from '../CreateLocationModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_SUGGESTIONS: readonly LocationSuggestionDTO[] = [
  {
    id: 'loc-1',
    name: 'Spring Roll Snack Cart',
    park: 'Magic Kingdom',
    similarity: 0.85,
  },
  {
    id: 'loc-2',
    name: 'Adventureland Spring Roll Stand',
    park: 'Magic Kingdom',
    similarity: 0.45,
  },
];

describe('CreateLocationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with park name, input field, and action buttons', () => {
    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={jest.fn()}
        onLocationSelected={jest.fn()}
      />,
    );

    expect(screen.getByText('Add Food Spot')).toBeTruthy();
    expect(screen.getByText("Can't find a snack cart or stand in Magic Kingdom? Add it here.")).toBeTruthy();
    expect(screen.getByTestId('create-location-name-input')).toBeTruthy();
    expect(screen.getByTestId('create-location-submit-btn')).toBeTruthy();
  });

  it('queries suggestions as user types and renders suggestions with similarity', async () => {
    apiRequestMock.mockResolvedValueOnce(MOCK_SUGGESTIONS);

    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={jest.fn()}
        onLocationSelected={jest.fn()}
      />,
    );

    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Spring Roll Cart',
    );

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('/locations/suggest?park=Magic%20Kingdom&name=Spring%20Roll%20Cart'),
      );
      expect(screen.getByText('Spring Roll Snack Cart')).toBeTruthy();
      expect(screen.getByText('85% match')).toBeTruthy();
      expect(screen.getByText('Adventureland Spring Roll Stand')).toBeTruthy();
      expect(screen.getByText('45% match')).toBeTruthy();
    });
  });

  it('selecting a suggestion routes directly into onLocationSelected without calling POST', async () => {
    apiRequestMock.mockResolvedValueOnce(MOCK_SUGGESTIONS);

    const onLocationSelected = jest.fn();
    const onClose = jest.fn();

    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={onClose}
        onLocationSelected={onLocationSelected}
      />,
    );

    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Spring Roll',
    );

    await waitFor(() => {
      expect(screen.getByTestId('location-suggestion-loc-1')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('location-suggestion-loc-1'));

    expect(onLocationSelected).toHaveBeenCalledWith({
      id: 'loc-1',
      name: 'Spring Roll Snack Cart',
      park: 'Magic Kingdom',
    });
    // Crucial: POST /locations must NOT have been called
    expect(apiRequestMock).not.toHaveBeenCalledWith('POST', '/locations', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a new location calling POST /locations and routes to newly created location', async () => {
    const createdLoc: UserSubmittedLocationDTO = {
      id: 'new-loc-id',
      name: 'Cheshire Cafe Snack Cart',
      park: 'Magic Kingdom',
    };

    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path.includes('/locations/suggest')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && path === '/locations') {
        return Promise.resolve(createdLoc);
      }
      return Promise.resolve([]);
    });

    const onLocationSelected = jest.fn();
    const onClose = jest.fn();

    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={onClose}
        onLocationSelected={onLocationSelected}
      />,
    );

    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Cheshire Cafe Snack Cart',
    );

    await waitFor(() => {
      expect(screen.getByText('Create "Cheshire Cafe Snack Cart"')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('create-location-submit-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/locations',
        {
          name: 'Cheshire Cafe Snack Cart',
          park: 'Magic Kingdom',
        },
      );
      expect(onLocationSelected).toHaveBeenCalledWith(createdLoc);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('collapses to existing location when POST returns location_duplicate with existingId', async () => {
    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path.includes('/locations/suggest')) {
        return Promise.resolve([]);
      }
      if (method === 'POST' && path === '/locations') {
        return Promise.reject(
          new ApiError({
            code: 'location_duplicate',
            message: 'A location with that name already exists in this park',
            status: 409,
            details: { existingId: 'existing-loc-123' },
          }),
        );
      }
      return Promise.resolve([]);
    });

    const onLocationSelected = jest.fn();
    const onClose = jest.fn();

    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={onClose}
        onLocationSelected={onLocationSelected}
      />,
    );

    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Spring Roll Cart',
    );

    fireEvent.press(screen.getByTestId('create-location-submit-btn'));

    await waitFor(() => {
      expect(onLocationSelected).toHaveBeenCalledWith({
        id: 'existing-loc-123',
        name: 'Spring Roll Cart',
        park: 'Magic Kingdom',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('allows user to switch park via park chip and queries/submits with selected park', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'epcot-loc-1',
      name: 'Festival Kiosk',
      park: 'EPCOT',
    });

    const onLocationSelected = jest.fn();

    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={jest.fn()}
        onLocationSelected={onLocationSelected}
      />,
    );

    // Switch to EPCOT
    fireEvent.press(screen.getByTestId('create-location-park-chip-epcot'));

    expect(screen.getByText("Can't find a snack cart or stand in EPCOT? Add it here.")).toBeTruthy();

    fireEvent.changeText(
      screen.getByTestId('create-location-name-input'),
      'Festival Kiosk',
    );

    fireEvent.press(screen.getByTestId('create-location-submit-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/locations', {
        name: 'Festival Kiosk',
        park: 'EPCOT',
      });
      expect(onLocationSelected).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'epcot-loc-1',
          name: 'Festival Kiosk',
          park: 'EPCOT',
        }),
      );
    });
  });

  test('uses undefined behavior for KeyboardAvoidingView on Android to prevent adjustResize jitter loops', () => {
    const originalPlatform = Platform.OS;
    try {
      Platform.OS = 'android';
      render(
        <CreateLocationModal
          park="Magic Kingdom"
          visible={true}
          onClose={jest.fn()}
          onLocationSelected={jest.fn()}
        />,
      );
      const modal = screen.getByTestId('create-location-modal');
      const kav = modal.findByType(KeyboardAvoidingView);
      expect(kav.props.behavior).toBeUndefined();
    } finally {
      Platform.OS = originalPlatform;
    }
  });
});

/** Nearest painted `backgroundColor` at or above `node` (sheet surface lookup). */
function paintedBackground(node: ReactTestInstance | null): unknown {
  for (let n = node; n !== null; n = n.parent) {
    const style = n.props.style;
    if (style === undefined || typeof style === 'function') continue;
    const flat = StyleSheet.flatten(style) as { backgroundColor?: unknown } | undefined;
    if (flat?.backgroundColor !== undefined) return flat.backgroundColor;
  }
  return undefined;
}

describe('CreateLocationModal — dark mode', () => {
  afterEach(resetTestScheme);

  it('paints the sheet, title and converted controls with dark tokens', () => {
    setTestScheme('dark');
    render(
      <CreateLocationModal
        park="Magic Kingdom"
        visible={true}
        onClose={jest.fn()}
        onLocationSelected={jest.fn()}
      />,
    );

    // (a) the sheet surface.
    expect(paintedBackground(screen.getByText('Add Food Spot'))).toBe(darkTheme.color.surface);
    // (b) primary text.
    expect(StyleSheet.flatten(screen.getByText('Add Food Spot').props.style).color).toBe(
      darkTheme.color.textPrimary,
    );
    // (c) the selected park chip is a primary fill with white text (rule 1 `#ffffff`
    // on a fill → textOnPrimary), and the TextInput follows the scheme.
    const chip = screen.getByTestId('create-location-park-chip-magic-kingdom');
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(darkTheme.color.primary);
    expect(StyleSheet.flatten(screen.getByText('Magic Kingdom').props.style).color).toBe(
      darkTheme.color.textOnPrimary,
    );
    const input = screen.getByTestId('create-location-name-input');
    expect(input.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
    expect(input.props.keyboardAppearance).toBe('dark');
  });
});

