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
  TRIP_REACTION_VALUES,
  WALKING_SPEEDS,
  PLANNED_ITEM_TYPES,
} from './enums.js';
export type {
  ExperienceCategory,
  AreaType,
  Park,
  SharePayloadKind,
  ShareReactionValue,
  TripReactionValue,
  WalkingSpeed,
  PlannedItemType,
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
  CrowdCalendarDayDTO,
  WaitSnapshot,
  WaitInsightsDTO,
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
  tripReactionValueSchema,
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

export {
  crowdCalendarDaySchema,
  waitSnapshotSchema,
  waitInsightsSchema,
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

// Trips domain: schemas + input types + DTOs.
export {
  // primitives
  tripNameSchema,
  tripDescriptionSchema,
  tripCalendarDateSchema,
  tripCommentBodySchema,
  tripResortIdsSchema,
  TRIP_RESORT_LIMIT,
  // input schemas
  dayTouringHoursSchema,
  tripCreateSchema,
  tripEditSchema,
  plannedItemAddSchema,
  plannedItemEditSchema,
  tripOptimizationInputSchema,
  tripLogEntryCreateSchema,
  rodeWithConfirmSchema,
  tripReactionInputSchema,
  tripCommentInputSchema,
  // DTO schemas
  pendingRodeWithTagSchema,
  tripIncomingInviteSchema,
} from './trips.js';
export type {
  // value types
  TripStatus,
  TripRole,
  TripInviteState,
  RodeWithTagState,
  TripFeedTargetType,
  DayTouringHoursDTO,
  // input types
  TripCreateInput,
  TripEditInput,
  PlannedItemAddInput,
  PlannedItemEditInput,
  TripOptimizationInput,
  TripLogEntryCreateInput,
  RodeWithConfirmInput,
  TripReactionInput,
  TripCommentInput,
  // DTOs
  TripDTO,
  TripResortDTO,
  TripMemberDTO,
  TripInviteDTO,
  TripIncomingInviteDTO,
  TripPendingInviteDTO,
  PendingRodeWithTagDTO,
  PlannedItemDTO,
  TripLogEntryDTO,
  TripFeedItemDTO,
  TripReactionSummary,
  TripCommentDTO,
  TripSummaryDTO,
  TripOptimizationResult,
  OptimizedItem,
  TripTravelLeg,
} from './trips.js';

// Planned List Completion Sync: pure, I/O-free derivation core shared by the
// mobile Planned_List presentation and the server Trip_Summary planned counts,
// so the two cannot drift.
export {
  completedExperienceIdsFromFeed,
  derivePlannedListPresentation,
  derivePlannedCounts,
} from './plannedCompletion.js';
export type {
  PlannedItemCompletionState,
  PlannedItemView,
  PlannedListProgress,
  PlannedListPresentation,
} from './plannedCompletion.js';

// Notification_Center pure attention model: domain-agnostic, dependency-free
// types for the merge / order / badge / failure-handling core shared by the
// Attention_Feed and the Attention_Badge so the two cannot drift.
export {
  SUMMARY_MAX_LENGTH,
  summarize,
  toAttentionItem,
} from './attention.js';
export type {
  AttentionDomain,
  AttentionItemRef,
  AttentionDestination,
  AttentionItem,
  AttentionSourceOutcome,
  AttentionSourceDTO,
  SortMode,
  BadgeDisplay,
  AttentionState,
} from './attention.js';

// Notification_Center pure ordering functions (value exports): the fixed domain
// sequence and the total-order comparator / feed orderer (R1.4–R1.8).
export { DOMAIN_ORDER, compareItems, orderItems } from './attention.js';

// Notification_Center pure attention functions: badge display derivation and
// the top-level state reducer that composes the feed + badge from per-source
// outcomes (R4.2–R4.6, R8.1, R8.4, R8.7).
export { badgeDisplayFor, buildAttentionState } from './attention.js';

// Notification_Center pure view classifier: the mutually-exclusive
// loading / empty / error / list view derivation from in-flight status and
// per-source outcomes (Property 12; R9.2, R9.3, R9.6).
export { classifyView } from './attention.js';
export type { AttentionView } from './attention.js';

// Notification_Center pure retry-merge: recompute the state from every source's
// latest outcome (retried successes replace prior failures and merge with the
// previously loaded successful items; still-failed sources remain failed)
// (R8.5, R8.6).
export { mergeOutcomes, recomputeAfterRetry } from './attention.js';
