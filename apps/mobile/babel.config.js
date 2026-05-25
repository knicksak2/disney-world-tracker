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
    ],
  };
};
