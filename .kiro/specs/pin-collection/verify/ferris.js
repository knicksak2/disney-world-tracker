/* The previous ferris assertion only checked that the two arcs had DIFFERENT sweep
   flags. That is true of both the broken and the fixed version — the flag alone says
   nothing about where the resulting circle is centred. These check the geometry. */
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const MOTIF_JS=require('fs').readFileSync(require('path').join(require('path').dirname(process.argv[2]),'motifs','motif-paths.js'),'utf8');
const code = MOTIF_JS + '\n' + html.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>[\s]*$/,'')
  + ';globalThis.__t={toPolys,pathBBox,insideNonZero,insideEvenOdd,SCENES,renderPin,splitCells};';
const document = { getElementById: () => ({ set innerHTML(v){}, get innerHTML(){return '';},
                                            set textContent(v){}, get textContent(){return '';} }) };
new Function('window','document',code)({},document);
const T = globalThis.__t;
let bad = 0;
const A = (c,m) => { if(!c){ console.error('FAIL: '+m); bad++; } else console.log('ok   '+m); };

const d = T.SCENES.ferris.d;
const polys = T.toPolys(d);
const inNZ = (x,y) => T.insideNonZero(polys, x, y);
const ring = r => { let hit=0, tot=0;
  for (let a=0;a<360;a+=2){ tot++;
    if (inNZ(256+r*Math.cos(a*Math.PI/180), 256+r*Math.sin(a*Math.PI/180))) hit++; }
  return hit/tot; };

console.log('-- ring coverage under nonzero (the rule die-cut uses)');
for (const r of [10,25,40,60,80,100,124,150])
  console.log(`   r=${String(r).padStart(3)}  ${(ring(r)*100).toFixed(0).padStart(3)}% filled`);

console.log('\n-- structural expectations');
A(ring(10) > 0.9, 'hub (r=10) is solid — it is a filled disc by design');
A(ring(25) > 0.9, 'hub edge (r=25) still solid (hub radius is 30)');
/* between hub (30) and inner rim (110) only the four spoke diameters cross:
   8 crossings x 14 units wide over a circumference of 2*pi*r */
for (const r of [40,60,80,100]) {
  const expected = (8*14)/(2*Math.PI*r);
  const got = ring(r);
  console.log(`   r=${r}: spokes predict ~${(expected*100).toFixed(0)}%, measured ${(got*100).toFixed(0)}%`);
  A(got < expected*2.2 + 0.05, `r=${r} is open apart from spokes (was 77-86% when broken)`);
}
A(ring(124) > 0.85, 'the rim band (r=124, between 110 and 138) is solid');
A(ring(150) < 0.5, 'outside the rim only the cabins are present');

console.log('\n-- no stray geometry where the mis-centred circle used to be');
{
  /* the broken inner circle was centred (256,36) with r=110, so it covered a large
     area around y=36 that nothing else in the design touches */
  let hit = 0, tot = 0;
  for (let x = 180; x <= 332; x += 4) for (let y = -60; y <= 20; y += 4) {
    tot++; if (inNZ(x, y)) hit++;
  }
  console.log(`   region around (256,-20): ${(hit/tot*100).toFixed(0)}% filled`);
  A(hit/tot < 0.05, 'nothing floats above the wheel any more');
  const bb = T.pathBBox(d);
  console.log(`   bbox y range ${bb.minY.toFixed(0)}..${bb.maxY.toFixed(0)} (top declared ${T.SCENES.ferris.top})`);
  A(bb.minY >= T.SCENES.ferris.top - 1, 'bbox top matches the declared top again');
  A(Math.abs(bb.minY - 99) < 2, 'topmost point is the top cabin at y=99, not a stray circle');
}

console.log('\n-- die-cut render keeps it whole');
{
  const s = T.renderPin({shape:'arch',tier:'silver',enamel:'#14727f',scene:'ferris',
                         mode:'diecut',rimTier:true});
  A([...s.matchAll(/fill="#14727f"/g)].length === 1, 'renders as one body path (noSplit)');
  A(T.SCENES.ferris.noSplit === true, 'ferris declares noSplit');
  A(s.includes('fill-rule="nonzero"'), 'body uses nonzero so the annulus cancels');
}

console.log(bad===0 ? '\nFERRIS CHECKS PASSED' : `\n${bad} FERRIS CHECK(S) FAILED`);
process.exit(bad===0?0:1);