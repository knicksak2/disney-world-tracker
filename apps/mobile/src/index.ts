import { registerRootComponent } from 'expo';

import App from './App';

// Suppress known third-party library deprecation and native-ref noise in Metro terminal logs:
// 1. `react-native-draggable-flatlist` passing node handle numbers into ref.measureLayout.
// 2. React Native / navigation internal InteractionManager deprecation.
if (__DEV__) {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('ref.measureLayout must be called with a ref to a native component')
    ) {
      return;
    }
    originalError(...args);
  };

  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('InteractionManager has been deprecated')
    ) {
      return;
    }
    originalWarn(...args);
  };
}

/**
 * Entry point for the Expo app.
 *
 * `registerRootComponent` ensures the root component is set whether the app
 * is loaded inside Expo Go or as a standalone build, so we never need to
 * call `AppRegistry.registerComponent` directly.
 */
registerRootComponent(App);

