import { useEffect, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';

export interface KeyboardBottomInsetResult {
  /** Height in dp of the software keyboard, or 0 when hidden. */
  readonly keyboardInset: number;
  /** True when the keyboard is currently shown. */
  readonly isKeyboardVisible: boolean;
  /** Calculates maximum modal container height to prevent pushing modal header off-screen. */
  readonly getAvailableModalHeight: (topOffset?: number) => number;
}

/**
 * Hook to track soft keyboard height/bottom inset.
 *
 * On Android, React Native's transparent `<Modal>` dialogs do not natively resize
 * with the soft keyboard, causing bottom-sheet modals (`justifyContent: 'flex-end'`)
 * to be covered by the keyboard. Using `KeyboardAvoidingView behavior="height"` inside
 * a transparent modal on Android causes an infinite layout oscillation loop (jitter/shake).
 *
 * This hook listens to keyboard events and returns the current keyboard height
 * and a clamped maximum content height so modals can cleanly lift above the keyboard
 * without overflowing off the top of the display.
 */
export function useKeyboardBottomInset(enabled = true): KeyboardBottomInsetResult {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (!enabled) {
      setKeyboardInset(0);
      return;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const height = e?.endCoordinates?.height ?? 0;
      setKeyboardInset(height);
    };

    const onHide = () => {
      setKeyboardInset(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub?.remove?.();
      hideSub?.remove?.();
    };
  }, [enabled]);

  const getAvailableModalHeight = (topOffset = 40): number => {
    const baseHeight = windowHeight > 0 ? windowHeight : Dimensions.get('screen').height;
    return Math.max(260, baseHeight - keyboardInset - topOffset);
  };

  return {
    keyboardInset,
    isKeyboardVisible: keyboardInset > 0,
    getAvailableModalHeight,
  };
}
