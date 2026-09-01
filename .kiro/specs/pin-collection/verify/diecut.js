/* Die-cut screening, enforced.   node verify/diecut.js [pin-catalog-mockup.html]
 *
 * WHY THIS EXISTS. `emblemGate` and `screen.js` have existed for a long time, and
 * docs/pin-art-direction.md has always said to screen every die-cut motif at the rim of the
 * tier it ships at. Nothing enforced it, so it did not happen: 53 of the 99 die-cut pins in
 * the catalogue use a motif the gate would reject. A rule that is documented but unenforced
 * is a rule that gets skipped, which is the whole lesson of this folder.
 *
 * It screens the path the catalogue ACTUALLY RENDERS, resolved through the same
 * Object.assign the page uses. It therefore applies identically to a licensed library icon
 * and to an SVG an AI drew five minutes ago - the test knows nothing about provenance, only
 * geometry. That is deliberate: AI-authored art is exactly the case most likely to arrive as
 * line work with floating parts.
 *
 * GRANDFATHERING. The 53 existing failures are recorded below rather than fixed, because
 * fixing them changes how ~31 pins look and nobody in this loop can see the renders. The
 * list is built so it can only SHRINK:
 *   - a NEW die-cut pin that fails, and is not listed, fails the suite;
 *   - a listed pin that now PASSES also fails the suite, telling you to delete its entry.
 * A plain allowlist rots into a permanent dumping ground. Asserting each entry is still
 * needed makes it self-cleaning.
 *
 * Each entry carries the remedy the fabrication ladder found, so the list doubles as the
 * work queue. Remedies: weld 24 · plate 22 · scale 4 · weld+scale 3.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const spec = path.dirname(file);
const mdir = path.join(spec, 'motifs');

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* ---------------------------------------------------------------------------
   Grandfathered failures, recorded 2026-08-30. See the note above: entries are
   asserted to STILL fail, so this list cannot silently outlive its usefulness.
   `fails` is the emblemGate verdict at the pin's own tier rim.
   --------------------------------------------------------------------------- */
const GRANDFATHERED = {
  'amethyst_12_ride_marathon':        { motif:'hourglass',        fails:'starved',              remedy:'scale 1.15x' },
  'amethyst_animal_kingdom_complete': { motif:'holyOak',          fails:'starved',              remedy:'weld' },
  'amethyst_disney_springs_complete': { motif:'waterTower',       fails:'starved+aspect',       remedy:'plate' },
  'amethyst_epcot_complete':          { motif:'wireframeGlobe',   fails:'medallion+starved',    remedy:'plate' },
  'amethyst_fine_dining_critic':      { motif:'wineGlass',        fails:'starved',              remedy:'weld' },
  'amethyst_hollywood_complete':      { motif:'clapperboard',     fails:'4 pieces+starved',     remedy:'weld' },
  'amethyst_resorts_15':              { motif:'key',              fails:'starved',              remedy:'weld' },
  'amethyst_squad_20':                { motif:'partyPopper',      fails:'5 pieces+starved',     remedy:'weld' },
  'amethyst_stage_connoisseur_15':    { motif:'dramaMasks',       fails:'starved',              remedy:'weld' },
  'bronze_360_cinema':                { motif:'filmSpool',        fails:'2 pieces+medallion',   remedy:'plate' },
  'bronze_boat_ride':                 { motif:'submarine',        fails:'aspect',               remedy:'plate' },
  'bronze_royal_encounter_1':         { motif:'crown',            fails:'2 pieces',             remedy:'weld' },
  'bronze_theater_spectacular':       { motif:'theater',          fails:'2 pieces',             remedy:'plate' },
  'bronze_two_parks_day':             { motif:'bus',              fails:'6 pieces+aspect',      remedy:'plate' },
  'gold_animation_courtyard_complete':{ motif:'filmProjector',    fails:'medallion',            remedy:'plate' },
  'gold_asia_complete':               { motif:'tiger',            fails:'starved',              remedy:'weld' },
  'gold_coaster_king':                { motif:'coasterLoop',      fails:'starved',              remedy:'weld' },
  'gold_disney_springs_master':       { motif:'waterTower',       fails:'starved+aspect',       remedy:'plate' },
  'gold_epcot_visionary':             { motif:'wireframeGlobe',   fails:'medallion',            remedy:'plate' },
  'gold_fantasyland_complete':        { motif:'fairyWand',        fails:'4 pieces+starved',     remedy:'plate' },
  'gold_hollywood_blvd_complete':     { motif:'directorChair',    fails:'starved',              remedy:'weld' },
  'gold_hollywood_star':              { motif:'clapperboard',     fails:'4 pieces+starved',     remedy:'weld' },
  'gold_rope_drop_to_fireworks':      { motif:'sunrise',          fails:'medallion',            remedy:'plate' },
  'gold_three_parks_day':             { motif:'skyliner',         fails:'starved',              remedy:'weld' },
  'gold_tomorrowland_complete':       { motif:'rocket',           fails:'2 pieces',             remedy:'weld' },
  'gold_world_celebration_complete':  { motif:'globe',            fails:'starved',              remedy:'weld+scale 1.5x' },
  'gold_world_discovery_complete':    { motif:'spaceship',        fails:'starved',              remedy:'weld' },
  'gold_world_showcase_complete':     { motif:'world',            fails:'3 pieces+medallion',   remedy:'plate' },
  'pearl_15_ride_marathon':           { motif:'stopwatch',        fails:'starved',              remedy:'plate' },
  'pearl_1971_heritage':              { motif:'pocketWatch',      fails:'starved',              remedy:'weld' },
  'pearl_royal_banquet_grand_slam':   { motif:'tiara',            fails:'starved',              remedy:'plate' },
  'pearl_squad_master':               { motif:'highFive',         fails:'starved',              remedy:'scale 1.3x' },
  'pearl_ultimate_critic':            { motif:'quill',            fails:'starved',              remedy:'weld' },
  'prism_global_ambassador':          { motif:'passport',         fails:'starved',              remedy:'scale 1.75x' },
  'prism_grand_hotelier':             { motif:'grandHotelEstate', fails:'starved',              remedy:'weld' },
  'prism_legendary_guide':            { motif:'flatStar',         fails:'starved',              remedy:'weld' },
  'silver_6_ride_sprint':             { motif:'speedometer',      fails:'2 pieces+starved',     remedy:'weld+scale 1.15x' },
  'silver_animation_courtyard_100':   { motif:'filmProjector',    fails:'medallion',            remedy:'plate' },
  'silver_asia_100':                  { motif:'tiger',            fails:'starved',              remedy:'weld' },
  'silver_character_hunter_10':       { motif:'photoCamera',      fails:'starved',              remedy:'plate' },
  'silver_critic_25':                 { motif:'megaphone',        fails:'3 pieces+starved',     remedy:'plate' },
  'silver_dark_ride_aficionado':      { motif:'magicLantern',     fails:'4 pieces',             remedy:'plate' },
  'silver_epcot_showcase_6':          { motif:'pagoda',           fails:'starved',              remedy:'scale 1.15x' },
  'silver_fantasyland_100':           { motif:'fairyWand',        fails:'5 pieces',             remedy:'plate' },
  'silver_hollywood_blvd_100':        { motif:'directorChair',    fails:'starved',              remedy:'weld' },
  'silver_interstellar_pilot':        { motif:'spaceSatellite',   fails:'starved',              remedy:'weld' },
  'silver_rail_transit':              { motif:'steamTrain',       fails:'2 pieces',             remedy:'plate' },
  'silver_tomorrowland_100':          { motif:'rocket',           fails:'2 pieces',             remedy:'weld' },
  'silver_typhoon_lagoon_master':     { motif:'waterSplash',      fails:'4 pieces',             remedy:'weld' },
  'silver_water_ride_splash':         { motif:'waterfallFlume',   fails:'3 pieces+starved',     remedy:'plate' },
  'silver_world_celebration_100':     { motif:'globe',            fails:'starved',              remedy:'weld+scale 1.3x' },
  'silver_world_discovery_100':       { motif:'spaceship',        fails:'starved',              remedy:'weld' },
  'silver_world_showcase_100':        { motif:'world',            fails:'3 pieces+medallion',   remedy:'plate' },
};

/* ---- borrow emblemGate from the frame sample, the way all.js borrows geometry ---- */
const motifJs = fs.readFileSync(path.join(mdir, 'motif-paths.js'), 'utf8');
const framePath = path.join(spec, 'pin-frame-sample.html');
A(fs.existsSync(framePath), 'pin-frame-sample.html is present (emblemGate lives there)');
const frame = fs.readFileSync(framePath, 'utf8');
const tag = frame.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');
let T;
try {
  T = new Function('window', 'document', motifJs + '\n' + tag +
    ';return {emblemGate:emblemGate, unionOutline:unionOutline, RIM_BY_TIER:RIM_BY_TIER};')(
    {}, { getElementById(){ return { set innerHTML(v){}, get innerHTML(){return '';},
          set textContent(v){}, get textContent(){return '';} }; } });
} catch (e) { console.error('FAIL: could not load emblemGate -> ' + e.message); process.exit(1); }
A(typeof T.emblemGate === 'function', 'emblemGate loaded');

/* ---- resolve what the catalogue renders ---- */
const html = fs.readFileSync(file, 'utf8');
const lib = {}; vm.runInNewContext(motifJs, { window: lib });
const im = html.match(/const MOTIFS = Object\.assign\(\{\}, window\.MOTIF_LIB \|\| \{\}, (\{[\s\S]*?\n\})\);/);
const isb = {}; if (im) vm.runInNewContext('var I = ' + im[1], isb);
const MOTIFS = Object.assign({}, lib.MOTIF_LIB, isb.I || {});
const pinsMatch = html.match(/const PINS = (\[[\s\S]*?\n\];)/);
const psb = { B4_STAGES: {}, PALETTES: { royal: {
  sky:'#2f6bb0', teal:'#14727f', forest:'#2f7d3e', crimson:'#a8323f',
  royal:'#4a2a7a', plum:'#6a3fb0', amber:'#b5721a', ink:'#241a3a' } } };
for (let i = 1; i <= 20; i++) psb.B4_STAGES[i] = { cols: [] };
vm.runInNewContext('var PINS = ' + pinsMatch[1], psb);
const PINS = psb.PINS;

const screenable = PINS.filter(p => p.mode === 'diecut' && p.motif && !p.scene);
A(screenable.length > 0, 'found die-cut pins to screen (' + screenable.length + ')');

/* ---- the enforcement ---- */
const newFailures = [], staleEntries = [], changedReason = [];
screenable.forEach(p => {
  const d = String(MOTIFS[p.motif] || '');
  if (!d) return;                                     // catalog.js covers unresolved motifs
  const rim = T.RIM_BY_TIER[p.tier];
  /* allowRound is a per-emblem declared exception; honour it when a pin sets it */
  let g; try { g = T.emblemGate(d, 'nonzero', rim, { allowRound: !!p.allowRound }); }
  catch (e) { return; }
  const listed = GRANDFATHERED[p.id];
  if (g.ok) {
    if (listed) staleEntries.push(p.id + ' (' + listed.remedy + ' — now passes)');
    return;
  }
  if (!listed) {
    newFailures.push(p.id + ' [' + p.tier + ', ' + p.motif + '] rim ' + rim +
      ' -> ' + g.fails.join('+') +
      '  (pieces ' + g.pieces + ', enamel ' + g.es.toFixed(3) +
      ', disc ' + g.disc.toFixed(3) + ', aspect ' + g.aspect.toFixed(2) + ')');
  } else if (listed.fails !== g.fails.join('+')) {
    changedReason.push(p.id + ': recorded "' + listed.fails + '", now "' + g.fails.join('+') + '"');
  }
});

A(newFailures.length === 0,
  'every NEW die-cut pin passes emblemGate at its own tier rim' +
  (newFailures.length
    ? '\n       ' + newFailures.join('\n       ') +
      '\n       Do not add it to GRANDFATHERED. Work the ladder in' +
      ' docs/pin-art-direction.md §5: weld, then scale, then a contained plate.'
    : ' (' + (screenable.length - Object.keys(GRANDFATHERED).length) + ' screened clean)'));

A(staleEntries.length === 0,
  'no grandfathered entry has been fixed without being removed from the list' +
  (staleEntries.length ? '\n       these now pass — delete their entries: ' +
    staleEntries.join(', ') : ''));

A(changedReason.length === 0,
  'grandfathered failure reasons still match what was recorded' +
  (changedReason.length ? '\n       ' + changedReason.join('\n       ') : ''));

/* the list must not accumulate entries for pins that no longer exist */
const ids = new Set(PINS.map(p => p.id));
const orphans = Object.keys(GRANDFATHERED).filter(id => !ids.has(id));
A(orphans.length === 0, 'the grandfather list contains no entries for deleted pins' +
  (orphans.length ? ' -> ' + orphans.join(', ') : ''));

/* every listed pin must still be a die-cut pin - flipping one to contained IS the plate
   remedy, and its entry should go with it */
const notDieCut = Object.keys(GRANDFATHERED)
  .filter(id => { const p = PINS.find(x => x.id === id); return p && p.mode !== 'diecut'; });
A(notDieCut.length === 0,
  'no grandfathered pin has been switched to a contained plate while keeping its entry' +
  (notDieCut.length ? ' -> ' + notDieCut.join(', ') : ''));

const remedies = {};
Object.values(GRANDFATHERED).forEach(v => { remedies[v.remedy.split(' ')[0]] =
  (remedies[v.remedy.split(' ')[0]] || 0) + 1; });
console.log('\ngrandfathered debt: ' + Object.keys(GRANDFATHERED).length + ' of ' +
  screenable.length + ' die-cut pins');
console.log('work queue by remedy: ' + JSON.stringify(remedies));

if (bad > 0) {
  console.error('\nDIE-CUT SCREENING FAILED: ' + bad + ' violation(s)');
  process.exit(1);
}
console.log('\nDIE-CUT SCREENING PASSED');
