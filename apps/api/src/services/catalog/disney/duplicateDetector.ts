/**
 * Diagnostic duplicate detector for Disney catalog synchronization.
 *
 * Sourced from catalog-taxonomy-cleanup design.md and Requirement 8.
 * Groups admitted Experiences by normalized name (lower-cased, NFKD,
 * non-alphanumerics collapsed to single spaces, trimmed) and returns every
 * group of two or more, minus the curated KNOWN_DISTINCT_NAMESAKES pairs.
 * Diagnostic only — never mutates or withholds (R8.8).
 *
 * Validates: Requirements 8.7, 8.8, 8.9
 */

export interface DuplicateGroup {
  readonly normalizedName: string;
  readonly members: readonly {
    readonly enterpriseId: string;
    readonly category: string;
  }[];
}

/**
 * Name collisions that are two genuinely different real things, suppressed
 * from the R8.7 detector so the warning stays actionable (R8.9).
 */
export const KNOWN_DISTINCT_NAMESAKES: readonly (readonly string[])[] = [
  [
    '80069785;entityType=resort:resort-visit',
    '412312319;entityType=restaurant',
  ],
];

/**
 * Pure name normalizer: NFKD normalization, strips non-alphanumerics to spaces,
 * lowercases, and trims whitespace.
 * Ensures case-insensitivity and punctuation-insensitivity (e.g. straight vs
 * curly apostrophes, trademark symbols).
 */
export function normalizeExperienceName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Pure. Groups admitted Experiences by normalized name and returns every
 * group of two or more, minus the curated `KNOWN_DISTINCT_NAMESAKES` pairs.
 * Diagnostic only — never mutates or withholds (R8.8).
 */
export function detectDuplicateGroups(
  experiences: readonly {
    readonly upstreamEntityId: string;
    readonly category: string;
    readonly name: string;
  }[],
): readonly DuplicateGroup[] {
  const groupsByNormName = new Map<
    string,
    { enterpriseId: string; category: string }[]
  >();

  for (const exp of experiences) {
    const norm = normalizeExperienceName(exp.name);
    if (norm.length === 0) {
      continue;
    }
    let group = groupsByNormName.get(norm);
    if (group === undefined) {
      group = [];
      groupsByNormName.set(norm, group);
    }
    group.push({
      enterpriseId: exp.upstreamEntityId,
      category: exp.category,
    });
  }

  const result: DuplicateGroup[] = [];

  for (const [normalizedName, members] of groupsByNormName.entries()) {
    if (members.length < 2) {
      continue;
    }

    // Check if this group matches any entry in KNOWN_DISTINCT_NAMESAKES (R8.9)
    const memberIds = new Set(members.map((m) => m.enterpriseId));
    const isKnownNamesake = KNOWN_DISTINCT_NAMESAKES.some((namesakeList) => {
      if (namesakeList.length !== memberIds.size) {
        return false;
      }
      return namesakeList.every((id) => memberIds.has(id));
    });

    if (!isKnownNamesake) {
      result.push({
        normalizedName,
        members,
      });
    }
  }

  return result;
}
