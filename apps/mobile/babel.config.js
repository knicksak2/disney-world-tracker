/**
 * Babel configuration for the Expo mobile app.
 *
 * The `module-resolver` plugin maps the `@dwt/shared` package alias to the
 * shared TypeScript sources so the bundler can resolve workspace imports
 * during development.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@dwt/shared': '../../packages/shared/src',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // Added for react-native-draggable-flatlist (checklist item drag
      // reorder, food-lists Requirement 13.14-13.18 amendment). Required by
      // react-native-reanimated 4.x; must be the LAST plugin in this array.
      // It already includes react-native-worklets' plugin internally — do
      // NOT also add 'react-native-worklets/plugin', which would conflict.
      'react-native-reanimated/plugin',
    ],
  };
};
