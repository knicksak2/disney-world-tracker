/**
 * Tests for `useClaimablePinsBadge` (Requirement 22.3, 22.4).
 *
 * Asserts:
 *  - the hidden/count/overflow derivation from a seeded `['me','pins']` cache;
 *  - that the hook reads the identical cache entry `PinBoardScreen` populates (same `pinBoardKey`),
 *    so seeding the cache once and rendering both can never disagree.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import { useClaimablePinsBadge } from '../useClaimablePinsBadge';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { pinBoardKey } from '../../../screens/profile/PinBoardScreen';
import { PINS, type PinBoardDTO, type UserPinProgressDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function readyProg(pinId: string): UserPinProgressDTO {
  return {
    pinId,
    unlocked: true,
    awardedAt: '2026-01-15T10:00:00.000Z',
    currentValue: null,
    targetValue: null,
    percentComplete: null,
    claimedAt: null,
  };
}
function claimedProg(pinId: string): UserPinProgressDTO {
  return { ...readyProg(pinId), claimedAt: '2026-01-15T10:05:00.000Z' };
}
function lockedProg(pinId: string): UserPinProgressDTO {
  return {
    pinId,
    unlocked: false,
    awardedAt: null,
    currentValue: 0,
    targetValue: 1,
    percentComplete: 0,
    claimedAt: null,
  };
}

function boardOf(pins: UserPinProgressDTO[]): PinBoardDTO {
  return {
    pins,
    tierSummary: [],
    totalUnlocked: pins.filter((p) => p.unlocked).length,
    totalPins: pins.length,
    overallPercent: 0,
  };
}

function renderWithSeededBoard(pins: UserPinProgressDTO[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(pinBoardKey, boardOf(pins));
  return renderHook(() => useClaimablePinsBadge(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  apiRequestMock.mockReset();
  // The hook's own queryFn would refetch in the background; resolve it to an
  // empty board so no "data cannot be undefined" warning fires mid-test.
  apiRequestMock.mockResolvedValue(boardOf([]) as never);
});

describe('useClaimablePinsBadge', () => {
  it('is hidden when no pin is ready to claim', () => {
    const { result } = renderWithSeededBoard([claimedProg('a'), lockedProg('b')]);
    expect(result.current.display).toBe('hidden');
    expect(result.current.count).toBe(0);
  });

  it('shows the exact count for 1-99 ready-to-claim pins', () => {
    const { result } = renderWithSeededBoard([
      readyProg('a'),
      readyProg('b'),
      claimedProg('c'),
      lockedProg('d'),
    ]);
    expect(result.current.display).toBe('count');
    expect(result.current.count).toBe(2);
  });

  it('overflows to "99+" semantics (display=overflow) at 100 or more ready-to-claim pins', () => {
    const pins = Array.from({ length: 100 }, (_, i) => readyProg(`p${i}`));
    const { result } = renderWithSeededBoard(pins);
    expect(result.current.display).toBe('overflow');
    expect(result.current.count).toBe(100);
  });

  it('reads the identical pinBoardKey cache PinBoardScreen populates (Requirement 22.4)', () => {
    const realPinId = PINS[0]!.id;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    // Seed via the exact same key export the board screen uses.
    client.setQueryData(pinBoardKey, boardOf([readyProg(realPinId)]));

    const { result } = renderHook(() => useClaimablePinsBadge(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });

    expect(result.current.count).toBe(1);
    expect(result.current.display).toBe('count');

    // Simulating a claim landing (as PinBoardScreen's claim mutation does via
    // queryClient.setQueryData on this exact key) is immediately reflected.
    client.setQueryData<PinBoardDTO>(pinBoardKey, (prev) =>
      prev
        ? { ...prev, pins: prev.pins.map((p) => (p.pinId === realPinId ? { ...p, claimedAt: 'x' } : p)) }
        : prev,
    );
    const { result: after } = renderHook(() => useClaimablePinsBadge(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(after.current.count).toBe(0);
    expect(after.current.display).toBe('hidden');
  });
});
