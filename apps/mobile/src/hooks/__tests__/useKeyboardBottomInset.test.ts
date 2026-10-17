import { act, renderHook } from '@testing-library/react-native';
import { Dimensions, Keyboard, Platform } from 'react-native';

import { useKeyboardBottomInset } from '../useKeyboardBottomInset';

describe('useKeyboardBottomInset', () => {
  let listeners: Record<string, ((event: unknown) => void) | undefined> = {};

  beforeEach(() => {
    listeners = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
      listeners[event] = callback as (event: unknown) => void;
      return {
        remove: jest.fn(() => {
          delete listeners[event];
        }),
      } as any;
    });
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 400,
      height: 800,
      scale: 2,
      fontScale: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes with 0 inset and hidden state', () => {
    const { result } = renderHook(() => useKeyboardBottomInset(true));
    expect(result.current.keyboardInset).toBe(0);
    expect(result.current.isKeyboardVisible).toBe(false);
  });

  it('updates keyboardInset when keyboard shows and resets when hidden', () => {
    const { result } = renderHook(() => useKeyboardBottomInset(true));

    const showEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    expect(listeners[showEventName]).toBeDefined();

    act(() => {
      listeners[showEventName]?.({
        endCoordinates: { height: 320, width: 400, screenX: 0, screenY: 480 },
      });
    });

    expect(result.current.keyboardInset).toBe(320);
    expect(result.current.isKeyboardVisible).toBe(true);

    act(() => {
      listeners[hideEventName]?.({});
    });

    expect(result.current.keyboardInset).toBe(0);
    expect(result.current.isKeyboardVisible).toBe(false);
  });

  it('calculates available modal height clamped at min 260', () => {
    const { result } = renderHook(() => useKeyboardBottomInset(true));

    // Initially with 0 inset and 800 screen height: 800 - 0 - 40 = 760
    expect(result.current.getAvailableModalHeight(40)).toBe(760);

    const showEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    act(() => {
      listeners[showEventName]?.({
        endCoordinates: { height: 320, width: 400, screenX: 0, screenY: 480 },
      });
    });

    // 800 - 320 - 40 = 440
    expect(result.current.getAvailableModalHeight(40)).toBe(440);

    // If keyboard is huge (e.g. 700dp): 800 - 700 - 40 = 60 -> clamped at 260
    act(() => {
      listeners[showEventName]?.({
        endCoordinates: { height: 700, width: 400, screenX: 0, screenY: 100 },
      });
    });
    expect(result.current.getAvailableModalHeight(40)).toBe(260);
  });

  it('resets inset and removes listeners when disabled', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useKeyboardBottomInset(enabled),
      { initialProps: { enabled: true } },
    );

    const showEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    act(() => {
      listeners[showEventName]?.({
        endCoordinates: { height: 300, width: 400, screenX: 0, screenY: 500 },
      });
    });
    expect(result.current.keyboardInset).toBe(300);

    rerender({ enabled: false });
    expect(result.current.keyboardInset).toBe(0);
    expect(result.current.isKeyboardVisible).toBe(false);
    expect(listeners[showEventName]).toBeUndefined();
  });
});
