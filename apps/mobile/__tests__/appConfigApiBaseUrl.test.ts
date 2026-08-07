/**
 * Feature: mobile-hosted-dev-run
 *
 * Verifies how `app.config.ts` resolves `extra.apiBaseUrl` — the base URL the
 * mobile app talks to. The `dev:mobile:cloud` script sets `APP_ENV=dev` so a
 * dev build targets the hosted (Render) backend; these tests pin that
 * precedence so a local override or a future edit can't silently defeat it.
 *
 * The config is evaluated at import time from `process.env` and an on-disk
 * `.env.<APP_ENV>` file (read from `process.cwd()`, i.e. apps/mobile), so each
 * case mutates the environment, writes a temp env file where needed, and
 * re-imports the module in isolation.
 */
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOSTED_DEFAULT = 'https://dwt-api.onrender.com';
const LOCAL_DEFAULT = 'http://10.0.2.2:3000';

// A distinctive URL only reachable by actually loading the .env.<APP_ENV> file,
// so the file-loading assertion fails against the pre-change logic (which had
// no APP_ENV file loading at all).
const APP_ENV_FILE = 'jesttestcloud';
const APP_ENV_FILE_URL = 'https://from-env-file.test';
const envFilePath = join(process.cwd(), `.env.${APP_ENV_FILE}`);

/** Import app.config.ts fresh under the current environment. */
function resolveApiBaseUrl(): string {
  let apiBaseUrl = '';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../app.config').default as {
      extra?: { apiBaseUrl?: string };
    };
    apiBaseUrl = config.extra?.apiBaseUrl ?? '';
  });
  return apiBaseUrl;
}

describe('app.config.ts apiBaseUrl resolution', () => {
  const KEYS = ['APP_ENV', 'API_BASE_URL', 'PROD_API_BASE_URL', 'NODE_ENV'];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('loads API_BASE_URL from the .env.<APP_ENV> file when APP_ENV is set', () => {
    writeFileSync(envFilePath, `API_BASE_URL=${APP_ENV_FILE_URL}\n`, 'utf8');
    try {
      process.env.APP_ENV = APP_ENV_FILE;
      expect(resolveApiBaseUrl()).toBe(APP_ENV_FILE_URL);
    } finally {
      unlinkSync(envFilePath);
    }
  });

  it('the .env.<APP_ENV> file wins over a pinned API_BASE_URL (e.g. .env.local)', () => {
    writeFileSync(envFilePath, `API_BASE_URL=${APP_ENV_FILE_URL}\n`, 'utf8');
    try {
      process.env.APP_ENV = APP_ENV_FILE;
      process.env.API_BASE_URL = LOCAL_DEFAULT; // simulates .env.local pin
      expect(resolveApiBaseUrl()).toBe(APP_ENV_FILE_URL);
    } finally {
      unlinkSync(envFilePath);
    }
  });

  // These cases exercise the APP_ENV=dev fallback (file absent), so they hide
  // the repo's real apps/mobile/.env.dev for their duration to be deterministic
  // regardless of whether it exists locally.
  describe('APP_ENV=dev with no .env.dev file present', () => {
    const devFilePath = join(process.cwd(), '.env.dev');
    const devFileBak = join(process.cwd(), '.env.dev.jestbak');
    let hid = false;

    beforeAll(() => {
      if (existsSync(devFilePath)) {
        renameSync(devFilePath, devFileBak);
        hid = true;
      }
    });

    afterAll(() => {
      if (hid) renameSync(devFileBak, devFilePath);
    });

    it('falls back to the hosted Render URL, overriding a pinned local API_BASE_URL', () => {
      process.env.APP_ENV = 'dev';
      // Even a pinned local API_BASE_URL (from .env.local) must not win.
      process.env.API_BASE_URL = LOCAL_DEFAULT;
      expect(resolveApiBaseUrl()).toBe(HOSTED_DEFAULT);
    });

    it('honors PROD_API_BASE_URL as the hosted default', () => {
      process.env.APP_ENV = 'dev';
      process.env.PROD_API_BASE_URL = 'https://renamed-service.onrender.com';
      expect(resolveApiBaseUrl()).toBe('https://renamed-service.onrender.com');
    });
  });

  it('uses API_BASE_URL for a non-dev context when APP_ENV is unset', () => {
    process.env.API_BASE_URL = 'http://localhost:3000';
    expect(resolveApiBaseUrl()).toBe('http://localhost:3000');
  });

  it('targets the hosted API for a production build with no override', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveApiBaseUrl()).toBe(HOSTED_DEFAULT);
  });

  it('defaults to the local Android-emulator route for a plain dev run', () => {
    // No APP_ENV, no API_BASE_URL, not production => local default.
    expect(resolveApiBaseUrl()).toBe(LOCAL_DEFAULT);
  });
});
