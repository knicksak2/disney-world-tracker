/**
 * Unit tests for the remote-push environment gate.
 *
 * Verifies `remotePushSupported()` reports `false` only in Expo Go
 * (`executionEnvironment === 'storeClient'`) and `true` in development
 * (`bare`) and production (`standalone`) builds — the gate that keeps the
 * Share notification flow from crashing in Expo Go (SDK 53+ removed remote
 * push there) while running fully in a real build.
 */

const setExecutionEnvironment = (value: string | undefined): void => {
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { executionEnvironment: value },
  }));
};

describe('remotePushSupported', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('returns false in Expo Go (storeClient)', () => {
    jest.isolateModules(() => {
      setExecutionEnvironment('storeClient');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { remotePushSupported } = require('../pushSupport');
      expect(remotePushSupported()).toBe(false);
    });
  });

  test('returns true in a development build (bare)', () => {
    jest.isolateModules(() => {
      setExecutionEnvironment('bare');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { remotePushSupported } = require('../pushSupport');
      expect(remotePushSupported()).toBe(true);
    });
  });

  test('returns true in a production/standalone build', () => {
    jest.isolateModules(() => {
      setExecutionEnvironment('standalone');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { remotePushSupported } = require('../pushSupport');
      expect(remotePushSupported()).toBe(true);
    });
  });
});
