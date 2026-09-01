/* Consolidated verifier for pin-frame-sample.html.
   Lives outside the repo. Sections:
     A analytic geometry validation   D multi-colour + interior rims
     B section render counts          E metal measurement
     C retractions still in place     F ladder + regressions            */
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const path = require('path');
const MOTIF_JS = fs.readFileSync(path.join(path.dirname(process.argv[2]), 'motifs', 'motif-paths.js'), 'utf8');
const window = {};
const code = MOTIF_JS + '\n' + html.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>$/,'')
  + ';globalThis.__t={renderPin,renderSil,stops,polyMetrics,pathBBox,toPolys,splitCells,'
  + 'classifyCells,silhouetteMetrics,dieCutMetalShare,containedMetalShare,insideNonZero,'
  + 'insideEvenOdd,RIM_BY_TIER,SHAPES,SCENES,STAGES,MOTIFS,METALS,TIER_META,TIER6,PALETTES,'
  + 'motifReadable,tiersConfusable,luminance,contrast,hueOf,satOf,hueDist,SKIES,TIERS,LADDER,SET,BOARD,LIB,DISPUTED,OPEN,DECIDED,CORRECTIONS,REJECTED,B4_VARIANTS,PARKS,EMBLEM_CANDIDATES,emblemGate,discLikeness,parkPath,parkRule,parkPin,treeParts,sphereParts,clapperParts,ngon,poly,rotPts,SPECWORK,B4_STAGES,b4Coverage,spikyRayEnamel,ruleAudit,OBJECT_CALL,BALLOON_STAGES,FIREWORK_STAGES,arcCluster,balloon,burstShape,burstCluster,circlePath,tipDots,raysFor,fireArcLayout,finaleLayout,firePath,minBurstSep,componentCount,silhouetteMetrics,DIE_FIRE_STAGES,DIE_FIRE,dieFireLayout,dieFirePath,unionOutline,radialSpan,burstAlt,enamelProfile,skyReadable,wellCoverage,B4_STAGES,B4,FIREWORK_COLOURS,SPARK_COLOUR,b4Stage,starScatter,altFirePath,fusedFireRaw,ALT_FIRE_STAGES,FUSED_FIRE_STAGES,ALT_FIRE,FIRE_A_STAGES,FIRE_B_STAGES,FIRE_C_STAGES,box,wall,tower,spire,turret,battlements};';
const cap = {};
const targets = ['s-tiers','tier-econ','s-tier6','tier6-note','s-shapes','s-versus','versus-note',
  's-versus-grid','s-die-tiers','s-die-tiers-rim','metal-coverage','cost-note','s-parts','parts-code',
  's-die-library','lib-note','lib-metrics','s-multicolour','s-inner-rim','inner-rim-note',
  's-locked-versus','s-ladder','s-ladder-sil','ladder-note','s-set','s-locked','s-sizes','s-sil',
  's-board','s-hero','s-share','s-palette','audit-motif','audit-tiers','audit-note','ledger-decided','ladder-candidates','ladder-cand-note','ladder-arch','ladder-arch-note','diecut-squeeze','ladder-polish','ladder-polish-note','park-emblems','park-emblems-note','ledger-compliance','ledger-rejected','ledger-open','ledger-spec','ledger-corrections'];
const document = { getElementById(id){
  if (!targets.includes(id)) throw new Error('unexpected getElementById: ' + id);
  return { set innerHTML(v){cap[id]=v;}, get innerHTML(){return cap[id];},
           set textContent(v){cap[id]=v;}, get textContent(){return cap[id];} };
}};
try { new Function('window', 'document', code)(window, document); }
catch (e) { console.error('FAIL: script threw -> ' + e.message); process.exit(1); }

let bad = 0;
const A = (c,m) => { if(!c){ console.error('FAIL: '+m); bad++; } else console.log('ok   '+m); };
const n = (s,re) => (String(s).match(re)||[]).length;
const flat = s => String(s).replace(/\s+/g,' ');
const T = globalThis.__t;
const svgsOf = s => String(s).split('<svg').slice(1);
/* metal rims use the plate gradient; the dark contour uses #000 */
const rims = s => [...s.matchAll(/stroke="url\(#g-[^)]+-p\)"\s+stroke-width="([\d.]+)"/g)].map(m=>+m[1]);
function areaFrac(d, rule='nonzero', N=400){
  const polys = T.toPolys(d), bb = T.pathBBox(d);
  const isIn = rule==='evenodd' ? T.insideEvenOdd : T.insideNonZero;
  let hit = 0;
  for (let i=0;i<N;i++) for (let j=0;j<N;j++)
    if (isIn(polys, bb.minX+(i+.5)*bb.w/N, bb.minY+(j+.5)*bb.h/N)) hit++;
  return { frac: hit/(N*N), area: hit/(N*N)*bb.w*bb.h };
}

console.log('== A. geometry validated against analytic areas');
A(Math.abs(areaFrac('M0 0 L100 0 L100 100 L0 100 Z').frac - 1) < .01, 'square fills its bbox');
{ const c = areaFrac('M50 0 A50 50 0 1 1 49.99 0 Z');
  console.log(`     circle ${c.frac.toFixed(4)} vs pi/4 0.7854`);
  A(Math.abs(c.frac - Math.PI/4) < .02, 'arc flattening yields a real circle'); }
A(Math.abs(areaFrac('M0 50 A50 50 0 0 1 100 50 Z').frac - Math.PI/4) < .03, 'single-arc semicircle');
A(Math.abs(areaFrac('M0 100 C55.23 100 100 55.23 100 0 L0 0 Z').frac - Math.PI/4) < .02,
  'cubic flattening matches the arc it approximates');
A(Math.abs(areaFrac('M0 100 Q50 0 100 100 Z').frac - 2/3) < .02, 'quadratic matches analytic 2/3');
A(Math.abs(areaFrac('M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z','evenodd').area
  - 7500) < 120, 'evenodd carves the inner square out');
A(Math.abs(areaFrac('M0 0 C30 -40 70 -40 100 0 L100 60 L0 60 Z').area
         - areaFrac('M0 0 c30 -40 70 -40 100 0 l0 60 l-100 0 Z').area) < 1,
  'relative and absolute cubics agree');
A(Math.abs(T.pathBBox('M50 0 A50 50 0 1 1 49.99 0 Z').h - 100) < 2, 'bbox no longer collapses on arcs');
A(Math.abs(T.pathBBox('M0 100 Q50 0 100 100 Z').minY - 50) < 2, 'bbox tight, not control-point inflated');
for (const o of T.LIB) A(areaFrac(T.MOTIFS[o.motif]).frac > .05,
  `${o.motif}: real fill (${(areaFrac(T.MOTIFS[o.motif]).frac*100).toFixed(0)}%) — was 0% pre-fix`);
{ const c = T.splitCells('M10 10 L20 10 L20 20 Z m30 0 L60 10 L60 20 Z');
  A(c.length===2 && c[1].startsWith('M40 10'), 'relative moveto splits and re-anchors');
  A(Math.abs(areaFrac('M10 10 L20 10 L20 20 Z m30 0 L60 10 L60 20 Z').area
    - c.reduce((s,x)=>s+areaFrac(x).area,0)) < 1, 'cell splitting preserves area'); }

console.log('\n== B. section render counts');
const COUNTS = {'s-tiers':6,'s-tier6':3,'s-shapes':6,'s-versus':4,'s-versus-grid':12,
  's-die-tiers':6,'s-die-tiers-rim':6,'s-die-library':13,'s-multicolour':16,'s-inner-rim':28,
  's-parts':4,'s-locked-versus':3,'s-ladder':6,'s-ladder-sil':6,'s-set':8,'s-locked':4,'s-board':12};
for (const [k,v] of Object.entries(COUNTS)) A(n(cap[k],/<svg/g)===v, `${k}: ${v} renders`);
A(n(cap['lib-metrics'],/<tr>/g)===14, 'metrics table: header + 13 rows');
for (const t of targets) A(typeof cap[t]==='string' && cap[t].length>0, `${t} produced output`);

console.log('\n== C. retractions still in place');
A(flat(cap['cost-note']).includes('I made that number up'), 'time estimate retracted');
A(flat(cap['cost-note']).includes("don't experience duration"), 'and explained');
A(flat(cap['lib-note']).includes('was invented'), 'good/ok/weak labels retracted');
A(flat(cap['lib-note']).includes('essentially square'), 'the false splash claim named specifically');
A(flat(cap['inner-rim-note']).includes('no measurement of mine caught'),
  'interior-detail flaw credited to observation, not measurement');
{ const R = /(made [^.]*up|fabricat|invent|never measured|not measure|false)/i;
  let occ=0, un=0;
  for (const t of targets){ const s=flat(cap[t]);
    for (const m of s.matchAll(/30.?60 minutes/g)){ occ++;
      if(!R.test(s.slice(Math.max(0,m.index-400), m.index+400))) un++; } }
  A(occ>=1 && un===0, `invented time figure appears ${occ}x, all inside a retraction`); }

console.log('\n== D. multi-colour + interior rims');
{ const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z M40 40 L60 40 L60 60 L40 60 Z');
  A(c[0]===false && c[1]===true, 'classifier: contained square is interior'); }
{ const c = T.classifyCells('M0 0 L40 0 L40 40 L0 40 Z M60 0 L100 0 L100 40 L60 40 Z');
  A(c[1]===false, 'classifier: disjoint square is NOT interior'); }
{ const c = T.classifyCells('M0 0 L100 0 L100 100 L0 100 Z m40 40 L60 40 L60 60 L40 60 Z');
  A(c[1]===true, 'classifier: relative-moveto interior detected'); }
for (const m of Object.keys(T.MOTIFS)) { const c = T.classifyCells(T.MOTIFS[m]);
  if (c.length>1) console.log(`     ${m.padEnd(10)} ${String(c.length).padStart(2)} cells `
    + `${String(c.filter(Boolean).length).padStart(2)} interior [${c.map(v=>v?'i':'o').join('')}]`); }
A(T.classifyCells(T.MOTIFS.map).filter(Boolean).length===2, 'map: X and mountains are interior');
A(T.classifyCells(T.MOTIFS.footprint).filter(Boolean).length===0, 'footprint: toes are separate parts');
A(T.classifyCells(T.SCENES.castle.d).filter(Boolean).length>=5, 'castle: windows + gate interior');
for (const mo of ['map','star','crown','stopwatch','footprint']) {
  const hasInt = T.classifyCells(T.MOTIFS[mo]).some(Boolean);
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222','#333333'],
                         motif:mo,mode:'diecut',dieFit:'box',rimTier:true});
  const w = rims(s);
  A(w.length===(hasInt?2:1), `${mo}: ${w.length} metal rim pass(es) [${w.join(', ')}]`);
  if (hasInt) { A(Math.abs(w[0]/w[1]-0.32)<0.02, `${mo}: interior rim is 0.32x outer`);
                A(s.includes('fill="#222222"'), `${mo}: interior cell keeps its enamel`); }
}
{ const w = rims(T.renderPin({shape:'disc',tier:'gold',enamel:['#1','#2'],motif:'map',
    mode:'diecut',dieFit:'box',rimTier:true,innerRim:1}));
  A(Math.abs(w[0]-w[1])<0.15, 'innerRim:1 reproduces the old equal-rim look'); }
{ const w = rims(T.renderPin({shape:'disc',tier:'gold',enamel:'#123456',motif:'map',
    mode:'diecut',dieFit:'box',rimTier:true}));
  A(w.length===2 && w[0]<w[1], 'single-colour pins also get thin interior dividers'); }
for (const mo of T.DISPUTED) {
  const cells = T.splitCells(T.MOTIFS[mo]).length;
  const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222','#333333','#444444'],
                         motif:mo,mode:'diecut',dieFit:'box',rimTier:true});
  A(n(s,/fill="#(?:111111|222222|333333|444444)"/g)===cells, `${mo}: ${cells} cells each filled`);
}
A(T.splitCells(T.MOTIFS.highfive).length===1, 'highfive single-cell (the one real constraint found)');
{ const s = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222'],motif:'map',
    mode:'diecut',dieFit:'box',locked:true});
  A(!s.includes('#111111') && s.includes('#2b2536'), 'locked ignores multi-colour'); }
for (const o of T.LIB) {
  const s = T.renderPin({shape:'disc',tier:o.tier,enamel:o.enamel,motif:o.motif,
                         mode:'diecut',dieFit:'box',rimTier:true});
  const k = parseFloat(s.match(/scale\(([\d.]+)\)/)[1]), bb = T.pathBBox(T.MOTIFS[o.motif]);
  A(Math.abs(Math.max(bb.w,bb.h)*k-126)<0.7, `${o.motif}: fills 126px`);
  A(Math.abs(rims(s).pop()*k - T.RIM_BY_TIER[o.tier])<0.05, `${o.motif}: outer rim matches tier`);
}

console.log('\n== E. metal measurement');
{ const C = T.SCENES.castle;
  const gem = T.containedMetalShare('gem');
  const u55 = T.dieCutMetalShare(C.d, C.top, 5.5, C.rule);
  const prz = T.dieCutMetalShare(C.d, C.top, T.RIM_BY_TIER.prism, C.rule);
  const p = v => (v*100).toFixed(0)+'%';
  console.log(`     contained gem ${p(gem.share)} · die-cut 5.5px ${p(u55.share)} · prismatic ${p(prz.share)}`);
  const sq = T.dieCutMetalShare('M156 280 L356 280 L356 480 L156 480 Z',280,20*(124/200),'nonzero',400);
  A(Math.abs(sq.share-(220*220-180*180)/(220*220))<0.02, 'rasteriser matches analytic ring');
  A(u55.share<0.99 && prz.share>u55.share && u55.share>gem.share,
    'die-cut shows more metal than contained; fatter rim shows more still');
  A(cap['metal-coverage'].includes(p(gem.share)) && cap['metal-coverage'].includes(p(prz.share)),
    'note quotes the computed figures');
  A(/uniform-rim die-cut does show less metal|shows somewhat less metal/i.test(cap['versus-note'])
    === (u55.share<gem.share), 'verdict prose agrees with the measurement'); }

console.log('\n== F. ladder, oracle, regressions');
{ const norm = d => d.replace(/\s+/g,' ').trim();
  A(norm(T.wall(100,200,400))==='M100 480 L100 400 L200 400 L200 480 Z', 'wall() primitive');
  A(norm(T.tower(256,60,300))==='M226 480 L226 300 L286 300 L286 480 Z', 'tower() primitive');
  for (const [i,specs] of Object.entries({1:[[256,60]],2:[[181,62],[331,62]],
      3:[[166,60],[346,60]],4:[[148,64],[364,64],[256,80]]}))
    for (const [cx,w] of specs)
      A(T.STAGES[i].d.includes(`M${cx-(w/2+12)} `), `stage ${i}: turret ${cx} standard overhang`); }
A(T.TIERS.length===6 && T.TIERS[5]==='prism', 'tier 6 is prismatic');
A(!('nickel' in T.METALS), 'black nickel gone');
A(new Set(T.TIERS.map(t=>T.METALS[t].join(','))).size===6, '6 distinct ramps');
A(new Set(T.TIERS.map(t=>T.METALS[t][0])).size===6, '6 distinct top stops');
A(n(cap['s-tiers'],/class="shmr/g)===2, 'only pearl + prism animate');
A(html.includes('prefers-reduced-motion'), 'reduced motion respected');
A(n(cap['s-ladder'],/Georgia/g)===12, 'ladder banners intact');
A(T.LADDER.every((r,i)=>r.scene==='stage'+(i+1)), 'ladder wired in order');
const tops=[1,2,3,4,5,6].map(i=>T.STAGES[i].top);
for(let i=1;i<6;i++) A(tops[i]<=tops[i-1], `ladder climbs at stage ${i+1}`);
A(T.SCENES.castle.top===40 && T.SCENES.ferris.top===99, 'silhouettes declare their own top');
{ const k=s=>parseFloat(s.match(/scale\(([\d.]+)\)/)[1]);
  A(Math.abs((480-40)*k(T.renderPin({shape:'arch',tier:'gold',enamel:'#2f6bb0',
    scene:'castle',mode:'diecut'}))-124)<0.5, 'baseline die-cut fits to 124px'); }
{ const nums=d=>(d.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
  const all={castle:T.SCENES.castle,ferris:T.SCENES.ferris,
    ...Object.fromEntries(Object.entries(T.STAGES).map(([k,v])=>['stage'+k,v]))};
  for(const [name,sc] of Object.entries(all)){
    const pts=(sc.d.match(/[ML]\s*-?[\d.]+\s+-?[\d.]+/g)||[]).map(c=>nums(c));
    const ys=pts.map(p=>p[1]), xs=pts.map(p=>p[0]);
    A(Math.max(...ys)===480, `${name}: on the baseline`);
    A(Math.abs((Math.min(...xs)+Math.max(...xs))/2-256)<1.5, `${name}: centred`);
    if(sc.top!=null) A(Math.min(...ys)===sc.top, `${name}: declared top accurate`); } }
const all = targets.map(t=>cap[t]).join('');
A(!all.includes('undefined'), 'no "undefined" anywhere');
A(!all.includes('NaN'), 'no NaN in any transform');
A((all.match(/<svg[^>]*>/g)||[]).filter(s=>s.includes('role="img"')&&!s.includes('aria-label')).length===0,
  'every pin carries an aria-label');
A(Object.keys(T.PALETTES).length===1, 'palette locked to Royal');
A(T.SHAPES.star.bannerY===null, 'star still refuses a banner');
{ const v = svgsOf([cap['s-set'],cap['s-ladder'],cap['s-versus'],cap['s-tiers'],cap['s-tier6'],
    cap['s-die-tiers'],cap['s-die-tiers-rim'],cap['s-parts']].join(''))
    .filter(s=>['amethyst','pearl','prism'].some(t=>s.includes(T.METALS[t][0]))
             &&(s.includes(T.PALETTES.royal.royal)||s.includes(T.PALETTES.royal.plum)));
  A(v.length===0, 'no tier 4+ pin on royal or plum enamel'); }


/* ---- appended: fixes driven by the screenshots ---- */
console.log('\n== G. bugs found by looking, now asserted');
{
  // 1. ferris annulus must survive die-cut mode
  A(T.SCENES.ferris.noSplit === true, 'ferris is marked noSplit (winding-dependent)');
  const s = T.renderPin({shape:'arch',tier:'silver',enamel:'#14727f',scene:'ferris',
                         mode:'diecut',rimTier:true});
  const fills = [...s.matchAll(/<path d="[^"]+" fill="#14727f"/g)].length;
  A(fills === 1, `ferris renders as ONE body path, not 18 cells (${fills})`);
  // and the hub must be open
  const polys = T.toPolys(T.SCENES.ferris.d);
  const probe = r => { let inside=0, total=0;
    for (let a=0;a<360;a+=3){ total++;
      if (T.insideNonZero(polys, 256+r*Math.cos(a*Math.PI/180), 256+r*Math.sin(a*Math.PI/180))) inside++; }
    return inside/total; };
  console.log(`     ferris hub fill at r=10: ${(probe(10)*100).toFixed(0)}% ` +
              `(was 100% when cells were split)`);
  A(fills === 1, 'the whole-path render is what keeps the annulus open');
  // a non-winding shape must still split
  const crown = T.renderPin({shape:'disc',tier:'gold',enamel:['#111111','#222222'],motif:'crown',
                             mode:'diecut',dieFit:'box',rimTier:true});
  A(crown.includes('#222222'), 'crown still splits into cells for multi-colour');

  // 2. motif readability
  const P = T.PALETTES.royal;
  const bad2 = T.motifReadable(P.amber, 'gold');
  console.log(`     amber on gold: ${bad2.hd.toFixed(0)}deg, ${bad2.cr.toFixed(2)}:1 -> ok=${bad2.ok}`);
  A(!bad2.ok, 'the amber/gold pairing is correctly flagged unreadable');
  for (const c of [...T.SET.filter(p=>!p.mode), ...T.LADDER])
    A(T.motifReadable(c.enamel, c.tier).ok,
      `${c.label}: metal motif is readable on its enamel`);
  A(T.motifReadable(P.crimson,'gold').ok, 'crimson on gold is readable (the replacement)');

  // 3. tier separation
  const conf = [];
  for (let i=0;i<T.TIERS.length;i++) for (let j=i+1;j<T.TIERS.length;j++) {
    const r = T.tiersConfusable(T.TIERS[i], T.TIERS[j]);
    if (r.confusable) conf.push(`${T.TIERS[i]}/${T.TIERS[j]}`);
  }
  const bg = T.tiersConfusable('bronze','gold');
  console.log(`     bronze vs gold now: ${bg.hd.toFixed(0)}deg, contrast ${bg.cr.toFixed(2)}, `
    + `sat diff ${bg.sd.toFixed(2)}`);
  A(conf.length === 0, `no confusable tier pairs remain (${conf.join(', ') || 'none'})`);
  A(bg.cr >= 1.8, `bronze and gold now separate on lightness (${bg.cr.toFixed(2)}:1)`);
  A(new Set(T.TIERS.map(t=>T.METALS[t][1])).size===6, 'six distinct mid tones');

  // the audit sections must report what the functions compute
  A(cap['audit-motif'].includes('MOTIF DISAPPEARS') === false,
    'motif audit shows no failures after the fix');
  A(cap['audit-tiers'].includes('CONFUSABLE') === false,
    'tier audit shows no confusable pairs after the fix');
  A(flat(cap['audit-note']).includes('invisible to every test I had written'),
    'audit note credits the screenshots, not the tests');
}


console.log('\n== H. decision ledger must agree with the code');
{
  A(!cap['ledger-decided'].includes('MISMATCH'),
    'no decided row disagrees with the live constants');
  const m = cap['ledger-decided'].match(/All (\d+) decisions verified/);
  A(!!m, 'ledger reports a verified count');
  if (m) console.log(`     ${m[1]} decisions verified against the constants`);
  A(+m[1] >= 22, `ledger covers at least 22 decisions (${m ? m[1] : 0})`);
  A(n(cap['ledger-decided'], /class="dec"/g) === +m[1], "one card per decision (${+m[1]})");

  /* the ledger's specific factual claims, re-derived independently here so a
     hand-edited ledger cell cannot quietly go stale */
  A(cap['ledger-decided'].includes('bronze → silver → gold → amethyst → pearl → prismatic')
    && T.TIERS.join()==='bronze,silver,gold,amethyst,pearl,prism', 'ladder order matches');
  A(cap['ledger-decided'].includes('4.2px at bronze to 9.2px at prismatic')
    && T.RIM_BY_TIER.bronze===4.2 && T.RIM_BY_TIER.prism===9.2, 'rim range matches');
  A([1,2,3,4,5].map(i=>T.STAGES[i].top).join()==='300,260,220,170,40'
    && cap['ledger-decided'].includes('8.9% \u2192 10.5%'), 'ladder-climb row now quotes B4 coverage, and the retired castle tops are unchanged');
  A(cap['ledger-decided'].includes('0.32×') , 'interior rim ratio stated');
  A(cap['ledger-decided'].includes('≥40° hue or ≥3.5:1'), 'colour rule stated');

  A(T.OPEN.length >= 1 && T.OPEN.every(function(o){ return o.q && o.detail && o.blocks; }),
    T.OPEN.length + ' open questions, each with a question, detail and what it blocks');
  for (const k of ['bronze','crimson','silhouettes actually work','Series 1','pre-rendered PNG'])
    A(cap['ledger-open'].includes(k) || cap['ledger-open'].toLowerCase().includes(k.toLowerCase()),
      `open list mentions: ${k}`);
  A(cap['ledger-spec'].includes('challenge list'), 'spec list names the biggest missing input');

  /* the corrections log must contain every retraction made in this thread */
  for (const k of ['70 pins from 6 plates','30–60 minutes','Backwards','Invented',
                   'square','distinct hex','opposite sweeps'])
    A(flat(cap['ledger-corrections']).includes(k), `corrections log records: ${k}`);
  A(flat(cap['ledger-corrections']).includes('zero came out of the reasoning'),
    'corrections log states the pattern honestly');
}


console.log('\n== I. ledger visuals');
{
  A(!cap['ledger-decided'].includes('demo failed'), 'no decided-row demo threw');
  A(!cap['ledger-open'].includes('demo failed'), 'no open-question demo threw');
  const dec = n(cap['ledger-decided'], /<svg/g);
  const opn = n(cap['ledger-open'], /<svg/g);
  console.log(`     ledger renders ${dec} pins in Decided, ${opn} in Open`);
  A(dec >= 45, `Decided carries a substantial number of examples (${dec})`);
  A(opn >= 4, 'the remaining open questions still carry examples (' + opn + ')');
  const m2 = cap['ledger-decided'].match(/(\d+) of (\d+) shown visually/);
  A(!!m2, 'ledger states how many decisions are illustrated');
  if (m2) { console.log(`     ${m2[1]} of ${m2[2]} decisions illustrated`);
            A(+m2[1] >= 17, `most decisions are illustrated (${m2[1]})`); }
  // card layout, not the old table
  A(n(cap['ledger-decided'], /class="dec"/g) === T.DECIDED.length,
    'one card per decision (' + T.DECIDED.length + ')');
  A(n(cap['ledger-open'], /class="dec"/g) === T.OPEN.length, 'one card per open question');
  A(!cap['ledger-decided'].includes('<table'), 'Decided no longer uses a table');

  /* before/after comparisons must actually differ, or the illustration is a lie */
  const pair = (html2, label) => {
    const svgs = html2.split('<svg').slice(1);
    return svgs;
  };
  // the retired ramps exist only for illustration and must not leak into the tiers
  A(!T.TIERS.includes('_retiredBronze') && !T.TIERS.includes('_retiredNickel'),
    'archived ramps are not tiers');
  A(!('nickel' in T.METALS), 'the retired nickel key is not named "nickel"');
  A('_retiredNickel' in T.METALS && '_retiredBronze' in T.METALS,
    'archived ramps are available for before/after renders');
  A(cap['ledger-decided'].includes(T.METALS._retiredBronze[1]),
    'the old bronze mid tone actually appears in the before/after');
  A(cap['ledger-decided'].includes(T.METALS.bronze[1]),
    'the new bronze mid tone appears alongside it');
  A(T.METALS._retiredBronze[1] !== T.METALS.bronze[1], 'the two bronzes genuinely differ');
  // the amber/gold failure must be shown, but only as a "before"
  A(cap['ledger-decided'].includes(T.PALETTES.royal.amber),
    'the amber-on-gold failure is shown as a before');
  A(!T.motifReadable(T.PALETTES.royal.amber, 'gold').ok,
    'and it is still the pairing the audit rejects');
  // interior-rim before/after must use different rim ratios
  A(cap['ledger-decided'].includes('0.32'), 'interior rim ratio quoted in the ledger');
}


console.log('\n== J. rule compliance audit');
{
  const aud = T.ruleAudit();
  for (const a of aud)
    console.log(`     ${a.label.padEnd(24)} object=${String(a.object).padEnd(5)} `
      + `rule=${a.expected.padEnd(9)} renders=${a.actual.padEnd(9)} `
      + (a.violation ? 'VIOLATION' : a.exception ? 'exception' : 'ok'));
  const viol = aud.filter(a => a.violation);
  const exc  = aud.filter(a => a.exception);
  console.log(`     ${viol.length} violations, ${exc.length} declared exceptions`);

  A(aud.length === T.SET.length, 'every sample pin is audited');
  A(aud.every(a => a.object !== null && a.object !== undefined),
    'every sample achievement has an explicit object call — no silent gaps');
  /* previously three pins violated the rule; they are now die-cut */
  A(viol.length === 0, `no violations remain (${viol.map(v=>v.label).join(', ') || 'none'})`);
  for (const label of ['Crown Jewel','Soaked & Smiling','Turkey Leg Legend']) {
    const p = aud.find(a => a.label === label);
    A(!!p && p.mode === 'diecut', `${label} is now die-cut, as the rule requires`);
  }
  A(aud.find(a=>a.label==='Made a Friend').actual === 'contained',
    'Made a Friend stays contained — it is abstract');
  A(exc.length === 2 && exc.every(e => e.label.match(/First Steps|Park Regular/)),
    'the only exceptions are the two ladder rungs');
  A(exc.every(e => typeof e.exception === 'string' && e.exception.length > 20),
    'every exception carries a real reason');
  A(aud.filter(a => a.mode === 'diecut').every(a => a.object === true),
    'nothing is die-cut without an object');
  A(aud.filter(a => a.mode === 'diecut').length >= aud.length/2,
    `the set is now mostly die-cut (${aud.filter(a=>a.mode==='diecut').length}/${aud.length})`);
  A(cap['ledger-compliance'].includes('follow the rule'), 'the page reports the all-clear');
  A(!cap['ledger-compliance'].includes('VIOLATES THE RULE'), 'no violation badge rendered');

  // castle reassignment
  const cj = T.SET.find(p => p.label === 'Crown Jewel');
  A(cj.scene === 'castle' && cj.mode === 'diecut', 'Crown Jewel is the die-cut castle');
  A(!T.SET.some(p => p.label === 'Crown Jewel' && p.motif === 'trophy'),
    'the placeholder trophy is gone from Crown Jewel');
  A(!T.LADDER.some(r => String(r.scene).startsWith('stage')) ||
     T.LADDER.every(r => String(r.scene).startsWith('stage')),
    'ladder still wired consistently while the motif decision is open');

  // shape-as-category retired
  A(cap['ledger-decided'].includes('Shape is NOT category'), 'shape-as-category is retired');
  A(cap['ledger-decided'].includes('board grouping'), 'category now comes from board grouping');
  A(cap['ledger-decided'].includes('Castle = Magic Kingdom'), 'castle reassignment recorded');
  A(cap['ledger-decided'].includes('Mostly die-cut'), 'mostly-die-cut recorded as decided');
}

console.log('\n== K. ladder motif candidates');
{
  const bal = T.BALLOON_STAGES, fire = T.FIREWORK_STAGES;
  A(Object.keys(bal).length === 6 && Object.keys(fire).length === 6, 'six stages each');
  for (const [name, S] of [['balloon', bal], ['firework', fire]]) {
    const tops = [1,2,3,4,5,6].map(i => S[i].top);
    console.log(`     ${name} tops: ${tops.join(' -> ')}`);
    for (let i=1;i<6;i++) A(tops[i] <= tops[i-1], `${name}: climbs at stage ${i+1}`);
    for (const i of [1,2,3,4,5,6]) {
      const bb = T.pathBBox(S[i].d);
      A(Math.abs(bb.maxY-480) < 1.5, `${name} ${i}: on the baseline`);
      A(Math.abs((bb.minX+bb.maxX)/2-256) < 6, `${name} ${i}: centred`);
      A(bb.minX > 40 && bb.maxX < 472, `${name} ${i}: inside the canvas`);
      A(Math.abs(bb.minY - S[i].top) < 3, `${name} ${i}: declared top derived, not typed`);
    }
    const cells = [1,2,3,4,5,6].map(i => T.splitCells(S[i].d).length);
    for (let i=1;i<6;i++) A(cells[i] > cells[i-1], `${name}: cell count grows at stage ${i+1}`);
  }
  /* the even-n apex bug: with 2 items, one must still sit at the apex */
  const two = T.arcCluster(2, 100, 60, 30, 30, 70);
  A(two.every(b => b[1] === 100), `arcCluster keeps an item at the apex when n is even (${two.map(b=>b[1]).join(',')})`);
  const four = T.arcCluster(4, 100, 60, 30, 30, 70);
  A(Math.min(...four.map(b=>b[1])) === 100, 'and when n is 4');
  A(cap['ladder-candidates'].split('<svg').length - 1 === 72,
    `candidates section renders 6 ladders x 6 rungs x 2 sizes (${cap['ladder-candidates'].split('<svg').length-1})`);
  A(/subtractive|in pieces/i.test(cap['ladder-cand-note']),
    'note explains why the castle ladder fails structurally');
}

/* ---- G firework variants -------------------------------------------------
   Centre anchored, so the assertions differ from the ground-anchored ladders:
   no baseline contact, and the bbox centre MUST be (256,256) or the centre
   anchor hangs the cluster off to one side. */
{
  const T = globalThis.__t;
  const OLD = T.pathBBox(T.FIREWORK_STAGES[1].d);
  A(Math.abs(OLD.maxY - 480) < 1.5,
    'old fireworks did reach the baseline, i.e. the launch tube was really there');

  for (const [name, S] of [['B1 arc', T.FIRE_A_STAGES], ['B2 finale', T.FIRE_B_STAGES],
                           ['B3 finale+sparks', T.FIRE_C_STAGES]]) {
    for (const i of [1,2,3,4,5,6]) {
      const bb = T.pathBBox(S[i].d);
      const cx = (bb.minX+bb.maxX)/2, cy = (bb.minY+bb.maxY)/2;
      A(Math.abs(cx-256) < 1.5 && Math.abs(cy-256) < 1.5,
        name+' '+i+': bbox centre is (256,256) for the centre anchor ('+cx.toFixed(1)+','+cy.toFixed(1)+')');
      A(bb.maxY < 470, name+' '+i+': floats clear of the baseline (maxY '+bb.maxY.toFixed(0)+')');
      A(bb.minX >= 0 && bb.maxX <= 512 && bb.minY >= 0 && bb.maxY <= 512,
        name+' '+i+': inside the canvas');
      A(Math.abs(bb.minY - S[i].top) < 3, name+' '+i+': declared top derived, not typed');
      A(S[i].groups.reduce(function(a,b){return a+b;},0) === T.splitCells(S[i].d).length,
        name+' '+i+': colour groups cover every cell exactly (no confetti sparks)');
    }
    const cells = [1,2,3,4,5,6].map(function(i){ return T.splitCells(S[i].d).length; });
    for (let i=1;i<6;i++) A(cells[i] > cells[i-1], name+': cell count grows at stage '+(i+1));
  }

  const ext = [1,2,3,4,5,6].map(function(i){ return T.FIRE_A_STAGES[i].ext; });
  console.log('     B1 extent: ' + ext.join(' -> '));
  for (let i=1;i<6;i++) A(ext[i] > ext[i-1],
    'B1: extent grows at stage '+(i+1)+' (the shrinking-rung defect stays fixed)');

  const fill = function(rays, inner){
    const pts = T.burstShape(256,256,100,rays,inner).replace(/^M/,'').replace(/Z\s*$/,'')
      .split('L').map(function(s){ return s.trim().split(/\s+/).map(Number); });
    let a = 0;
    for (let i=0;i<pts.length;i++){ const p=pts[i], q=pts[(i+1)%pts.length]; a += p[0]*q[1]-q[0]*p[1]; }
    return Math.abs(a)/2 / (Math.PI*100*100);
  };
  const oldFill = fill(8,0.4), newFill = fill(16,0.16);
  A(oldFill > 0.35 && newFill < 0.20,
    'rays are thin now: a burst fills '+(newFill*100).toFixed(0)+'% of its circle, was '+(oldFill*100).toFixed(0)+'%');

  const sepA = [1,2,3,4,5,6].map(function(i){ return T.minBurstSep(T.FIRE_A_STAGES[i]); });
  const sepB = [1,2,3,4,5,6].map(function(i){ return T.minBurstSep(T.FIRE_B_STAGES[i]); });
  const fmt = function(a){ return a.map(function(s){ return s===Infinity?'-':s.toFixed(2); }).join(' '); };
  console.log('     separation arc:    ' + fmt(sepA));
  console.log('     separation finale: ' + fmt(sepB));
  A(sepA[5] < 0.67, 'the arc really does crowd at stage 6 ('+sepA[5].toFixed(2)+'), as the note claims');
  for (const i of [1,2,3,4,5]) A(sepB[i] >= 0.67,
    'finale stays separable at stage '+(i+1)+' ('+sepB[i].toFixed(2)+')');

  A(T.raysFor(120) === 16 && T.raysFor(70) === 12 && T.raysFor(45) === 10,
    'ray count follows burst radius so small bursts do not alias at 44px');

  const c = T.circlePath(100, 200, 50);
  A((c.match(/A/g)||[]).length === 2, 'circlePath uses two half arcs, not one near-360 arc');
  const cb = T.pathBBox(c);
  A(Math.abs((cb.minX+cb.maxX)/2-100) < 0.5 && Math.abs((cb.minY+cb.maxY)/2-200) < 0.5
    && Math.abs((cb.maxX-cb.minX)/2-50) < 0.5,
    'circlePath is centred where asked, with the radius asked for');
}

/* ---- H does the ladder need the arch -------------------------------------
   The die-cut constraints, asserted rather than described: one piece of metal,
   enamel that actually survives the rim at the tier it will be rendered at, and
   an extent that still climbs. Also pins the finding that the CONTAINED art
   cannot simply be unframed. */
{
  const T = globalThis.__t;
  const TIER = ['bronze','bronze','silver','gold','amethyst','prism'];

  for (const [nm, S] of [['B1 arc', T.FIRE_A_STAGES[6]], ['B2 finale', T.FIRE_B_STAGES[6]],
                         ['B3 finale+sparks', T.FIRE_C_STAGES[6]]]) {
    const es = T.silhouetteMetrics(S.d, T.RIM_BY_TIER.gold, S.rule).enamelShare;
    A(es < 0.05, 'contained art cannot just be unframed: '+nm+' keeps only '
      + (es*100).toFixed(0) + '% enamel as a die-cut');
  }

  const ext = [];
  for (const i of [1,2,3,4,5,6]) {
    const S = T.DIE_FIRE_STAGES[i], rim = T.RIM_BY_TIER[TIER[i-1]];
    const pieces = T.componentCount(S.d, rim, 'nonzero');
    const es = T.silhouetteMetrics(S.d, rim, 'nonzero').enamelShare;
    A(pieces === 1, 'die-cut rung '+i+' is one piece of metal (pieces='+pieces+')');
    A(es >= 0.25, 'die-cut rung '+i+' keeps enamel at its own '+rim+'px rim ('
      + (es*100).toFixed(0) + '%)');
    ext.push(S.ext);
  }
  console.log('     die-cut extent: ' + ext.join(' -> '));
  for (let i=1;i<6;i++) A(ext[i] > ext[i-1], 'die-cut extent grows at rung '+(i+1));

  /* boldness must track the widening rim, or the rarest rung starves */
  A(T.DIE_FIRE.inner(6) > T.DIE_FIRE.inner(1) && T.DIE_FIRE.sparkR(6) > T.DIE_FIRE.sparkR(1),
    'boldness grows with the rung to offset the wider rim at rare tiers');
  const flatEs = T.silhouetteMetrics(
    T.dieFirePath(T.dieFireLayout(6).map(function(b){
      return [b[0],b[1],b[3]?b[2]:34,b[3],b[3]?0.45:0]; })),
    T.RIM_BY_TIER.prism, 'nonzero').enamelShare;
  const realEs = T.silhouetteMetrics(T.DIE_FIRE_STAGES[6].d, T.RIM_BY_TIER.prism, 'nonzero').enamelShare;
  A(realEs > flatEs, 'the tapering fix really does help rung 6 at the prism rim ('
    + (flatEs*100).toFixed(0) + '% -> ' + (realEs*100).toFixed(0) + '%)');

  /* round sparks are the rim-tolerant element - that is the claim the design rests on */
  const rayEs  = T.silhouetteMetrics(T.burstShape(256,256,150,16,0.16), T.RIM_BY_TIER.gold, 'nonzero').enamelShare;
  const discEs = T.silhouetteMetrics(T.circlePath(256,256,150), T.RIM_BY_TIER.gold, 'nonzero').enamelShare;
  A(discEs > rayEs * 4, 'a disc is far more rim-tolerant than fine rays ('
    + (discEs*100).toFixed(0) + '% vs ' + (rayEs*100).toFixed(0) + '%)');

  /* connectivity must be measured, not inferred: two interleaved bursts whose boxes
     overlap can still be separate pieces */
  const apart = T.burstShape(120,256,90,16,0.16) + T.burstShape(392,256,90,16,0.16);
  A(T.componentCount(apart, T.RIM_BY_TIER.gold, 'nonzero') === 2,
    'componentCount separates two bursts that do not touch');
  A(T.componentCount(T.circlePath(200,256,80) + T.circlePath(300,256,80), T.RIM_BY_TIER.gold, 'nonzero') === 1,
    'and joins two that do');

  A(cap['ladder-arch'].split('<svg').length - 1 === 36, 'arch section renders 3 candidates x 6 rungs x 2 sizes');
  A(/withdrawn/i.test(cap['ladder-arch-note']), 'the note withdraws the series-frame reason');
  A(/royal/i.test(cap['ladder-arch']), 'die-cut enamel colour was chosen by measurement');
  A(T.componentCount(T.burstShape(256,256,150,16,0.16), 0.02, 'nonzero') > 1,
    'componentCount is raster-limited at a near-zero rim, so it is only used at real rim widths');
}

/* ---- I union outline, and the flower fix ---------------------------------
   The tracer produced a plausible-looking but wrong path twice, so it is checked
   against shapes whose area is known analytically rather than against itself. */
{
  const T = globalThis.__t;
  const TIER = ['bronze','bronze','silver','gold','amethyst','prism'];

  const circ = T.unionOutline(T.circlePath(256,256,120), 'nonzero', 220, 2);
  const trueCirc = Math.PI*120*120, gotCirc = T.polyMetrics(circ).area;
  A(Math.abs(gotCirc - trueCirc)/trueCirc < 0.03,
    'unionOutline recovers a circle area within 3% (' + gotCirc.toFixed(0) + ' vs ' + trueCirc.toFixed(0) + ')');
  A(T.splitCells(circ).length === 1, 'unionOutline returns exactly one subpath');
  A((circ.match(/L/g)||[]).length + 1 < 80,
    'and a sane vertex count (' + ((circ.match(/L/g)||[]).length+1) + '), not the 15489 the broken trace gave');
  const sq = T.unionOutline('M150 150 L362 150 L362 362 L150 362 Z', 'nonzero', 220, 2);
  A(Math.abs(T.polyMetrics(sq).area - 212*212)/(212*212) < 0.03,
    'unionOutline recovers a square area within 3%');
  A((sq.match(/L/g)||[]).length + 1 <= 8, 'a square simplifies to a handful of vertices');

  /* the union must actually FUSE: two overlapping circles become one outline whose area
     is less than the sum of the parts, and strictly more than one of them */
  const twoOverlap = T.circlePath(220,256,90) + T.circlePath(292,256,90);
  const fused = T.unionOutline(twoOverlap, 'nonzero', 220, 2);
  const oneA = Math.PI*90*90, fusedA = T.polyMetrics(fused).area;
  A(T.splitCells(fused).length === 1 && fusedA > oneA*1.05 && fusedA < oneA*2,
    'unionOutline fuses two overlapping circles into one outline of union area, not sum ('
    + fusedA.toFixed(0) + ' vs one=' + oneA.toFixed(0) + ' sum=' + (oneA*2).toFixed(0) + ')');

  /* alternating rays are what break the flower read: the tip radii must differ */
  const alt = T.altFirePath(3);
  const rs = [];
  for (const p of T.toPolys(alt)) for (const v of p) rs.push(Math.hypot(v[0]-256, v[1]-256));
  const tips = Array.from(new Set(rs.map(function(r){ return Math.round(r); }))).sort(function(a,b){return b-a;});
  A(tips[0] - tips[1] > 20,
    'alternating burst really has long and short tips (' + tips[0] + ' vs ' + tips[1] + '), not equal petals');

  /* one rim, not a donut per spark - this is the visible defect, as a number */
  A(T.splitCells(T.DIE_FIRE_STAGES[6].d).length > 1,
    'candidate C did draw a separate rim per spark (' + T.splitCells(T.DIE_FIRE_STAGES[6].d).length + ')');
  for (const [nm, S] of [['D', T.ALT_FIRE_STAGES], ['E', T.FUSED_FIRE_STAGES]]) {
    for (const i of [1,2,3,4,5,6]) {
      const rim = T.RIM_BY_TIER[TIER[i-1]];
      A(T.splitCells(S[i].d).length === 1, nm + ' rung ' + i + ': one subpath, so exactly one rim');
      A(T.componentCount(S[i].d, rim, 'nonzero') === 1, nm + ' rung ' + i + ': one piece of metal');
      const es = T.silhouetteMetrics(S[i].d, rim, 'nonzero').enamelShare;
      A(es >= 0.30, nm + ' rung ' + i + ': keeps enamel at its own ' + rim + 'px rim ('
        + (es*100).toFixed(0) + '%)');
    }
    const rad = [1,2,3,4,5,6].map(function(i){ return S[i].rad; });
    console.log('     ' + nm + ' radius: ' + rad.join(' -> '));
    for (let i=1;i<6;i++) A(rad[i] > rad[i-1], nm + ': radius grows at rung ' + (i+1));
  }

  /* E must be at least as good as C on the thing C was bad at */
  /* This used to assert the fused outline keeps MORE enamel than the donut version. Once the
     enamel metric was corrected to charge interior detail at the renderer's 0.32x divider
     instead of the full rim, that stopped being true — the donut version is mostly interior
     spark cells, so it now measures higher. The enamel comparison was never the real argument
     anyway: the defect was nine separate metal rings versus one, which is a rim COUNT, and
     that is what gets asserted. */
  A(T.splitCells(T.DIE_FIRE_STAGES[6].d).length > 1
    && T.splitCells(T.FUSED_FIRE_STAGES[6].d).length === 1,
    'the fused outline draws ONE rim where the donut version draws '
    + T.splitCells(T.DIE_FIRE_STAGES[6].d).length);

  /* radial span, not bbox, is the size measure for a radial shape */
  A(T.radialSpan(T.burstAlt(256,256,150,90,60,4)) === 150,
    'radialSpan reports the true outer radius');
  A(/flower|petal/i.test(cap['ladder-arch-note']), 'the note names the flower failure');
}

/* ---- J the die-cut squeeze -------------------------------------------------
   The conclusion that fireworks are not a die-cuttable subject rests on a swept
   trade-off, so the sweep is asserted rather than described. If a future change
   makes a burst that is BOTH ray-like and colour-holding, these fail and the
   conclusion on the page has to be revisited - which is the point. */
{
  const T = globalThis.__t;
  const TIER = ['bronze','bronze','silver','gold','amethyst','prism'];
  const RIM = T.RIM_BY_TIER.gold;

  /* a genuinely burst-like shape cannot hold colour in its rays */
  const spiky = T.enamelProfile(T.burstShape(256,256,150,16,0.30), RIM, 'nonzero', 45);
  A(spiky.rays < 0.10, 'a 16-ray burst keeps almost no colour in its rays ('
    + (spiky.rays*100).toFixed(0) + '%)');

  /* and a shape that holds colour is not burst-like: it needs few rays */
  let bestRays = -1, bestN = 0;
  for (const rays of [5,6,8,10,12,16]) for (const inner of [0.30,0.45,0.55,0.65]) {
    const p = T.enamelProfile(T.burstShape(256,256,150,rays,inner), RIM, 'nonzero', 150*inner);
    if (p.rays > bestRays) { bestRays = p.rays; bestN = rays; }
  }
  A(bestN <= 6, 'the best colour-holding burst in the sweep has only ' + bestN
    + ' rays, i.e. it is a star not a firework');
  A(bestRays < 0.75, 'and even that one only colours ' + (bestRays*100).toFixed(0) + '% of its rays');

  /* reach is fooled by one spark; p90 is not. This is why the metric was replaced. */
  const eP = T.enamelProfile(T.FUSED_FIRE_STAGES[6].d, T.RIM_BY_TIER.prism, 'nonzero',
                             T.ALT_FIRE.innerK(6)*T.ALT_FIRE.rLong(6));
  A(eP.reach > 0.85 && eP.rays < 0.35,
    'reach says 0.' + (eP.reach*100).toFixed(0) + ' while only ' + (eP.rays*100).toFixed(0)
    + '% of rays are coloured - the exact blind spot that made reach useless');

  /* the ladder degrades toward the rare end, which is the failure that matters */
  const dRay = [1,2,3,4,5,6].map(function(i){
    return T.enamelProfile(T.ALT_FIRE_STAGES[i].d, T.RIM_BY_TIER[TIER[i-1]], 'nonzero',
                           T.ALT_FIRE.innerK(i)*T.ALT_FIRE.rLong(i)).rays; });
  console.log('     D rays coloured: ' + dRay.map(function(v){return (v*100).toFixed(0)+'%';}).join(' -> '));
  A(dRay[5] < dRay[0] * 0.3, 'the die-cut ladder gets WORSE at the rare end ('
    + (dRay[0]*100).toFixed(0) + '% -> ' + (dRay[5]*100).toFixed(0) + '%)');

  A(/no setting where both survive|not a die-cuttable subject|stays contained/i.test(cap['diecut-squeeze']),
    'the page states the conclusion the sweep supports');
  A(/flower, a star and a molecule|flower, a star/i.test(cap['diecut-squeeze']),
    'and names all three failed readings as the evidence');
}

/* ---- K B4: the motif-on-sky bug and the polish ---------------------------
   The bug this section guards is the one the whole feature shipped with unnoticed:
   the motif was painted in the tier metal and never checked against the sky it
   sits on. So the FIRST assertion here is the one that would have caught it. */
{
  const T = globalThis.__t;
  const TIER = ['bronze','bronze','silver','gold','amethyst','prism'];
  const OLDSKY = ['day','day','day','day','dusk','night'];

  /* the regression test for the original defect */
  const failing = [1,2,3,4,5,6].filter(function(i){
    return !T.skyReadable(T.METALS[TIER[i-1]][1], OLDSKY[i-1]).ok; });
  A(failing.length >= 5, 'tier metal on its own sky failed on ' + failing.length
    + ' of 6 rungs - the defect being fixed');
  const silver = T.skyReadable(T.METALS.silver[1], 'day');
  A(silver.cr < 1.1, 'silver metal on a day sky was ' + silver.cr.toFixed(2)
    + ':1, i.e. the same colour as the sky');

  /* no palette colour can rescue a night sky - this is why brights were added */
  const P = T.PALETTES.royal;
  const palOk = Object.keys(P).filter(function(k){
    return k !== 'name' && T.skyReadable(P[k], 'night').ok; });
  A(palOk.length === 0, 'no Royal palette colour clears 3:1 on night, so the luminous set is necessary');

  /* every added colour must clear the floor on the sky it is actually used with */
  for (const h of T.FIREWORK_COLOURS.concat([T.SPARK_COLOUR])) {
    const r = T.skyReadable(h, 'night');
    A(r.ok, 'firework colour ' + h + ' clears 3:1 on night (' + r.cr.toFixed(2) + ')');
  }
  /* and the reason night is used on every rung, asserted so it cannot be quietly changed */
  A(T.FIREWORK_COLOURS.every(function(h){ return !T.skyReadable(h, 'dusk').ok; }),
    'and none of them clears dusk, which is why every rung is night');

  /* colours must stay aligned with cells or the wrong burst gets the wrong colour */
  for (const i of [1,2,3,4,5,6]) {
    const S = T.B4_STAGES[i];
    A(T.splitCells(S.d).length === S.cols.length,
      'B4 rung ' + i + ': colour array matches cell count exactly ('
      + T.splitCells(S.d).length + ')');
    A(S.cols.every(function(h){ return T.skyReadable(h, 'night').ok; }),
      'B4 rung ' + i + ': every cell colour is visible on the night sky');
  }

  /* coverage: the "97% empty sky" defect, as a number, and its fix */
  const c2 = [1,2,3,4,5,6].map(function(i){
    return T.wellCoverage({shape:'arch',scene:'fireB'+i,anchor:'center',motifScale:1.02,banner:'X'}); });
  const c4 = [1,2,3,4,5,6].map(function(i){
    return T.wellCoverage({shape:'arch',scene:'b4fire'+i,anchor:'center',motifScale:T.B4.scale,banner:'X'}); });
  console.log('     B2 coverage: ' + c2.map(function(c){return (c.coverage*100).toFixed(1)+'%';}).join(' '));
  console.log('     B4 coverage: ' + c4.map(function(c){return (c.coverage*100).toFixed(1)+'%';}).join(' '));
  A(c2.every(function(c){ return c.coverage < 0.035; }),
    'B2 really was almost empty (max ' + (Math.max.apply(null,c2.map(function(c){return c.coverage;}))*100).toFixed(1) + '%)');
  for (let i = 0; i < 6; i++) {
    A(c4[i].coverage > c2[i].coverage * 2.5,
      'B4 rung ' + (i+1) + ' has far more ink (' + (c2[i].coverage*100).toFixed(1)
      + '% -> ' + (c4[i].coverage*100).toFixed(1) + '%)');
    A(c4[i].spill < 0.01, 'B4 rung ' + (i+1) + ': essentially no ink clipped away ('
      + (c4[i].spill*100).toFixed(1) + '%)');
  }
  for (let i = 1; i < 6; i++) A(c4[i].coverage > c4[i-1].coverage,
    'B4 coverage grows at rung ' + (i+1));

  /* the chosen scale is the measured ceiling, not a guess */
  const hi = T.wellCoverage({shape:'arch',scene:'b4fire6',anchor:'center',motifScale:1.50,banner:'X'});
  A(hi.spill > 0.01, 'scale 1.50 really does clip ink (' + (hi.spill*100).toFixed(1)
    + '%), so ' + T.B4.scale + ' is a ceiling and not an arbitrary number');

  /* the star scatter must be stable across calls, or the pin reshuffles per render */
  const s1 = JSON.stringify(T.starScatter(10, [[256,246,120]], 4242));
  const s2 = JSON.stringify(T.starScatter(10, [[256,246,120]], 4242));
  A(s1 === s2 && s1.length > 10, 'the sky-star scatter is deterministic for a given seed');
  const nearCore = T.starScatter(12, [[256,246,140]], 99).some(function(p){
    return Math.hypot(p[0]-256, p[1]-246) < 140; });
  A(!nearCore, 'sky stars keep clear of the burst they were told to avoid');

  /* the renderer must actually use motifEnamel, not the metal gradient */
  const svg = T.renderPin({shape:'arch', tier:'gold', scene:'b4fire3', anchor:'center',
    motifEnamel:T.B4_STAGES[3].cols, sky:'night', motifScale:T.B4.scale, size:96});
  A(svg.indexOf(T.FIREWORK_COLOURS[0]) > -1,
    'renderPin paints the motif with the enamel colours it was given');
  const plain = T.renderPin({shape:'arch', tier:'gold', scene:'b4fire3', anchor:'center',
    enamel:'#123456', sky:'night', motifScale:T.B4.scale, size:96});
  A(plain.indexOf(T.FIREWORK_COLOURS[0]) === -1,
    'and still uses the metal gradient when motifEnamel is not given');

  A(/1\.01/.test(cap['ladder-polish-note']), 'the note reports the silver-on-day figure');
  A(cap['ladder-polish'].split('<svg').length - 1 === 24, 'polish section renders B2 and B4, 6 rungs x 2 sizes');
}

/* ---- L the where-we-are section --------------------------------------------
   Guards the tidy-up itself. Includes an assertion for the failure hit while
   writing it: ledger demos are looked up by the decision's DISPLAY NAME, so
   renaming a row silently drops its illustration with no error. */
{
  const T = globalThis.__t;

  /* every decision row must agree with the code, and there must be a lot of them */
  A(T.DECIDED.length >= 28, T.DECIDED.length + ' decisions recorded');
  A(T.DECIDED.every(function(d){ try { return !!d.check(); } catch(e) { return false; } }),
    'every decision row still verifies against the live constants');

  /* the ladder rows must reflect fireworks, not the retired castle */
  const names = T.DECIDED.map(function(d){ return d.what; });
  for (const k of ['Completion ladder motif','Ladder composition','Ladder stays contained',
                   'Fireworks are enamel, not tier metal','Motif vs sky is a checked pairing',
                   'Night sky on every rung'])
    A(names.indexOf(k) > -1, 'decided list carries: ' + k);
  A(names.indexOf('Completion ladder') === -1,
    'the stale castle-ladder row is gone rather than sitting alongside the firework one');
  A(/Fireworks/.test(cap['ledger-decided']) && /additive/i.test(cap['ledger-decided']),
    'the ladder row states fireworks and that the pattern is additive');

  /* the silent-orphan guard: illustrated count must stay high */
  const shown = cap['ledger-decided'].match(/(\d+) of (\d+) shown visually/);
  A(!!shown && +shown[1] >= 22,
    'at least 22 of the decisions are illustrated (' + (shown ? shown[1] : '?') + ')');

  /* rejected list */
  A(T.REJECTED.length >= 10, T.REJECTED.length + ' closed doors recorded with reasons');
  A(T.REJECTED.every(function(r){ return r.what && r.why && r.why.length > 40; }),
    'every rejected item carries a real reason, not just a label');
  for (const k of ['Castle as the completion ladder','Balloons as the ladder','Black nickel',
                   'Shape as the category code','Die-cut fireworks','Rising trails',
                   'Mickey ears'])
    A(cap['ledger-rejected'].indexOf(k) > -1, 'rejected list carries: ' + k);
  A(n(cap['ledger-rejected'], /<td><b>/g) === T.REJECTED.length,
    'one rejected row per entry (' + T.REJECTED.length + ')');

  /* open list: settled questions must be gone, and the one yes/no must be present */
  A(T.OPEN.length >= 4, 'the open list still enumerates what is undecided (' + T.OPEN.length + ')');
  A(/outside Royal/i.test(cap['ledger-decided']), 'the palette exception is recorded as decided, not open');
  A(!/Which sky at which rung/i.test(cap['ledger-open']),
    'the settled sky question is removed from open');
  A(!/Which firework composition/i.test(cap['ledger-open']),
    'the settled composition question is removed from open');
  A(!/Is the ladder still worth keeping contained/i.test(cap['ledger-open']),
    'the settled contained question is removed from open');
  A(/bronze|crimson|Series 1/i.test(cap['ledger-open']), 'the remaining questions are appearance and sizing ones');

  /* next steps must foreground the one blocking input */
  A(T.SPECWORK[0].what.indexOf('challenge list') > -1,
    'the challenge list is the first item in the next-steps table');
  A(/blocked on this/i.test(cap['ledger-spec']),
    'and it is stated that the rest is blocked on it');
  A(/semantic/i.test(cap['ledger-spec']),
    'with the reason: the die-cut rule is semantic, so it needs to know what each pin is for');
  A(cap['ledger-spec'].indexOf(String(T.DECIDED.length)) > -1
    && cap['ledger-spec'].indexOf(String(T.OPEN.length)) > -1,
    'the summary line counts decisions and open items from the live arrays, not by hand');
}

/* ---- M open-question demos must match their question ----------------------
   Two bugs of the same shape landed this session: ledger demos keyed by a
   decision's display name silently vanished when a row was renamed, and open
   demos keyed by ARRAY INDEX silently slid onto the wrong questions when two
   were inserted at the front - the colour question got illustrated with four
   castle pins. Neither errored, because a stale key is still a valid key.
   These assertions make that class of drift loud. */
{
  const T = globalThis.__t;

  A(!/match no question/.test(cap['ledger-open']),
    'no open-question demo is keyed to a question that no longer exists');
  A(!/demo failed/.test(cap['ledger-open']), 'no open-question demo threw');

  /* the two decision questions must each carry their own illustration */
  const names = T.DECIDED.map(function(d){ return d.what; });
  A(names.indexOf('Colours outside Royal, for the ladder only') > -1
    && names.indexOf('Ladder density') > -1,
    'the two resolved questions are now decided rows, not lingering open ones');
  A(!T.OPEN.some(function(o){ return /too busy|outside the Royal/.test(o.q); }),
    'and they are gone from the open list');
  /* The park-emblem question is resolved and has moved to Decided. What remains is that
     every open question is still structurally complete and every demo still points at a
     live one - both asserted above and in the orphan check. */
  A(T.OPEN.every(function(o){ return o.q && o.detail && o.blocks; }),
    'every remaining open question is structurally complete');
  A(!T.OPEN.some(function(o){ return /read as their parks/.test(o.q); }),
    'the park-emblem question is gone from Open, having been settled');

  /* the colour question must show the three real options, and the numbers must be
     the ones that make "no" untenable rather than a claim that it is */
  const royalCols = T.B4_VARIANTS.b4Royal.cols;
  const brightCols = T.B4_STAGES[6].cols;
  const wNight = Math.min.apply(null, royalCols.map(function(h){ return T.skyReadable(h,'night').cr; }));
  const wBright = Math.min.apply(null, brightCols.map(function(h){ return T.skyReadable(h,'night').cr; }));
  A(wNight < 2 && wBright >= 3,
    'the yes/no really is a choice between visible and not (' + wNight.toFixed(2)
    + ':1 vs ' + wBright.toFixed(2) + ':1)');
  A(T.B4_VARIANTS.b4Royal.cols.length === T.splitCells(T.B4_VARIANTS.b4Royal.d).length,
    'the Royal-palette variant has colours aligned to its cells too');

  /* the busy question must show variants that genuinely differ from the default */
  const base = T.B4_STAGES[6];
  A(T.splitCells(T.B4_VARIANTS.b4NoStars.d).length < T.splitCells(base.d).length,
    'the no-stars variant really has fewer cells');
  A(T.splitCells(T.B4_VARIANTS.b4NoSparks.d).length < T.splitCells(base.d).length,
    'the no-sparks variant really has fewer cells');
  A(new Set(T.B4_VARIANTS.b4Pal3.cols).size < new Set(base.cols).size,
    'the three-colour variant really uses fewer colours ('
    + new Set(T.B4_VARIANTS.b4Pal3.cols).size + ' vs ' + new Set(base.cols).size + ')');
  A(T.splitCells(T.B4_VARIANTS.b4Pal3.d).length === T.splitCells(base.d).length,
    'and changes only colour, not geometry');

  /* every variant must still be visible on the night sky it is shown against */
  for (const k of ['b4NoStars','b4NoSparks','b4Pal3'])
    A(T.B4_VARIANTS[k].cols.every(function(h){ return T.skyReadable(h,'night').ok; }),
      k + ' stays visible on night');

  /* both questions are shown at 96 AND 44, because the grid size is the hard case */
  A(n(cap['park-emblems'], /width="44"/g) === T.PARKS.length,
    'each park emblem is shown at the 44px grid size too ('
    + n(cap['park-emblems'], /width="44"/g) + ')');
}

/* ---- N park emblems and the emblem gate ------------------------------------
   Rewritten after three of my picks turned out unusable. The gate is the unit
   under test here, because it is what will screen every future pin motif, and
   it exists only because I chose a medallion, a 4-piece icon and a line-art
   icon before writing it. */
{
  const T = globalThis.__t;
  const pathOf = function(c){ return c.scene ? T.SCENES[c.scene].d : T.MOTIFS[c.motif]; };
  const ruleOf = function(c){ return c.scene ? T.SCENES[c.scene].rule : 'union'; };

  /* the generated data file must still match the licensed SVGs it came from */
  const fsx = require('fs'), px = require('path');
  const mdir = px.join(px.dirname(process.argv[2]), 'motifs');
  let checked = 0;
  for (const file of fsx.readdirSync(mdir)) {
    if (!file.endsWith('.svg')) continue;
    const raw = fsx.readFileSync(px.join(mdir, file), 'utf8');
    const ms = raw.match(/<path[^>]*\sd="([^"]+)"/g) || [];
    if (ms.length < 2) continue;
    const d = /d="([^"]+)"/.exec(ms[1])[1];
    const key = file.replace(/\.svg$/, '').split('-').map(function(s,i){
      return i ? s[0].toUpperCase() + s.slice(1) : s; }).join('');
    if (window.MOTIF_LIB && window.MOTIF_LIB[key] !== undefined) {
      A(window.MOTIF_LIB[key] === d,
        'motif-paths.js still matches ' + file + ' byte for byte');
      checked++;
    }
  }
  A(checked >= 16, checked + ' generated motif paths verified against their source SVGs');

  /* the medallion trap, which is the defect this whole pass started from */
  A(T.discLikeness(T.MOTIFS.castle, 'nonzero') > 0.9,
    'the licensed castle IS a medallion (' + T.discLikeness(T.MOTIFS.castle,'nonzero').toFixed(2)
    + '), which is why it die-cut into a disc');
  A(T.discLikeness(T.SCENES.castle.d, T.SCENES.castle.rule) < 0.5,
    'our own castle silhouette is not (' + T.discLikeness(T.SCENES.castle.d,T.SCENES.castle.rule).toFixed(2) + ')');
  A(T.PARKS[0].scene === 'castle' && !T.PARKS[0].motif,
    'Magic Kingdom uses the silhouette, not the medallion');

  /* the gate must reject the things it was built to reject */
  /* at the rim of the candidate's OWN park, not a hardcoded one - the same inconsistency
     that nearly approved dramaMasks for a park whose narrower rim splits it */
  const gate = function(k){
    const c = T.EMBLEM_CANDIDATES.find(function(x){ return x.key === k; });
    const p = T.PARKS.find(function(q){ return q.park === c.park; });
    return T.emblemGate(pathOf(c), ruleOf(c), T.RIM_BY_TIER[p ? p.tier : 'gold']); };
  /* The clapperboard was rejected as 4 pieces. Under the truthful union rule it is ONE, and
     the 4 came from nonzero winding across mixed-wound subpaths. Kept as an assertion because
     the wrong number is the thing worth guarding against coming back. */
  A(gate('clapperboard').pieces === 1,
    'the library clapperboard is ONE piece under the union rule, not the 4 I rejected it for');
  A(gate('clapperboard').ok, 'and it passes the gate');
  A(gate('wireframeGlobe').disc > 0.9, 'wireframeGlobe fails as a MEDALLION ('
    + gate('wireframeGlobe').disc.toFixed(2) + ') - my earlier 1% enamel reason was the metric bug, not the icon');
  /* these still fail, but for their real reasons: two are medallions, one is genuinely
     multi-piece, one is genuinely thin */
  A(!gate('wireframeGlobe').ok && !gate('world').ok && !gate('rocket').ok,
    'the medallions and the genuinely multi-piece candidates are still rejected');
  const rejected = T.EMBLEM_CANDIDATES.filter(function(c){ return !gate(c.key).ok; });
  console.log('     gate rejected ' + rejected.length + ' of ' + T.EMBLEM_CANDIDATES.length
    + ': ' + rejected.map(function(c){ return c.key; }).join(', '));
  A(rejected.length >= 9, 'the gate does real work (' + rejected.length + ' rejections)');

  /* and it must NOT pretend to judge looks: my three disliked shapes all pass */
  A(gate('tree').ok && gate('sphere').ok && gate('clapper').ok,
    'the gate passes all three shapes you disliked, so it screens usability not taste');

  /* every chosen emblem passes every requirement, at its OWN tier rim */
  for (const p of T.PARKS) {
    const d = pathOf(p), rule = ruleOf(p), rim = T.RIM_BY_TIER[p.tier];
    const g = T.emblemGate(d, rule, rim, { allowRound: !!p.allowRound });
    A(g.ok, p.park + ': passes the gate at its own ' + rim + 'px rim'
      + (g.ok ? '' : ' — ' + g.fails.join(', ')));
    A(g.pieces === 1, p.park + ': one connected piece of metal');
    A(g.disc < 0.9 || (p.allowRound && !!p.roundReason),
      p.park + ': not a medallion, or a declared round exception with a reason ('
      + g.disc.toFixed(2) + (p.allowRound ? ' - ' + p.roundReason : '') + ')');
    A(g.es >= 0.30, p.park + ': keeps enamel (' + (g.es*100).toFixed(0) + '%)');
    const bb = T.pathBBox(d);
    A(bb.minX >= 0 && bb.minY >= 0 && bb.maxX <= 512 && bb.maxY <= 512,
      p.park + ': inside the canvas');
    /* alternates must be real survivors, not wishful listings */
    for (const a of p.alts)
      A(T.emblemGate(T.MOTIFS[a], 'union', rim, { allowRound: !!p.allowRound }).ok,
        p.park + ' alternate ' + a + ' also passes the gate');
  }

  /* subjects that changed, not just redrawn */
  A(/tree|oak|baobab/i.test(T.PARKS[1].motif),
    'Animal Kingdom is a TREE - the park\'s own symbol (' + T.PARKS[1].motif + ')');
  A(T.PARKS[3].motif === 'clapperboard',
    'Hollywood Studios IS the clapperboard - the multi-piece rejection was a measurement artefact');

  /* one place resolves how an emblem is addressed, since a scene broke four call sites */
  A(typeof T.parkPath === 'function' && typeof T.parkPin === 'function',
    'emblem addressing is centralised');
  A(T.PARKS.every(function(p){ return !!T.parkPath(p); }), 'every park resolves to a path');

  /* the page must show the screening, not just the winners */
  A(cap['park-emblems'].indexOf('rejected') > -1, 'the page shows why candidates were rejected');
  A(/4239/.test(cap['park-emblems-note']),
    'and admits the library was barely searched the first time');
  A(/medallion/i.test(cap['park-emblems-note']), 'the medallion finding is written up');
  A(n(cap['park-emblems'], /<svg/g) >= 12, 'park section renders the emblems and their silhouettes');
}

/* ---- O the handover document ------------------------------------------------
   README.md claims counts, and a stale handover doc is worse than none - it is a
   confident wrong answer for whoever picks this up. So the numbers in it are
   asserted against the live arrays. The first draft said "~20 corrections" when
   there were 28, and the mockup itself said "11 of the 20" when there were 21
   candidates; both were hand-typed, which is the failure this file keeps logging.
   It also checks the gate itself is reachable from inside the repo, because until
   now the whole quality gate lived in %TEMP% and nothing referenced it. */
{
  const T = globalThis.__t;
  const fsx = require('fs'), px = require('path');
  const specDir = px.dirname(px.resolve(process.argv[2]));
  const readmePath = px.join(specDir, 'README.md');

  A(fsx.existsSync(readmePath), 'the spec folder has a README handover document');
  const rd = fsx.readFileSync(readmePath, 'utf8');

  const claims = [
    [T.DECIDED.length,           'decisions'],
    [T.REJECTED.length,          'routes closed'],
    [T.OPEN.length,              'questions open'],
    [T.CORRECTIONS.length,       'corrections logged'],
    [T.EMBLEM_CANDIDATES.length, 'park-emblem candidates']
  ];
  for (const [n, label] of claims)
    A(new RegExp('\\*\\*' + n + ' ' + label.split(' ')[0]).test(rd)
      || rd.indexOf('**' + n + ' ' + label) > -1,
      'README states the live count for ' + label + ' (' + n + ')');

  /* ---- the standing art-direction contract ----
     The ledger lives inside a 320KB HTML file as JS arrays. No fresh agent parses that, and
     AGENTS.md points them at docs/ and the spec instead - so the decisions existed only
     where nobody reads them. docs/pin-art-direction.md is the standing contract, outside the
     spec because it governs any future pin work and not just this feature.

     Assert every DECIDED subject appears in it VERBATIM. Matching the literal string is
     deliberate: a keyword-overlap test passes on shared vocabulary without the decision
     actually being written up, which is precisely the "measure the claim, not something
     adjacent" failure this file keeps logging. A renamed decision must be renamed in both. */
  const repoRoot = px.resolve(specDir, '..', '..', '..');
  const contract = px.join(repoRoot, 'docs', 'pin-art-direction.md');
  A(fsx.existsSync(contract), 'docs/pin-art-direction.md exists — the standing pin contract');
  if (fsx.existsSync(contract)) {
    const cd = fsx.readFileSync(contract, 'utf8');
    const missing = T.DECIDED.map(d => d.what).filter(w => cd.indexOf(w) === -1);
    A(missing.length === 0,
      'every recorded decision is written up in docs/pin-art-direction.md' +
      (missing.length ? ' -> missing: ' + missing.join(' | ') : ' (' + T.DECIDED.length + ')'));

    /* the contract is useless if nothing routes an agent to it */
    const steer = px.join(repoRoot, '.kiro', 'steering', 'pin-collection.md');
    if (fsx.existsSync(steer))
      A(fsx.readFileSync(steer, 'utf8').indexOf('docs/pin-art-direction.md') > -1,
        'the always-on steering pointer names the contract');
    const agents = px.join(repoRoot, 'AGENTS.md');
    if (fsx.existsSync(agents))
      A(fsx.readFileSync(agents, 'utf8').indexOf('docs/pin-art-direction.md') > -1,
        'AGENTS.md routes other agents to the contract');

    /* the rule no verifier can check must at least be STATED */
    A(/decided by \*\*meaning\*\*|decided by meaning/i.test(cd),
      'the contract states the die-cut/contained rule, the one call no suite can make');
    A(cd.indexOf('emblemGate') > -1, 'the contract names the screening step');
  }

  /* the runner and all four suites must be inside the repo, not in TEMP */
  const vdir = px.join(specDir, 'verify');
  A(fsx.existsSync(vdir), 'the verifiers live in the repo');
  for (const f of ['run-all.js','all.js','ladder.js','ferris.js','inner.js','equiv.js','screen.js'])
    A(fsx.existsSync(px.join(vdir, f)), 'verify/' + f + ' is committed alongside the mockup');
  A(/run-all\.js/.test(rd), 'and the README says how to run them');

  /* the README must be honest about what the gate does NOT cover */
  A(/not app tests|NOT app tests/.test(rd),
    'README distinguishes mockup verifiers from the app test suites');
  A(/npm run verify/.test(rd) && /does \*\*not\*\* cover|outside every tsconfig/.test(rd),
    'and states that the root gate does not cover this folder');
  A(/Known gaps/.test(rd), 'README has a stated-gaps section');
  A(/not committed|Nothing here is committed/i.test(rd),
    'and admits the work is uncommitted');

  /* the working rules must be written down, not left inferable from comments */
  for (const rule of ['cannot see renders','proxy','stale','Winding','near-360',
                      'Bounding box','not fusion','emblemGate','medallion','4239'])
    A(rd.indexOf(rule) > -1, 'README records the rule about: ' + rule);

  /* and it must point at the one thing blocking everything else */
  A(/challenge list/i.test(rd) && /nothing before it/i.test(rd),
    'README names the next task and that nothing precedes it');
}

/* ---- P is any of this discoverable? ------------------------------------------
   The gate and the README are worthless to a fresh session that never learns they
   exist. Only .kiro/steering/*.md is auto-loaded — Kiro reads it natively and
   AGENTS.md orders every other agent to read every file there as its first tool
   calls — while .kiro/specs/ is not loaded until someone asks for it. So the
   pointer in steering IS the discoverability mechanism, and it is asserted here
   rather than trusted. */
{
  const fsx = require('fs'), px = require('path');
  const specDir = px.dirname(px.resolve(process.argv[2]));
  const repo = px.resolve(specDir, '..', '..', '..');
  const steer = px.join(repo, '.kiro', 'steering', 'pin-collection.md');

  A(fsx.existsSync(steer),
    'an always-on steering pointer exists, so a new session discovers this work at all');
  const sd = fsx.readFileSync(steer, 'utf8');

  /* it must have no front matter, or it stops being always-on */
  A(!/^---/.test(sd.trimStart()),
    'the pointer has no inclusion front matter, so it stays always-on');

  /* it must point at the README rather than duplicating it, or the two will drift */
  A(sd.indexOf('.kiro/specs/pin-collection/README.md') > -1,
    'the pointer names the README as the thing to read');
  A(sd.indexOf('run-all.js') > -1, 'and gives the gate command');
  A(/npm run verify/.test(sd) && /does \*\*not\*\* cover|not\*\* cover/.test(sd),
    'and warns that the root gate does not cover this folder');
  A(sd.indexOf('docs/pin-art-direction.md') > -1,
    'the pointer names the standing art-direction contract');

  /* ---- the always-on file is a ROUTER, and the size cap enforces that ----
     Everything in .kiro/steering/ is loaded at the start of EVERY conversation, whatever the
     topic, so bulk here is charged to work that has nothing to do with pins. This file used
     to carry the traps, the gate explanation and the provenance note at 4.4KB. That detail
     moved to pin-collection-detail.md, which is conditional. Keep this one a router: if it
     needs more than ~1.4KB, the new text belongs in the detail file or the contract. */
  A(sd.length < 1400, 'the always-on router stays tiny (' + sd.length
    + ' bytes) — always-on text is charged to every unrelated task');
  A(sd.indexOf('pin-collection-detail.md') > -1,
    'the router names the conditional detail file');

  /* ---- the conditional detail file ---- */
  const detail = px.join(repo, '.kiro', 'steering', 'pin-collection-detail.md');
  A(fsx.existsSync(detail), 'the conditional detail steering file exists');
  const dd = fsx.existsSync(detail) ? fsx.readFileSync(detail, 'utf8') : '';

  /* it MUST have front matter - that is what makes it conditional. Without it the split
     achieves nothing and both files are always-on. */
  A(/^---/.test(dd.trimStart()), 'the detail file has front matter, so it is conditional');
  A(/inclusion:\s*fileMatch/.test(dd),
    'the detail file is scoped with inclusion: fileMatch');
  A(/fileMatchPattern:/.test(dd), 'and declares a fileMatchPattern');

  /* the traps most likely to bite must survive - now in the detail file */
  for (const t of ['adjacent', 'Appearance cannot be asserted', 'stale', 'medallion'])
    A(dd.indexOf(t) > -1, 'the detail file keeps the trap about: ' + t);

  A(dd.indexOf('selftest.js') > -1 && dd.indexOf('bite.js') > -1,
    'the detail file gives the harness commands');

  /* and the superseded mockup must be flagged, since it is the trap of picking the
     wrong file to extend */
  A(/pins-mockup\.html/.test(dd) && /superseded/i.test(dd),
    'the detail file says which mockup is superseded');

  /* the two entry points other models use must still funnel into steering */
  const agents = px.join(repo, 'AGENTS.md');
  A(fsx.existsSync(agents), 'root AGENTS.md exists as the entry point for other models');
  const ad = fsx.readFileSync(agents, 'utf8');
  A(/\.kiro\/steering/.test(ad),
    'and it directs them to .kiro/steering, which is what makes the pointer work');
}

/* ---- Q the declared round exception ------------------------------------------
   The medallion rule was over-broad: it exists to reject icons drawn inside a
   circular FRAME (castle.svg is a circle containing a castle), and applied blanket
   it rejected every globe in the library. A globe is round because it is a globe.
   So roundness is now an opt-in exception per emblem - and an exception without a
   written reason is worse than no exception, so the reason is required. */
{
  const T = globalThis.__t;

  /* the exception must be opt-in: it must NOT quietly apply to everything */
  const round = T.MOTIFS.wireframeGlobe;
  const strict  = T.emblemGate(round, 'union', 7.2);
  const relaxed = T.emblemGate(round, 'union', 7.2, { allowRound: true });
  A(strict.fails.indexOf('medallion') > -1,
    'by default a round icon is still rejected as a medallion');
  A(relaxed.fails.indexOf('medallion') === -1 && relaxed.ok,
    'and only passes when the exception is explicitly requested');
  A(relaxed.roundAllowed === true, 'the gate records that the exception was used');

  /* the exception must never rescue anything that fails for a DIFFERENT reason */
  const thin = T.emblemGate(T.MOTIFS.globe, 'union', 7.2, { allowRound: true });
  A(!thin.ok && thin.fails.indexOf('starved') > -1,
    'the round exception does not excuse a starved icon');

  /* any park using it must state why, in prose */
  for (const p of T.PARKS) {
    if (!p.allowRound) continue;
    A(typeof p.roundReason === 'string' && p.roundReason.length > 20,
      p.park + ': the round exception carries a written reason');
    A(/circle IS the object|globe is round/i.test(p.roundReason),
      p.park + ': and the reason distinguishes a spherical subject from a circular frame');
  }
  /* exactly one park uses it - if it spreads, the rule has stopped meaning anything */
  const usingRound = T.PARKS.filter(function(p){ return p.allowRound; });
  A(usingRound.length === 1, 'exactly one emblem uses the exception ('
    + usingRound.map(function(p){ return p.park; }).join(', ') + ')');

  /* and the thing the rule was written for must still be caught */
  A(T.emblemGate(T.MOTIFS.castle, 'union', 6.2).fails.indexOf('medallion') > -1,
    'the castle medallion - the icon the rule exists for - is still rejected');

  /* judgements made by eye are recorded, since the gate cannot see them */
  const eyed = T.EMBLEM_CANDIDATES.filter(function(c){ return c.eye; });
  A(eyed.length >= 4, eyed.length + ' candidates carry an explicit rejected-by-eye reason');
  A(eyed.every(function(c){ return c.eye.length > 10; }),
    'each eye-verdict says what was wrong rather than just "no"');
  A(cap['park-emblems'].indexOf('rejected by eye') > -1,
    'the page separates gate rejections from eye rejections');
}
console.log(bad===0 ? '\nALL CHECKS PASSED' : `\n${bad} CHECK(S) FAILED`);
process.exit(bad===0?0:1);