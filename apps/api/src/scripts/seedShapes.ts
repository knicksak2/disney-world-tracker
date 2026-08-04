import { getPool } from '../db/pool.js';
import { IntelligenceRepo } from '../services/intelligence/IntelligenceRepo.js';
import { createThemeParksDirectory } from '../services/live/themeParksDirectory.js';
import { createThemeParksClient } from '../services/catalog/themeparks.js';
import { loadConfig } from '../config.js';
import { runSeedShapes } from './seedShapesLogic.js';

async function main() {
  const config = loadConfig();
  const pool = getPool();
  const repo = new IntelligenceRepo(pool);

  const directory = createThemeParksDirectory({
    client: createThemeParksClient({ baseUrl: config.themeparks.baseUrl }),
  });

  const ROPEDROP_BASE_URL = process.env.ROPEDROP_BASE_URL || 'https://ropedropplanner.com/api';
  const SEED_USER_AGENT = process.env.SEED_USER_AGENT || 'DisneyApp/1.0 (seed@example.com)';

  try {
    await runSeedShapes({
      repo,
      directory,
      fetch: globalThis.fetch.bind(globalThis),
      baseUrl: ROPEDROP_BASE_URL,
      userAgent: SEED_USER_AGENT,
      // RopeDrop rate-limits /api/analysis/* at 30/min (~2s spacing); default to a polite 2100ms.
      ...(process.env.SEED_DELAY_MS ? { delayMs: Number(process.env.SEED_DELAY_MS) } : { delayMs: 2100 }),
    });
  } catch (err) {
    console.error('Fatal error during seeding:', err);
  } finally {
    await pool.end();
    console.log('Seed pass complete.');
  }
}

main().catch(console.error);
