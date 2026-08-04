import * as path from 'path';
import type { IntelligenceRepo, ParkCrowdIndexRow } from '../services/intelligence/IntelligenceRepo.js';

export interface SeedCrowdIndexDeps {
  repo: IntelligenceRepo;
  dir: string;
  fsLib: {
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
  };
  log?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

const MONTH_MAP: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const PARK_MAP: Record<string, string> = {
  'Magic Kingdom': 'Magic Kingdom',
  'Epcot': 'EPCOT',
  'Hollywood Studios': 'Hollywood Studios',
  'Animal Kingdom': 'Animal Kingdom',
};

export async function runSeedCrowdIndex(deps: SeedCrowdIndexDeps): Promise<void> {
  const log = deps.log || console.log;
  const warn = deps.warn || console.warn;
  void warn; // Silence unused warning if no warn logs are generated
  const error = deps.error || console.error;

  log(`Starting seedCrowdIndex from directory: ${deps.dir}`);

  let files: string[] = [];
  try {
    files = await deps.fsLib.readdir(deps.dir);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log(`[INFO] Seed directory does not exist: ${deps.dir}. Skipping crowd index seed.`);
      return;
    }
    throw err;
  }

  const htmlFiles = files.filter(f => f.endsWith('.html'));
  log(`Found ${htmlFiles.length} HTML files.`);

  let totalUpserted = 0;

  for (const file of htmlFiles) {
    try {
      log(`Parsing file: ${file}`);
      const content = await deps.fsLib.readFile(path.join(deps.dir, file), 'utf8');

      // 1. Split into day blocks: <a href=".../past-crowds/{month}-{year}/{day}" ... > ... </a>
      const dayBlockRegex = /<a[^>]*href="[^"]*\/past-crowds\/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{4})\/(\d{1,2})"[^>]*>([\s\S]*?)<\/a>/gi;
      
      let dayMatch;
      const rowsToUpsert: ParkCrowdIndexRow[] = [];

      while ((dayMatch = dayBlockRegex.exec(content)) !== null) {
        const monthStr = dayMatch[1]!.toLowerCase();
        const yearStr = dayMatch[2]!;
        const dayStr = dayMatch[3]!;
        const innerHtml = dayMatch[4]!;

        const monthNum = MONTH_MAP[monthStr]!;
        const paddedDay = dayStr.padStart(2, '0');
        const dateStr = `${yearStr}-${monthNum}-${paddedDay}`;
        const date = new Date(`${dateStr}T00:00:00Z`);

        // 2. Parse parks within the day block.
        // The <h4> carries classes in the real markup (e.g. <h4 class="flex-1 text-right leading-tight">),
        // so allow attributes on the tag. The bubble must immediately follow its park <h4>, which
        // naturally excludes the day's overall crowd bubble (that one has no preceding <h4>).
        const parkRegex = /<h4[^>]*>\s*([^<]+?)\s*<\/h4>\s*<div[^>]*class="[^"]*crowd-bubble-level-(\d+)[^"]*"[^>]*>\s*\2\s*<\/div>/gi;
        
        let parkMatch;
        while ((parkMatch = parkRegex.exec(innerHtml)) !== null) {
          const rawPark = parkMatch[1]!;
          const level = parseInt(parkMatch[2]!, 10);

          const mappedPark = PARK_MAP[rawPark];
          if (!mappedPark) {
            continue; // Ignore unmapped names
          }

          const ratio = level / 5;
          const crowd_index = Math.max(0.4, Math.min(3.0, ratio));

          rowsToUpsert.push({
            park: mappedPark,
            date,
            crowd_index,
            daily_avg_wait: 0,
            sample_count: 0,
            source: 'seed',
          });
        }
      }

      if (rowsToUpsert.length > 0) {
        await deps.repo.upsertParkCrowdIndices(rowsToUpsert);
        totalUpserted += rowsToUpsert.length;
        log(`[OK] Inserted ${rowsToUpsert.length} seed rows from ${file}`);
      } else {
        log(`[INFO] No valid data found in ${file}`);
      }

    } catch (err) {
      error(`[ERROR] Failed processing file ${file}:`, err);
    }
  }

  log(`Seed pass complete. Upserted ${totalUpserted} rows total.`);
}
