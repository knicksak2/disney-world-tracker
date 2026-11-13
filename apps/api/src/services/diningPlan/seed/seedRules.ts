/**
 * The pure half of "Apply seed rules" (dining-plan-calculator Requirements 8.9, 8.10, 18.8, 18.10; design.md "Seed
 * application"; Property 40).
 *
 * `parseSeedFile` validates every entry before anything is written, naming the first bad one. `planSeed` matches each
 * entry to one active Restaurant Experience (by `upstreamEntityId` when the entry has one, otherwise by normalized
 * `name` and `aliases`), resolves two entries that match the same Experience, and decides each entry's outcome against
 * the stored rules. It never plans a write that would replace a `verified` rule with an `unverified` one, and it plans
 * no write for a rule that already holds the seed's values, so applying the seed twice changes nothing.
 */

import { diningSeedRuleSchema, type DiningCreditCostByPeriod, type DiningRuleStatus, type DiningSeedRule, type DiningServiceType } from '@dwt/shared';

export const SEED_OUTCOMES = ['inserted', 'updated', 'kept', 'unmatched', 'ambiguous'] as const;
export type SeedOutcome = (typeof SEED_OUTCOMES)[number];

/** An active Restaurant Experience the seed may match. */
export interface SeedCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly upstreamEntityId: string | null;
}

/** The rule columns the seed writes (the per-person overrides and the pass-discount flag are never touched). */
export interface SeedRuleFields {
  readonly serviceType: DiningServiceType | null;
  readonly creditCost: 1 | 2;
  readonly creditCostByPeriod: DiningCreditCostByPeriod | null;
  readonly gratuityIncluded: boolean;
  readonly ruleStatus: DiningRuleStatus;
  readonly verifiedAt: string | null;
  readonly sourceNote: string | null;
}

export interface SeedWrite {
  readonly experienceId: string;
  readonly fields: SeedRuleFields;
  readonly insert: boolean;
}

export interface SeedEntryResult {
  readonly name: string;
  readonly outcome: SeedOutcome;
  /** Why an entry was kept, unmatched or ambiguous; null for an insert or an update. */
  readonly reason: string | null;
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly sourceNote: string;
}

/**
 * Lower case, diacritics removed (`NFD`), every character that is not a letter, digit or space removed (so `'`, `®`,
 * `™`, `&`, `-`, `:` and the accents vanish), runs of spaces collapsed, and a leading "the" dropped. "The BOATHOUSE" and "Boathouse"
 * both give `boathouse`; "Cítricos" and "Citricos" give `citricos`.
 */
export function normalizeSeedName(name: string): string {
  // `NFD` splits an accented letter into the letter and a combining mark; the mark is not a letter or digit, so the
  // punctuation step removes it with the rest.
  const plain = name
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return plain.startsWith('the ') ? plain.slice(4) : plain;
}

/** The whole file, or the first entry that fails the rule schema (named by position and name). */
export function parseSeedFile(raw: unknown): { readonly ok: true; readonly entries: DiningSeedRule[] } | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'The seed file must be a JSON array of rules.' };
  const entries: DiningSeedRule[] = [];
  for (const [i, item] of raw.entries()) {
    const parsed = diningSeedRuleSchema.safeParse(item);
    if (!parsed.success) {
      const name = item !== null && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : '(no name)';
      const issue = parsed.error.issues[0];
      const where = issue === undefined || issue.path.length === 0 ? '' : ` (${issue.path.join('.')})`;
      return { ok: false, error: `Seed entry ${i + 1} "${name}" is invalid${where}: ${issue?.message ?? 'invalid'}` };
    }
    entries.push(parsed.data);
  }
  return { ok: true, entries };
}

export function seedFieldsOf(entry: DiningSeedRule): SeedRuleFields {
  return {
    serviceType: entry.serviceType,
    creditCost: entry.creditCost,
    creditCostByPeriod: entry.creditCostByPeriod !== undefined && Object.keys(entry.creditCostByPeriod).length > 0 ? entry.creditCostByPeriod : null,
    gratuityIncluded: entry.gratuityIncluded,
    ruleStatus: entry.ruleStatus,
    verifiedAt: entry.verifiedAt ?? null,
    sourceNote: entry.sourceNote,
  };
}

function samePeriods(a: DiningCreditCostByPeriod | null, b: DiningCreditCostByPeriod | null): boolean {
  if (a === null || b === null) return a === b;
  return a.breakfast === b.breakfast && a.lunch === b.lunch && a.dinner === b.dinner;
}

export function sameSeedFields(a: SeedRuleFields, b: SeedRuleFields): boolean {
  return (
    a.serviceType === b.serviceType &&
    a.creditCost === b.creditCost &&
    samePeriods(a.creditCostByPeriod, b.creditCostByPeriod) &&
    a.gratuityIncluded === b.gratuityIncluded &&
    a.ruleStatus === b.ruleStatus &&
    a.verifiedAt === b.verifiedAt &&
    a.sourceNote === b.sourceNote
  );
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function planSeed(input: {
  readonly entries: readonly DiningSeedRule[];
  readonly catalog: readonly SeedCatalogRow[];
  readonly stored: ReadonlyMap<string, SeedRuleFields>;
}): { readonly results: SeedEntryResult[]; readonly writes: SeedWrite[] } {
  const byUpstream = new Map<string, SeedCatalogRow[]>();
  const byName = new Map<string, SeedCatalogRow[]>();
  for (const row of input.catalog) {
    if (row.upstreamEntityId !== null) push(byUpstream, row.upstreamEntityId, row);
    push(byName, normalizeSeedName(row.name), row);
  }

  // 1. Match each entry on its own.
  type Match = { readonly row: SeedCatalogRow } | { readonly outcome: 'unmatched' | 'ambiguous'; readonly reason: string };
  const matches: Match[] = input.entries.map((entry) => {
    let candidates: SeedCatalogRow[];
    let how: string;
    if (entry.upstreamEntityId !== undefined) {
      candidates = byUpstream.get(entry.upstreamEntityId) ?? [];
      how = `id ${entry.upstreamEntityId}`;
    } else {
      candidates = [];
      for (const name of [entry.name, ...(entry.aliases ?? [])]) for (const row of byName.get(normalizeSeedName(name)) ?? []) if (!candidates.includes(row)) candidates.push(row);
      how = 'this name or its aliases';
    }
    if (candidates.length === 0) return { outcome: 'unmatched', reason: `No active restaurant has ${how}.` };
    if (candidates.length > 1) {
      return { outcome: 'ambiguous', reason: `More than one active restaurant has ${how}: ${candidates.map((c) => c.name).join('; ')}.` };
    }
    return { row: candidates[0]! };
  });

  // 2. Two entries on one Experience: the one with an upstreamEntityId wins, else the later one.
  const winner = new Map<string, number>();
  matches.forEach((m, i) => {
    if (!('row' in m)) return;
    const prev = winner.get(m.row.id);
    if (prev === undefined) {
      winner.set(m.row.id, i);
      return;
    }
    const prevHasId = input.entries[prev]!.upstreamEntityId !== undefined;
    const thisHasId = input.entries[i]!.upstreamEntityId !== undefined;
    if (thisHasId || !prevHasId) winner.set(m.row.id, i);
  });

  // 3. Outcomes against the stored rules.
  const results: SeedEntryResult[] = [];
  const writes: SeedWrite[] = [];
  input.entries.forEach((entry, i) => {
    const m = matches[i]!;
    const base = { name: entry.name, sourceNote: entry.sourceNote };
    if (!('row' in m)) {
      results.push({ ...base, outcome: m.outcome, reason: m.reason, experienceId: null, experienceName: null });
      return;
    }
    const target = { experienceId: m.row.id, experienceName: m.row.name };
    const won = winner.get(m.row.id)!;
    if (won !== i) {
      results.push({ ...base, ...target, outcome: 'ambiguous', reason: `Seed entry "${input.entries[won]!.name}" matches the same restaurant and is applied instead.` });
      return;
    }
    const fields = seedFieldsOf(entry);
    const stored = input.stored.get(m.row.id);
    if (stored === undefined) {
      writes.push({ experienceId: m.row.id, fields, insert: true });
      results.push({ ...base, ...target, outcome: 'inserted', reason: null });
    } else if (stored.ruleStatus === 'verified' && fields.ruleStatus === 'unverified') {
      results.push({ ...base, ...target, outcome: 'kept', reason: 'A verified rule is never replaced by an unverified one.' });
    } else if (sameSeedFields(stored, fields)) {
      results.push({ ...base, ...target, outcome: 'kept', reason: 'The stored rule already matches the seed.' });
    } else {
      writes.push({ experienceId: m.row.id, fields, insert: false });
      results.push({ ...base, ...target, outcome: 'updated', reason: null });
    }
  });
  return { results, writes };
}

/** The outcome counts of a seed run, every outcome present. */
export function seedCounts(results: readonly SeedEntryResult[]): Record<SeedOutcome, number> {
  const counts = Object.fromEntries(SEED_OUTCOMES.map((o) => [o, 0])) as Record<SeedOutcome, number>;
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}
