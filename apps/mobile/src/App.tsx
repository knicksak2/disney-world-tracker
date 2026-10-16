import './setupScrollDefaults';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootNavigator from './navigation/RootNavigator';
import { navigationRef } from './navigation/navigationRef';
import { usePushRegistration } from './hooks/usePushRegistration';
import { useNotificationResponse } from './hooks/useNotificationResponse';
import { useSessionStore } from './state/sessionStore';
import { useThemeStore } from './state/themeStore';
import { useActiveTheme } from './theme/useActiveTheme';
import { deriveAppearanceChrome } from './theme/AppearanceChrome';
import { ApiError } from './api/client';

// Suppress known third-party library deprecation noise:
// 1. `react-native-draggable-flatlist` internal use of findNodeHandle with measureLayout on newer React Native.
// 2. React Native / navigation internal InteractionManager deprecation.
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LogBox } = require('react-native');
    LogBox?.ignoreLogs?.([
      'ref.measureLayout must be called with a ref to a native component.',
      'InteractionManager has been deprecated and will be removed in a future release.',
    ]);
  } catch {
    // LogBox unavailable on this platform/environment
  }
}

/**
 * Root application component.
 *
 * Wires up the foundational providers — React Query for server state and
 * SafeArea for layout — then mounts `NavigationContainer` and the
 * `RootNavigator`, which gates the main tabs behind a valid session.
 *
 * On mount we hydrate the session store from secure storage exactly once
 * so the navigator can decide between the auth stack and the main tabs
 * without flashing the login screen for users who are already signed in.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          (error.status === 429 ||
            error.status === 404 ||
            error.status === 403 ||
            error.code === 'rate_limit_exceeded')
        ) {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export default function App(): JSX.Element {
  const loadFromStorage = useSessionStore((state) => state.loadFromStorage);
  const loadThemeFromStorage = useThemeStore((state) => state.loadFromStorage);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    void loadThemeFromStorage();
  }, [loadThemeFromStorage]);

  // Register this device for Share push notifications once authenticated
  // (R8.1, R9.1); no-op until a session is hydrated and present.
  usePushRegistration();

  // Deep-link a tapped Share push notification to the Inbox and on to the
  // Share's destination (R10). Mounted once at the root, above the navigator,
  // so it can dispatch navigation through the shared `navigationRef`.
  useNotificationResponse();

  // dark-mode: resolve the Active theme and derive the three chrome
  // surfaces (Navigation theme, status bar style, root safe-area
  // background) this spec owns from it (Requirement 6).
  const activeTheme = useActiveTheme();
  const { navigationTheme, statusBarStyle, rootBackground } = deriveAppearanceChrome(activeTheme);

  // dark-mode R6.5: paint the native window/root view with the same root
  // background, so the area behind the Android gesture bar (outside the React
  // root, unreachable from JS views) follows the Active theme instead of
  // showing the platform default white. Non-fatal: a native failure must
  // never crash the app.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(rootBackground).catch((error: unknown) => {
      console.warn('expo-system-ui: setBackgroundColorAsync failed', error);
    });
  }, [rootBackground]);

  return (
    // GestureHandlerRootView must wrap the entire app root — required by
    // react-native-gesture-handler (added for react-native-draggable-flatlist's
    // checklist drag reorder, food-lists Requirement 13.14-13.18 amendment).
    // Without it, gesture handlers anywhere in the tree silently fail to
    // capture touches.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ backgroundColor: rootBackground }}>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer ref={navigationRef} theme={navigationTheme}>
            <RootNavigator />
          </NavigationContainer>
          <StatusBar style={statusBarStyle} />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
