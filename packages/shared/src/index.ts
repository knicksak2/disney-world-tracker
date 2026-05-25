/**
 * Public surface of `@dwt/shared`.
 *
 * Anything intended to be imported by `apps/api`, `apps/mobile`, or another
 * future package must be re-exported from this barrel. The intent is that a
 * consumer never reaches into a deeper file path: a single import like
 *
 *   import { registerInputSchema, ErrorCode, ExperienceCategory } from '@dwt/shared';
 *
 * resolves cleanly. Internal helpers (e.g. raw enum tuples in
 * `./enums.ts`) are still exposed because property tests benefit from
 * iterating over them.
 */

// Enums (runtime tuples + derived union types).
export {
  EXPERIENCE_CATEGORIES,
  PARKS,
  SHARE_PAYLOAD_KINDS,
} from './enums.js';
export type {
  ExperienceCategory,
  Park,
  SharePayloadKind,
} from './enums.js';

// Error code catalog and uniform JSON envelope.
export {
  ERROR_CODES,
  errorCodeToHttpStatus,
} from './errors.js';
export type {
  ErrorCode,
  ErrorEnvelope,
  ErrorEnvelopeBody,
} from './errors.js';

// DTOs (types only — no runtime payload).
export type {
  UserDTO,
  ProfileDTO,
  ExperienceDTO,
  CompletionDTO,
  RatingDTO,
  NoteDTO,
  FriendRequestDTO,
  FriendshipDTO,
  ShareDTO,
  SharePayload,
  ExperienceSharePayload,
  ProgressSharePayload,
  ShareRecipientDTO,
  AggregateRatingDTO,
  LeaderboardEntryDTO,
  StatsDTO,
  StatsBreakdown,
} from './dto/index.js';

// Zod schemas + input types.
export {
  // primitives
  uuidSchema,
  emailSchema,
  displayNameSchema,
  passwordSchema,
  ratingValueSchema,
  noteBodySchema,
  isoDateSchema,
  ianaTzSchema,
  isoTimestampSchema,
  searchQuerySchema,
  recipientListSchema,
  experienceCategorySchema,
  parkSchema,
  sharePayloadKindSchema,
  completionPercentSchema,
  // DTO schemas
  userSchema,
  registerInputSchema,
  loginInputSchema,
  profileSchema,
  profileDisplayNameInputSchema,
  experienceSchema,
  completionSchema,
  completionInputSchema,
  ratingSchema,
  ratingInputSchema,
  noteSchema,
  noteInputSchema,
  friendRequestSchema,
  friendRequestInputSchema,
  friendshipSchema,
  shareSchema,
  sharePayloadSchema,
  experienceSharePayloadSchema,
  progressSharePayloadSchema,
  shareInputSchema,
  shareRecipientSchema,
  aggregateRatingSchema,
  leaderboardEntrySchema,
  statsSchema,
  userSearchInputSchema,
} from './schemas/index.js';
export type {
  RegisterInput,
  LoginInput,
  ProfileDisplayNameInput,
  CompletionInput,
  RatingInput,
  NoteInput,
  FriendRequestInput,
  ShareInput,
  UserSearchInput,
} from './schemas/index.js';
