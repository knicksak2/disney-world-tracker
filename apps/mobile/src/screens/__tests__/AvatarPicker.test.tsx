/**
 * Component & artwork tests for AvatarPicker and AvatarPresets (24 trademark-safe presets).
 *
 * Covers:
 *   - Rendering all 24 preset radio tiles (verified against AVATAR_PRESET_IDS and
 *     AVATAR_PRESET_LABELS) plus the "No avatar" option when opened
 *   - Selecting a new preset (e.g. 'pineapple-whip') triggers PUT /me/profile/avatar
 *     with { avatarPreset: 'pineapple-whip' }, passes updated ProfileDTO to onChanged,
 *     and closes the picker grid
 *   - Selecting "No avatar" triggers PUT /me/profile/avatar with { avatarPreset: null },
 *     passes updated ProfileDTO to onChanged, and closes the picker grid
 *   - Re-tapping the currently selected preset closes the grid without an API request
 *   - API error surfaces an alert without calling onChanged
 *   - renderAvatarPreset renders an SVG badge for every id in AVATAR_PRESET_IDS and
 *     returns null for null or retired/unknown ids
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AVATAR_PRESET_IDS, type AvatarPresetId, type ProfileDTO } from '@dwt/shared';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => 'token-abc'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

import AvatarPicker from '../AvatarPicker';
import {
  AVATAR_PRESET_COMPONENTS,
  AVATAR_PRESET_LABELS,
  renderAvatarPreset,
} from '../../avatars/AvatarPresets';

function makeProfile(avatarPreset: AvatarPresetId | null): ProfileDTO {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    displayName: 'Explorer',
    avatarPreset,
    overallCompletionPercent: 37.5,
  };
}

function mockFetchJson(status: number, body: unknown): jest.Mock {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('AvatarPicker', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('renders all 24 preset radio tiles and "No avatar" when opened', () => {
    expect(AVATAR_PRESET_IDS).toHaveLength(24);

    render(<AvatarPicker currentPreset={null} onChanged={jest.fn()} />);
    expect(screen.queryByTestId('avatar-picker-grid')).toBeNull();

    fireEvent.press(screen.getByText('Choose an avatar'));
    expect(screen.getByTestId('avatar-picker-grid')).toBeTruthy();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(25); // 24 presets + "No avatar"

    for (const id of AVATAR_PRESET_IDS) {
      expect(screen.getByLabelText(AVATAR_PRESET_LABELS[id])).toBeTruthy();
    }
    expect(screen.getByLabelText('No avatar')).toBeTruthy();
  });

  it('selecting a new preset calls PUT /me/profile/avatar, invokes onChanged, and closes the grid', async () => {
    const updated = makeProfile('pineapple-whip');
    const fetchMock = mockFetchJson(200, updated);
    const onChanged = jest.fn();

    render(<AvatarPicker currentPreset="castle" onChanged={onChanged} />);

    fireEvent.press(screen.getByText('Change avatar'));
    fireEvent.press(screen.getByLabelText(AVATAR_PRESET_LABELS['pineapple-whip']));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(updated);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/me/profile/avatar');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ avatarPreset: 'pineapple-whip' });
    expect(screen.queryByTestId('avatar-picker-grid')).toBeNull();
  });

  it('pressing "No avatar" calls PUT /me/profile/avatar with null and invokes onChanged', async () => {
    const cleared = makeProfile(null);
    const fetchMock = mockFetchJson(200, cleared);
    const onChanged = jest.fn();

    render(<AvatarPicker currentPreset="pretzel" onChanged={onChanged} />);

    fireEvent.press(screen.getByText('Change avatar'));
    fireEvent.press(screen.getByLabelText('No avatar'));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(cleared);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/me/profile/avatar');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ avatarPreset: null });
    expect(screen.queryByTestId('avatar-picker-grid')).toBeNull();
  });

  it('re-tapping the currently selected preset closes the grid without calling the API', () => {
    const fetchMock = mockFetchJson(200, makeProfile('castle'));
    const onChanged = jest.fn();

    render(<AvatarPicker currentPreset="castle" onChanged={onChanged} />);

    fireEvent.press(screen.getByText('Change avatar'));
    expect(screen.getByTestId('avatar-picker-grid')).toBeTruthy();

    fireEvent.press(screen.getByLabelText(AVATAR_PRESET_LABELS.castle));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByTestId('avatar-picker-grid')).toBeNull();
  });

  it('surfaces an alert and stays open when the API rejects the update', async () => {
    mockFetchJson(400, {
      error: { code: 'avatar_invalid', message: 'Avatar preset is invalid.' },
    });
    const onChanged = jest.fn();

    render(<AvatarPicker currentPreset="castle" onChanged={onChanged} />);

    fireEvent.press(screen.getByText('Change avatar'));
    fireEvent.press(screen.getByLabelText(AVATAR_PRESET_LABELS['royal-crown']));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Avatar preset is invalid.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('avatar-picker-grid')).toBeTruthy();
  });
});

describe('AvatarPresets registry & renderAvatarPreset', () => {
  it('registers components and labels for all 24 presets and renders each SVG cleanly', () => {
    expect(Object.keys(AVATAR_PRESET_COMPONENTS)).toHaveLength(24);
    expect(Object.keys(AVATAR_PRESET_LABELS)).toHaveLength(24);

    for (const id of AVATAR_PRESET_IDS) {
      const el = renderAvatarPreset(id, 48);
      expect(el).not.toBeNull();
      const view = render(<>{el}</>);
      const json = JSON.stringify(view.toJSON());
      expect(json).toContain('RNSVGSvgView');
      expect(json).toContain(AVATAR_PRESET_LABELS[id]);
      view.unmount();
    }
  });

  it('returns null for null or unknown/retired preset ids', () => {
    expect(renderAvatarPreset(null)).toBeNull();
    expect(renderAvatarPreset('ear-balloon' as unknown as AvatarPresetId)).toBeNull();
    expect(renderAvatarPreset('ice-cream-bar' as unknown as AvatarPresetId)).toBeNull();
  });
});
