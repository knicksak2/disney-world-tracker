/**
 * Interaction tests for PinBoardScreen (task 8.7, extended by task 10.18 for manual claim).
 *
 * Drives each interaction the board adds and asserts BOTH the data path and the on-screen change:
 *  - initial load: fetches `GET /me/pins` and renders the grid;
 *  - tier pill filter: narrows the grid client-side (no refetch) while the whole-collection header
 *    stays put (R5.3);
 *  - track tab filter: narrows the grid to that track;
 *  - open detail: tapping a locked or already-claimed pin opens `PinDetailModal`;
 *  - claim: tapping a ready-to-claim pin calls `POST /me/pins/:pinId/claim` and shows
 *    `PinCelebrationModal` instead of the detail modal, with a haptic on success (Requirement 20);
 *  - chaining: multiple ready-to-claim pins (e.g. via `celebratePinIds`) are claimed and
 *    celebrated one after another without leaving the board (Requirement 20.6);
 *  - view details from celebration: hands off to `PinDetailModal` for the claimed pin;
 *  - credits: the header control navigates to the attribution screen.
 *
 * The board read is the only network call driven by filtering; the filters are client-side by
 * design (the header must not move as the grid filters), so those interactions assert the grid
 * change + that no extra board fetch occurred rather than a per-filter request.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

// Replace only `apiRequest`; keep the real `ApiError`.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import PinBoardScreen from '../PinBoardScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import * as Haptics from 'expo-haptics';
import { PINS, PIN_TIERS } from '@dwt/shared';
import type { PinBoardDTO, PinDTO, UserPinProgressDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const notificationAsyncMock = Haptics.notificationAsync as jest.MockedFunction<
  typeof Haptics.notificationAsync
>;

// Fixture pins spanning distinct tiers and tracks so the filters are observable.
const pinA: PinDTO = PINS.find((p) => p.tier === 'bronze')!;
const pinB: PinDTO = PINS.find((p) => p.tier === 'gold' && p.track !== pinA.track)!;
const pinC: PinDTO = PINS.find((p) => p.tier === 'silver' && p.id !== pinA.id && p.id !== pinB.id)!;

/** An unlocked, already-claimed pin — the normal steady-state unlocked pin. */
function unlockedProg(pin: PinDTO): UserPinProgressDTO {
  return {
    pinId: pin.id,
    unlocked: true,
    awardedAt: '2026-01-15T10:00:00.000Z',
    currentValue: null,
    targetValue: null,
    percentComplete: null,
    claimedAt: '2026-01-15T10:01:00.000Z',
  };
}
/** Awarded but not yet claimed — ready to claim (Requirement 20.2). */
function readyToClaimProg(pin: PinDTO): UserPinProgressDTO {
  return {
    pinId: pin.id,
    unlocked: true,
    awardedAt: '2026-01-15T10:00:00.000Z',
    currentValue: null,
    targetValue: null,
    percentComplete: null,
    claimedAt: null,
  };
}
function lockedProg(pin: PinDTO): UserPinProgressDTO {
  return {
    pinId: pin.id,
    unlocked: false,
    awardedAt: null,
    currentValue: 3,
    targetValue: 10,
    percentComplete: 30,
    claimedAt: null,
  };
}

const BOARD: PinBoardDTO = {
  pins: [unlockedProg(pinA), lockedProg(pinB), unlockedProg(pinC)],
  tierSummary: PIN_TIERS.map((t) => ({ tier: t, unlocked: t === 'bronze' ? 1 : 0, total: 1 })),
  totalUnlocked: 2,
  totalPins: 3,
  overallPercent: 66,
};

/** A board where pinB is ready to claim (awarded, unclaimed) instead of locked. */
const BOARD_WITH_READY: PinBoardDTO = {
  ...BOARD,
  pins: [unlockedProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
};

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/**
 * Safely stringify a rendered tree for substring assertions (e.g. checking for a specific
 * `"opacity":0.18` value baked into a `PinView`'s style props). `screen.toJSON()`'s tree can carry
 * circular references (e.g. via context Providers) that break a naive `JSON.stringify`; this
 * replacer drops anything already seen instead of throwing.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return undefined;
      seen.add(val);
    }
    return val;
  });
}

function renderBoard(params: Record<string, unknown> = {}) {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const route = { key: 'k', name: 'PinBoard', params };
  const utils = render(
    <QueryClientProvider client={makeClient()}>
      <PinBoardScreen navigation={navigation as never} route={route as never} />
    </QueryClientProvider>,
  );
  return { navigation, ...utils };
}

/** Route GET /me/pins to `board` and POST claims to a resolved `{pinId, claimedAt}`. */
function mockApi(board: PinBoardDTO): void {
  apiRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/me/pins') return board as never;
    const claimMatch = /^\/me\/pins\/([^/]+)\/claim$/.exec(path);
    if (method === 'POST' && claimMatch) {
      return { pinId: claimMatch[1], claimedAt: '2026-02-01T00:00:00.000Z' } as never;
    }
    throw new Error(`unexpected apiRequest(${method}, ${path})`);
  });
}

beforeEach(() => {
  apiRequestMock.mockReset();
  notificationAsyncMock.mockClear();
  mockApi(BOARD);
});

describe('PinBoardScreen', () => {
  it('fetches the board and renders the grid', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/pins');
    expect(screen.getByTestId(`pin-cell-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-cell-${pinB.id}`)).toBeTruthy();
    expect(screen.getByTestId('pin-board-overall')).toHaveTextContent('66%');
  });

  it('aligns grid rows with flex-start and uniform gap so incomplete rows flow left-to-center without center gaps', async () => {
    renderBoard();
    const cell = await screen.findByTestId(`pin-cell-${pinA.id}`);
    let cur: any = cell;
    let foundStyle: any = null;
    while (cur) {
      const flat = StyleSheet.flatten(cur.props?.style);
      if (flat?.justifyContent) {
        foundStyle = flat;
        break;
      }
      cur = cur.parent;
    }
    expect(foundStyle).toEqual(
      expect.objectContaining({
        justifyContent: 'flex-start',
        gap: 12,
      }),
    );
  });

  it('tier pill filters the grid client-side and leaves the whole-collection header intact', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId('tier-pill-gold'));

    // on-screen change: only the gold pin remains
    expect(screen.getByTestId(`pin-cell-${pinB.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-cell-${pinA.id}`)).toBeNull();
    // no extra board fetch — filtering is client-side
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    // header counts do not move (R5.3)
    expect(screen.getByTestId('pin-board-overall')).toHaveTextContent('66%');
  });

  it('track tab filters the grid to the chosen track', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`track-tab-${pinA.track}`));

    expect(screen.getByTestId(`pin-cell-${pinA.id}`)).toBeTruthy();
    // pinB is a different track, so it drops out
    expect(screen.queryByTestId(`pin-cell-${pinB.id}`)).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('opens the detail modal for a claimed (steady-state unlocked) pin', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');

    expect(screen.queryByTestId('pin-detail-modal')).toBeNull();
    fireEvent.press(screen.getByTestId(`pin-cell-${pinA.id}`));

    await screen.findByTestId('pin-detail-modal');
    expect(screen.getByTestId('pin-detail-name')).toHaveTextContent(pinA.name);
    expect(screen.getByTestId('pin-detail-unlocked')).toBeTruthy();
    expect(screen.queryByTestId('pin-detail-progress')).toBeNull();
    // No claim call — tapping an already-claimed pin never hits the claim endpoint.
    expect(apiRequestMock).not.toHaveBeenCalledWith('POST', expect.stringContaining('/claim'));
  });

  it('shows a progress bar in the detail modal for a locked pin', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
    await screen.findByTestId('pin-detail-modal');
    expect(screen.getByTestId('pin-detail-progress')).toBeTruthy();
    expect(screen.queryByTestId('pin-detail-unlocked')).toBeNull();
  });

  it('renders a "tap to claim" badge only on ready-to-claim pins, not locked or claimed ones', async () => {
    mockApi(BOARD_WITH_READY);
    renderBoard();
    await screen.findByTestId('pin-board');

    expect(screen.getByTestId(`pin-cell-ready-${pinB.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-cell-ready-${pinA.id}`)).toBeNull();
    expect(screen.queryByTestId(`pin-cell-ready-${pinC.id}`)).toBeNull();
  });

  it('renders a ready-to-claim pin with the locked/dimmed art treatment, not the unlocked one, before it is claimed (Requirement 23.1)', async () => {
    mockApi(BOARD_WITH_READY);
    const { toJSON } = renderBoard();
    await screen.findByTestId('pin-board');

    // pinB is ready-to-claim: it must render through PinView's LOCKED branch
    // (dimmed opacity 0.18) exactly like a truly locked pin would, despite
    // `item.unlocked === true` on the DTO — claiming, not earning, reveals it.
    expect(safeStringify(toJSON())).toContain('"opacity":0.18');
  });

  it('reveals the pin\'s art (locked -> unlocked) once a claim resolves (Requirement 23.2)', async () => {
    mockApi(BOARD_WITH_READY);
    const { toJSON } = renderBoard();
    await screen.findByTestId('pin-board');

    // Before claiming: locked/dimmed art is present somewhere in the tree (pinB's cell).
    expect(safeStringify(toJSON())).toContain('"opacity":0.18');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
    await screen.findByTestId('pin-celebration-modal');

    // After the claim resolves, dismiss the celebration to get back to the grid and confirm the
    // tile's rendered art is no longer dimmed — it has been revealed, not left in its pre-claim
    // locked state.
    fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
    await waitFor(() => {
      expect(safeStringify(toJSON())).not.toContain('"opacity":0.18');
    });
  });

  it('shows "Pin claimed!" / "Awesome!" copy on the celebration modal, not "New pin unlocked!" / "Add to collection" (Requirement 23.3)', async () => {
    mockApi(BOARD_WITH_READY);
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
    await screen.findByTestId('pin-celebration-modal');

    expect(screen.getByTestId('pin-celebration-heading')).toHaveTextContent('Pin claimed!');
    expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Awesome!');
  });

  it('tapping a ready-to-claim pin calls the claim endpoint and shows the celebration (not the detail modal)', async () => {
    mockApi(BOARD_WITH_READY);
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`),
    );
    await screen.findByTestId('pin-celebration-modal');
    expect(screen.getByTestId(`pin-celebration-${pinB.id}`)).toBeTruthy();
    expect(screen.queryByTestId('pin-detail-modal')).toBeNull();
    // A success haptic fires on the claim landing (Requirement 20 — the ceremony).
    await waitFor(() => expect(notificationAsyncMock).toHaveBeenCalledWith('success'));
  });

  it('claiming clears the ready-to-claim badge once the mutation resolves', async () => {
    mockApi(BOARD_WITH_READY);
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
    await screen.findByTestId('pin-celebration-modal');
    fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));

    await waitFor(() => expect(screen.queryByTestId(`pin-cell-ready-${pinB.id}`)).toBeNull());
  });

  it('chains through multiple ready-to-claim pins passed via celebratePinIds, claiming and celebrating each in turn', async () => {
    const boardTwoReady: PinBoardDTO = {
      ...BOARD,
      pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
    };
    mockApi(boardTwoReady);
    renderBoard({ celebratePinIds: [pinA.id, pinB.id] });

    // First pin in the queue is claimed and celebrated.
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`));
    await screen.findByTestId('pin-celebration-modal');
    expect(screen.getByTestId(`pin-celebration-${pinA.id}`)).toBeTruthy();

    // Dismissing advances the queue to the second pin — claimed and celebrated next.
    fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`));
    await screen.findByTestId(`pin-celebration-${pinB.id}`);

    // Both claims genuinely fired — chaining claimed each pin, not just displayed it.
    expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`);
    expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`);

    // Dismissing the last one leaves no celebration behind.
    fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('pin-celebration-modal')).toBeNull());
  });

  it('the celebration\'s "View details" hands off to the detail modal for the just-claimed pin', async () => {
    mockApi(BOARD_WITH_READY);
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
    await screen.findByTestId('pin-celebration-modal');

    fireEvent.press(screen.getByTestId('pin-celebration-view-details'));

    await screen.findByTestId('pin-detail-modal');
    expect(screen.getByTestId('pin-detail-name')).toHaveTextContent(pinB.name);
    expect(screen.queryByTestId('pin-celebration-modal')).toBeNull();
  });

  it('viewing details during a multi-pin batch pauses the queue and does not pop the next celebration until details are closed', async () => {
    const boardTwoReady: PinBoardDTO = {
      ...BOARD,
      pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
    };
    mockApi(boardTwoReady);
    renderBoard({ celebratePinIds: [pinA.id, pinB.id] });

    // Pin A starts celebrating ("1 of 2")
    await screen.findByTestId('pin-celebration-modal');
    expect(screen.getByTestId(`pin-celebration-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('1 of 2');

    // Press "View details" on Pin A
    fireEvent.press(screen.getByTestId('pin-celebration-view-details'));

    // Pin A detail modal is presented; celebration modal is dismissed
    await screen.findByTestId('pin-detail-modal');
    expect(screen.getByTestId('pin-detail-name')).toHaveTextContent(pinA.name);
    expect(screen.queryByTestId('pin-celebration-modal')).toBeNull();

    // Pin B does NOT hijack the screen while Pin A details are open
    expect(screen.queryByTestId(`pin-celebration-${pinB.id}`)).toBeNull();

    // Now close the detail modal
    fireEvent.press(screen.getByTestId('pin-detail-close'));

    // The queue resumes: Pin B celebration modal now appears ("2 of 2")
    await screen.findByTestId('pin-celebration-modal');
    expect(screen.getByTestId(`pin-celebration-${pinB.id}`)).toBeTruthy();
    expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('2 of 2');
    expect(screen.queryByTestId('pin-detail-modal')).toBeNull();
  });

  it('navigates to the attribution screen from the credits control', async () => {
    const { navigation } = renderBoard();
    await screen.findByTestId('pin-board');
    fireEvent.press(screen.getByTestId('pin-board-credits'));
    expect(navigation.navigate).toHaveBeenCalledWith('PinAttribution');
  });

  it('navigates to the showcase screen from the showcase control', async () => {
    const { navigation } = renderBoard();
    await screen.findByTestId('pin-board');
    fireEvent.press(screen.getByTestId('pin-board-showcase'));
    expect(navigation.navigate).toHaveBeenCalledWith('PinShowcase');
  });

  it('sorts a ready-to-claim pin ahead of a catalog-earlier locked pin (Requirement 22.1)', async () => {
    // PINS[0] is early in catalog order; pick a pin far later in the catalog
    // to be the ready-to-claim one, so a plain catalog-order sort would put
    // it AFTER pinEarly — the claimable-first comparator must override that.
    const pinEarly = PINS[0]!;
    const pinLate = PINS[50]!;
    const board: PinBoardDTO = {
      pins: [lockedProg(pinEarly), readyToClaimProg(pinLate)],
      tierSummary: PIN_TIERS.map((t) => ({ tier: t, unlocked: 0, total: 1 })),
      totalUnlocked: 1,
      totalPins: 2,
      overallPercent: 50,
    };
    mockApi(board);
    renderBoard();
    await screen.findByTestId('pin-board');

    // Both cells render; the ready-to-claim one must appear earlier in the
    // grid's rendered testID sequence than the catalog-earlier locked one.
    const cells = screen.getAllByTestId(/^pin-cell-/);
    const readyIdx = cells.findIndex((el) => el.props.testID === `pin-cell-${pinLate.id}`);
    const lockedIdx = cells.findIndex((el) => el.props.testID === `pin-cell-${pinEarly.id}`);
    expect(readyIdx).toBeGreaterThan(-1);
    expect(lockedIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeLessThan(lockedIdx);
  });

  it('filters to only unlocked pins, combinable with the tier filter (Requirement 22.2)', async () => {
    renderBoard(); // BOARD: pinA unlocked, pinB locked, pinC unlocked
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId('ownership-pill-unlocked'));
    expect(screen.getByTestId(`pin-cell-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-cell-${pinC.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-cell-${pinB.id}`)).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1); // still client-side, no refetch

    // Combine with the bronze tier pill — narrows further, to pinA only.
    fireEvent.press(screen.getByTestId('tier-pill-bronze'));
    expect(screen.getByTestId(`pin-cell-${pinA.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-cell-${pinC.id}`)).toBeNull();
  });

  it('filters to only locked pins', async () => {
    renderBoard();
    await screen.findByTestId('pin-board');

    fireEvent.press(screen.getByTestId('ownership-pill-locked'));
    expect(screen.getByTestId(`pin-cell-${pinB.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-cell-${pinA.id}`)).toBeNull();
    expect(screen.queryByTestId(`pin-cell-${pinC.id}`)).toBeNull();
  });

  describe('claim reveal, bulk claim, and celebration fanfare (Requirement 23)', () => {
    it('hides "Claim all" with 0 or 1 ready-to-claim pins', async () => {
      renderBoard(); // BOARD: no ready-to-claim pins
      await screen.findByTestId('pin-board');
      expect(screen.queryByTestId('pin-board-claim-all')).toBeNull();

      mockApi(BOARD_WITH_READY); // exactly 1 ready-to-claim pin (pinB)
      renderBoard();
      await screen.findByTestId('pin-board');
      expect(screen.queryByTestId('pin-board-claim-all')).toBeNull();
    });

    it('shows "Claim all (N)" with the exact count when 2+ pins are ready to claim, and claims every one (Requirement 23.4, Property 17)', async () => {
      const boardTwoReady: PinBoardDTO = {
        ...BOARD,
        pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
      };
      mockApi(boardTwoReady);
      renderBoard();
      await screen.findByTestId('pin-board');

      const claimAll = screen.getByTestId('pin-board-claim-all');
      expect(claimAll).toHaveTextContent('Claim all (2)');

      fireEvent.press(claimAll);

      // Every ready-to-claim id gets its own claim call — none skipped, none extra.
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`));
      await screen.findByTestId('pin-celebration-modal');
      fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`));
      await waitFor(() => expect(screen.queryByTestId('pin-celebration-modal')).toBeTruthy());
      fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));

      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`);
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`);
    });

    it('shows the queue position ("X of N") on each celebration in a multi-pin batch, and it does not shrink across the batch (Requirement 23.5)', async () => {
      const boardTwoReady: PinBoardDTO = {
        ...BOARD,
        pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
      };
      mockApi(boardTwoReady);
      renderBoard({ celebratePinIds: [pinA.id, pinB.id] });

      await screen.findByTestId('pin-celebration-modal');
      expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('1 of 2');
      expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Next');

      fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
      await waitFor(() => expect(screen.queryByTestId('pin-celebration-modal')).toBeTruthy());
      // "of 2" persists on the second pin — the total does not shrink as the queue drains.
      expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('2 of 2');
      expect(screen.getByTestId('pin-celebration-dismiss')).toHaveTextContent('Awesome!');
    });

    it('does not show a position line for a single, non-batched claim', async () => {
      mockApi(BOARD_WITH_READY);
      renderBoard();
      await screen.findByTestId('pin-board');

      fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));
      await screen.findByTestId('pin-celebration-modal');
      expect(screen.queryByTestId('pin-celebration-position')).toBeNull();
    });

    it('paces the advance between queued celebrations rather than firing the next claim synchronously on dismiss (Requirement 23.6)', async () => {
      jest.useFakeTimers();
      const boardTwoReady: PinBoardDTO = {
        ...BOARD,
        pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), unlockedProg(pinC)],
      };
      mockApi(boardTwoReady);
      renderBoard({ celebratePinIds: [pinA.id, pinB.id] });

      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`));
      await waitFor(() => expect(screen.queryByTestId('pin-celebration-modal')).toBeTruthy());

      fireEvent.press(screen.getByTestId('pin-celebration-dismiss'));
      // Immediately after dismiss, the second claim must NOT have fired yet.
      expect(apiRequestMock).not.toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`);

      act(() => {
        jest.advanceTimersByTime(500);
      });
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`));
      jest.useRealTimers();
    });

    it('fires the two-part haptic pattern (heavy impact then success notification) on a successful claim (Requirement 23.7)', async () => {
      mockApi(BOARD_WITH_READY);
      renderBoard();
      await screen.findByTestId('pin-board');

      fireEvent.press(screen.getByTestId(`pin-cell-${pinB.id}`));

      await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy'));
      await waitFor(() => expect(notificationAsyncMock).toHaveBeenCalledWith('success'));
    });

    it('skipping all claims all remaining queued pins in the batch and dismisses the celebration queue immediately (Requirement 23.8)', async () => {
      const boardThreeReady: PinBoardDTO = {
        ...BOARD,
        pins: [readyToClaimProg(pinA), readyToClaimProg(pinB), readyToClaimProg(pinC)],
      };
      mockApi(boardThreeReady);
      renderBoard();
      await screen.findByTestId('pin-board');

      const claimAll = screen.getByTestId('pin-board-claim-all');
      expect(claimAll).toHaveTextContent('Claim all (3)');
      fireEvent.press(claimAll);

      // First pin is claimed and celebration appears with position 1 of 3
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinA.id}/claim`));
      await screen.findByTestId('pin-celebration-modal');
      expect(screen.getByTestId('pin-celebration-position')).toHaveTextContent('1 of 3');

      const skipAll = screen.getByTestId('pin-celebration-skip-all');
      expect(skipAll).toHaveTextContent('Skip all');

      fireEvent.press(skipAll);

      // Modal closes immediately
      await waitFor(() => expect(screen.queryByTestId('pin-celebration-modal')).toBeNull());

      // Remaining pins are claimed in the background
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinB.id}/claim`));
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith('POST', `/me/pins/${pinC.id}/claim`));

      // No further celebration modal appears
      expect(screen.queryByTestId('pin-celebration-modal')).toBeNull();

      // All 3 ready-to-claim badges on the board are cleared optimistically
      expect(screen.queryByTestId(`pin-cell-ready-${pinA.id}`)).toBeNull();
      expect(screen.queryByTestId(`pin-cell-ready-${pinB.id}`)).toBeNull();
      expect(screen.queryByTestId(`pin-cell-ready-${pinC.id}`)).toBeNull();
    });
  });
});
