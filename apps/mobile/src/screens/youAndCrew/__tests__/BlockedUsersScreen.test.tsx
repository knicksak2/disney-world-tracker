// Feature: photo-uploads, Task 13.8 — Blocked Users Screen tests
//
// Validates: Requirements 17.1, 17.5

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BlockedUserDTO } from '@dwt/shared';
import * as clientModule from '../../../api/client';
import BlockedUsersScreen from '../BlockedUsersScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
    }),
  };
});

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => 'mock-token'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MOCK_BLOCKS: BlockedUserDTO[] = [
  {
    blockId: 'block-named-1',
    displayName: 'Daisy Duck',
    avatarPreset: 'mickey',
    createdAt: '2026-10-15T12:00:00Z',
  },
  {
    blockId: 'block-anon-2',
    displayName: null,
    avatarPreset: null,
    createdAt: '2026-10-18T08:30:00Z',
  },
];

describe('BlockedUsersScreen (Task 13.8)', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  it('renders names from GET /me/blocks and label "Photo uploader" with date when name is null', async () => {
    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/me/blocks') {
        // Real server shape: a bare array (GET /me/blocks), not `{ blocks: [...] }`.
        return Promise.resolve(MOCK_BLOCKS);
      }
      return Promise.resolve([]);
    });

    render(<BlockedUsersScreen />, { wrapper: createWrapper() });

    // Named block item
    await waitFor(() => {
      expect(screen.getByText('Daisy Duck')).toBeTruthy();
      expect(screen.getByTestId('blocked-user-row-block-named-1')).toBeTruthy();
    });

    // Anonymous block item (displayName === null)
    expect(screen.getByText('Photo uploader')).toBeTruthy();
    expect(screen.getByTestId('blocked-user-row-block-anon-2')).toBeTruthy();

    // Verify date is rendered for both blocks
    expect(screen.getAllByText(/2026/).length).toBe(2);
  });

  it('Unblock calls DELETE /me/blocks/:blockId (the entry blockId, not a user id) and removes the row', async () => {
    let currentBlocks = [...MOCK_BLOCKS];

    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/me/blocks') {
        return Promise.resolve(currentBlocks);
      }
      if (method === 'DELETE' && path === '/me/blocks/block-anon-2') {
        currentBlocks = currentBlocks.filter((b) => b.blockId !== 'block-anon-2');
        return Promise.resolve(undefined);
      }
      return Promise.resolve([]);
    });

    render(<BlockedUsersScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('unblock-btn-block-anon-2')).toBeTruthy();
    });

    // Tap Unblock for anonymous block
    fireEvent.press(screen.getByTestId('unblock-btn-block-anon-2'));

    // Assert DELETE was called with the blockId
    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/me/blocks/block-anon-2');
    });

    // The unblocked row is removed
    await waitFor(() => {
      expect(screen.queryByTestId('blocked-user-row-block-anon-2')).toBeNull();
      expect(screen.queryByText('Photo uploader')).toBeNull();
    });

    // The other block remains
    expect(screen.getByText('Daisy Duck')).toBeTruthy();
  });

  it('renders empty state when there are no blocked users', async () => {
    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/me/blocks') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(<BlockedUsersScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('blocked-users-empty')).toBeTruthy();
      expect(screen.getByText('No blocked users')).toBeTruthy();
    });
  });
});
