// Metro configuration for the Expo mobile app in an npm-workspaces monorepo.
//
// Two things this config handles that the Expo defaults don't:
//
//   1. Workspace resolution. The app imports `@dwt/shared` from
//      `../../packages/shared/src`. Metro must watch the workspace root and
//      know about both the app-local and root `node_modules` so hoisted
//      dependencies resolve.
//
//   2. NodeNext `.js` import specifiers. The shared package is authored in
//      TypeScript using the NodeNext convention, where relative imports carry
//      an explicit `.js` extension (e.g. `import './enums.js'`) even though
//      the file on disk is `enums.ts`. Node + tsx + vitest resolve this
//      automatically; Metro does not. The custom `resolveRequest` below
//      rewrites `.js` -> `.ts` for relative imports that originate inside the
//      shared package source, falling back to the default resolver for
//      everything else.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to packages/shared trigger reloads.
// Append to (rather than replace) Expo's default watchFolders so the
// SDK-provided entries are preserved — expo-doctor (SDK 53+) flags a config
// that drops the defaults. De-duplicate in case the workspace root is
// already covered by a default entry.
const defaultWatchFolders = config.watchFolders ?? [];
config.watchFolders = Array.from(
  new Set([...defaultWatchFolders, workspaceRoot]),
);

// Resolve dependencies from both the app and the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Rewrite NodeNext `.js` specifiers to their `.ts` source, scoped to imports
// originating inside packages/shared/src so node_modules `.js` files are
// untouched.
const sharedSrc = path.resolve(workspaceRoot, 'packages', 'shared', 'src');
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath || '';
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    origin.startsWith(sharedSrc)
  ) {
    const tsCandidate = `${moduleName.slice(0, -3)}.ts`;
    try {
      return context.resolveRequest(context, tsCandidate, platform);
    } catch {
      // Fall through to the default resolver below.
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
