#!/usr/bin/env node
/**
 * Live photo storage smoke check script.
 *
 * Runs against the configured R2 bucket to verify object storage capabilities:
 * - presigning PUT on u/ keys
 * - HEAD checks
 * - copy with CopySourceIfMatch semantics
 * - destination ETag preservation
 * - presigning rejection on p/ keys
 * - clean object deletion
 *
 * Secrets are never printed.
 *
 * Implements: Task 6.5
 * Validates: Requirements 3.2, 3.8, 3.10, 4.2, 8.11, 22.3
 */

import { loadConfig } from '../config.js';
import { R2ObjectStore } from '../services/photos/adapters/r2ObjectStore.js';
import { runPhotoStoreSmoke, formatSmokeReport } from './photoStoreSmokeReport.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.photos.store) {
    console.error('Photo storage is not configured (PHOTOS_STORAGE_BUCKET or credentials missing).');
    process.exit(1);
  }

  const store = new R2ObjectStore({
    endpoint: config.photos.store.endpoint,
    bucket: config.photos.store.bucket,
    accessKeyId: config.photos.store.accessKeyId,
    secretAccessKey: config.photos.store.secretAccessKey,
    region: config.photos.store.region,
  });

  console.log(`Starting Photo Store Smoke check against bucket: ${config.photos.store.bucket}`);
  const checks = await runPhotoStoreSmoke({ store });
  const report = formatSmokeReport(checks);
  console.log(report);

  const allPassed = checks.every((c) => c.pass);
  if (!allPassed) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('photoStoreSmoke.ts') || process.argv[1]?.endsWith('photoStoreSmoke.js')) {
  main().catch((err) => {
    console.error('Smoke script crashed:', err);
    process.exit(1);
  });
}
