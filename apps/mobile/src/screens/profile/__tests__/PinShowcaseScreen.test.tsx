/**
 * Tests for PinShowcaseScreen (Task 16.10).
 *
 * Validates: Requirements 24.2, 24.3, 24.4, 24.6, 24.9, 24.10, 24.11, 24.12;
 *            Properties 18, 19, 20, 22
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

// Mock apiRequest, keep real ApiError
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import PinShowcaseScreen from '../PinShowcaseScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import {
  PINS,
  SHOWCASE_BOARD_MARGIN,
  SHOWCASE_PIN_SIZE,
  SHOWCASE_REFERENCE_SIZE,
  type PinDTO,
  type PinShowcaseDTO,
} from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const pinA: PinDTO = PINS[0]!;
const pinB: PinDTO = PINS[1]!;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeTouchEvent(opts: {
  pageX: number;
  pageY: number;
  prevPageX?: number;
  prevPageY?: number;
  timeStamp?: number;
}) {
  const ts = opts.timeStamp ?? 10;
  const prevTs = ts - 5;
  const touch = {
    touchActive: true,
    currentTimeStamp: ts,
    previousTimeStamp: prevTs,
    currentPageX: opts.pageX,
    currentPageY: opts.pageY,
    previousPageX: opts.prevPageX ?? opts.pageX,
    previousPageY: opts.prevPageY ?? opts.pageY,
  };
  return {
    touchHistory: {
      touchBank: [touch],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: ts,
    },
    nativeEvent: {
      touches: [{ pageX: opts.pageX, pageY: opts.pageY }],
      changedTouches: [{ pageX: opts.pageX, pageY: opts.pageY }],
    },
  };
}

function simulateDrag(
  element: any,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  fireEvent(
    element,
    'responderGrant',
    makeTouchEvent({ pageX: from.x, pageY: from.y, timeStamp: 10 }),
  );
  fireEvent(
    element,
    'responderMove',
    makeTouchEvent({
      pageX: to.x,
      pageY: to.y,
      prevPageX: from.x,
      prevPageY: from.y,
      timeStamp: 20,
    }),
  );
  fireEvent(
    element,
    'responderRelease',
    makeTouchEvent({
      pageX: to.x,
      pageY: to.y,
      prevPageX: to.x,
      prevPageY: to.y,
      timeStamp: 30,
    }),
  );
}

function renderScreen(props: {
  userId?: string;
  readOnly?: boolean;
  nav?: { goBack: jest.Mock; navigate: jest.Mock };
} = {}) {
  const navigation = props.nav ?? { goBack: jest.fn(), navigate: jest.fn() };
  const route = {
    key: 'k-showcase',
    name: 'PinShowcase',
    params: { userId: props.userId, readOnly: props.readOnly },
  };

  const utils = render(
    <QueryClientProvider client={makeClient()}>
      <PinShowcaseScreen
        navigation={navigation}
        route={route as never}
        userId={props.userId}
        readOnly={props.readOnly}
      />
    </QueryClientProvider>,
  );
  return { navigation, ...utils };
}

describe('PinShowcaseScreen (Task 16.10)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('renders cork board and placed pins at calculated positions (R24.2, R24.10)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.25, posY: 0.5, zIndex: 0 },
      ],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    await screen.findByTestId('pin-showcase-board');
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/pin-showcase');

    const placedItem = screen.getByTestId(`pin-showcase-placed-${pinA.id}`);
    expect(placedItem).toBeTruthy();

    // With SHOWCASE_REFERENCE_SIZE = 360x640:
    // left = 0.25 * 360 - 72/2 = 90 - 36 = 54
    // top = 0.5 * 640 - 72/2 = 320 - 36 = 284
    expect(StyleSheet.flatten(placedItem.props.style)).toEqual(
      expect.objectContaining({
        left: 54,
        top: 284,
        zIndex: 0,
      }),
    );

    // Capacity indicator
    expect(screen.getByTestId('pin-showcase-capacity')).toHaveTextContent('1/24');

    // Unplaced tray pin is visible
    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinB.id}`)).toBeTruthy();
  });

  it('dragging a tray pin onto the board fires PUT with drop coordinates (R24.2, R24.3)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 0.5, posY: 0.5, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const trayPin = await screen.findByTestId(`pin-showcase-tray-pin-${pinB.id}`);

    // Simulate drag from tray (180, 700) onto center of board (180, 320)
    simulateDrag(trayPin, { x: 180, y: 700 }, { x: 180, y: 320 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinB.id}`, {
        posX: 0.5,
        posY: 0.5,
      });
    });
  });

  it('dragging an already-placed pin fires PUT for that same pin id (R24.2, R24.4)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.2, posY: 0.2, zIndex: 0 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinA.id}`) {
        return { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 1 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const placedPin = await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);

    // Drag placed pin by dx = 108, dy = 192
    // Start center: 0.2 * 360 = 72, 0.2 * 640 = 128
    // End center: 72 + 108 = 180 (0.5), 128 + 192 = 320 (0.5)
    simulateDrag(placedPin, { x: 72, y: 128 }, { x: 180, y: 320 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinA.id}`, {
        posX: 0.5,
        posY: 0.5,
      });
    });
  });

  it('dragging a pin to within SHOWCASE_MIN_PIN_CLEARANCE of another pin fires NO PUT (R24.11)', async () => {
    // Pin A at center (0.5, 0.5) -> (180, 320)
    // Pin B at bottom-right (0.8, 0.8) -> (288, 512)
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 },
        { pinId: pinB.id, posX: 0.8, posY: 0.8, zIndex: 1 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const pinBView = await screen.findByTestId(`pin-showcase-placed-${pinB.id}`);

    // Try to drop pin B at (230, 320) which is 50px from Pin A (center 180, 320)
    // 50px < SHOWCASE_MIN_PIN_CLEARANCE (60px) -> Overlap!
    simulateDrag(pinBView, { x: 288, y: 512 }, { x: 230, y: 320 });

    // Ensure NO PUT was called
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'PUT',
      expect.anything(),
      expect.anything(),
    );
  });

  it('dragging a pin to just outside SHOWCASE_MIN_PIN_CLEARANCE of another pin fires PUT (R24.11)', async () => {
    // Pin A at center (0.5, 0.5) -> (180, 320)
    // Pin B at bottom-right (0.8, 0.8) -> (288, 512)
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 },
        { pinId: pinB.id, posX: 0.8, posY: 0.8, zIndex: 1 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 245 / 360, posY: 0.5, zIndex: 2 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const pinBView = await screen.findByTestId(`pin-showcase-placed-${pinB.id}`);

    // Drop pin B at (245, 320) which is 65px from Pin A (180, 320)
    // 65px >= SHOWCASE_MIN_PIN_CLEARANCE (60px) -> Valid drop!
    simulateDrag(pinBView, { x: 288, y: 512 }, { x: 245, y: 320 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinB.id}`, {
        posX: 245 / 360,
        posY: 0.5,
      });
    });
  });

  it('removing a placement fires DELETE and returns pin to unplaced (R24.4)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.25, posY: 0.5, zIndex: 0 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'DELETE' && path === `/me/pin-showcase/${pinA.id}`) {
        return { ok: true } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const removeBtn = await screen.findByTestId(`pin-showcase-remove-${pinA.id}`);
    fireEvent.press(removeBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/me/pin-showcase/${pinA.id}`);
    });
  });

  it('readOnly mode attaches no drag handlers and renders no place/remove controls (R24.9)', async () => {
    const friendShowcase: PinShowcaseDTO = {
      ownerId: 'friend-456',
      placements: [
        { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 },
      ],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/users/friend-456/pin-showcase') return friendShowcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen({ userId: 'friend-456', readOnly: true });

    await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/users/friend-456/pin-showcase');

    // No remove button
    expect(screen.queryByTestId(`pin-showcase-remove-${pinA.id}`)).toBeNull();
    // No tray
    expect(screen.queryByTestId('pin-showcase-tray')).toBeNull();
    // No share button
    expect(screen.queryByTestId('pin-showcase-share-button')).toBeNull();
  });

  it('renders friend empty-state when friend has placed zero pins (R24.9)', async () => {
    const friendEmptyShowcase: PinShowcaseDTO = {
      ownerId: 'friend-456',
      placements: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/users/friend-456/pin-showcase') return friendEmptyShowcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen({ userId: 'friend-456', readOnly: true });

    await screen.findByTestId('pin-showcase-friend-empty');
    expect(screen.getByText('No pins on display')).toBeTruthy();
    expect(screen.getByText('This friend hasn’t placed any pins yet.')).toBeTruthy();
  });

  it('renders profile_forbidden deny state (R24.7)', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError({
        code: 'profile_forbidden',
        status: 403,
        message: 'Forbidden',
      });
    });

    renderScreen({ userId: 'non-friend-789', readOnly: true });

    await screen.findByTestId('pin-showcase-unavailable');
    expect(screen.getByText('Profile unavailable')).toBeTruthy();
    expect(screen.getByText('This friend’s profile is no longer available to view.')).toBeTruthy();
  });

  it('Share button opens ShareComposer with kind: pinShowcase (R24.12)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    const mockNav = { goBack: jest.fn(), navigate: jest.fn() };
    renderScreen({ nav: mockNav });

    const shareBtn = await screen.findByTestId('pin-showcase-share-button');
    fireEvent.press(shareBtn);

    expect(mockNav.navigate).toHaveBeenCalledWith('ShareComposer', {
      kind: 'pinShowcase',
    });
  });

  it('dragging an already-moved pin a second time moves from its updated position without jumping (regression guard)', async () => {
    let currentPlacements = [
      { pinId: pinA.id, posX: 0.2, posY: 0.2, zIndex: 0 },
    ];

    apiRequestMock.mockImplementation(async (method: string, path: string, body?: any) => {
      if (method === 'GET' && path === '/me/pin-showcase') {
        return { ownerId: 'user-123', placements: currentPlacements, unplaced: [] } as never;
      }
      if (method === 'PUT' && path === `/me/pin-showcase/${pinA.id}`) {
        currentPlacements = [{ pinId: pinA.id, posX: body.posX, posY: body.posY, zIndex: 1 }];
        return { pinId: pinA.id, posX: body.posX, posY: body.posY, zIndex: 1 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const placedPin = await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);

    // First drag: from (72, 128) to (180, 320) -> dx = 108, dy = 192
    simulateDrag(placedPin, { x: 72, y: 128 }, { x: 180, y: 320 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinA.id}`, {
        posX: 0.5,
        posY: 0.5,
      });
    });

    // Second drag: nudge slightly to the left from its new position (180, 320) to (160, 320) -> dx = -20
    simulateDrag(placedPin, { x: 180, y: 320 }, { x: 160, y: 320 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinA.id}`, {
        posX: 160 / 360,
        posY: 0.5,
      });
    });
  });

  it('renders floating drag overlay above pin board when dragging an unplaced pin and removes it on release (defect fix)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 0.5, posY: 0.5, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const trayPin = await screen.findByTestId(`pin-showcase-tray-pin-${pinB.id}`);

    // Initially, no dragging overlay exists
    expect(screen.queryByTestId('pin-showcase-dragging-overlay')).toBeNull();

    // Start drag on tray pin at (180, 700)
    fireEvent(
      trayPin,
      'responderGrant',
      makeTouchEvent({ pageX: 180, pageY: 700, timeStamp: 10 }),
    );

    // Floating overlay is now visible above everything
    const overlay = screen.getByTestId('pin-showcase-dragging-overlay');
    expect(overlay).toBeTruthy();

    const overlayStyle = StyleSheet.flatten(overlay.props.style);
    expect(overlayStyle.zIndex).toBe(99999);
    expect(overlayStyle.elevation).toBe(99999);
    // Pin size is 72, touch is (180, 700), left = 180 - 36 = 144, top = 700 - 36 = 664
    expect(overlayStyle.left).toBe(144);
    expect(overlayStyle.top).toBe(664);

    // The tray pin is dimmed as a placeholder while dragged
    const trayPinStyle = StyleSheet.flatten(trayPin.props.style);
    expect(trayPinStyle.opacity).toBe(0.25);

    // Move touch toward board center (180, 320)
    fireEvent(
      trayPin,
      'responderMove',
      makeTouchEvent({ pageX: 180, pageY: 320, prevPageX: 180, prevPageY: 700, timeStamp: 20 }),
    );

    // Release touch onto board
    fireEvent(
      trayPin,
      'responderRelease',
      makeTouchEvent({ pageX: 180, pageY: 320, prevPageX: 180, prevPageY: 320, timeStamp: 30 }),
    );

    // PUT was fired to place the pin
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinB.id}`, {
        posX: 0.5,
        posY: 0.5,
      });
    });

    // Dragging overlay is unmounted
    expect(screen.queryByTestId('pin-showcase-dragging-overlay')).toBeNull();
  });

  it('elevates placed pin zIndex and elevation while dragging so it renders above other placed pins', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.2, posY: 0.2, zIndex: 0 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinA.id}`) {
        return { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const placedPin = await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);
    expect(StyleSheet.flatten(placedPin.props.style).zIndex).toBe(0);

    // Start dragging placed pin
    fireEvent(
      placedPin,
      'responderGrant',
      makeTouchEvent({ pageX: 72, pageY: 128, timeStamp: 10 }),
    );

    // Elevated above all other pins during drag
    const draggingStyle = StyleSheet.flatten(placedPin.props.style);
    expect(draggingStyle.zIndex).toBe(1000);
    expect(draggingStyle.elevation).toBe(1000);

    // Move drag
    fireEvent(
      placedPin,
      'responderMove',
      makeTouchEvent({ pageX: 180, pageY: 320, prevPageX: 72, prevPageY: 128, timeStamp: 20 }),
    );

    // Release drag
    fireEvent(
      placedPin,
      'responderRelease',
      makeTouchEvent({ pageX: 180, pageY: 320, prevPageX: 180, prevPageY: 320, timeStamp: 30 }),
    );

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinA.id}`, {
        posX: 0.5,
        posY: 0.5,
      });
    });
  });

  it('dragging an unplaced pin to overlap with an existing placed pin snaps back with NO PUT and cleans up overlay', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 },
      ],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const trayPin = await screen.findByTestId(`pin-showcase-tray-pin-${pinB.id}`);

    // Drag tray pin to drop at (180, 320) which directly overlaps pinA at center (180, 320)
    simulateDrag(trayPin, { x: 180, y: 700 }, { x: 180, y: 320 });

    // NO PUT should be fired due to overlap
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'PUT',
      expect.anything(),
      expect.anything(),
    );
  });

  it('searching unplaced pins filters by name in tray (Requirement 24.15)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinA.id, pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    await screen.findByTestId('pin-showcase-tray');
    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinB.id}`)).toBeTruthy();

    // Toggle search bar
    fireEvent.press(screen.getByTestId('pin-showcase-search-toggle'));
    const searchInput = await screen.findByTestId('pin-showcase-search-input');

    // Filter to pinA's name
    fireEvent.changeText(searchInput, pinA.name);

    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinA.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pin-showcase-tray-pin-${pinB.id}`)).toBeNull();

    // Clear search
    fireEvent.press(screen.getByTestId('pin-showcase-search-clear'));
    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-showcase-tray-pin-${pinB.id}`)).toBeTruthy();
  });

  it('sorting unplaced pins reorders tray pins by name and tier (Requirement 24.15)', async () => {
    const pinCenturion = PINS[0]!; // 'Centurion 5', bronze
    const pinAllAttractions = PINS[11]!; // 'All Attractions', prism

    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinCenturion.id, pinAllAttractions.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // In catalog order, pinCenturion is first
    let trayPins = await screen.findAllByTestId(/pin-showcase-tray-pin-/);
    expect(trayPins[0]?.props.testID).toBe(`pin-showcase-tray-pin-${pinCenturion.id}`);

    // Cycle sort once -> name-asc ('All Attractions' < 'Centurion 5')
    fireEvent.press(screen.getByTestId('pin-showcase-sort-toggle'));

    trayPins = await screen.findAllByTestId(/pin-showcase-tray-pin-/);
    expect(trayPins[0]?.props.testID).toBe(`pin-showcase-tray-pin-${pinAllAttractions.id}`);

    // Cycle sort again -> tier-desc ('prism' > 'bronze')
    fireEvent.press(screen.getByTestId('pin-showcase-sort-toggle'));

    trayPins = await screen.findAllByTestId(/pin-showcase-tray-pin-/);
    expect(trayPins[0]?.props.testID).toBe(`pin-showcase-tray-pin-${pinAllAttractions.id}`);
  });

  it('opening the expanded modal displays full pin cards and metadata (Requirement 24.16)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinA.id, pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // Tap "Browse All" button
    const expandBtn = await screen.findByTestId('pin-showcase-expand-button');
    fireEvent.press(expandBtn);

    // Modal and cards should be visible
    expect(await screen.findByTestId('pin-showcase-modal')).toBeTruthy();
    expect(screen.getByTestId(`pin-showcase-card-${pinA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-showcase-card-${pinB.id}`)).toBeTruthy();
    expect(screen.getByTestId(`pin-showcase-card-place-${pinA.id}`)).toBeTruthy();

    // Close modal
    fireEvent.press(screen.getByTestId('pin-showcase-modal-close'));
  });

  it('tapping "Place on Board" in the modal auto-places the pin (Requirement 24.17)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 0.133, posY: 0.081, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // Open modal
    const expandBtn = await screen.findByTestId('pin-showcase-expand-button');
    fireEvent.press(expandBtn);

    // Press Place on Board
    const placeBtn = await screen.findByTestId(`pin-showcase-card-place-${pinB.id}`);
    fireEvent.press(placeBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/me/pin-showcase/${pinB.id}`,
        expect.objectContaining({
          posX: expect.any(Number),
          posY: expect.any(Number),
        }),
      );
    });
  });

  it('tapping a tray pin directly auto-places it on the board (Requirement 24.17)', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinB.id],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 0.133, posY: 0.081, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const trayPin = await screen.findByTestId(`pin-showcase-tray-pin-${pinB.id}`);

    // Simulate tap (dx=0, dy=0)
    simulateDrag(trayPin, { x: 180, y: 700 }, { x: 180, y: 700 });

      await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/me/pin-showcase/${pinB.id}`,
        expect.objectContaining({
          posX: expect.any(Number),
          posY: expect.any(Number),
        }),
      );
    });
  });

  it('pins placed at extreme edges (e.g. bottom-left corner with posX: 0, posY: 1) are clamped to SHOWCASE_BOARD_MARGIN and do not go under the border', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.0, posY: 1.0, zIndex: 0 },
        { pinId: pinB.id, posX: 1.0, posY: 0.0, zIndex: 1 },
      ],
      unplaced: [],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const placedA = await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);
    const placedB = await screen.findByTestId(`pin-showcase-placed-${pinB.id}`);

    const styleA = StyleSheet.flatten(placedA.props.style);
    const styleB = StyleSheet.flatten(placedB.props.style);

    // Pin A at bottom-left:
    // left clamped to at least SHOWCASE_BOARD_MARGIN (0)
    expect(styleA.left).toBe(SHOWCASE_BOARD_MARGIN);
    // top clamped so bottom of pin (top + 72) stays within boardHeight - SHOWCASE_BOARD_MARGIN
    // 640 - 72 - 0 = 568
    expect(styleA.top).toBe(SHOWCASE_REFERENCE_SIZE.height - SHOWCASE_PIN_SIZE - SHOWCASE_BOARD_MARGIN);

    // Pin B at top-right:
    // left clamped so right edge of pin (left + 72) stays within boardWidth - SHOWCASE_BOARD_MARGIN
    // 360 - 72 - 0 = 288
    expect(styleB.left).toBe(SHOWCASE_REFERENCE_SIZE.width - SHOWCASE_PIN_SIZE - SHOWCASE_BOARD_MARGIN);
    // top clamped to at least SHOWCASE_BOARD_MARGIN (0)
    expect(styleB.top).toBe(SHOWCASE_BOARD_MARGIN);
  });

  it('dragging a placed pin toward the border clamps movement and drop coordinates to SHOWCASE_BOARD_MARGIN without slipping under the border', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [
        { pinId: pinA.id, posX: 0.5, posY: 0.5, zIndex: 0 },
      ],
      unplaced: [],
    };

    const expectedMaxPosY =
      (SHOWCASE_REFERENCE_SIZE.height - SHOWCASE_BOARD_MARGIN - SHOWCASE_PIN_SIZE / 2) /
      SHOWCASE_REFERENCE_SIZE.height;

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinA.id}`) {
        return { pinId: pinA.id, posX: 0.5, posY: expectedMaxPosY, zIndex: 1 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const placedPin = await screen.findByTestId(`pin-showcase-placed-${pinA.id}`);

    // Pin starts at center: (180, 320). Drag it far below bottom of board to (180, 999)
    simulateDrag(placedPin, { x: 180, y: 320 }, { x: 180, y: 999 });

    // The saved coordinate must be clamped so pin stays inside cork margin (maxCenterY = 640 - 36 = 604)
    // 604 / 640 = 0.94375, NOT 1.0 or beyond
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinA.id}`, {
        posX: 0.5,
        posY: expectedMaxPosY,
      });
    });
  });

  it('dragging an unplaced tray pin and dropping it at the bottom edge clamps to safe board bounds without going under the border', async () => {
    const showcase: PinShowcaseDTO = {
      ownerId: 'user-123',
      placements: [],
      unplaced: [pinB.id],
    };

    const expectedMaxPosY =
      (SHOWCASE_REFERENCE_SIZE.height - SHOWCASE_BOARD_MARGIN - SHOWCASE_PIN_SIZE / 2) /
      SHOWCASE_REFERENCE_SIZE.height;

    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me/pin-showcase') return showcase as never;
      if (method === 'PUT' && path === `/me/pin-showcase/${pinB.id}`) {
        return { pinId: pinB.id, posX: 0.5, posY: expectedMaxPosY, zIndex: 0 } as never;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const trayPin = await screen.findByTestId(`pin-showcase-tray-pin-${pinB.id}`);

    // Drop tray pin at bottom edge (180, 640)
    simulateDrag(trayPin, { x: 180, y: 700 }, { x: 180, y: 640 });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/pin-showcase/${pinB.id}`, {
        posX: 0.5,
        posY: expectedMaxPosY,
      });
    });
  });
});

