import { describe, it, expect } from 'vitest';
import { FakeObjectStore } from '../../services/photos/__tests__/fakes.js';
import {
  formatSmokeReport,
  runPhotoStoreSmoke,
  type SmokeCheck,
} from '../photoStoreSmokeReport.js';

describe('photoStoreSmoke', () => {
  it('formats smoke report with passes, failures, and summaries', () => {
    const checks: SmokeCheck[] = [
      {
        name: 'Presign check',
        expected: 'valid url',
        observed: 'valid url',
        pass: true,
      },
      {
        name: 'Mismatch check',
        expected: 'source_changed',
        observed: 'ok',
        pass: false,
      },
    ];

    const report = formatSmokeReport(checks);
    expect(report).toContain('PHOTO STORAGE SMOKE REPORT');
    expect(report).toContain('[PASS] Presign check');
    expect(report).toContain('[FAIL] Mismatch check');
    expect(report).toContain('Total: 2 | Passed: 1 | Failed: 1');
  });

  it('runs step list against fake ObjectStore: every step passes and nothing is left behind', async () => {
    const fakeStore = new FakeObjectStore();
    const testId = 'smoke-test-uuid-1234';

    const checks = await runPhotoStoreSmoke({
      store: fakeStore,
      testId,
    });

    for (const check of checks) {
      expect(check.pass, `Check failed: ${check.name} - observed: ${check.observed}`).toBe(true);
    }

    // Verify nothing is left behind in the store
    const uploadHead = await fakeStore.head(`u/${testId}/full.jpg`);
    const serveHead = await fakeStore.head(`p/${testId}/full.jpg`);
    expect(uploadHead.exists).toBe(false);
    expect(serveHead.exists).toBe(false);
  });
});
