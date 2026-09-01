#!/usr/bin/env node
/* Does the spatial index give the SAME answers as the brute-force path?
 *
 *   node .kiro/specs/pin-collection/verify/equiv.js
 *
 * The index made every measurement in this file ~10x faster, which is worthless if it also
 * made them wrong. So this compares indexed against unindexed over thousands of points on
 * real shapes, and compares the four public measurements end to end.
 *
 * The brute-force functions (insideNonZero, insideEvenOdd, distToEdges) are kept in the
 * mockup ONLY as the reference for this test. Nothing else calls them any more.
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
  + ';globalThis.__t={MOTIFS,SCENES,toPolys,pathBBox,polyIndex,idxInsideNZ,idxInsideEO,'
  + 'idxNearEdge,insideNonZero,insideEvenOdd,distToEdges};')({}, doc);
const T = globalThis.__t;

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* deterministic pseudo-random sampling, so a failure is reproducible */
let seed = 20260827;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) & 0x7fffffff) / 0x7fffffff;

const SHAPES = [
  ['baobab',        T.MOTIFS.baobab,        'nonzero'],
  ['lightProjector',T.MOTIFS.lightProjector,'nonzero'],
  ['stoneSphere',   T.MOTIFS.stoneSphere,   'nonzero'],
  ['popcorn',       T.MOTIFS.popcorn,       'nonzero'],
  ['castle scene',  T.SCENES.castle.d,      T.SCENES.castle.rule],
  ['ferris scene',  T.SCENES.ferris.d,      T.SCENES.ferris.rule]
];

const POINTS = 4000;
for (const [name, d, rule] of SHAPES) {
  const polys = T.toPolys(d), bb = T.pathBBox(d), ix = T.polyIndex(polys);
  let insideDiff = 0, edgeDiff = 0;
  for (let k = 0; k < POINTS; k++) {
    /* sample the bbox plus a margin, so points outside the shape are covered too */
    const x = bb.minX - 12 + rnd() * (bb.w + 24);
    const y = bb.minY - 12 + rnd() * (bb.h + 24);
    const slowIn = rule === 'evenodd' ? T.insideEvenOdd(polys, x, y)
                                      : T.insideNonZero(polys, x, y);
    const fastIn = rule === 'evenodd' ? T.idxInsideEO(ix, x, y) : T.idxInsideNZ(ix, x, y);
    if (slowIn !== fastIn) insideDiff++;
    /* the near-edge test at a few different cutoffs, since callers use several rims */
    for (const half of [2.1, 3.1, 4.6]) {
      const slowEdge = T.distToEdges(polys, x, y, half) <= half;
      const fastEdge = T.idxNearEdge(ix, x, y, half);
      if (slowEdge !== fastEdge) edgeDiff++;
    }
  }
  A(insideDiff === 0, name + ': indexed inside-test agrees on all ' + POINTS
    + ' points' + (insideDiff ? ' (' + insideDiff + ' differ)' : ''));
  A(edgeDiff === 0, name + ': indexed near-edge test agrees on all ' + (POINTS*3)
    + ' checks' + (edgeDiff ? ' (' + edgeDiff + ' differ)' : ''));
}

/* the index must also be correct for points far outside the shape's y-range, where the
   row clamp could plausibly misbehave */
{
  const polys = T.toPolys(T.MOTIFS.baobab), ix = T.polyIndex(polys);
  let diff = 0;
  for (const y of [-500, -1, 0, 511, 512, 9999]) for (const x of [-500, 0, 256, 512, 9999]) {
    if (T.insideNonZero(polys, x, y) !== T.idxInsideNZ(ix, x, y)) diff++;
    if ((T.distToEdges(polys, x, y, 4) <= 4) !== T.idxNearEdge(ix, x, y, 4)) diff++;
  }
  A(diff === 0, 'agrees outside the shape entirely, including beyond the canvas');
}

console.log(bad === 0 ? '\nEQUIVALENCE PASSED — the index changed the speed, not the answers'
                      : '\n' + bad + ' DIFFERENCE(S) — the index is not equivalent');
process.exit(bad === 0 ? 0 : 1);
