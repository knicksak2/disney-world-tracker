/**
 * Manual Jest mock for `@expo/vector-icons`.
 *
 * The real package eagerly pulls in the `expo-asset` / `expo-font` native
 * module chain at import time. Under the unit-test environment (where
 * `expo-constants` is mocked to a bare object) that chain throws
 * "Cannot read properties of undefined (reading 'Expo')" before any test
 * body runs. The app only uses icon glyphs for decoration, and no test
 * asserts on icon internals, so we replace every icon set with a tiny
 * host-component stub that forwards `testID` / `accessibilityLabel`.
 *
 * Jest applies this automatically for the `@expo/vector-icons` node module
 * because it lives in `<rootDir>/__mocks__` (the manual-mock convention for
 * node_modules).
 */

const React = require('react');

function makeIcon(displayName) {
  function Icon(props) {
    // Render as a plain RN `Text`-like host node. We avoid importing
    // react-native here to keep the mock dependency-free; a string element
    // type is sufficient for the test renderer and never asserted on.
    return React.createElement('Icon', {
      ...props,
      // Preserve the glyph name for debugging snapshots if ever needed.
      'data-icon-name': props.name,
    });
  }
  Icon.displayName = displayName;
  return Icon;
}

const Ionicons = makeIcon('Ionicons');
Ionicons.glyphMap = {};

module.exports = {
  __esModule: true,
  Ionicons,
  MaterialIcons: makeIcon('MaterialIcons'),
  MaterialCommunityIcons: makeIcon('MaterialCommunityIcons'),
  FontAwesome: makeIcon('FontAwesome'),
  FontAwesome5: makeIcon('FontAwesome5'),
  AntDesign: makeIcon('AntDesign'),
  Entypo: makeIcon('Entypo'),
  Feather: makeIcon('Feather'),
  createIconSet: () => makeIcon('CustomIconSet'),
};
