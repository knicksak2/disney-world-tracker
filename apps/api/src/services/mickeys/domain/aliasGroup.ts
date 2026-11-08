export interface AliasLink {
  readonly aliasId: string;
  readonly canonicalId: string;
}

export type AliasRejectReason = 'self' | 'alias_is_canonical' | 'canonical_is_alias' | 'already_linked';

export interface AliasValidationResult {
  readonly accepted: readonly AliasLink[];
  readonly rejected: ReadonlyArray<{ readonly link: AliasLink; readonly reason: AliasRejectReason }>;
}

/**
 * Resolves the canonical Experience ID for an Experience:
 * Its canonical ID when it is registered as an alias, otherwise itself.
 * Links are one hop only (never chains).
 */
export function canonicalOf(experienceId: string, links: readonly AliasLink[]): string {
  const match = links.find((l) => l.aliasId === experienceId);
  return match ? match.canonicalId : experienceId;
}

/**
 * Returns the Experience_Group for an Experience:
 * The canonical plus every alias of that canonical, sorted alphabetically and de-duplicated.
 * Returns a group of one [experienceId] when unlinked.
 */
export function groupOf(experienceId: string, links: readonly AliasLink[]): readonly string[] {
  const canon = canonicalOf(experienceId, links);
  const groupSet = new Set<string>([canon]);

  for (const l of links) {
    if (l.canonicalId === canon) {
      groupSet.add(l.aliasId);
    }
  }

  return Array.from(groupSet).sort();
}

/**
 * Partitions candidate alias links into accepted and rejected (Requirements 12.8, 16.1, 16.3).
 *
 * Rejection rules:
 * - self: aliasId === canonicalId
 * - alias_is_canonical: aliasId is already a canonical (stored or earlier in the file)
 * - canonical_is_alias: canonicalId is already an alias (stored or earlier in the file)
 * - already_linked: aliasId is already linked as an alias (stored or earlier in the file)
 */
export function validateAliasLinks(
  candidates: readonly AliasLink[],
  existing: readonly AliasLink[] = [],
): AliasValidationResult {
  const knownAliases = new Set<string>();
  const knownCanonicals = new Set<string>();

  for (const ex of existing) {
    knownAliases.add(ex.aliasId);
    knownCanonicals.add(ex.canonicalId);
  }

  const accepted: AliasLink[] = [];
  const rejected: Array<{ link: AliasLink; reason: AliasRejectReason }> = [];

  for (const cand of candidates) {
    if (cand.aliasId === cand.canonicalId) {
      rejected.push({ link: cand, reason: 'self' });
      continue;
    }

    if (knownCanonicals.has(cand.aliasId)) {
      rejected.push({ link: cand, reason: 'alias_is_canonical' });
      continue;
    }

    if (knownAliases.has(cand.canonicalId)) {
      rejected.push({ link: cand, reason: 'canonical_is_alias' });
      continue;
    }

    if (knownAliases.has(cand.aliasId)) {
      rejected.push({ link: cand, reason: 'already_linked' });
      continue;
    }

    accepted.push(cand);
    knownAliases.add(cand.aliasId);
    knownCanonicals.add(cand.canonicalId);
  }

  return { accepted, rejected };
}
