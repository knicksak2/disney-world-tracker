/**
 * Seed matching and planning (pure) and the bundled `locationRules.seed.json`.
 *
 * Validates: dining-plan-calculator Requirements 8.4, 8.8 to 8.10, 18.8, 18.10; Property 40.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { diningSeedRuleSchema, type DiningSeedRule } from '@dwt/shared';

import { BUNDLED_SEED } from '../seed/bundledSeed.js';
import { normalizeSeedName, parseSeedFile, planSeed, seedFieldsOf, type SeedCatalogRow, type SeedRuleFields } from '../seed/seedRules.js';

function entry(name: string, extra: Partial<DiningSeedRule> = {}): DiningSeedRule {
  return diningSeedRuleSchema.parse({ name, serviceType: 'table_service', creditCost: 2, gratuityIncluded: false, ruleStatus: 'unverified', sourceNote: `Third party 2026-11: ${name}`, ...extra });
}
const cat = (id: string, name: string, upstreamEntityId: string | null = null): SeedCatalogRow => ({ id, name, upstreamEntityId });

describe('normalizeSeedName (Requirement 8.10)', () => {
  it.each([
    ['The BOATHOUSE', 'boathouse'],
    ['Boathouse', 'boathouse'],
    ['The BOATHOUSE®: Great Food, Waterfront Dining, Dream Boats™', 'boathouse great food waterfront dining dream boats'],
    ['Cítricos', 'citricos'],
    ['Citricos', 'citricos'],
    ["Topolino's Terrace – Flavors of the Riviera", 'topolinos terrace flavors of the riviera'],
    ["Topolino's Terrace - Flavors of the Riviera", 'topolinos terrace flavors of the riviera'],
    ['Jaleo® by José Andrés', 'jaleo by jose andres'],
    ['Theater Bistro', 'theater bistro'],
  ])('%s normalizes to "%s"', (name, key) => expect(normalizeSeedName(name)).toBe(key));
});

describe('planSeed', () => {
  it('matches by id when the entry has one, else by name or alias', () => {
    const plan = planSeed({
      entries: [entry('Akershus', { upstreamEntityId: 'u-1' }), entry('The BOATHOUSE', { aliases: ['Boathouse Dream Boats'] }), entry('Nobody')],
      catalog: [cat('a', 'Akershus Royal Banquet Hall', 'u-1'), cat('b', 'Boathouse'), cat('c', 'Akershus')],
      stored: new Map(),
    });
    expect(plan.results.map((r) => [r.name, r.outcome, r.experienceId])).toEqual([['Akershus', 'inserted', 'a'], ['The BOATHOUSE', 'inserted', 'b'], ['Nobody', 'unmatched', null]]);
    expect(plan.writes.map((w) => [w.experienceId, w.insert])).toEqual([['a', true], ['b', true]]);
  });

  it('reports colliding names as ambiguous and writes neither', () => {
    const plan = planSeed({ entries: [entry('Twin One')], catalog: [cat('x', 'Twin One'), cat('y', 'Twin, One!')], stored: new Map() });
    expect(plan.results[0]).toMatchObject({ outcome: 'ambiguous', experienceId: null });
    expect(plan.results[0]!.reason).toContain('Twin One; Twin, One!');
    expect(plan.writes).toEqual([]);
  });

  it('applies one entry per Experience: the one with an id wins, else the later one, and the other is ambiguous', () => {
    const withId = planSeed({ entries: [entry('Grill', { upstreamEntityId: 'u-9' }), entry('Grill', { creditCost: 1 })], catalog: [cat('g', 'Grill', 'u-9')], stored: new Map() });
    expect(withId.results.map((r) => r.outcome)).toEqual(['inserted', 'ambiguous']);
    expect(withId.writes).toEqual([{ experienceId: 'g', fields: seedFieldsOf(entry('Grill', { upstreamEntityId: 'u-9' })), insert: true }]);
    const later = planSeed({ entries: [entry('Grill'), entry('Grill', { aliases: ['Other Name'], creditCost: 1 })], catalog: [cat('g', 'Grill')], stored: new Map() });
    expect(later.results.map((r) => r.outcome)).toEqual(['ambiguous', 'inserted']);
    expect(later.writes[0]!.fields.creditCost).toBe(1);
  });

  // Feature: dining-plan-calculator, Property 40: The seed is consistent, never downgrades, and reports what it skipped
  it('Property 40: never downgrades a verified rule, and a second run over the result plans no write', () => {
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const entryArb = fc.record({
      name: fc.constantFrom(...names, 'Missing'),
      verified: fc.boolean(),
      cost: fc.constantFrom<1 | 2>(1, 2),
      withId: fc.boolean(),
    });
    const storedArb = fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.record({ verified: fc.boolean(), cost: fc.constantFrom<1 | 2>(1, 2) }));
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 6 }), storedArb, (raw, storedRaw) => {
        const catalog = names.map((n, i) => cat('abcd'[i]!, n, `u-${i}`));
        const entries = raw.map((e) =>
          entry(e.name, {
            creditCost: e.cost,
            ruleStatus: e.verified ? 'verified' : 'unverified',
            ...(e.verified ? { verifiedAt: '2026-07-20' } : {}),
            ...(e.withId && e.name !== 'Missing' ? { upstreamEntityId: `u-${names.indexOf(e.name)}` } : {}),
          }),
        );
        const stored = new Map<string, SeedRuleFields>(
          Object.entries(storedRaw).map(([id, s]) => [id, { serviceType: 'table_service', creditCost: s.cost, creditCostByPeriod: null, gratuityIncluded: false, ruleStatus: s.verified ? 'verified' : 'unverified', verifiedAt: s.verified ? '2026-01-01' : null, sourceNote: 'operator' }]),
        );
        const first = planSeed({ entries, catalog, stored });
        // Never a write that replaces a verified rule with an unverified one; at most one write per Experience.
        for (const w of first.writes) {
          expect(stored.get(w.experienceId)?.ruleStatus === 'verified' && w.fields.ruleStatus === 'unverified').toBe(false);
        }
        expect(new Set(first.writes.map((w) => w.experienceId)).size).toBe(first.writes.length);
        // Every entry gets exactly one outcome; unmatched and ambiguous ones name no write.
        expect(first.results).toHaveLength(entries.length);
        const after = new Map(stored);
        for (const w of first.writes) after.set(w.experienceId, w.fields);
        const second = planSeed({ entries, catalog, stored: after });
        expect(second.writes).toEqual([]);
        expect(second.results.map((r) => r.outcome).filter((o) => o === 'inserted' || o === 'updated')).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

describe('the bundled seed file (Requirements 8.4, 8.8, 8.9)', () => {
  const parsed = parseSeedFile(BUNDLED_SEED);
  const entries = parsed.ok ? parsed.entries : [];
  /** The three Disney statements the design names as verification sources. */
  const DISNEY_SOURCES = ['Disney Dining Plans page 2026-11-09', 'planDisney 2026-07-20', 'planDisney 2026-04-05'];
  const citesDisney = (note: string) => DISNEY_SOURCES.some((s) => note.includes(s));

  it('parses, and every entry passes the rule schema', () => {
    expect(parsed).toMatchObject({ ok: true });
    expect(entries).toHaveLength(31);
    expect(new Set(entries.map((e) => normalizeSeedName(e.name))).size).toBe(entries.length);
  });

  it('marks verified exactly the 19 entries a current Disney statement names, each citing it', () => {
    const verified = entries.filter((e) => e.ruleStatus === 'verified');
    expect(verified.map((e) => e.name)).toEqual([
      "Cinderella's Royal Table", 'Be Our Guest Restaurant', 'Akershus Royal Banquet Hall', 'Le Cellier Steakhouse', 'The Hollywood Brown Derby',
      'Tiffins Restaurant', 'The BOATHOUSE', 'Jaleo by José Andrés', 'Morimoto Asia', 'Paddlefish', 'Cítricos', "Narcoossee's",
      'Story Book Dining at Artist Point with Snow White', 'Hoop-Dee-Doo Musical Revue', 'Jiko - The Cooking Place',
      "Topolino's Terrace - Flavors of the Riviera", 'Flying Fish', 'Yachtsman Steakhouse', "Private Dining at Disney's Grand Floridian Resort & Spa",
    ]);
    for (const e of entries) expect(citesDisney(e.sourceNote), e.name).toBe(e.ruleStatus === 'verified');
  });

  it('records the per-period costs, the included gratuities and the not-eligible list', () => {
    const by = new Map(entries.map((e) => [e.name, e]));
    expect(by.get('Akershus Royal Banquet Hall')).toMatchObject({ creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 } });
    expect(by.get('Morimoto Asia')).toMatchObject({ creditCost: 1, creditCostByPeriod: { dinner: 2 } });
    expect(by.get("Topolino's Terrace - Flavors of the Riviera")).toMatchObject({ creditCost: 1, creditCostByPeriod: { dinner: 2 } });
    expect(entries.filter((e) => e.gratuityIncluded).map((e) => e.name)).toEqual(["Cinderella's Royal Table", 'Hoop-Dee-Doo Musical Revue', "Private Dining at Disney's Grand Floridian Resort & Spa"]);
    expect(entries.filter((e) => e.serviceType === 'not_eligible').map((e) => e.name)).toEqual([
      'California Grill', "Victoria & Albert's", 'Takumi-Tei', 'Space 220', 'La Cava del Tequila', 'The Cake Bake Shop', 'Summer House on the Lake',
      'Wolfgang Puck Bar & Grill', 'Wine Bar George', 'STK Orlando',
    ]);
    expect(by.get("Victoria & Albert's")!.aliases).toEqual(expect.arrayContaining(["Chef's Table at Victoria & Albert's", "Queen Victoria's Room"]));
    for (const name of ['Cape Town Lounge and Wine Bar', 'Toledo - Tapas, Steak & Seafood']) expect(by.get(name)).toMatchObject({ serviceType: 'table_service', creditCost: 2, ruleStatus: 'unverified' });
  });

  it('names each catalog restaurant once, by its catalog upstream id', () => {
    const ids = entries.map((e) => e.upstreamEntityId);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
