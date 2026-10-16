/**
 * Feature: dark-mode — ParkWaitPulse selected-park ring (Requirement 9.12).
 *
 * The active park pill's ring must differ from the unselected ring and reach
 * 3:1 against the pill surface in dark; light keeps today's `#22c55e` ring.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiRequest } from '../../../api/client';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { contrastRatio } from '../../../theme/contrast';
import { DARK_TONAL, darkTheme, lightTheme } from '../../../theme/theme';
import ParkWaitPulse from '../ParkWaitPulse';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});
jest.mock('../../../navigation/navigationRef', () => ({
  navigateToLiveWaits: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

function renderPulse() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ParkWaitPulse activePark="Magic Kingdom" />
    </QueryClientProvider>,
  );
}

function pillStyle(park: string) {
  return StyleSheet.flatten(screen.getByTestId(`home-pulse-pill-${park}`).props.style) as {
    borderColor?: string;
    borderWidth?: number;
    backgroundColor?: string;
  };
}

describe('ParkWaitPulse selected-park ring', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockImplementation(async () => ({
      park: 'Magic Kingdom',
      entries: [
        { experienceId: 'e-1', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 35 },
        { experienceId: 'e-2', name: 'Big Thunder', status: 'OPERATING', waitMinutes: 25 },
      ],
      retrievedAt: new Date().toISOString(),
      stale: false,
    }));
  });
  afterEach(resetTestScheme);

  it('dark: the active ring is distinct from the unselected ring and >= 3:1 on the surface', () => {
    setTestScheme('dark');
    renderPulse();

    const active = pillStyle('Magic Kingdom');
    const idle = pillStyle('EPCOT');

    expect(active.borderWidth).toBe(2);
    expect(active.borderColor).toBe(DARK_TONAL.green.fg);
    expect(idle.borderColor).toBe(DARK_TONAL.violet.border);
    expect(active.borderColor).not.toBe(idle.borderColor);
    expect(active.backgroundColor).toBe(darkTheme.color.surface);
    expect(contrastRatio(active.borderColor!, darkTheme.color.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(active.borderColor!, idle.borderColor!)).toBeGreaterThanOrEqual(3);
  });

  it('light: the active ring keeps today\'s #22c55e', () => {
    setTestScheme('light');
    renderPulse();

    expect(pillStyle('Magic Kingdom').borderColor).toBe('#22c55e');
    expect(pillStyle('Magic Kingdom').backgroundColor).toBe(lightTheme.color.surface);
  });
});
