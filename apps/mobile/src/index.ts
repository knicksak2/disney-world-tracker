import { registerRootComponent } from 'expo';

import App from './App';

/**
 * Entry point for the Expo app.
 *
 * `registerRootComponent` ensures the root component is set whether the app
 * is loaded inside Expo Go or as a standalone build, so we never need to
 * call `AppRegistry.registerComponent` directly.
 */
registerRootComponent(App);
