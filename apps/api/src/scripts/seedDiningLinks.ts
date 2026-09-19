import * as fs from 'fs/promises';
import { getPool } from '../db/pool.js';
import { createCatalogRepo } from '../services/catalog/repo.js';
import { runSeedDiningLinks } from './seedDiningLinksLogic.js';
import { resolveDiningLinksSeedPath } from './seedDiningLinksPath.js';

async function main(): Promise<void> {
  const pool = getPool();
  const repo = createCatalogRepo(pool);
  const filePath = resolveDiningLinksSeedPath();

  try {
    await runSeedDiningLinks({
      repo,
      filePath,
      fsLib: {
        readFile: fs.readFile,
      },
    });
  } catch (err) {
    console.error('Fatal error during dining links seeding:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
