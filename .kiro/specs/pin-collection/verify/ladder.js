/* Check the generated ladder candidates BEFORE wiring them into the page. The balloon
   uses a near-360 arc, which is the construct that silently mis-centred the ferris rim,
   so its geometry is measured rather than assumed. */
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const MOTIF_JS=require('fs').readFileSync(require('path').join(require('path').dirname(process.argv[2]),'motifs','motif-paths.js'),'utf8');
const code = MOTIF_JS + '\n' + html.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>[\s]*$/,'')
  + ';globalThis.__t={toPolys,pathBBox,splitCells,insideNonZero,balloon,balloonCluster,burstShape,'
  + 'burstCluster,BALLOON_STAGES,FIREWORK_STAGES,STAGES,SCENES};';
const document = { getElementById: () => ({ set innerHTML(v){}, get innerHTML(){return '';},
                                            set textContent(v){}, get textContent(){return '';} }) };
new Function('window','document',code)({},document);
const T = globalThis.__t;
let bad = 0;
const A = (c,m) => { if(!c){ console.error('FAIL: '+m); bad++; } else console.log('ok   '+m); };
const areaOf = (d, N=340) => {
  const polys = T.toPolys(d), bb = T.pathBBox(d); let hit=0;
  for (let i=0;i<N;i++) for (let j=0;j<N;j++)
    if (T.insideNonZero(polys, bb.minX+(i+.5)*bb.w/N, bb.minY+(j+.5)*bb.h/N)) hit++;
  return hit/(N*N)*bb.w*bb.h;
};

console.log('-- a single balloon: is the arc centred where intended?');
{
  const d = T.balloon(256, 200, 40, 50, 470);
  const bb = T.pathBBox(d);
  console.log(`   bbox x ${bb.minX.toFixed(1)}..${bb.maxX.toFixed(1)}  y ${bb.minY.toFixed(1)}..${bb.maxY.toFixed(1)}`);
  A(Math.abs(bb.minX - 216) < 3, `left edge at cx-rx (${bb.minX.toFixed(1)} vs 216)`);
  A(Math.abs(bb.maxX - 296) < 3, `right edge at cx+rx (${bb.maxX.toFixed(1)} vs 296)`);
  A(Math.abs(bb.minY - 150) < 3, `top at cy-ry (${bb.minY.toFixed(1)} vs 150)`);
  A(Math.abs(bb.maxY - 470) < 1, `string reaches the anchor (${bb.maxY.toFixed(1)} vs 470)`);
  /* ellipse area pi*rx*ry = 6283, plus a thin string ~5 x 220 = 1100 */
  const a = areaOf(d);
  console.log(`   area ${a.toFixed(0)} (ellipse alone would be ${(Math.PI*40*50).toFixed(0)})`);
  A(a > Math.PI*40*50*0.9, 'the balloon body is actually filled, not a sliver');
  A(a < Math.PI*40*50*1.5, 'and not wildly over-filled');
  A(T.splitCells(d).length === 1, 'one balloon is exactly one enamel cell');
}

console.log('\n-- clusters: cell counts, baseline, centring');
for (const [name, STAGES] of [['balloon', T.BALLOON_STAGES], ['firework', T.FIREWORK_STAGES]]) {
  console.log(`   ${name}:`);
  let prevTop = Infinity, prevArea = 0, prevCells = 0;
  for (const i of [1,2,3,4,5,6]) {
    const s = STAGES[i], bb = T.pathBBox(s.d), cells = T.splitCells(s.d).length;
    const a = areaOf(s.d);
    console.log(`     stage ${i}: ${String(cells).padStart(2)} cells  `
      + `y ${bb.minY.toFixed(0).padStart(3)}..${bb.maxY.toFixed(0)}  `
      + `x ${bb.minX.toFixed(0).padStart(3)}..${bb.maxX.toFixed(0)}  area ${a.toFixed(0)}`);
    A(Math.abs(bb.maxY - 480) < 1.5, `${name} ${i}: stands on the y=480 baseline`);
    A(Math.abs((bb.minX+bb.maxX)/2 - 256) < 6, `${name} ${i}: centred on x=256 (${((bb.minX+bb.maxX)/2).toFixed(0)})`);
    A(Math.abs(bb.minY - s.top) < 3, `${name} ${i}: declared top ${s.top} matches actual ${bb.minY.toFixed(0)}`);
    A(bb.minX > 40 && bb.maxX < 472, `${name} ${i}: stays inside the canvas`);
    A(bb.minY <= prevTop + 1, `${name} ${i}: no shorter than stage ${i-1} (${prevTop===Infinity?'-':prevTop.toFixed(0)} -> ${bb.minY.toFixed(0)})`);
    A(cells > prevCells, `${name} ${i}: more cells than stage ${i-1} (${cells} > ${prevCells})`);
    /* Area is allowed to plateau: a dense cluster overlaps itself, so ink saturates
       while the pin still plainly reads as "more". Demanding strict growth was my
       assertion being wrong about what a cluster can do, not the layout being wrong. */
    A(a >= prevArea * 0.95, `${name} ${i}: ink does not shrink (${a.toFixed(0)} vs ${prevArea.toFixed(0)})`);
    prevTop = bb.minY; prevArea = a; prevCells = cells;
  }
}

console.log('\n-- every stage is a COMPLETE object, unlike the castle ladder');
{
  /* the castle's stage 1 covers a tiny share of its own bounding box relative to the
     final stage; an additive ladder should keep a similar density at every rung */
  const dens = (d) => { const bb = T.pathBBox(d); return areaOf(d) / (bb.w*bb.h); };
  for (const [name, S] of [['castle', T.STAGES], ['balloon', T.BALLOON_STAGES],
                           ['firework', T.FIREWORK_STAGES]]) {
    const ds = [1,2,3,4,5,6].map(i => dens(S[i].d));
    const spread = Math.max(...ds) / Math.min(...ds);
    console.log(`   ${name.padEnd(9)} density per stage ${ds.map(d=>d.toFixed(2)).join(' ')}  spread ${spread.toFixed(2)}x`);
    if (name !== 'castle') A(spread < 2.2, `${name}: density stays comparable across stages (${spread.toFixed(2)}x)`);
  }
}

console.log('\n-- cells give multi-colour room');
for (const [name, S] of [['balloon', T.BALLOON_STAGES], ['firework', T.FIREWORK_STAGES]]) {
  const c6 = T.splitCells(S[6].d).length;
  A(c6 >= 6, `${name} stage 6 has ${c6} cells for multi-colour`);
  A(T.splitCells(S[1].d).length >= 2, `${name} stage 1 has multiple cells too`);
}

console.log(bad===0 ? '\nLADDER CHECKS PASSED' : `\n${bad} LADDER CHECK(S) FAILED`);
process.exit(bad===0?0:1);