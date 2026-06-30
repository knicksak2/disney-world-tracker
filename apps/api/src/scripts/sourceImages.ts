#!/usr/bin/env node
/**
 * Experience image-sourcing job.
 *
 * The ThemeParks.wiki catalog upstream exposes no imagery, so this job
 * enriches the `experiences` cache with properly-licensed photos sourced from
 * Wikipedia / Wikimedia Commons. It is intentionally separate from the
 * catalog sync (`runSync`) because images are curated out of band and must
 * survive every catalog refresh — `applyReconciliation` never touches the
 * `image_url` / `image_attribution` columns.
 *
 * Why Wikipedia/Wikimedia rather than scraping disneyworld.disney.go.com:
 *   - Disney's own pages are copyrighted, ToS-restricted, bot-protected, and
 *     JavaScript-rendered; republishing those images is a legal problem.
 *   - Wikimedia content is freely licensed (CC BY-SA / public domain) as long
 *     as attribution is preserved — which is exactly what this job stores in
 *     `image_attribution`.
 *
 * Resolution order for each Experience (first hit wins):
 *   1. **Curated override** — an entry in `imageOverrides.json` keyed by the
 *      Experience name (case-insensitive). The escape hatch for anything the
 *      automated lookup can't find: you pick the URL by hand and it wins.
 *   2. **Confident Wikipedia article match** — the MediaWiki search API finds
 *      candidate pages (several query variants); a page's lead image is
 *      accepted only when the title confidently matches the name.
 *   3. **Wikimedia Commons photo search** — Commons holds photos for far more
 *      attractions/restaurants/shows than there are Wikipedia articles, so
 *      this layer raises coverage substantially. A file is accepted only when
 *      its filename confidently matches and it is a raster photo.
 *   4. **Park-level fallback** (opt-in, `--park-fallback`) — uses the park's
 *      own photo so the row still shows a real image instead of a placeholder.
 *   5. If everything misses, the row keeps `image_url = NULL` and the App
 *      renders its category placeholder.
 *
 * "Confident match" (see `isConfidentMatch`) accepts a candidate when token
 * similarity clears a threshold OR one name's meaningful tokens are a subset
 * of the other's — so a wrong photo is still not guessed, but partial names
 * ("Soarin'" vs "Soarin' Around the World") and Commons filenames with extra
 * date/author tokens still match.
 *
 * Usage:
 *   npm run source-images                    # enrich rows missing an image
 *   npm run source-images -- --force         # re-source every active row
 *   npm run source-images -- --dry-run       # log matches without writing
 *   npm run source-images -- --park-fallback # also use a park photo for misses
 *   npm run source-images -- --overrides path.json # custom overrides file
 *
 * Network access is required. The job is idempotent: re-running without
 * --force only fills rows where image_url IS NULL.
 *
 * Requirements: image display for catalog Experiences (browse + detail).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closePool, getPool } from '../db/pool.js';
import type { DbPool } from '../db/pool.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Wikipedia REST + action API host. English Wikipedia has the best coverage. */
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1';

/**
 * Wikimedia Commons action API. Commons is the media repository behind
 * Wikipedia and holds far more *photos* than there are Wikipedia articles —
 * lots of attractions, restaurants, and shows have Commons photos with no
 * dedicated article. Searching it directly is the single biggest coverage win.
 */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** Requested width (px) for Commons thumbnails — large enough for a hero image. */
const COMMONS_THUMB_WIDTH = 800;

/**
 * Wikimedia's API etiquette REQUIRES a descriptive User-Agent that includes a
 * way to contact you; requests with a generic or placeholder UA are throttled
 * (HTTP 429) or blocked. Set `WIKI_CONTACT` in your env to an email or project
 * URL. Until you do, the job runs with a placeholder that may get rate-limited.
 */
const WIKI_CONTACT = process.env['WIKI_CONTACT'];
const USER_AGENT = `DisneyWorldTracker/0.1 (image-sourcing job; ${
  WIKI_CONTACT ?? 'set WIKI_CONTACT env var'
})`;

/** Politeness delay between upstream calls (ms) to stay well under rate limits. */
const REQUEST_DELAY_MS = 400;

/** Max attempts per request when the server returns 429/503. */
const MAX_RETRIES = 5;

/** Base backoff (ms) used when no `Retry-After` header is supplied. */
const BACKOFF_BASE_MS = 1000;

/**
 * Minimum acceptable token-similarity (0..1) between the Experience name and a
 * candidate page/file title. A candidate also passes when one name's tokens
 * are a subset of the other's (see {@link isConfidentMatch}), which catches
 * cases like "Soarin'" ⊂ "Soarin' Around the World".
 */
const MIN_TITLE_SIMILARITY = 0.5;

/**
 * Wikipedia page titles for each Park, used to source the park-level fallback
 * photo. Each of these pages has a reliable lead image. Keys match the `park`
 * column values written by the catalog sync.
 */
const PARK_WIKI_TITLE: Readonly<Record<string, string>> = {
  'Magic Kingdom': 'Magic Kingdom',
  EPCOT: 'Epcot',
  'Hollywood Studios': "Disney's Hollywood Studios",
  'Animal Kingdom': "Disney's Animal Kingdom",
  'Typhoon Lagoon': "Disney's Typhoon Lagoon",
  'Blizzard Beach': "Disney's Blizzard Beach",
  'Disney Springs': 'Disney Springs',
};

/** Default location of the curated overrides file (next to this script). */
const DEFAULT_OVERRIDES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'imageOverrides.json',
);

/** Per-park fallback image cache so each park page is fetched at most once. */
const parkImageCache = new Map<string, ImageMatch | null>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperienceRow {
  id: string;
  name: string;
  park: string;
  category: string;
}

interface ImageMatch {
  readonly url: string;
  readonly attribution: string;
}

/** Where a resolved image came from, for logging/reporting. */
type MatchSource = 'override' | 'wikipedia' | 'commons' | 'park';

interface ResolvedImage {
  readonly match: ImageMatch;
  readonly source: MatchSource;
}

/** Curated overrides: normalized experience name -> image. */
type OverrideMap = ReadonlyMap<string, ImageMatch>;

interface RunOptions {
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly parkFallback: boolean;
  readonly overridesPath: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getPool();

  if (WIKI_CONTACT === undefined) {
    console.warn(
      '[source-images] WIKI_CONTACT is not set. Wikimedia throttles requests ' +
        'with a placeholder User-Agent (HTTP 429). Set WIKI_CONTACT to your ' +
        'email or project URL to avoid rate limiting.',
    );
  }

  const overrides = await loadOverrides(options.overridesPath);
  if (overrides.size > 0) {
    console.log(`[source-images] loaded ${overrides.size} curated override(s)`);
  }

  const rows = await loadExperiences(pool, options.force);
  console.log(
    `[source-images] ${rows.length} experience(s) to process` +
      (options.force ? ' (force: all active rows)' : ' (missing image only)') +
      (options.dryRun ? ' [dry-run]' : ''),
  );

  const counts: Record<MatchSource, number> = {
    override: 0,
    wikipedia: 0,
    commons: 0,
    park: 0,
  };
  let skipped = 0;

  for (const row of rows) {
    try {
      const resolved = await resolveImage(row, overrides, options);
      if (resolved === null) {
        skipped++;
        console.log(`  · skip   ${row.name} (${row.park}) — no image (placeholder)`);
        continue;
      }

      counts[resolved.source]++;
      console.log(
        `  ✓ ${resolved.source.padEnd(9)} ${row.name} -> ${resolved.match.url}`,
      );
      if (!options.dryRun) {
        await writeImage(pool, row.id, resolved.match);
      }
    } catch (err) {
      skipped++;
      console.warn(
        `  ! error  ${row.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[source-images] done: ${counts.override} override, ${counts.wikipedia} wikipedia, ` +
      `${counts.commons} commons, ${counts.park} park-fallback, ${skipped} skipped` +
      (options.dryRun ? ' (no writes performed)' : ''),
  );
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function loadExperiences(
  pool: DbPool,
  force: boolean,
): Promise<readonly ExperienceRow[]> {
  const where = force
    ? 'active = TRUE'
    : 'active = TRUE AND image_url IS NULL';
  const result = await pool.query<ExperienceRow>(
    `SELECT id, name, park, category
       FROM experiences
      WHERE ${where}
      ORDER BY park ASC, lower(name) ASC`,
  );
  return result.rows;
}

async function writeImage(
  pool: DbPool,
  id: string,
  match: ImageMatch,
): Promise<void> {
  await pool.query(
    `UPDATE experiences
        SET image_url = $2,
            image_attribution = $3,
            updated_at = now()
      WHERE id = $1`,
    [id, match.url, match.attribution.slice(0, 1000)],
  );
}

// ---------------------------------------------------------------------------
// Wikipedia / Wikimedia lookup
// ---------------------------------------------------------------------------

/**
 * Resolve an image for one Experience using the layered strategy documented
 * at the top of the file: override → confident Wikipedia match → park-level
 * fallback. Returns `null` only when every layer misses (the App then renders
 * its category placeholder).
 */
async function resolveImage(
  row: ExperienceRow,
  overrides: OverrideMap,
  options: RunOptions,
): Promise<ResolvedImage | null> {
  // 1. Curated override (always wins).
  const override = overrides.get(normalize(row.name));
  if (override !== undefined) {
    return { match: override, source: 'override' };
  }

  // 2. Confident Wikipedia article match for the specific Experience.
  const wiki = await findImage(row);
  if (wiki !== null) {
    return { match: wiki, source: 'wikipedia' };
  }

  // 3. Wikimedia Commons photo search — catches the many attractions /
  //    restaurants / shows that have photos but no Wikipedia article.
  const commons = await findCommonsImage(row);
  if (commons !== null) {
    return { match: commons, source: 'commons' };
  }

  // 4. Park-level fallback — opt-in via --park-fallback.
  if (options.parkFallback) {
    const park = await getParkImage(row.park);
    if (park !== null) {
      return { match: park, source: 'park' };
    }
  }

  return null;
}

/**
 * Find a confidently-matching Wikipedia article lead image, or `null`.
 *
 * Tries several query variants (park-biased, resort-biased, bare name) and
 * accepts the first candidate whose title confidently matches the Experience
 * name.
 */
async function findImage(row: ExperienceRow): Promise<ImageMatch | null> {
  const queries = [
    `${row.name} ${row.park} Disney`,
    `${row.name} Walt Disney World`,
    `${row.name} Disney`,
    row.name,
  ];
  const seen = new Set<string>();
  for (const query of queries) {
    const candidates = await searchPages(query);
    for (const title of candidates) {
      if (seen.has(title)) continue;
      seen.add(title);
      if (!isConfidentMatch(row.name, title)) {
        continue;
      }
      const summary = await fetchSummary(title);
      if (summary !== null) {
        return summary;
      }
    }
  }
  return null;
}

/**
 * Search Wikimedia Commons for a photo file matching the Experience.
 *
 * Commons holds photos for far more attractions than Wikipedia has articles,
 * so this layer materially raises coverage. We use a `generator=search` over
 * the File namespace and read `imageinfo` to get a thumbnail URL, accepting a
 * file only when its (cleaned) filename confidently matches the name and it is
 * a raster image (not an SVG logo, PDF, or audio file).
 */
async function findCommonsImage(row: ExperienceRow): Promise<ImageMatch | null> {
  const queries = [`${row.name} ${row.park}`, `${row.name} Walt Disney World`];
  const seen = new Set<string>();
  for (const query of queries) {
    const files = await searchCommonsFiles(query);
    for (const file of files) {
      if (seen.has(file.title)) continue;
      seen.add(file.title);
      // Strip "File:" prefix and the extension before comparing.
      const cleaned = file.title
        .replace(/^file:/i, '')
        .replace(/\.[a-z0-9]+$/i, '');
      if (!isConfidentMatch(row.name, cleaned)) {
        continue;
      }
      if (!isPhotoUrl(file.url)) {
        continue;
      }
      return {
        url: file.url,
        attribution: `Photo via Wikimedia Commons (${cleaned.trim()}): ${file.descriptionUrl}. Licensed under the file's stated terms.`,
      };
    }
  }
  return null;
}

interface CommonsFile {
  readonly title: string;
  readonly url: string;
  readonly descriptionUrl: string;
}

/**
 * Query Commons for image files matching `query`, returning a thumbnail URL
 * and description-page URL for each hit.
 */
async function searchCommonsFiles(query: string): Promise<readonly CommonsFile[]> {
  const url =
    `${COMMONS_API}?action=query&format=json&generator=search` +
    `&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query)}` +
    `&prop=imageinfo&iiprop=url|mime&iiurlwidth=${COMMONS_THUMB_WIDTH}`;
  const body = (await fetchJson(url)) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            thumburl?: string;
            url?: string;
            descriptionurl?: string;
            mime?: string;
          }>;
        }
      >;
    };
  };
  const pages = body.query?.pages;
  if (pages === undefined) return [];
  const out: CommonsFile[] = [];
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    const src = info?.thumburl ?? info?.url;
    if (typeof page.title === 'string' && typeof src === 'string') {
      out.push({
        title: page.title,
        url: src,
        descriptionUrl:
          info?.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      });
    }
  }
  return out;
}

/**
 * Resolve (and cache) the park-level fallback image for a park name. Each park
 * page is fetched at most once per run; a miss is cached as `null` so we don't
 * retry it for every Experience in that park.
 */
async function getParkImage(park: string): Promise<ImageMatch | null> {
  const cached = parkImageCache.get(park);
  if (cached !== undefined) {
    return cached;
  }
  const title = PARK_WIKI_TITLE[park];
  let result: ImageMatch | null = null;
  if (title !== undefined) {
    const summary = await fetchSummary(title);
    if (summary !== null) {
      result = {
        url: summary.url,
        attribution: `${park} (park image) — ${summary.attribution}`,
      };
    }
  }
  parkImageCache.set(park, result);
  return result;
}

/**
 * Load the curated overrides file into a normalized-name -> ImageMatch map.
 *
 * The file is a JSON object whose keys are Experience names (matched
 * case-insensitively) and whose values are either a URL string or an object
 * `{ "url": "...", "attribution": "..." }`. A missing file is treated as "no
 * overrides" so the job runs out of the box.
 */
async function loadOverrides(path: string): Promise<OverrideMap> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const map = new Map<string, ImageMatch>();
  for (const [name, value] of Object.entries(parsed)) {
    // Keys starting with `__` are documentation (e.g. `__comment`); skip them.
    if (name.startsWith('__')) continue;
    const key = normalize(name);
    if (key.length === 0) continue;
    if (typeof value === 'string') {
      map.set(key, {
        url: value,
        attribution: 'Curated image (manual override).',
      });
    } else if (value !== null && typeof value === 'object') {
      const rec = value as { url?: unknown; attribution?: unknown };
      if (typeof rec.url === 'string' && rec.url.length > 0) {
        map.set(key, {
          url: rec.url,
          attribution:
            typeof rec.attribution === 'string' && rec.attribution.length > 0
              ? rec.attribution
              : 'Curated image (manual override).',
        });
      }
    }
  }
  return map;
}

/**
 * MediaWiki search: returns candidate page titles, best match first.
 */
async function searchPages(query: string): Promise<readonly string[]> {
  const url =
    `${WIKI_API}?action=query&list=search&format=json` +
    `&srlimit=5&srsearch=${encodeURIComponent(query)}`;
  const body = (await fetchJson(url)) as {
    query?: { search?: Array<{ title?: string }> };
  };
  const hits = body.query?.search ?? [];
  return hits
    .map((h) => h.title)
    .filter((t): t is string => typeof t === 'string');
}

/**
 * REST summary for a page: yields the lead image (`originalimage` preferred,
 * `thumbnail` as a fallback) plus an attribution string pointing back to the
 * source page, satisfying the Wikimedia attribution requirement.
 */
async function fetchSummary(title: string): Promise<ImageMatch | null> {
  const url = `${WIKI_REST}/page/summary/${encodeURIComponent(title)}`;
  const body = (await fetchJson(url)) as {
    title?: string;
    content_urls?: { desktop?: { page?: string } };
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
  };
  const source = body.originalimage?.source ?? body.thumbnail?.source;
  if (typeof source !== 'string' || source.length === 0) {
    return null;
  }
  const pageUrl =
    body.content_urls?.desktop?.page ??
    `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  return {
    url: source,
    attribution: `Image via Wikipedia (${body.title ?? title}): ${pageUrl}. Licensed under the page's stated terms (typically CC BY-SA).`,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });

    if (response.ok) {
      return response.json();
    }

    // 429 (Too Many Requests) and 503 (Service Unavailable) are transient:
    // wait and retry. Wikimedia sends a `Retry-After` header (seconds) on
    // 429 — honor it when present, otherwise use exponential backoff.
    if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const waitMs = retryAfter ?? BACKOFF_BASE_MS * 2 ** (attempt - 1);
      // Drain the body so the connection can be reused.
      await response.text().catch(() => undefined);
      console.log(
        `    … ${response.status} from upstream, retrying in ${Math.round(waitMs / 1000)}s` +
          ` (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      continue;
    }

    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  // Unreachable: the loop either returns, retries, or throws.
  throw new Error(`Exhausted retries for ${url}`);
}

/** Parse a `Retry-After` header (delta-seconds form) into milliseconds. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, drop a leading "the", collapse whitespace. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parenthetical disambiguators
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

/** Tokenize a normalized string into a set of words, ignoring common filler. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'at',
  'in',
  'disney',
  'disneys',
  'walt',
  'world',
  'resort',
]);

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

/**
 * Decide whether `title` confidently refers to the same thing as `name`.
 *
 * Two signals, either of which is sufficient:
 *   - Jaccard token similarity ≥ {@link MIN_TITLE_SIMILARITY}; or
 *   - one side's meaningful tokens are a subset of the other's (catches
 *     "Soarin'" vs "Soarin' Around the World", or a Commons filename that
 *     appends a date/photographer). The subset side must have ≥ 2 tokens, or
 *     1 token that is ≥ 4 chars, so a single short generic word can't match.
 */
function isConfidentMatch(name: string, title: string): boolean {
  const a = tokens(name);
  const b = tokens(title);
  if (a.size === 0 || b.size === 0) return false;

  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  if (union > 0 && intersection / union >= MIN_TITLE_SIMILARITY) {
    return true;
  }

  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  const isSubset = [...small].every((t) => large.has(t));
  const distinctive =
    small.size >= 2 || [...small].some((t) => t.length >= 4);
  return isSubset && distinctive;
}

/** True for raster image URLs (skip SVG logos, PDFs, audio/video, etc.). */
function isPhotoUrl(url: string): boolean {
  return /\.(jpe?g|png|webp)(\?|$)/i.test(url);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): RunOptions {
  const overridesIdx = argv.indexOf('--overrides');
  const overridesPath =
    overridesIdx >= 0 && argv[overridesIdx + 1] !== undefined
      ? resolve(argv[overridesIdx + 1] as string)
      : DEFAULT_OVERRIDES_PATH;
  return {
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    parkFallback: argv.includes('--park-fallback'),
    overridesPath,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((err: unknown) => {
    console.error('[source-images] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
