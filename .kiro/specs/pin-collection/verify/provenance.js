/* Provenance gate for the release catalogue (pin-catalog-mockup.html).
 *
 * WHY THIS EXISTS. CREDITS.md states "Every motif used on a pin must have a row here
 * before it ships" and calls itself the audit trail for the CC BY attribution
 * obligation. Nothing enforced it. The gate was fully green while 58 of the 88 motifs
 * the catalogue renders had no entry in the provenance table.
 *
 * WHY THE EXISTING BYTE CHECK DOES NOT COVER THIS. all.js walks the .svg FILES in
 * motifs/ and asserts motif-paths.js still matches each one, guarded by
 * `MOTIF_LIB[key] !== undefined`. Two blind spots follow:
 *   1. a library key with NO source file is never visited, so it cannot fail;
 *   2. the catalogue renders MOTIFS = Object.assign({}, MOTIF_LIB, {inline...}), so an
 *      inline entry can shadow the licensed file. `directorChair` and `filmProjector`
 *      are byte-asserted against files that are not what ships, and `toriiGate` was
 *      holding delapouite/pagoda.svg's path entirely.
 * So this suite asserts from the other direction: start from what a pin actually
 * renders and demand the paperwork for it.
 *
 * It is expected to be RED until the catalogue's provenance is finished. That is the
 * point - "no row, no ship" is a shipping requirement, so it belongs in the gate
 * rather than in a paragraph.
 */
const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./catalog-loader');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const dir = path.dirname(file);
const mdir = path.join(dir, 'motifs');

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* ---------- resolve what the page actually renders ---------- */
/* The v2 catalogue builds its roster through mapV2Pins (not a literal PINS array) and merges
   MOTIFS = Object.assign({}, window.MOTIF_LIB, {inline}). catalog-loader.js executes the
   page's own scripts and hands back the resolved objects, so provenance screens exactly what
   the catalogue draws. */
let cat;
try { cat = loadCatalog(file); }
catch (e) { console.error('FAIL: could not load catalogue -> ' + e.message); process.exit(1); }
const LIB = cat.MOTIF_LIB || {};
const INLINE = cat.INLINE || {};
const MOTIFS = cat.MOTIFS || {};
const PINS = cat.PINS || [];
A(Object.keys(MOTIFS).length > 0, 'MOTIFS resolved through the loader (' + Object.keys(MOTIFS).length + ' keys)');
A(Array.isArray(PINS) && PINS.length > 0, 'PINS resolved through the loader (' + PINS.length + ' pins)');

/* motif keys that are drawn by a DEDICATED renderPin branch (`o.motif === 'X'`) rather than
   from a MOTIFS[key] path. Their art lives in the render code as original hand-authored
   geometry, so — like the park-emblem scenes — they carry no external attribution obligation
   and are exempt from the "needs a source file" check (but still get a row if derived). */
const dispatchMotifs = new Set();
for (const m of cat.inline.matchAll(/o\.motif\s*===\s*'([^']+)'/g)) dispatchMotifs.add(m[1]);

/* ---------- the provenance table ----------
   Only the "| `file.svg` | Author | Source | Licence | ... |" rows count. CREDITS.md
   also names files in prose - chosen, rejected, alternates - and a file appearing in
   the REJECTED list is mentioned but emphatically not credited, so a loose backtick
   search would pass on exactly the wrong evidence. */
const credits = fs.readFileSync(path.join(mdir, 'CREDITS.md'), 'utf8');

/* Parse by COLUMN NAME, not position. CREDITS.md holds several tables with different
   shapes - the provenance table is "File | Author | Source | Licence | Used for", while
   the later pass tables are "File | Author | Park | Note". Reading column 4 positionally
   picks up a Note and calls it a licence, which is how the first version of this check
   reported "Chosen by eye..." as a licence in use. Only a table that actually has a
   Licence column can establish provenance. */
const table = new Map();       // filename -> { author, source, licence }
const lines = credits.split(/\r?\n/);
let cols = null;
for (const line of lines) {
  if (!line.trim().startsWith('|')) { cols = null; continue; }
  const cells = line.split('|').slice(1, -1).map(s => s.trim());
  if (/^-+$/.test(cells[0] && cells[0].replace(/[\s:]/g, ''))) continue;   // separator row
  const lower = cells.map(c => c.toLowerCase());
  if (lower.includes('file') && lower.includes('author')) { cols = lower; continue; }
  if (!cols) continue;
  const idx = n => cols.indexOf(n);
  const fileCell = cells[idx('file')] || '';
  /* .path as well as .svg: derived geometry is stored as a bare path, and a row keyed to
     one is still provenance */
  const m = fileCell.match(/`([^`]+\.(?:svg|path))`/);
  if (!m) continue;
  if (idx('licence') === -1 && idx('license') === -1) continue;  // not a provenance table
  const li = idx('licence') === -1 ? idx('license') : idx('licence');
  table.set(m[1], {
    author: cells[idx('author')] || '',
    source: (idx('source') > -1 ? cells[idx('source')] : '') || '',
    licence: cells[li] || '',
  });
}
A(table.size > 0, 'parsed the CREDITS.md provenance table by column name (' + table.size + ' rows)');

const rowsComplete = [...table.entries()].filter(([, v]) => !v.author || !v.licence);
A(rowsComplete.length === 0, 'every provenance row names an author and a licence' +
  (rowsComplete.length ? ' -> ' + rowsComplete.map(([k]) => k).join(', ') : ''));

/* ---------- helpers ---------- */
const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const localFiles = fs.readdirSync(mdir);
const svgSet = new Set(localFiles.filter(f => f.endsWith('.svg')));
const pathSet = new Set(localFiles.filter(f => f.endsWith('.path')));

function upstreamPathOf(svgName) {
  const t = fs.readFileSync(path.join(mdir, svgName), 'utf8');
  const ms = [...t.matchAll(/<path[^>]*\sd="([^"]+)"/g)];
  /* game-icons files carry a full-canvas background rect as path[0]; the icon is path[1] */
  return ms.length > 1 ? ms[1][1] : (ms[0] ? ms[0][1] : null);
}

const used = [...new Set(PINS.filter(p => !p.scene && p.motif).map(p => p.motif))].sort();

/* A motif key does not always kebab-case to its filename: `carouselHorse` ships as
   `carouselHorse.svg` (camelCase kept), `__balloon` reuses `balloons.svg`, and the two
   monorail scene names map to hand-authored files. So resolve a key to its provenance by
   trying the raw key and the kebab form as both .svg and .path, plus a small explicit alias
   for the handful that follow neither pattern. */
const ALIAS = {
  /* motif key -> CREDITS filename, for the few whose key follows neither `key.svg` nor
     `kebab(key).svg`. Do NOT alias a key to an unrelated file, as that credits the wrong
     source. `__balloon` is Fontisto's hot-air-balloon, stored under a readable filename. */
  __balloon: 'hot-air-balloon.path',
};
function candidatesFor(k) {
  if (ALIAS[k]) return [ALIAS[k]];
  return [k + '.svg', k + '.path', kebab(k) + '.svg', kebab(k) + '.path'];
}
const ORIGINAL_RE = /project original|original|proprietary/i;

/* ---------- 1. every rendered motif needs a provenance row ---------- */
const noRow = [], noSource = [], derived = [];
used.forEach(k => {
  const cands = candidatesFor(k);
  const rowKey = cands.find(c => table.has(c));
  if (!rowKey) noRow.push(k);
  const row = rowKey ? table.get(rowKey) : null;
  const isOriginal = row && ORIGINAL_RE.test(row.licence);

  const fileKey = cands.find(c => svgSet.has(c) || pathSet.has(c));
  /* A source file must exist for a motif rendered from MOTIFS[k], so its origin is provable.
     Two exemptions, both because the geometry does not live in a standalone file:
       - Project Original art authored directly by us, and
       - any motif drawn by a dedicated renderPin branch (its paths are hardcoded in the
         render code, licensed or not — the CREDITS row still records the attribution). */
  if (!fileKey && !isOriginal && !dispatchMotifs.has(k)) { noSource.push(k); return; }

  /* A motif drawn by a dedicated renderPin branch does not render from MOTIFS[k]; any
     MOTIFS[k] path is vestigial, so comparing it to the .svg says nothing about what ships.
     Only screen "differs from its source" for motifs actually rendered from their path. */
  if (dispatchMotifs.has(k)) return;
  const svgCand = cands.find(c => svgSet.has(c));
  if (svgCand) {
    const up = upstreamPathOf(svgCand);
    if (up !== null && MOTIFS[k] != null && String(MOTIFS[k]) !== up) derived.push(k);
  }
});

A(noRow.length === 0,
  'every motif the catalogue renders has a CREDITS provenance row (' +
  (used.length - noRow.length) + '/' + used.length + ')' +
  (noRow.length ? '\n       missing (' + noRow.length + '): ' + noRow.join(', ') : ''));

A(noSource.length === 0,
  'every motif the catalogue renders has a source file in motifs/, so its origin can be shown (' +
  (used.length - noSource.length) + '/' + used.length + ')' +
  (noSource.length ? '\n       no source file (' + noSource.length + '): ' + noSource.join(', ') : ''));

/* Derived art is legitimate under CC BY - welding is documented in CREDITS - but the
   row has to admit it, otherwise the table claims we ship the pristine licensed file. */
const derivedUndocumented = derived.filter(k => {
  const rowKey = candidatesFor(k).find(c => table.has(c));
  const row = rowKey ? table.get(rowKey) : null;
  return !row || !/weld|modif|derive|edit|our own|adapted/i.test(row.author + ' ' + row.source + ' ' + (credits.split('\n').find(l => rowKey && l.includes('`' + rowKey + '`')) || ''));
});
A(derived.length === 0 || derivedUndocumented.length === 0,
  'every motif that differs from its source file is recorded as derived' +
  (derivedUndocumented.length ? '\n       differs from its .svg but the row does not say so (' +
    derivedUndocumented.length + '): ' + derivedUndocumented.join(', ') : ''));

/* ---------- 2. no inline entry may shadow a licensed file ---------- */
const shadowing = Object.keys(INLINE).filter(k =>
  LIB[k] !== undefined && String(INLINE[k]) !== String(LIB[k]));
const shadowingWithFile = shadowing.filter(k => svgSet.has(kebab(k) + '.svg'));
A(shadowingWithFile.length === 0,
  'no inline override replaces the art of a motif that has a licensed file ' +
  '(all.js byte-asserts the file, so the assertion would cover art that never renders)' +
  (shadowingWithFile.length ? '\n       shadowed (' + shadowingWithFile.length + '): ' +
    shadowingWithFile.join(', ') : ''));

A(shadowing.length === 0,
  'the inline block contains no override that silently differs from motif-paths.js' +
  (shadowing.length ? '\n       differs (' + shadowing.length + '): ' + shadowing.join(', ') : ''));

/* ---------- 3. the inline block should not duplicate the library ---------- */
const redundant = Object.keys(INLINE).filter(k =>
  LIB[k] !== undefined && String(INLINE[k]) === String(LIB[k]));
A(redundant.length === 0,
  'the inline block holds no byte-identical copy of a library entry ' +
  '(a redundant copy is a shadowing hazard with no benefit)' +
  (redundant.length ? '\n       redundant copies: ' + redundant.length + ' keys' : ''));

/* ---------- 4. reverse direction: credited files must exist ----------
   A row's file is normally the attribution evidence and must be present. But a motif whose
   geometry lives in our own code has no standalone file, and that is legitimate for two kinds:
   a *Project Original* row, and any motif drawn by a dedicated renderPin branch (whose art —
   licensed-and-edited like the Twemoji-derived monorail, or original — is hardcoded in the
   render code). Collect the row files those code-authored motifs resolve to, and exempt them;
   every other credited file must exist so a stale row cannot hide. */
const codeAuthoredFiles = new Set();
used.forEach(k => {
  if (!dispatchMotifs.has(k)) return;
  const rk = candidatesFor(k).find(c => table.has(c));
  if (rk) codeAuthoredFiles.add(rk);
});
const creditedMissing = [...table.entries()]
  .filter(([f, v]) => !svgSet.has(f) && !pathSet.has(f) &&
                      !ORIGINAL_RE.test(v.licence) && !codeAuthoredFiles.has(f))
  .map(([f]) => f);
A(creditedMissing.length === 0, 'every credited file is present in motifs/ (code-authored ' +
  'render-branch and Project Original motifs excepted)' +
  (creditedMissing.length ? ' -> ' + creditedMissing.join(', ') : ''));

/* ---------- 5. the in-app attribution must cover every licence we actually use ---------- */
const rowFor = k => { const c = candidatesFor(k).find(x => table.has(x)); return c ? table.get(c) : null; };
const licences = [...new Set(used.map(rowFor).filter(Boolean).map(r => r.licence))];
const attributionBlock = (credits.match(/## Attribution required in-app[\s\S]*?(?=\n## )/) || [''])[0];
/* CC0 is a public-domain dedication and requires no attribution, so demanding that the
   in-app credits name it would be inventing an obligation. Only licences that actually
   require something of us need to appear: CC BY needs attribution, MIT and Apache need
   their notice retained. */
const NEEDS_ATTRIBUTION = /CC[\s-]*BY|MIT|Apache/i;

/* Checking that the token "CC BY" appears somewhere is not enough: "CC BY 3.0" satisfied it
   while a Boxicons asset under CC BY 4.0 went uncredited, and the row named only Lorc while
   the shipped set also uses Delapouite, Skoll and Cathelineau. CC BY requires naming the
   AUTHOR, so assert per author, per source and per licence version - the specific obligation,
   not the family. */
const shortToken = s => (String(s).match(/[A-Za-z][A-Za-z0-9-]{3,}/) || [''])[0];
/* key on the DISTINCT obligation, not the raw row: the Source cell often carries the specific
   upstream filename, so keying on it reported the same author sixteen times */
const obligations = new Map();
used.forEach(k => {
  const r = rowFor(k);
  if (!r || !NEEDS_ATTRIBUTION.test(r.licence)) return;
  obligations.set(shortToken(r.author) + '|' + shortToken(r.source) + '|' +
                  (r.licence.match(/CC[\s-]*BY[\s-]*\d(?:\.\d)?|MIT|Apache/i) || [r.licence])[0], r);
});
const uncovered = [];
for (const [, r] of obligations) {
  const licenceVersion = (r.licence.match(/CC[\s-]*BY[\s-]*\d(?:\.\d)?|MIT|Apache[^|]*/i) || [r.licence])[0];
  const author = shortToken(r.author);
  const source = shortToken(r.source);
  const missing = [];
  if (author && !attributionBlock.toLowerCase().includes(author.toLowerCase())) missing.push('author ' + author);
  if (source && !attributionBlock.toLowerCase().includes(source.toLowerCase())) missing.push('source ' + source);
  if (!new RegExp(licenceVersion.replace(/[\s.]/g, '.?'), 'i').test(attributionBlock))
    missing.push('licence ' + licenceVersion);
  if (missing.length) uncovered.push(r.author + ' / ' + source + ' / ' + r.licence +
    ' — not credited: ' + missing.join(', '));
}
A(uncovered.length === 0,
  'the in-app Art credits row names every author, source and licence version we owe ' +
  'attribution to (' + obligations.size + ' obligation' + (obligations.size === 1 ? '' : 's') + ')' +
  (uncovered.length ? '\n       ' + uncovered.join('\n       ') : '') +
  '\n       [licences in use: ' + (licences.join(' / ') || 'none resolved') + ']');

if (bad > 0) {
  console.error('\nPROVENANCE FAILED: ' + bad + ' violation(s). "No row, no ship."');
  process.exit(1);
}
console.log('\nPROVENANCE CHECKS PASSED');
