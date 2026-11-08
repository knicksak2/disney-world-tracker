import { z } from 'zod';

import {
  MICKEY_AREA_TYPES,
  MICKEY_CLUE1_MAX,
  MICKEY_CLUE1_MIN,
  MICKEY_CLUE2_MAX,
  MICKEY_CLUE2_MIN,
  MICKEY_DIFFICULTIES,
  MICKEY_FOUND_FILTERS,
  MICKEY_LIST_DEFAULT_LIMIT,
  MICKEY_LIST_MAX_LIMIT,
  MICKEY_NOTE_MAX,
  MICKEY_PHOTO_URL_MAX,
  MICKEY_REPORT_REASONS,
  MICKEY_REVEAL_MAX,
  MICKEY_REVEAL_MIN,
  MICKEY_SCOPES,
  MICKEY_SEARCH_MAX,
  MICKEY_SEARCH_MIN,
  MICKEY_ZONES,
} from '../constants/mickeys.js';
import { PARKS } from '../enums.js';
import { uuidSchema } from './primitives.js';

export const mickeyListQuerySchema = z
  .object({
    experienceId: uuidSchema.optional(),
    park: z.enum(PARKS).optional(),
    areaType: z.enum(MICKEY_AREA_TYPES).optional(),
    land: z.string().min(1).max(100).optional(),
    q: z.string().min(MICKEY_SEARCH_MIN).max(MICKEY_SEARCH_MAX).optional(),
    zone: z.enum(MICKEY_ZONES).optional(),
    found: z.enum(MICKEY_FOUND_FILTERS).optional(),
    scope: z.enum(MICKEY_SCOPES).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MICKEY_LIST_MAX_LIMIT)
      .default(MICKEY_LIST_DEFAULT_LIMIT),
  })
  .strict();
export type MickeyListQuery = z.infer<typeof mickeyListQuerySchema>;

export const mickeyHintBodySchema = z
  .object({
    level: z.union([z.literal(2), z.literal(3)]),
  })
  .strict();
export type MickeyHintBody = z.infer<typeof mickeyHintBodySchema>;

export const mickeyFindBodySchema = z
  .object({
    tripId: uuidSchema.nullable().optional(),
  })
  .strict();
export type MickeyFindBody = z.infer<typeof mickeyFindBodySchema>;

export const mickeyVoteBodySchema = z
  .object({
    vote: z.enum(['there', 'gone']),
  })
  .strict();
export type MickeyVoteBody = z.infer<typeof mickeyVoteBodySchema>;

export const mickeyReportBodySchema = z
  .object({
    reason: z.enum(MICKEY_REPORT_REASONS),
    note: z.string().min(1).max(MICKEY_NOTE_MAX).optional(),
  })
  .strict();
export type MickeyReportBody = z.infer<typeof mickeyReportBodySchema>;

export const mickeySubmissionBodySchema = z
  .object({
    experienceId: uuidSchema,
    zone: z.enum(MICKEY_ZONES),
    difficulty: z.enum(MICKEY_DIFFICULTIES),
    clue1: z.string().min(MICKEY_CLUE1_MIN).max(MICKEY_CLUE1_MAX),
    clue2: z.string().min(MICKEY_CLUE2_MIN).max(MICKEY_CLUE2_MAX),
    reveal: z.string().min(MICKEY_REVEAL_MIN).max(MICKEY_REVEAL_MAX),
  })
  .strict();
export type MickeySubmissionBody = z.infer<typeof mickeySubmissionBodySchema>;

export const seedMickeyEntrySchema = z
  .object({
    seedKey: z.string().min(1),
    upstreamEntityId: z.string().min(1).optional(),
    experienceName: z.string().min(1).optional(),
    park: z.enum(PARKS).nullable().optional(),
    zone: z.enum(MICKEY_ZONES),
    difficulty: z.enum(MICKEY_DIFFICULTIES),
    clue1: z.string().min(MICKEY_CLUE1_MIN).max(MICKEY_CLUE1_MAX),
    clue2: z.string().min(MICKEY_CLUE2_MIN).max(MICKEY_CLUE2_MAX),
    reveal: z.string().min(MICKEY_REVEAL_MIN).max(MICKEY_REVEAL_MAX),
    photoUrl: z.string().max(MICKEY_PHOTO_URL_MAX).optional(),
  })
  .strict();
export type SeedMickeyEntry = z.infer<typeof seedMickeyEntrySchema>;

export const aliasFileEntrySchema = z
  .object({
    aliasUpstreamEntityId: z.string().min(1),
    canonicalUpstreamEntityId: z.string().min(1),
  })
  .strict();
export type AliasFileEntry = z.infer<typeof aliasFileEntrySchema>;
