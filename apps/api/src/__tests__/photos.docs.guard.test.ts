/**
 * Documentation and deployment configuration guard tests for photo uploads.
 *
 * Implements: Tasks 14.1 and 14.4
 * Validates: Requirements 19.10, 20.5, 22.1, 22.2, 22.4, 22.5, 22.6, 22.7
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root is two levels up from apps/api/src/__tests__
const API_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(API_ROOT, '..', '..');

const HOSTING_MD_PATH = resolve(REPO_ROOT, 'docs', 'hosting.md');
const README_MD_PATH = resolve(REPO_ROOT, 'README.md');
const RENDER_YAML_PATH = resolve(REPO_ROOT, 'render.yaml');
const ENV_EXAMPLE_PATH = resolve(API_ROOT, '.env.example');
const DESIGN_MD_PATH = resolve(REPO_ROOT, '.kiro', 'specs', 'photo-uploads', 'design.md');
const PRIVACY_POLICY_PATH = resolve(REPO_ROOT, 'docs', 'privacy-policy.md');

describe('Photos Documentation & Config Guard (Task 14.1 & 14.4)', () => {
  const hostingMd = readFileSync(HOSTING_MD_PATH, 'utf-8');
  const readmeMd = readFileSync(README_MD_PATH, 'utf-8');
  const renderYaml = readFileSync(RENDER_YAML_PATH, 'utf-8');
  const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');

  it('docs/hosting.md contains sweep endpoint, Photo_Cron crontab, and AI provider names', () => {
    expect(hostingMd).toContain('/internal/photos/sweep/run');
    expect(hostingMd).toContain('5 7,13,19,0 * * *');
    expect(hostingMd).toContain('OpenAI');
    expect(hostingMd).toContain('Google');
  });

  it('neither docs/hosting.md nor README.md contains the phrase "no object storage"', () => {
    expect(hostingMd.toLowerCase()).not.toContain('no object storage');
    expect(readmeMd.toLowerCase()).not.toContain('no object storage');
  });

  it('all design.md PHOTO* variables (except mobile-only) appear in apps/api/.env.example', () => {
    const designMd = readFileSync(DESIGN_MD_PATH, 'utf-8');

    // Extract table rows from "Configuration & Constants"
    const configSection = designMd.split('## Configuration & Constants')[1]?.split('## Correctness Properties')[0];
    expect(configSection).toBeDefined();

    const photoVarRegex = /\|\s*`?(PHOTO[A-Z0-9_]+)`?\s*(\([^)]*\))?\s*\|/g;
    const matches: { name: string; isMobile: boolean }[] = [];
    let match: RegExpExecArray | null;

    while ((match = photoVarRegex.exec(configSection!)) !== null) {
      const varName = match[1];
      if (!varName) {
        continue;
      }
      const annotation = match[2] || '';
      const isMobile = annotation.includes('(mobile') || annotation.includes('mobile constant');
      matches.push({ name: varName, isMobile });
    }

    expect(matches.length).toBeGreaterThan(20);

    for (const item of matches) {
      if (item.isMobile) {
        continue;
      }
      expect(
        envExample,
        `Expected ${item.name} to appear in apps/api/.env.example`,
      ).toContain(item.name);
    }

    // Explicitly assert critical named variables
    expect(envExample).toContain('PHOTOS_GLOBAL_DAILY_CAP');
    expect(envExample).toContain('PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS');
    expect(envExample).toContain('PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS');
    expect(envExample).toContain('PHOTOS_RECAP_HIGHLIGHT_MAX');
    expect(envExample).toContain('PHOTOS_EXPERIENCE_STRIP_MAX');
  });

  it('render.yaml lists the secret variables without values (sync: false)', () => {
    const secretKeys = [
      'PHOTOS_CRON_SECRET',
      'PHOTO_STORE_ENDPOINT',
      'PHOTO_STORE_BUCKET',
      'PHOTO_STORE_ACCESS_KEY_ID',
      'PHOTO_STORE_SECRET_ACCESS_KEY',
      'PHOTO_HARM_API_KEY',
      'PHOTO_VISION_API_KEY',
    ];

    for (const key of secretKeys) {
      // Must be present in render.yaml
      expect(renderYaml, `Expected ${key} in render.yaml`).toContain(`key: ${key}`);

      // Must be declared with sync: false and no value line
      const keyIndex = renderYaml.indexOf(`key: ${key}`);
      const snippet = renderYaml.slice(keyIndex, keyIndex + 120);
      expect(snippet, `Expected ${key} to have sync: false`).toContain('sync: false');
      expect(snippet, `Expected ${key} not to have hardcoded value:`).not.toMatch(/value:\s*\S+/);
    }
  });

  it('keep-alive section of docs/hosting.md does not mention the photo sweep path (Requirement 19.10)', () => {
    const keepWarmStart = hostingMd.indexOf('### Keeping it warm for free (scheduled pinger)');
    expect(keepWarmStart).toBeGreaterThan(-1);

    const nextSectionStart = hostingMd.indexOf('### Dedicated Trip Booking Reminders Cron', keepWarmStart);
    expect(nextSectionStart).toBeGreaterThan(keepWarmStart);

    const keepWarmSection = hostingMd.slice(keepWarmStart, nextSectionStart);
    expect(keepWarmSection).not.toContain('/internal/photos/sweep/run');
    expect(keepWarmSection).not.toContain('photos/sweep');
  });

  it('docs/privacy-policy.md exists and contains required third-party disclosures, operator review sentence, and user-content section (Task 14.4)', () => {
    expect(existsSync(PRIVACY_POLICY_PATH)).toBe(true);

    const privacyPolicy = readFileSync(PRIVACY_POLICY_PATH, 'utf-8');

    // Mentions third parties
    expect(privacyPolicy).toContain('OpenAI');
    expect(privacyPolicy).toContain('Google');
    expect(privacyPolicy).toContain('Cloudflare');

    // Operator review sentence (Requirement 22.1: photos reported or flagged for review may be viewed by the app operator)
    expect(privacyPolicy).toMatch(/viewed by the app operator/i);

    // User content section with objectionable content statement and support contact placeholder (Requirement 22.7)
    expect(privacyPolicy).toMatch(/user-generated content|objectionable content/i);
    // The contact address is sourced from the SUPPORT_EMAIL env var (account-deletion R20.5); the old
    // literal placeholder must never come back.
    expect(privacyPolicy).toContain('SUPPORT_EMAIL');
    expect(privacyPolicy).not.toContain('[Support Contact Email]');
  });
});
