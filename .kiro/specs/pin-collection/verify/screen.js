#!/usr/bin/env node
/* Screen candidate motifs through emblemGate before designing around them.
 *
 *   node .kiro/specs/pin-collection/verify/screen.js <rimPx> <key> [key...]
 *   node .kiro/specs/pin-collection/verify/screen.js 5.2 baobab treeRoots holyOak
 *
 * With no keys it screens every entry in motif-paths.js at the given rim.
 *
 * Exists because I picked three unusable icons by eye before the gate was written, and
 * because rim width changes the answer: a narrow rim leaves more enamel but welds less, so
 * multi-part icons come apart. Always screen at the rim of the tier the pin will actually
 * use, not at a convenient one.
 */
const fs = require('fs');
const path = require('path');

const here = __dirname;
const spec = path.resolve(here, '..');
const html = path.join(spec, 'pin-frame-sample.html');
const lib = fs.readFileSync(path.join(spec, 'motifs', 'motif-paths.js'), 'utf8');

const inner = fs.readFileSync(html, 'utf8')
  .match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>[\s]*$/, '');

const win = {};
const doc = { getElementById: () => ({ set innerHTML(v){}, get innerHTML(){return '';},
                                       set textContent(v){}, get textContent(){return '';} }) };
new Function('window', 'document',
  lib + '\n' + inner + ';globalThis.__t={MOTIFS,emblemGate,pathBBox,splitCells,classifyCells};')
  (win, doc);
const T = globalThis.__t;

const rim = parseFloat(process.argv[2] || '6.2');
let keys = process.argv.slice(3);
if (!keys.length) keys = Object.keys(win.MOTIF_LIB || {}).sort();

console.log('screening ' + keys.length + ' motif(s) at a ' + rim + 'px rim\n');
console.log('  key                  pieces  cells  aspect  enamel  discLike  verdict');

const passed = [];
for (const k of keys) {
  const d = T.MOTIFS[k];
  if (!d) { console.log('  ' + k.padEnd(20) + '  MISSING from motif-paths.js'); continue; }
  const g = T.emblemGate(d, 'union', rim);
  const cells = T.splitCells(d).length;
  if (g.ok) passed.push(k);
  console.log('  ' + k.padEnd(20)
    + String(g.pieces).padStart(7)
    + String(cells).padStart(7)
    + g.aspect.toFixed(2).padStart(8)
    + ((g.es * 100).toFixed(0) + '%').padStart(8)
    + g.disc.toFixed(2).padStart(10)
    + '  ' + (g.ok ? 'PASSES' : 'reject: ' + g.fails.join(', ')));
}

console.log('\n' + passed.length + ' of ' + keys.length + ' pass at ' + rim + 'px'
  + (passed.length ? ': ' + passed.join(', ') : ''));
console.log('\nPassing the gate means USABLE, not attractive — it cannot judge how a shape');
console.log('looks, so anything above still needs eyes on it.');
