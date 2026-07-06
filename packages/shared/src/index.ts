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
  AREA_TYPES,
  PARKS,
  SHARE_PAYLOAD_KINDS,
  SHARE_REACTION_VALUES,
} from './enums.js';
export type {
  ExperienceCategory,
  AreaType,
  Park,
  SharePayloadKind,
  ShareReactionValue,
} from './enums.js';

// Avatar preset catalog (allowlist of bundled illustration ids).
export {
  AVATAR_PRESET_IDS,
  isAvatarPresetId,
} from './constants/avatarPresets.js';
export type { AvatarPresetId } from './constants/avatarPresets.js';

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
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  WhyThisDTO,
  ResortDTO,
  MealPeriodDTO,
  MenuDTO,
  CompletionDTO,
  CompletionEntryDTO,
  FriendCompletionsDTO,
  RatingDTO,
  NoteDTO,
  FriendRequestDTO,
  FriendshipDTO,
  ShareDTO,
  SentShareDTO,
  SharePayload,
  ExperienceSharePayload,
  ProgressSharePayload,
  ShareRecipientDTO,
  ShareReactionDTO,
  NotificationPreferenceDTO,
  InboxItemDTO,
  InboxResponse,
  AggregateRatingDTO,
  LeaderboardEntryDTO,
  StatsDTO,
  StatsBreakdown,
  CompletionCell,
  OperatingStatus,
  ForecastEntry,
  Showtime,
  OperatingHours,
  DiningAvailabilityEntry,
  LightningLaneState,
  BoardingGroupState,
  LiveDetailDTO,
  LiveDetailResponseDTO,
} from './dto/index.js';

// Disney source-resilience transport-facing types (closed-set value tuples).
export {
  SYNC_RUN_OUTCOMES,
  DISNEY_TARGETS,
  DISNEY_FAILURE_KINDS,
} from './dto/index.js';
export type {
  SyncRunOutcome,
  DisneyTarget,
  DisneyRequestSpec,
  DisneyResponse,
  DisneyFailureKind,
  DisneyClassification,
  BackoffConfig,
  RateLimiterConfig,
  StoredDocument,
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
  shareReactionValueSchema,
  completionPercentSchema,
  // DTO schemas
  userSchema,
  registerInputSchema,
  loginInputSchema,
  changePasswordInputSchema,
  profileSchema,
  profileDisplayNameInputSchema,
  profileAvatarInputSchema,
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
  shareReactionSchema,
  notificationPreferenceSchema,
  notificationPreferenceInputSchema,
  inboxItemSchema,
  inboxResponseSchema,
  aggregateRatingSchema,
  leaderboardEntrySchema,
  statsSchema,
  completionCellSchema,
  userSearchInputSchema,
  // Live_Detail schemas
  liveDetailSchema,
  liveDetailResponseSchema,
  operatingStatusSchema,
  forecastEntrySchema,
  showtimeSchema,
  operatingHoursSchema,
  diningAvailabilityEntrySchema,
  lightningLaneStateSchema,
  boardingGroupStateSchema,
} from './schemas/index.js';
export type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  ProfileDisplayNameInput,
  ProfileAvatarInput,
  CompletionInput,
  RatingInput,
  NoteInput,
  FriendRequestInput,
  ShareInput,
  UserSearchInput,
  NotificationPreferenceInput,
} from './schemas/index.js';
