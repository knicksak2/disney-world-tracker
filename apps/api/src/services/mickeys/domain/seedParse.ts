import { z } from 'zod';
import {
  PARKS,
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
  MICKEY_CLUE1_MIN,
  MICKEY_CLUE1_MAX,
  MICKEY_CLUE2_MIN,
  MICKEY_CLUE2_MAX,
  MICKEY_REVEAL_MIN,
  MICKEY_REVEAL_MAX,
  type Park,
  type MickeyZone,
  type MickeyDifficulty,
} from '@dwt/shared';

export const rawSeedMickeyEntrySchema = z
  .object({
    seedKey: z.string().min(1).max(100),
    upstreamEntityId: z.string().min(1).optional(),
    experienceName: z.string().min(1).optional(),
    park: z.enum(PARKS).nullable().optional(),
    zone: z.enum(MICKEY_ZONES),
    difficulty: z.enum(MICKEY_DIFFICULTIES),
    clue1: z.string().min(MICKEY_CLUE1_MIN).max(MICKEY_CLUE1_MAX),
    clue2: z.string().min(MICKEY_CLUE2_MIN).max(MICKEY_CLUE2_MAX),
    reveal: z.string().min(MICKEY_REVEAL_MIN).max(MICKEY_REVEAL_MAX),
    photoUrl: z.string().max(2048).optional(),
  })
  .strict()
  .refine((entry) => Boolean(entry.upstreamEntityId || entry.experienceName), {
    message: 'Entry must specify at least one of upstreamEntityId or experienceName',
  });

export interface ParsedSeedMickey {
  readonly seedKey: string;
  readonly upstreamEntityId?: string;
  readonly experienceName?: string;
  readonly park: Park | null;
  readonly zone: MickeyZone;
  readonly difficulty: MickeyDifficulty;
  readonly clue1: string;
  readonly clue2: string;
  readonly reveal: string;
}

export interface SeedParseResult {
  readonly valid: readonly ParsedSeedMickey[];
  readonly duplicates: ReadonlyArray<{ seedKey: string; index: number }>;
  readonly invalid: ReadonlyArray<{ index: number; seedKey?: string; reason: string }>;
}

/**
 * Parses and validates seed entries from a JSON seed file (Requirements 12.1, 12.3, 12.5, 12.10).
 *
 * Rules:
 * - Uses .strict() schema matching Requirement 12.1.
 * - photoUrl is accepted if <= 2048 chars, but strictly stripped from the returned ParsedSeedMickey.
 * - Unknown fields make the entry invalid.
 * - Entries with duplicate seedKeys keep the first occurrence; subsequent occurrences are reported in duplicates[].
 * - The original ordering of valid entries is preserved.
 */
export function parseSeedEntries(entries: unknown): SeedParseResult {
  if (!Array.isArray(entries)) {
    return {
      valid: [],
      duplicates: [],
      invalid: [{ index: -1, reason: 'Seed file must contain a JSON array' }],
    };
  }

  const valid: ParsedSeedMickey[] = [];
  const duplicates: Array<{ seedKey: string; index: number }> = [];
  const invalid: Array<{ index: number; seedKey?: string; reason: string }> = [];
  const seenSeedKeys = new Set<string>();

  for (let index = 0; index < entries.length; index++) {
    const raw = entries[index];
    const parsed = rawSeedMickeyEntrySchema.safeParse(raw);

    if (!parsed.success) {
      const seedKey =
        typeof raw === 'object' && raw !== null && 'seedKey' in raw && typeof (raw as any).seedKey === 'string'
          ? (raw as any).seedKey
          : undefined;
      invalid.push({
        index,
        seedKey,
        reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
      });
      continue;
    }

    const item = parsed.data;
    if (seenSeedKeys.has(item.seedKey)) {
      duplicates.push({ seedKey: item.seedKey, index });
      continue;
    }

    seenSeedKeys.add(item.seedKey);

    // Explicitly omit photoUrl from the output object (Requirement 12.10)
    const validItem: ParsedSeedMickey = {
      seedKey: item.seedKey,
      ...(item.upstreamEntityId ? { upstreamEntityId: item.upstreamEntityId } : {}),
      ...(item.experienceName ? { experienceName: item.experienceName } : {}),
      park: item.park ?? null,
      zone: item.zone,
      difficulty: item.difficulty,
      clue1: item.clue1,
      clue2: item.clue2,
      reveal: item.reveal,
    };

    valid.push(validItem);
  }

  return { valid, duplicates, invalid };
}
