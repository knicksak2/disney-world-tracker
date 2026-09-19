export interface SeedDiningLinksRepo {
  updateDiningUrl(upstreamEntityId: string, diningUrl: string): Promise<boolean>;
}

export interface SeedDiningLinksDeps {
  repo: SeedDiningLinksRepo;
  filePath: string;
  fsLib: {
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
  };
  log?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export interface DiningLinkEntry {
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly diningUrl: string;
}

export interface SeedDiningLinksResult {
  readonly updated: number;
  readonly skipped: number;
  readonly total: number;
}

export async function runSeedDiningLinks(
  deps: SeedDiningLinksDeps,
): Promise<SeedDiningLinksResult> {
  const log = deps.log || console.log;
  const warn = deps.warn || console.warn;
  const error = deps.error || console.error;

  log(`Starting seedDiningLinks from file: ${deps.filePath}`);

  let content: string;
  try {
    content = await deps.fsLib.readFile(deps.filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log(`[INFO] Seed file does not exist: ${deps.filePath}. Skipping dining links seed.`);
      return { updated: 0, skipped: 0, total: 0 };
    }
    error(`[ERROR] Failed to read seed file ${deps.filePath}:`, err);
    throw err;
  }

  let entries: DiningLinkEntry[];
  try {
    entries = JSON.parse(content);
    if (!Array.isArray(entries)) {
      throw new Error('Seed file content is not an array');
    }
  } catch (err: any) {
    error(`[ERROR] Failed to parse JSON from seed file ${deps.filePath}:`, err);
    throw err;
  }

  log(`Found ${entries.length} dining link entries.`);

  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.upstreamEntityId || !entry.diningUrl) {
      warn(`[WARN] Skipping malformed entry: ${JSON.stringify(entry)}`);
      skipped++;
      continue;
    }

    try {
      const didUpdate = await deps.repo.updateDiningUrl(
        entry.upstreamEntityId,
        entry.diningUrl,
      );
      if (didUpdate) {
        updated++;
        log(`[OK] Updated dining_url for ${entry.name} (${entry.upstreamEntityId})`);
      } else {
        skipped++;
        warn(`[WARN] Skipping unmatched upstreamEntityId ${entry.upstreamEntityId} (${entry.name})`);
      }
    } catch (err: any) {
      error(
        `[ERROR] Error updating dining_url for ${entry.upstreamEntityId} (${entry.name}):`,
        err,
      );
      skipped++;
    }
  }

  log(
    `Seed pass complete. Updated: ${updated}, Skipped: ${skipped}, Total: ${entries.length}.`,
  );
  return { updated, skipped, total: entries.length };
}
