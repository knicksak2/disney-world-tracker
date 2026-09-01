/* The interior/outer classifier decides which cells get a thin rim. Validate it on
   shapes where containment is known by construction, THEN report what it says about
   the real icons — rather than asserting what I expect it to say. */
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const MOTIF_JS=require('fs').readFileSync(require('path').join(require('path').dirname(process.argv[2]),'motifs','motif-paths.js'),'utf8');
const code = MOTIF_JS + '\n' + html.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>[\s]*$/,'')
  + ';globalThis.__t={renderPin,classifyCells,splitCells,toPolys,pathBBox,MOTIFS,SCENES,'
  + 'LIB,DISPUTED,RIM_BY_TIER,SHAPES,silhouetteMetrics};';
const document = { getElementById: () => ({ set innerHTML(v){}, get innerHTML(){return '';},
                                            set textContent(v){}, get textContent(){return '';} }) };
new Function('window','document',code)({},document);
const T = globalThis.__t;
let bad = 0;
const A = (c,m) => { if(!c){ console.error('FAIL: '+m); bad++; } else console.log('ok   '+m); };

console.log('-- classifier on constructed containment cases');
{
  const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z M40 40 L60 40 L60 60 L40 60 Z');
  A(c.length===2 && c[0]===false && c[1]===true, 'small square inside a big one -> interior');
}
{
  const c = T.classifyCells('M0 0 L40 0 L40 40 L0 40 Z M60 0 L100 0 L100 40 L60 40 Z');
  A(c.length===2 && c[1]===false, 'two disjoint squares -> second is NOT interior');
}
{
  const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z M20 20 L40 20 L40 40 L20 40 Z '
                          + 'M200 0 L240 0 L240 40 L200 40 Z');
  A(c[1]===true && c[2]===false, 'mixed: one interior, one separate part');
}
{
  const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z');
  A(c.length===1 && c[0]===false, 'single-cell path has no interior');
}
{ // relative moveto must be classified too, not skipped
  const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z m40 40 L60 40 L60 60 L40 60 Z');
  A(c.length===2 && c[1]===true, 'relative-moveto interior cell is detected');
}

console.log('\n-- what it reports about the real icons (reported, not asserted)');
for (const m of Object.keys(T.MOTIFS)) {
  const c = T.classifyCells(T.MOTIFS[m]);
  if (c.length > 1)
    console.log(`     ${m.padEnd(10)} ${String(c.length).padStart(2)} cells, `
      + `${String(c.filter(Boolean).length).padStart(2)} interior  [${c.map(v=>v?'i':'o').join('')}]`);
}
{
  const cc = T.classifyCells(T.MOTIFS.map);
  A(cc.length===3, 'map has 3 cells');
  A(cc.filter(Boolean).length >= 1, 'map has at least one interior cell (the X / mountains)');
}
{ // the castle's windows and gate sit inside its outline -> interior
  const cc = T.classifyCells(T.SCENES.castle.d);
  console.log(`     castle    ${cc.length} cells, ${cc.filter(Boolean).length} interior`);
  A(cc.filter(Boolean).length >= 5, 'castle windows + gate classified interior');
}

console.log('\n-- render: interior cells stroked thin, outer cells thick');
/* Metal rims are stroked with the plate gradient; the dark contour uses #000.
   Matching on stroke-width alone counted the contour as a rim. */
const rims = s => [...s.matchAll(/stroke="url\(#g-[^)]+-p\)"\s+stroke-width="([\d.]+)"/g)]
  .map(m2 => +m2[1]);
for (const mo of ['map','star','crown','stopwatch']) {
  const cls = T.classifyCells(T.MOTIFS[mo]);
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222','#333333'],
                         motif:mo,mode:'diecut',dieFit:'box',rimTier:true});
  const w = rims(s);
  const hasInterior = cls.some(Boolean);
  A(w.length === (hasInterior ? 2 : 1),
    `${mo}: ${hasInterior?'two':'one'} metal rim pass${hasInterior?'es':''} (${w.join(', ')})`);
  if (hasInterior) {
    A(w[0] < w[1], `${mo}: interior rim ${w[0]} thinner than outer ${w[1]}`);
    A(Math.abs(w[0]/w[1] - 0.32) < 0.02, `${mo}: interior rim is 0.32x the outer`);
    A(s.includes('fill="#222222"'), `${mo}: interior cell keeps its own enamel colour`);
  }
}
console.log('\n-- innerRim:1 reproduces the old behaviour for comparison');
{
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222'],motif:'map',
                         mode:'diecut',dieFit:'box',rimTier:true,innerRim:1});
  const w = rims(s);
  A(w.length===2 && Math.abs(w[0]-w[1]) < 0.15, `innerRim:1 equalises both rims (${w.join(', ')})`);
}
console.log('\n-- outer parts still get the full rim (footprint toes)');
{
  const cls = T.classifyCells(T.MOTIFS.footprint);
  console.log(`     footprint cells: [${cls.map(v=>v?'i':'o').join('')}]`);
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:'#123456',motif:'footprint',
                         mode:'diecut',dieFit:'box',rimTier:true});
  const k = parseFloat(s.match(/scale\(([\d.]+)\)/)[1]);
  const w = rims(s);
  A(w.length===1, `footprint has one rim pass — all 5 cells are separate parts (${w.join(', ')})`);
  A(Math.abs(w[0]*k - T.RIM_BY_TIER.gold) < 0.05,
    `footprint toes keep the full gold rim (${(w[0]*k).toFixed(2)}px)`);
}
console.log('\n-- single-colour pins also benefit');
{
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:'#123456',motif:'map',
                         mode:'diecut',dieFit:'box',rimTier:true});
  const w = rims(s);
  A(w.length===2 && w[0]<w[1],
    `a single-colour pin still gets thin interior dividers (${w.join(', ')})`);
}
console.log('\n-- the castle keeps its gate and windows as thin-framed enamel');
{
  const s = T.renderPin({shape:'arch',tier:'gold',enamel:'#2f6bb0',scene:'castle',mode:'diecut'});
  const w = rims(s);
  A(w.length===2 && w[0]<w[1], `castle windows get thin frames (${w.join(', ')})`);
}
console.log('\n-- locked pins unaffected');
{
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222'],motif:'map',
                         mode:'diecut',dieFit:'box',locked:true});
  A(!s.includes('#111111') && s.includes('#2b2536'), 'locked still drains to the well colour');
}

console.log(bad===0 ? '\nINNER-RIM CHECKS PASSED' : `\n${bad} INNER-RIM CHECK(S) FAILED`);
process.exit(bad===0?0:1);