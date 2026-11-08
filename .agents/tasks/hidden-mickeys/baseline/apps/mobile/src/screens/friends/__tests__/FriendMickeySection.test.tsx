import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { FriendMickeyFindsPageDTO, MickeySummaryDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import FriendMickeySection from '../FriendMickeySection';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const mockSummary: MickeySummaryDTO = {
  overall: { found: 8, total: 30 },
  byPark: [],
  community: { found: 2 },
};

const mockFindsPage: FriendMickeyFindsPageDTO = {
  items: [
    {
      mickeyId: 'm-1',
      clue1: 'Pattern on the brickwork near the well',
      official: true,
      experienceId: 'exp-cinderella',
      experienceName: "Cinderella's Wishing Well",
      park: 'Magic Kingdom',
      foundOn: '2026-02-01',
    },
  ],
  nextCursor: null,
};

function renderSection(friendId: string, displayName: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FriendMickeySection friendId={friendId} displayName={displayName} />
    </QueryClientProvider>,
  );
}

describe('FriendMickeySection (Task 10.7, Requirements 10.1, 10.2, 10.4)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('renders summary and recent finds read-only with Clue 1 only', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/config') {
        return { enabled: true, submissionsEnabled: true } as never;
      }
      if (path.startsWith('/mickeys/summary?for=friend-1')) {
        return mockSummary as never;
      }
      if (path.startsWith('/users/friend-1/mickeys/finds')) {
        return mockFindsPage as never;
      }
      return {} as never;
    });

    renderSection('friend-1', 'Goofy');

    expect(await screen.findByText('8 / 30')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // Community finds

    // Recent find with Clue 1
    expect(screen.getByText("Cinderella's Wishing Well")).toBeTruthy();
    expect(screen.getByText('Pattern on the brickwork near the well')).toBeTruthy();
    expect(screen.getByText('2026-02-01')).toBeTruthy();

    // Verify read-only: no buttons/inputs/controls for find/undo/vote/hint
    expect(screen.queryByLabelText('I found it')).toBeNull();
    expect(screen.queryByLabelText('Need a hint?')).toBeNull();
    expect(screen.queryByLabelText('Still there')).toBeNull();
  });

  it('renders empty text when friend has no finds', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/config') {
        return { enabled: true, submissionsEnabled: true } as never;
      }
      if (path.startsWith('/mickeys/summary?for=friend-1')) {
        return { overall: { found: 0, total: 30 }, byPark: [], community: { found: 0 } } as never;
      }
      if (path.startsWith('/users/friend-1/mickeys/finds')) {
        return { items: [], nextCursor: null } as never;
      }
      return {} as never;
    });

    renderSection('friend-1', 'Goofy');

    expect(await screen.findByText("Goofy hasn't recorded any Hidden Mickey finds yet.")).toBeTruthy();
  });
});
