/* Catalogue invariants for pin-catalog-mockup.html (v2 roster, single source of truth).
 *
 * Deliberately asserts NO pin counts. A typed count is a derived value (working
 * rule 5) and would fail the moment a pin is added, which trains everyone to edit
 * the number until the gate goes quiet. Every assertion here is a *relationship*
 * that holds at 174 pins or 400:
 *
 *   - a pin's id prefix agrees with its tier field
 *   - a pin physically sits under the transcription section naming its TRACK
 *   - no rendered count element carries a hardcoded number
 *   - ids and names are unique
 *   - every motif/scene key resolves to real, non-empty path data
 *   - the Centurion (attractions) ladder's thresholds rise with tier rank
 *   - the page shows the real counts ON LOAD, with no click simulated
 *
 * The v2 catalogue does not carry a literal `const PINS = [...]`; it builds its roster
 * from pins-v2-transcription.js (window.PINS_V2) through mapV2Pins(), resolving
 * descriptions and enamel the way the page renders them. So this suite EXECUTES the
 * page's own scripts through verify/catalog-loader.js rather than regexing source text,
 * and its structural (source-order) checks read the transcription file directly.
 */
const fs = require('fs');
const path = require('path');
const { loadCatalog, runOnLoad } = require('./catalog-loader');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const dir = path.dirname(file);
const html = fs.readFileSync(file, 'utf8');

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* ---------- 1. execute the page's definitions the way it renders them ---------- */
let cat;
try {
  cat = loadCatalog(file);
} catch (e) {
  console.error('FAIL: catalogue definitions threw -> ' + e.message);
  process.exit(1);
}
const { PINS, MOTIFS, SCENES, splitCells, pathBBox, renderPin } = cat;
A(Array.isArray(PINS) && PINS.length > 0, 'PINS evaluated from the page (' + (PINS ? PINS.length : 0) + ' pins)');
A(MOTIFS && Object.keys(MOTIFS).length > 0, 'MOTIFS resolved (' + (MOTIFS ? Object.keys(MOTIFS).length : 0) + ' keys)');
A(SCENES && Object.keys(SCENES).length > 0, 'SCENES resolved (' + (SCENES ? Object.keys(SCENES).length : 0) + ' keys, dynamic ones included)');
if (!Array.isArray(PINS) || !PINS.length) { console.error('\nCATALOGUE INVARIANTS FAILED: no pins'); process.exit(1); }

const TIERS = ['bronze', 'silver', 'gold', 'amethyst', 'pearl', 'prism', 'mythic'];
const RANK = {}; TIERS.forEach((t, i) => RANK[t] = i);
/* cat === track in the v2 roster (mapV2Pins sets o.cat = t.track) */
const CATS = ['attractions', 'dining', 'places', 'social', 'resorts', 'characters', 'touring', 'thematic'];

/* ---------- 2. required fields ---------- */
{
  const missing = PINS.filter(p => !p.id || !p.name || !p.tier || !p.cat || !p.criteria);
  A(missing.length === 0,
    'every pin has id, name, tier, cat and criteria' +
    (missing.length ? ' -> ' + missing.map(p => p.id || '(no id)').join(', ') : ''));
  const badTier = PINS.filter(p => !TIERS.includes(p.tier));
  A(badTier.length === 0, 'every tier is one of the 7 known tiers' +
    (badTier.length ? ' -> ' + badTier.map(p => p.id + ':' + p.tier).join(', ') : ''));
  const badCat = PINS.filter(p => !CATS.includes(p.cat));
  A(badCat.length === 0, 'every cat (track) matches a category filter tab' +
    (badCat.length ? ' -> ' + badCat.map(p => p.id + ':' + p.cat).join(', ') : ''));
}

/* ---------- 3. id prefix agrees with tier ---------- */
{
  const wrong = PINS.filter(p => {
    const pfx = TIERS.find(t => p.id.startsWith(t + '_'));
    return !pfx || pfx !== p.tier;
  });
  A(wrong.length === 0, 'every id is prefixed with its own tier' +
    (wrong.length ? ' -> ' + wrong.map(p => p.id + " has tier '" + p.tier + "'").join(', ') : ''));
}

/* ---------- 4. uniqueness ---------- */
{
  const ids = {}, names = {}, dupId = [], dupName = [];
  PINS.forEach(p => {
    if (ids[p.id]) dupId.push(p.id); ids[p.id] = 1;
    if (names[p.name]) dupName.push(p.name); names[p.name] = 1;
  });
  A(dupId.length === 0, 'pin ids are unique' + (dupId.length ? ' -> ' + dupId.join(', ') : ''));
  A(dupName.length === 0, 'pin names are unique' + (dupName.length ? ' -> ' + dupName.join(', ') : ''));
}

/* ---------- 5. every pin sits under the transcription section naming its TRACK ----------
   The v2 roster is grouped by track (`// ===== Places · ... =====`), not by tier: the
   first word of each section header is the track. A pin filed under the wrong section
   becomes the wrong `cat` through mapV2Pins and then shows under the wrong filter tab, so
   assert placement the way v1 asserted tier placement. Read the transcription that the
   page actually loads, resolved relative to the html. */
{
  const tSrc = cat.externals.find(s => /transcription/.test(s)) || 'pins-v2-transcription.js';
  const tPath = path.join(dir, tSrc);
  A(fs.existsSync(tPath), 'located the roster source (' + tSrc + ')');
  if (fs.existsSync(tPath)) {
    const lines = fs.readFileSync(tPath, 'utf8').split('\n');
    let section = null;
    const strays = [], unknownHeaders = [], seenSections = [];
    lines.forEach(line => {
      const h = line.match(/^\s*\/\/\s*=====\s*(\S+)/);
      if (h) {
        const trk = h[1].toLowerCase();
        if (!CATS.includes(trk)) { unknownHeaders.push(line.trim()); section = null; }
        else { section = trk; if (!seenSections.includes(trk)) seenSections.push(trk); }
        return;
      }
      const p = line.match(/\{\s*id:\s*'([^']+)'[\s\S]*?track:\s*'(\w+)'/);
      if (p && section && p[2] !== section)
        strays.push(p[1] + " (track '" + p[2] + "') under " + section.toUpperCase());
    });
    A(unknownHeaders.length === 0,
      'every roster section header names a known track (an unknown one silently slides ' +
      'the section tracker onto the wrong track)' +
      (unknownHeaders.length ? ' -> ' + unknownHeaders.join(' | ') : ''));
    A(strays.length === 0, 'every pin sits under the section header matching its track' +
      (strays.length ? ' -> ' + strays.join('; ') : ''));
    A(CATS.every(t => seenSections.includes(t)),
      'all 8 track sections are present (' + seenSections.join(', ') + ')');
    const empty = seenSections.filter(s => !PINS.some(p => p.cat === s));
    A(empty.length === 0, 'no track section is empty' + (empty.length ? ' -> ' + empty.join(', ') : ''));
  }
}

/* ---------- 6. no hardcoded counts in the RENDERED markup ----------
   The rendered header/pills/title must not carry a literal count: they go stale the moment
   a pin is added, and (worse than a stale comment) they are shown to a user. They are
   em-dash placeholders filled by updateTabCounts on load, asserted behaviourally in §7. */
{
  const markup = [
    ...[...html.matchAll(/<strong id="count-([a-z]+)">([^<]*)<\/strong>/g)],
    ...[...html.matchAll(/<span id="cat-count-([a-z]+)">([^<]*)<\/span>/g)],
    ...[...html.matchAll(/<span id="(headline-count|subtitle-count)">([^<]*)<\/span>/g)],
  ].filter(m => /\d/.test(m[2]));

  ['headline-count', 'subtitle-count'].forEach(id => {
    A(html.includes('id="' + id + '"'), id + ' placeholder exists in the markup');
    A(cat.inline.includes("'" + id + "'"), id + ' is populated from PINS.length at runtime');
  });

  const proseCount = [...html.matchAll(/(\d{2,4})[- ](?:Pin|collectible)/gi)].map(m => m[0]);
  A(proseCount.length === 0, 'no headline or body copy hard-codes a pin count' +
    (proseCount.length ? ' -> ' + proseCount.join(', ') : ''));

  const titleCount = /<title>[^<]*\d{2,4}[^<]*<\/title>/.test(html);
  A(!titleCount, 'the document title carries no pin count');
  A(markup.length === 0,
    'no count element in the markup holds a literal number (updateTabCounts fills them)' +
    (markup.length ? ' -> ' + markup.map(m => m[1] + '=' + m[2]).join(', ') : ''));
}

/* ---------- 7. the page is correct ON LOAD (behavioural, not textual) ----------
   updateTabCounts once sat INSIDE the tier-pill click handler, so it never ran on load and
   every count showed the stale markup literal until a pill was clicked. Text-matching that
   is a trap, so run the real script against a stub DOM, simulate NO clicks, and read the
   counts back. This is the assertion that would have caught the original bug. */
{
  const { writes, appended, threw } = runOnLoad(file);
  A(!threw, 'the page script runs to completion on load' + (threw ? ' -> ' + threw.message : ''));
  if (!threw) {
    A(writes['count-all'] === String(PINS.length),
      'count-all shows the real total on load, with no click (got ' +
      writes['count-all'] + ', expected ' + PINS.length + ')');

    const tierWrong = TIERS.filter(t =>
      writes['count-' + t] !== String(PINS.filter(p => p.tier === t).length));
    A(tierWrong.length === 0, 'every tier pill shows its real count on load' +
      (tierWrong.length ? ' -> ' + tierWrong.map(t =>
        t + ' showed ' + writes['count-' + t] + ' not ' +
        PINS.filter(p => p.tier === t).length).join(', ') : ''));

    const catWrong = CATS.filter(c =>
      writes['cat-count-' + c] !== String(PINS.filter(p => p.cat === c).length));
    A(catWrong.length === 0, 'every track tab shows its real count on load' +
      (catWrong.length ? ' -> ' + catWrong.map(c =>
        c + ' showed ' + writes['cat-count-' + c] + ' not ' +
        PINS.filter(p => p.cat === c).length).join(', ') : ''));

    A(writes['cat-count-all'] === String(PINS.length),
      'the All Tracks tab shows the real total on load');
    A(writes['headline-count'] === String(PINS.length),
      'the headline count is filled from PINS on load (got ' + writes['headline-count'] + ')');
    A(writes['subtitle-count'] === String(PINS.length),
      'the subtitle count is filled from PINS on load (got ' + writes['subtitle-count'] + ')');

    A(appended['pinGrid'] === PINS.length,
      'every pin renders a card into the grid on load (got ' + appended['pinGrid'] +
      ' of ' + PINS.length + ')');
  }
}

/* ---------- 7b. contained pins need a shape: the card label calls shape.toUpperCase() ---------- */
{
  const noShape = PINS.filter(p => p.mode !== 'diecut' && !p.shape);
  A(noShape.length === 0,
    'every contained pin declares a shape (the card label calls pin.shape.toUpperCase())' +
    (noShape.length ? ' -> ' + noShape.map(p => p.id).join(', ') : ''));
}

/* ---------- 8. every pin renders to real, non-empty artwork ----------
   v2 has many procedural scenes (starLadder, globalAmbassador, grandHotelier, the golden
   master ticket, …) that are drawn by dedicated renderPin branches rather than a static
   SCENES[key].d path, so a key-resolution check would wrongly flag them. Instead, render
   every pin through the page's own renderPin and assert it returns a non-empty <svg> with
   no throw — the truest test that the art key resolves to something the catalogue can draw,
   and it also catches a pin whose motif/scene is genuinely missing (renderPin throws or
   emits nothing). A static-path pin with a bad motif key still fails here because renderPin
   emits an empty <path d="">. */
{
  A(typeof renderPin === 'function', 'renderPin is available for the render check');
  /* Which motifs/scenes/ids have a DEDICATED renderPin branch (`if (o.motif === 'X')`,
     `o.scene === 'X'`, `o.id === 'X'`). Those branches self-draw hardcoded art and never
     read MOTIFS[key]/SCENES[key].d, so such a pin resolves even when its key is absent from
     the MOTIFS/SCENES objects — the bespoke weld/scene pins (teacup, magicCarpet,
     monorailScene, starLadder, globalAmbassador, …) all work this way. */
  const dispatch = { motif: new Set(), scene: new Set(), id: new Set() };
  for (const m of cat.inline.matchAll(/o\.(motif|scene|id)\s*===\s*'([^']+)'/g)) dispatch[m[1]].add(m[2]);

  const broken = [];
  if (typeof renderPin === 'function') {
    PINS.forEach(p => {
      let svg = null;
      try { svg = renderPin(Object.assign({}, p)); } catch (e) { broken.push(p.id + ': renderPin threw -> ' + e.message); return; }
      if (typeof svg !== 'string' || svg.indexOf('<svg') === -1) { broken.push(p.id + ': no <svg> emitted'); return; }
      const bespoke = dispatch.id.has(p.id)
        || (p.scene && dispatch.scene.has(p.scene))
        || (p.motif && dispatch.motif.has(p.motif));
      if (bespoke) return;                                   // self-drawn, no key lookup
      if (p.scene) {
        const s = SCENES[p.scene];
        if (!s || !s.d || !String(s.d).trim()) broken.push(p.id + ": scene '" + p.scene + "' resolves to nothing and has no dedicated branch");
      } else if (p.motif) {
        const d = MOTIFS[p.motif];
        if (d == null || !String(d).trim()) broken.push(p.id + ": motif '" + p.motif + "' resolves to nothing and has no dedicated branch");
      } else if (!p.text && !p.emblem) {
        broken.push(p.id + ': no scene, motif, emblem or text');
      }
    });
  }
  A(broken.length === 0, 'every pin renders to non-empty art (dedicated branch, or a resolved motif/scene key)' +
    (broken.length ? '\n       ' + broken.join('\n       ') : ''));
}

/* ---------- 9. die-cut pins need enamel colours ---------- */
{
  const noEnamel = PINS.filter(p => p.mode === 'diecut' && !p.enamel && !p.motifEnamel && !p.scene);
  A(noEnamel.length === 0, 'every die-cut pin carries enamel colours' +
    (noEnamel.length ? ' -> ' + noEnamel.map(p => p.id).join(', ') : ''));
}

/* ---------- 9b. enamel entries that never render ----------
   renderDieCut fills each cell with `enamel[i % enamel.length]`, so a SHORT array cycles by
   design. The reverse is dead data and usually means the author coloured a different cell
   count than the art has. colorDieCut pins pour enamel per original cell too, so the check
   applies to them as well. */
{
  const dead = [];
  PINS.filter(p => p.mode === 'diecut' && Array.isArray(p.enamel) && !p.scene).forEach(p => {
    const d = String(MOTIFS[p.motif] || '');
    if (!d) return;
    let cells;
    try { cells = p.noSplit ? 1 : splitCells(d).length; } catch (e) { return; }
    if (p.enamel.length > cells)
      dead.push(p.id + ' (' + cells + ' cell' + (cells === 1 ? '' : 's') +
        ', ' + p.enamel.length + ' colours' + (p.noSplit ? ', noSplit' : '') + ')');
  });
  A(dead.length === 0,
    'no die-cut pin declares more enamel colours than its art has cells' +
    (dead.length ? '\n       dead entries (' + dead.length + '): ' + dead.join(', ') : ''));
}

/* ---------- 9c. a contained pin cannot use a motif drawn on the wrong grid ----------
   renderPin scales a contained motif by a FIXED mk (~0.1875) rather than box-fitting, so a
   path drawn on a 24-unit grid lands a few px wide. renderDieCut box-fits and absorbs it,
   which is why a tiny motif survives as a die-cut. Assert the case that would not survive. */
{
  const tiny = [];
  PINS.filter(p => p.mode !== 'diecut' && p.motif && !p.scene).forEach(p => {
    const d = String(MOTIFS[p.motif] || '');
    if (!d) return;
    let bb; try { bb = pathBBox(d); } catch (e) { return; }
    const span = Math.max(bb.w, bb.h);
    if (span < 200) tiny.push(p.id + ' uses ' + p.motif + ' (spans ' + Math.round(span) + ' of 512)');
  });
  A(tiny.length === 0,
    'no contained pin uses a motif drawn on a smaller grid than 512 (it would render as a speck)' +
    (tiny.length ? '\n       ' + tiny.join(', ') : ''));
}

/* ---------- 10. the Centurion (attractions) ladder rises with tier ---------- */
{
  const rungs = PINS
    .filter(p => p.cat === 'attractions' && p.banner && Number.isFinite(Number(p.banner)))
    .map(p => ({ id: p.id, tier: p.tier, n: Number(p.banner) }))
    .sort((a, b) => a.n - b.n);
  A(rungs.length > 0, 'found the Centurion ladder (' + rungs.length + ' numeric rungs)');

  const inversions = [];
  for (let i = 0; i < rungs.length; i++) {
    for (let j = i + 1; j < rungs.length; j++) {
      if (RANK[rungs[i].tier] > RANK[rungs[j].tier]) {
        inversions.push(rungs[i].id + ' (' + rungs[i].tier + ', ' + rungs[i].n + ') outranks ' +
          rungs[j].id + ' (' + rungs[j].tier + ', ' + rungs[j].n + ')');
      }
    }
  }
  A(inversions.length === 0, 'ladder tier never decreases as the threshold rises' +
    (inversions.length ? ' -> ' + inversions.join('; ') : ''));

  /* an id ending in _<number> must agree with the banner it shows, so a renumber cannot slip */
  const mismatched = rungs.filter(r => {
    const m = r.id.match(/_(\d+)$/);
    return m && Number(m[1]) !== r.n;
  });
  A(mismatched.length === 0, 'each numbered ladder id matches its banner' +
    (mismatched.length ? ' -> ' + mismatched.map(r => r.id + ' shows ' + r.n).join(', ') : ''));
}

/* ---------- 11. the motif library is loaded once ---------- */
{
  const loads = (html.match(/<script src="motifs\/motif-paths\.js">/g) || []).length;
  A(loads === 1, 'motif-paths.js is included exactly once (found ' + loads + ')');
}

if (bad > 0) {
  console.error('\nCATALOGUE INVARIANTS FAILED: ' + bad + ' violation(s)');
  process.exit(1);
}
console.log('\nCATALOGUE INVARIANT CHECKS PASSED');
