/* Shared loader for the v2 pin catalogue (pin-catalog-mockup.html).
 *
 * WHY THIS EXISTS. The catalogue used to carry its pins as a literal `const PINS = [...]`
 * inline in the HTML, and every verifier parsed that block with its own regex. The v2
 * catalogue instead builds its roster the way the page renders it:
 *
 *     <script src="motifs/motif-paths.js">      -> window.MOTIF_LIB
 *     <script src="pins-v2-transcription.js">   -> window.PINS_V2   (the 174-pin roster)
 *     <script src="pin-descriptions.js">        -> window.PIN_DESCRIPTIONS
 *     ...inline: PALETTES, B4_STAGES, MOTIFS = Object.assign({}, MOTIF_LIB, {...}),
 *        SCENES, mapV2Pins(), const PINS = mapV2Pins(window.PINS_V2)
 *
 * A regex over source text cannot see that transform. So this loader EXECUTES the page's
 * own scripts — the externals then the inline definitions — in a sandbox whose `window`
 * IS the global object, exactly as a browser does. That makes `window.X = ...` assignments
 * become globals readable as bare identifiers (the way `mapV2Pins` reads `PIN_DESCRIPTIONS`),
 * so the pins, motifs and scenes come out identical to what the catalogue actually shows.
 *
 * One parse, shared by catalog.js / dedup.js / provenance.js / diecut.js, so they cannot
 * drift from each other or from the page.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* A stub DOM element that records textContent writes and appendChild calls, so the
   on-load count check can read back what the page wrote with no click simulated. */
function makeEl(id, writes, appended) {
  return {
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
  };
}

function makeDoc(writes, appended, els) {
  return {
    getElementById(id) { return els[id] || (els[id] = makeEl(id, writes, appended)); },
    createElement() { return makeEl(null, writes, appended); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    body: makeEl(null, writes, appended),
  };
}

/* Pull the ordered list of <script src="..."> files from the head, and the single
   largest inline <script> block (the FRAME SYSTEM + renderer + PINS assignment). */
function extractScripts(html) {
  const externals = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const inlineBlocks = (html.match(/<script>\n([\s\S]*?)<\/script>/g) || [])
    .map(s => s.replace(/^<script>\n?/, '').replace(/<\/script>\s*$/, ''));
  const inline = inlineBlocks.sort((a, b) => b.length - a.length)[0] || '';
  return { externals, inline };
}

const CUT = "const pinGrid = document.getElementById('pinGrid')";

/* Build a browser-like sandbox: window === the global object, plus a stub document. */
function makeSandbox(doc) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.document = doc;
  sandbox.console = console;
  /* transcription guards its CommonJS export with `typeof module !== 'undefined'`;
     leaving module undefined makes it take the browser branch (window.PINS_V2 = ...) */
  sandbox.module = undefined;
  vm.createContext(sandbox);
  return sandbox;
}

function runExternals(sandbox, externals, dir) {
  for (const src of externals) {
    const abs = path.join(dir, src);
    if (!fs.existsSync(abs)) continue;             // e.g. a font/CDN src, skip
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: src });
  }
}

/* The main entry: returns the fully resolved catalogue objects, plus the raw pieces the
   suites need for their own text-level and on-load checks. */
function loadCatalog(file) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const { externals, inline } = extractScripts(html);
  if (!inline) throw new Error('no inline <script> block found in ' + file);

  const cutIdx = inline.indexOf(CUT);
  const defs = cutIdx > 0 ? inline.slice(0, cutIdx) : inline;

  const writes = {}, appended = {}, els = {};
  const sandbox = makeSandbox(makeDoc(writes, appended, els));
  runExternals(sandbox, externals, dir);

  const capture =
    '\n;this.__OUT = {' +
    '  PINS: (typeof PINS!=="undefined")?PINS:null,' +
    '  MOTIFS: (typeof MOTIFS!=="undefined")?MOTIFS:null,' +
    '  SCENES: (typeof SCENES!=="undefined")?SCENES:null,' +
    '  PALETTES: (typeof PALETTES!=="undefined")?PALETTES:null,' +
    '  B4_STAGES: (typeof B4_STAGES!=="undefined")?B4_STAGES:null,' +
    '  splitCells: (typeof splitCells!=="undefined")?splitCells:null,' +
    '  pathBBox: (typeof pathBBox!=="undefined")?pathBBox:null,' +
    '  mapV2Pins: (typeof mapV2Pins!=="undefined")?mapV2Pins:null,' +
    '  renderPin: (typeof renderPin!=="undefined")?renderPin:null' +
    '};';
  vm.runInContext(defs + capture, sandbox, { filename: 'inline-defs' });
  const out = sandbox.__OUT || {};

  const MOTIF_LIB = sandbox.MOTIF_LIB || {};

  /* the inline MOTIFS override literal, evaluated in-sandbox so nested paths/comments
     cannot trip a hand-rolled brace matcher */
  let INLINE = {};
  const im = html.match(
    /const MOTIFS = Object\.assign\(\{\}, window\.MOTIF_LIB \|\| \{\}, (\{[\s\S]*?\n\})\);/);
  if (im) {
    try {
      const s2 = makeSandbox(makeDoc({}, {}, {}));
      runExternals(s2, externals, dir);
      vm.runInContext('this.__I = ' + im[1], s2, { filename: 'inline-motifs' });
      INLINE = s2.__I || {};
    } catch (e) { /* leave INLINE empty; provenance will still check via MOTIFS/LIB */ }
  }

  return {
    file, html, dir, externals, inline, defs,
    PINS: out.PINS, MOTIFS: out.MOTIFS, SCENES: out.SCENES,
    PALETTES: out.PALETTES, B4_STAGES: out.B4_STAGES,
    splitCells: out.splitCells, pathBBox: out.pathBBox,
    renderPin: out.renderPin,
    MOTIF_LIB, INLINE,
  };
}

/* Run the FULL inline script (including the DOM wiring) against a fresh stub DOM, with no
   click simulated, and return what the page wrote. This is how the on-load count check
   reads count-all / count-{tier} / cat-count-{track} / headline-count / pinGrid. */
function runOnLoad(file) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const { externals, inline } = extractScripts(html);
  const writes = {}, appended = {}, els = {};
  const sandbox = makeSandbox(makeDoc(writes, appended, els));
  let threw = null;
  try {
    runExternals(sandbox, externals, dir);
    vm.runInContext(inline, sandbox, { filename: 'inline-full' });
  } catch (e) { threw = e; }
  return { writes, appended, els, threw };
}

module.exports = { loadCatalog, runOnLoad, extractScripts, CUT };
