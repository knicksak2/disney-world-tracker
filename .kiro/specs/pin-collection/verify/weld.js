#!/usr/bin/env node
/* Did welding actually rescue the multi-part icons?
 *
 *   node .kiro/specs/pin-collection/verify/weld.js
 *
 * Every icon in WELD_TRY was rejected by the one-piece rule. Welding encloses the parts in a
 * single closed outline so the gaps become enamel. This reports, per icon: whether it welded,
 * at what bridge radius, and whether the welded version now passes the full gate at the rim
 * its park actually uses — measured at N=260, the resolution where componentCount stops
 * under-counting.
 */
const fs = require('fs');
const path = require('path');

const spec = path.resolve(__dirname, '..');
const html = path.join(spec, 'pin-frame-sample.html');
const lib = fs.readFileSync(path.join(spec, 'motifs', 'motif-paths.js'), 'utf8');
const inner = fs.readFileSync(html, 'utf8')
  .match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>[\s]*$/, '');
const doc = { getElementById: () => ({ set innerHTML(v){}, get innerHTML(){return '';},
                                       set textContent(v){}, get textContent(){return '';} }) };
new Function('window','document', lib + '\n' + inner
  + ';globalThis.__t={MOTIFS,WELDED,WELD_TRY,emblemGate,componentCount,splitCells,'
  + 'classifyCells,silhouetteMetrics,discLikeness,pathBBox};')({}, doc);
const T = globalThis.__t;

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

console.log('\n  icon              rim  before          after weld                bridge  now usable?');
const rescued = [];
for (const [key, rim] of T.WELD_TRY) {
  const orig = T.MOTIFS[key];
  if (!orig) { console.log('  ' + key.padEnd(17) + ' MISSING'); continue; }
  /* the truth about the original, at the resolution that does not under-count */
  const p0 = T.componentCount(orig, rim, 'union', 260);
  const w = T.WELDED[key];
  if (!w) {
    console.log('  ' + key.padEnd(17) + String(rim).padStart(4)
      + ('  ' + p0 + ' pieces').padEnd(16) + 'did not weld'.padEnd(26) + '     -    no');
    continue;
  }
  const d = T.MOTIFS[w.name];
  const p1 = T.componentCount(d, rim, 'union', 260);
  const g = T.emblemGate(d, 'union', rim);
  /* the gate uses the default resolution; re-check pieces honestly at 260 */
  const usable = p1 === 1 && g.es >= 0.30 && g.disc <= 0.9
                 && g.aspect > 0.55 && g.aspect < 1.8;
  if (usable) rescued.push(key);
  console.log('  ' + key.padEnd(17) + String(rim).padStart(4)
    + ('  ' + p0 + ' pieces').padEnd(16)
    + (p1 + ' piece' + (p1 === 1 ? '' : 's') + ', ' + (g.es*100).toFixed(0)
       + '% enamel, disc ' + g.disc.toFixed(2)).padEnd(26)
    + String(w.bridge).padStart(6) + '    ' + (usable ? 'YES' : 'no'));
}

console.log('\n' + rescued.length + ' of ' + T.WELD_TRY.length
  + ' rescued by welding: ' + (rescued.join(', ') || 'none'));

/* The strict properties are asserted for the welds that are actually USABLE, since those are
   the only ones that could ship. willowTree is the current exception and it is worth naming
   rather than hiding: it welds and it is one piece, but the outline is simplified with a
   Douglas-Peucker pass that clips its thinnest fronds, so a frond's centroid lands outside
   the outline and stops being classified as interior detail. It is starved at 27% regardless,
   so it is not a candidate — but if a future weld needs those thin tips, the fix is a smaller
   simplification epsilon in closedOutline, not a looser assertion here. */
const notPursued = Object.keys(T.WELDED).filter(k => rescued.indexOf(k) === -1);
if (notPursued.length)
  console.log('\nwelded but not usable, so not held to the strict properties: '
    + notPursued.join(', '));

for (const key of rescued) {
  const w = T.WELDED[key], d = T.MOTIFS[w.name];
  A(T.componentCount(d, w.rim, 'union', 260) === 1,
    key + ': welded version is genuinely one piece at N=260');
  const cells = T.splitCells(d), interior = T.classifyCells(d);
  A(cells.length === T.splitCells(T.MOTIFS[key]).length + 1,
    key + ': welded path is the closed outline plus every original part ('
    + cells.length + ' cells)');
  A(interior.filter(Boolean).length === cells.length - 1,
    key + ': the original parts are all INTERIOR, so only the outline takes the thick rim');
  /* the outline must enclose the original, not replace it: bbox must not shrink */
  const b0 = T.pathBBox(T.MOTIFS[key]), b1 = T.pathBBox(d);
  A(b1.minX <= b0.minX + 1 && b1.minY <= b0.minY + 1
    && b1.maxX >= b0.maxX - 1 && b1.maxY >= b0.maxY - 1,
    key + ': the weld encloses the original rather than clipping it');
}

console.log(bad === 0 ? '\nWELD CHECKS PASSED' : '\n' + bad + ' WELD FAILURE(S)');
process.exit(bad === 0 ? 0 : 1);
