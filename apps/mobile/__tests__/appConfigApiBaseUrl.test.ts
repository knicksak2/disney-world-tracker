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
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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

  it('sets pre-release version 0.1.0 and iOS camera/photo-library usage strings', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../app.config').default as {
      version?: string;
      ios?: { infoPlist?: Record<string, string> };
    };
    expect(config.version).toBe('0.1.0');
    expect(config.ios?.infoPlist?.NSCameraUsageDescription).toEqual(expect.any(String));
    expect(config.ios?.infoPlist?.NSCameraUsageDescription?.length).toBeGreaterThan(10);
    expect(config.ios?.infoPlist?.NSPhotoLibraryUsageDescription).toEqual(expect.any(String));
    expect(config.ios?.infoPlist?.NSPhotoLibraryUsageDescription?.length).toBeGreaterThan(10);
  });

  // Feature: legal-disclaimers-and-terms, Property 5: App Store & Google Play Packaging Asset Integrity
  it('wires icon, splash, and android.adaptiveIcon to valid 1024x1024 PNG assets on disk', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../app.config').default as {
      icon?: string;
      backgroundColor?: string;
      web?: {
        splash?: { image?: string; resizeMode?: string; backgroundColor?: string };
      };
      android?: {
        adaptiveIcon?: { foregroundImage?: string; backgroundColor?: string };
      };
    };

    expect(config.icon).toBe('./assets/icon.png');
    expect(config.backgroundColor).toBe('#3d1c5c');
    expect(config.web?.splash).toEqual({
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#3d1c5c',
    });
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#5b2a86',
    });

    const parsePngIhdr = (relPath: string) => {
      const fullPath = join(process.cwd(), relPath);
      expect(existsSync(fullPath)).toBe(true);
      const buf = readFileSync(fullPath);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf.readUInt8(24),
        colorType: buf.readUInt8(25),
      };
    };

    // icon.png: 1024x1024 opaque RGB (colorType 2) required by Apple App Store
    expect(parsePngIhdr('./assets/icon.png')).toEqual({
      width: 1024,
      height: 1024,
      bitDepth: 8,
      colorType: 2,
    });

    // adaptive-icon.png: 1024x1024 transparent RGBA (colorType 6) for Android foreground
    expect(parsePngIhdr('./assets/adaptive-icon.png')).toEqual({
      width: 1024,
      height: 1024,
      bitDepth: 8,
      colorType: 6,
    });

    // splash.png: 1024x1024 opaque RGB (colorType 2) on #3d1c5c background
    expect(parsePngIhdr('./assets/splash.png')).toEqual({
      width: 1024,
      height: 1024,
      bitDepth: 8,
      colorType: 2,
    });
  });
});
