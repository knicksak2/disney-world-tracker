/* Catalogue invariants for pin-catalog-mockup.html.
 *
 * Deliberately asserts NO pin counts. A typed count is a derived value (working
 * rule 5) and would fail the moment a pin is added, which trains everyone to edit
 * the number until the gate goes quiet. Every assertion here is a *relationship*
 * that holds at 167 pins or 400:
 *
 *   - a pin's id prefix agrees with its tier field
 *   - a pin physically sits under the section header naming its tier
 *   - a sub-group comment never names a tier other than its section's
 *   - no section header carries a hardcoded count
 *   - the markup carries no hardcoded count either
 *   - ids and names are unique
 *   - every motif/scene key resolves to real, non-empty path data
 *   - the Centurion ladder's thresholds rise with tier rank
 *
 * The catalogue is loaded by executing the page's own definitions, so scenes that
 * are assigned dynamically (SCENES['b4fire'+n], SCENES.fourParksMaster) are
 * measured as the browser sees them rather than text-matched.
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const html = fs.readFileSync(file, 'utf8');
const dir = path.dirname(file);

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* ---------- 1. execute the page's definitions ---------- */
const scriptBody = (html.match(/<script>\n([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script>/, '').replace(/<\/script>$/, ''))
  .sort((a, b) => b.length - a.length)[0];
if (!scriptBody) { console.error('FAIL: no inline <script> found'); process.exit(1); }

/* Everything we need (MOTIFS, SCENES, B4_STAGES, PINS and the dynamic SCENES
   assignments) is defined before the DOM wiring starts, so cut there. */
const cut = scriptBody.indexOf("const pinGrid = document.getElementById('pinGrid')");
A(cut > 0, 'found the DOM-wiring boundary to cut the definitions at');
if (cut < 0) process.exit(1);
const defs = scriptBody.slice(0, cut);

const motifJs = fs.readFileSync(path.join(dir, 'motifs', 'motif-paths.js'), 'utf8');
const win = {};
let PINS, MOTIFS, SCENES, splitCells, pathBBox;
try {
  const fn = new Function('window', motifJs + '\n' + defs +
    '\n;return {PINS: PINS, MOTIFS: MOTIFS, SCENES: SCENES,' +
    ' splitCells: splitCells, pathBBox: pathBBox};');
  const got = fn(win);
  PINS = got.PINS; MOTIFS = got.MOTIFS; SCENES = got.SCENES;
  /* reuse the page's own geometry helpers so these checks measure what the renderer does */
  splitCells = got.splitCells; pathBBox = got.pathBBox;
} catch (e) {
  console.error('FAIL: catalogue definitions threw -> ' + e.message);
  process.exit(1);
}
A(Array.isArray(PINS) && PINS.length > 0, 'PINS evaluated from the page (' + PINS.length + ' pins)');
A(MOTIFS && Object.keys(MOTIFS).length > 0, 'MOTIFS resolved (' + Object.keys(MOTIFS).length + ' keys)');
A(SCENES && Object.keys(SCENES).length > 0, 'SCENES resolved (' + Object.keys(SCENES).length + ' keys, dynamic ones included)');

const TIERS = ['bronze', 'silver', 'gold', 'amethyst', 'pearl', 'prism'];
const RANK = {}; TIERS.forEach((t, i) => RANK[t] = i);
const CATS = ['ladder', 'land', 'park', 'touring', 'sets', 'dining', 'social'];

/* ---------- 2. required fields ---------- */
{
  const missing = PINS.filter(p => !p.id || !p.name || !p.tier || !p.cat || !p.criteria);
  A(missing.length === 0,
    'every pin has id, name, tier, cat and criteria' +
    (missing.length ? ' -> ' + missing.map(p => p.id || '(no id)').join(', ') : ''));
  const badTier = PINS.filter(p => !TIERS.includes(p.tier));
  A(badTier.length === 0, 'every tier is one of the 6 known tiers' +
    (badTier.length ? ' -> ' + badTier.map(p => p.id + ':' + p.tier).join(', ') : ''));
  const badCat = PINS.filter(p => !CATS.includes(p.cat));
  A(badCat.length === 0, 'every cat matches a category filter tab' +
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

/* ---------- 5. every pin sits under the header naming its tier ---------- */
const pinsSrc = html.match(/const PINS = \[([\s\S]*?)\n\];/);
A(!!pinsSrc, 'located the PINS source block');
{
  const lines = pinsSrc[1].split('\n');
  let section = null;
  const strays = [];
  const mislabelled = [];
  const seenSections = [];
  lines.forEach(line => {
    /* tolerate a (count) here even though it is a violation: if this regex misses the
       header, section tracking silently slides onto the previous tier and every later
       assertion reports the wrong thing. The count is reported by its own check below. */
    const h = line.match(/\/\/\s*===\s*([A-Z]+)\s*(?:\(\d+\)\s*)?===/);
    if (h) { section = h[1].toLowerCase(); seenSections.push(section); return; }
    /* a sub-group comment that names a tier must name its own section's tier */
    const sub = line.match(/\/\/\s*[^=\n]*\((\w+)[\s)-]/);
    if (sub && section) {
      const named = sub[1].toLowerCase();
      if (TIERS.includes(named) && named !== section) mislabelled.push(line.trim());
      return;
    }
    const p = line.match(/\{\s*id:\s*'([^']+)'[\s\S]*?tier:\s*'(\w+)'/);
    if (p && section && p[2] !== section) strays.push(p[1] + " (tier '" + p[2] + "') under " + section.toUpperCase());
  });
  A(strays.length === 0, 'every pin sits under the section header matching its tier' +
    (strays.length ? ' -> ' + strays.join('; ') : ''));
  A(mislabelled.length === 0, 'no sub-group comment names a tier other than its section' +
    (mislabelled.length ? ' -> ' + mislabelled.join(' | ') : ''));
  A(TIERS.every(t => seenSections.includes(t)),
    'all 6 tier sections are present (' + seenSections.join(', ') + ')');
  const empty = seenSections.filter(s => !PINS.some(p => p.tier === s));
  A(empty.length === 0, 'no tier section is empty' + (empty.length ? ' -> ' + empty.join(', ') : ''));
}

/* ---------- 6. no hardcoded counts anywhere ---------- */
{
  const counted = [...pinsSrc[1].matchAll(/\/\/\s*===\s*[A-Z]+\s*\((\d+)\)\s*===/g)].map(m => m[0].trim());
  A(counted.length === 0,
    'no section header carries a hardcoded pin count (they go stale on every add)' +
    (counted.length ? ' -> ' + counted.join(', ') : ''));

  const markup = [
    ...[...html.matchAll(/<strong id="count-([a-z]+)">([^<]*)<\/strong>/g)],
    ...[...html.matchAll(/<span id="cat-count-([a-z]+)">([^<]*)<\/span>/g)],
    ...[...html.matchAll(/<span id="(headline-count|subtitle-count)">([^<]*)<\/span>/g)],
  ].filter(m => /\d/.test(m[2]));

  /* the headline and subtitle used to hard-code "163"; they are filled at runtime now */
  ['headline-count', 'subtitle-count'].forEach(id => {
    A(html.includes('id="' + id + '"'), id + ' placeholder exists in the markup');
    A(scriptBody.includes("'" + id + "'"), id + ' is populated from PINS.length at runtime');
  });

  const proseCount = [...html.matchAll(/(\d{2,3})[- ](?:Pin|collectible)/gi)].map(m => m[0]);
  A(proseCount.length === 0, 'no headline or body copy hard-codes a pin count' +
    (proseCount.length ? ' -> ' + proseCount.join(', ') : ''));

  const titleCount = /<title>[^<]*\d{2,3}[^<]*<\/title>/.test(html);
  A(!titleCount, 'the document title carries no pin count');
  A(markup.length === 0,
    'no count element in the markup holds a literal number (updateTabCounts fills them)' +
    (markup.length ? ' -> ' + markup.map(m => m[1] + '=' + m[2]).join(', ') : ''));
}

/* ---------- 7. the page is correct ON LOAD (behavioural, not textual) ---------- */
/* updateTabCounts once sat INSIDE the tier-pill click handler, so it never ran on load
   and every count in the header showed the stale markup literal until you clicked a pill.
   Text-matching that is a trap: a regex for `function updateTabCounts` matches whether it
   is nested or not, and a regex for the call site is satisfied by the copy inside the
   handler. So run the real script against a stub DOM, simulate NO clicks, and read the
   counts back out. This is the assertion that would have caught the original bug. */
{
  const writes = {};       // id -> last textContent written
  const appended = {};     // id -> appendChild count
  const mkEl = (id) => ({
    _id: id,
    set textContent(v) { if (id) writes[id] = String(v); },
    get textContent() { return id ? writes[id] : ''; },
    set innerHTML(v) { if (id && v === '') appended[id] = 0; },
    get innerHTML() { return ''; },
    className: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    appendChild() { if (id) appended[id] = (appended[id] || 0) + 1; },
    addEventListener() {}, focus() {}, scrollTo() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
  });
  const els = {};
  const documentStub = {
    getElementById(id) { return els[id] || (els[id] = mkEl(id)); },
    createElement() { return mkEl(null); },
    querySelectorAll() { return []; },   // no handlers attach, so nothing can fire
    querySelector() { return null; },
    addEventListener() {},
    body: mkEl(null),
  };

  let threw = null;
  try {
    new Function('window', 'document',
      motifJs + '\n' + scriptBody)(win, documentStub);
  } catch (e) { threw = e; }
  A(!threw, 'the page script runs to completion on load' +
    (threw ? ' -> ' + threw.message : ''));

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
    A(catWrong.length === 0, 'every category tab shows its real count on load' +
      (catWrong.length ? ' -> ' + catWrong.map(c =>
        c + ' showed ' + writes['cat-count-' + c] + ' not ' +
        PINS.filter(p => p.cat === c).length).join(', ') : ''));

    A(writes['cat-count-all'] === String(PINS.length),
      'the All Categories tab shows the real total on load');
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
    'every contained pin declares a shape (filterAndRender calls pin.shape.toUpperCase())' +
    (noShape.length ? ' -> ' + noShape.map(p => p.id).join(', ') : ''));
}

/* ---------- 8. every motif / scene key resolves to real path data ---------- */
{
  const unresolved = [];
  PINS.forEach(p => {
    if (p.scene) {
      const s = SCENES[p.scene];
      if (!s) unresolved.push(p.id + ": scene '" + p.scene + "' undefined");
      else if (!s.d || !String(s.d).trim()) unresolved.push(p.id + ": scene '" + p.scene + "' has empty d");
    } else if (p.motif) {
      const d = MOTIFS[p.motif];
      if (d == null) unresolved.push(p.id + ": motif '" + p.motif + "' undefined");
      else if (!String(d).trim()) unresolved.push(p.id + ": motif '" + p.motif + "' is empty");
    } else if (!p.text) {
      unresolved.push(p.id + ': no scene, motif or text');
    }
  });
  A(unresolved.length === 0, 'every motif/scene key resolves to non-empty path data' +
    (unresolved.length ? ' -> ' + unresolved.join('; ') : ''));
}

/* ---------- 9. die-cut pins need multi-colour enamel; contained need a shape ---------- */
{
  const noEnamel = PINS.filter(p => p.mode === 'diecut' && !p.enamel && !p.motifEnamel && !p.scene);
  A(noEnamel.length === 0, 'every die-cut pin carries enamel colours' +
    (noEnamel.length ? ' -> ' + noEnamel.map(p => p.id).join(', ') : ''));
}

/* ---------- 9b. enamel entries that never render ----------
   renderDieCut fills each cell with `enamel[i % enamel.length]`, so a SHORT array is
   fine by design - the colours cycle. The reverse is not: entries past the cell count
   are dead data, and they usually mean the author was colouring a different cell count
   than the art actually has (a noSplit pin has exactly one cell, so only enamel[0] is
   ever used). Asserting the cycling direction would be measuring the wrong thing. */
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
   renderPin scales a contained motif by a FIXED mk of ~0.1875 rather than box-fitting,
   so a path drawn on a 24-unit grid instead of 512 lands about 4px wide. renderDieCut
   box-fits and absorbs it, which is why magicLantern (span 20) survives as a die-cut.
   Assert the case that would not survive, before someone moves such a motif. */
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

/* ---------- 10. the Centurion ladder rises with tier ---------- */
{
  const rungs = PINS
    .filter(p => p.cat === 'ladder' && p.banner)
    .map(p => ({ id: p.id, tier: p.tier, n: Number(p.banner) }))
    .sort((a, b) => a.n - b.n);
  A(rungs.length > 0, 'found the Centurion ladder (' + rungs.length + ' rungs)');
  A(rungs.every(r => Number.isFinite(r.n)), 'every ladder banner is numeric');

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

  /* the id must agree with the banner it shows, so a renumber cannot slip */
  const mismatched = rungs.filter(r => {
    const m = r.id.match(/_(\d+)$/);
    return m && Number(m[1]) !== r.n;
  });
  A(mismatched.length === 0, 'each ladder id number matches its banner' +
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
