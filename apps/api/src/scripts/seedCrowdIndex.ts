import * as fs from 'fs/promises';
import * as path from 'path';
import { getPool } from '../db/pool.js';
import { IntelligenceRepo } from '../services/intelligence/IntelligenceRepo.js';
import { loadConfig } from '../config.js';
import { runSeedCrowdIndex } from './seedCrowdIndexLogic.js';

async function main() {
  const config = loadConfig();
  const pool = getPool();
  const repo = new IntelligenceRepo(pool);

  // Resolve directory (absolute or relative to cwd)
  const dir = path.resolve(process.cwd(), config.intelligence.crowdSeedDir);

  try {
    await runSeedCrowdIndex({
      repo,
      dir,
      fsLib: {
        readdir: fs.readdir,
        readFile: fs.readFile,
      },
    });
  } catch (err) {
    console.error('Fatal error during crowd index seeding:', err);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
