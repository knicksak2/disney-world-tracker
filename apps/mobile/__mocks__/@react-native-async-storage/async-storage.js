// Automatic manual mock (dark-mode retrofit). Every themed component reaches
// themeStore -> appearanceStorage -> AsyncStorage, whose native entry throws
// at import when the native module is absent. Jest applies this <rootDir>
// node-module mock to every test file; an explicit per-file jest.mock factory
// still takes precedence.
module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
