// Feature: hidden-mickeys, Property 21: Experience groups (model part)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  canonicalOf,
  groupOf,
  validateAliasLinks,
  type AliasLink,
} from '../aliasGroup.js';

describe('aliasGroup domain module', () => {
  // Feature: hidden-mickeys, Property 21: Experience groups
  it('Property 21: an unlinked Experience resolves to a group of one containing only itself', () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        expect(canonicalOf(id, [])).toBe(id);
        const group = groupOf(id, []);
        expect(group).toEqual([id]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: hidden-mickeys, Property 21: Experience groups
  it('Property 21: group of an alias equals the group of its canonical, is sorted, deduplicated, and one-hop', () => {
    const aliasLinkArb = fc
      .tuple(fc.uuid(), fc.uuid())
      .filter(([a, c]) => a !== c)
      .map(([aliasId, canonicalId]): AliasLink => ({ aliasId, canonicalId }));

    fc.assert(
      fc.property(
        fc.uniqueArray(aliasLinkArb, { selector: (l) => l.aliasId, maxLength: 20 }),
        (rawLinks) => {
          // Filter to strictly valid one-hop links with no chains
          const { accepted: links } = validateAliasLinks(rawLinks, []);

          for (const link of links) {
            const canonical = canonicalOf(link.aliasId, links);
            expect(canonical).toBe(link.canonicalId);

            const aliasGroup = groupOf(link.aliasId, links);
            const canonicalGroup = groupOf(link.canonicalId, links);

            // Group of alias equals group of its canonical
            expect(aliasGroup).toEqual(canonicalGroup);

            // Group contains both alias and canonical
            expect(aliasGroup).toContain(link.aliasId);
            expect(aliasGroup).toContain(link.canonicalId);

            // Group is sorted
            const sorted = [...aliasGroup].sort();
            expect(aliasGroup).toEqual(sorted);

            // Group has no duplicates
            const unique = new Set(aliasGroup);
            expect(aliasGroup.length).toBe(unique.size);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: hidden-mickeys, Property 21: Experience groups
  it('Property 21: validateAliasLinks correctly classifies self, alias_is_canonical, canonical_is_alias, and already_linked', () => {
    const storedLinks: AliasLink[] = [
      { aliasId: 'alias-1', canonicalId: 'canon-1' },
      { aliasId: 'alias-2', canonicalId: 'canon-1' },
    ];

    // 1. Self link
    const resSelf = validateAliasLinks([{ aliasId: 'node-x', canonicalId: 'node-x' }], storedLinks);
    expect(resSelf.accepted).toHaveLength(0);
    expect(resSelf.rejected).toEqual([{ link: { aliasId: 'node-x', canonicalId: 'node-x' }, reason: 'self' }]);

    // 2. Alias is already a canonical (stored or earlier candidate)
    const resAliasIsCanonStored = validateAliasLinks(
      [{ aliasId: 'canon-1', canonicalId: 'other-canon' }],
      storedLinks,
    );
    expect(resAliasIsCanonStored.rejected).toEqual([
      { link: { aliasId: 'canon-1', canonicalId: 'other-canon' }, reason: 'alias_is_canonical' },
    ]);

    // 3. Canonical is already an alias (stored or earlier candidate)
    const resCanonIsAliasStored = validateAliasLinks(
      [{ aliasId: 'new-alias', canonicalId: 'alias-1' }],
      storedLinks,
    );
    expect(resCanonIsAliasStored.rejected).toEqual([
      { link: { aliasId: 'new-alias', canonicalId: 'alias-1' }, reason: 'canonical_is_alias' },
    ]);

    // 4. Already linked alias
    const resAlreadyLinkedStored = validateAliasLinks(
      [{ aliasId: 'alias-1', canonicalId: 'new-canon' }],
      storedLinks,
    );
    expect(resAlreadyLinkedStored.rejected).toEqual([
      { link: { aliasId: 'alias-1', canonicalId: 'new-canon' }, reason: 'already_linked' },
    ]);

    // 5. In-file candidate chain prevention (alias is canonical or canonical is alias earlier in file)
    const resChain = validateAliasLinks(
      [
        { aliasId: 'step-b', canonicalId: 'step-c' },
        { aliasId: 'step-a', canonicalId: 'step-b' }, // step-b is already an alias -> canonical_is_alias
        { aliasId: 'step-c', canonicalId: 'step-d' }, // step-c is already a canonical -> alias_is_canonical
        { aliasId: 'step-b', canonicalId: 'step-e' }, // step-b is already linked -> already_linked
      ],
      [],
    );
    expect(resChain.accepted).toEqual([{ aliasId: 'step-b', canonicalId: 'step-c' }]);
    expect(resChain.rejected).toHaveLength(3);
    expect(resChain.rejected[0]?.reason).toBe('canonical_is_alias');
    expect(resChain.rejected[1]?.reason).toBe('alias_is_canonical');
    expect(resChain.rejected[2]?.reason).toBe('already_linked');
  });

  // Feature: hidden-mickeys, Property 21: Experience groups
  it('Property 21: accepted links never form a chain (intersection of aliases and canonicals is always empty)', () => {
    const aliasLinkArb = fc.record({
      aliasId: fc.constantFrom('id-1', 'id-2', 'id-3', 'id-4', 'id-5'),
      canonicalId: fc.constantFrom('id-1', 'id-2', 'id-3', 'id-4', 'id-5'),
    });

    fc.assert(
      fc.property(fc.array(aliasLinkArb, { maxLength: 20 }), (candidates) => {
        const { accepted } = validateAliasLinks(candidates, []);
        const aliases = new Set(accepted.map((l) => l.aliasId));
        const canonicals = new Set(accepted.map((l) => l.canonicalId));

        // No node can be both an alias and a canonical in accepted links
        for (const a of aliases) {
          expect(canonicals.has(a)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
