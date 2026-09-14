/**
 * Barrel for shared DTO types.
 *
 * Each DTO mirrors a domain entity from the design's data model. Types are
 * declared with `readonly` fields so consumers cannot mutate snapshots passed
 * across the API boundary. Validation lives next door in
 * `packages/shared/src/schemas/`.
 */

export type { UserDTO } from './User.js';
export type { ProfileDTO } from './Profile.js';
export type { ExperienceDTO } from './Experience.js';
export type {
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  WhyThisDTO,
} from './Facet.js';
export type { ResortDTO } from './Resort.js';
export type { MealPeriodDTO, MenuDTO } from './Menu.js';
export type { CompletionDTO } from './Completion.js';
export type { CompletionEntryDTO, FriendCompletionsDTO } from './CompletionEntry.js';
export type {
  ExperienceLogDTO,
  ExperienceVisitHistoryDTO,
} from './ExperienceLog.js';
export type { RatingDTO } from './Rating.js';
export type { NoteDTO } from './Note.js';
export type { FriendRequestDTO } from './FriendRequest.js';
export type { FriendshipDTO } from './Friendship.js';
export type {
  ShareDTO,
  SentShareDTO,
  SharePayload,
  ExperienceSharePayload,
  ProgressSharePayload,
  PinShowcaseSharePayload,
} from './Share.js';
export type { ShareRecipientDTO } from './ShareRecipient.js';
export type { ShareReactionDTO } from './ShareReaction.js';
export type { NotificationPreferenceDTO } from './NotificationPreference.js';
export type { InboxItemDTO, InboxResponse } from './Inbox.js';
export type { AggregateRatingDTO } from './AggregateRating.js';
export type { LeaderboardEntryDTO } from './LeaderboardEntry.js';
export type {
  StatsDTO,
  StatsBreakdown,
  FestivalStatsDTO,
  CompletionCell,
  ActivityStatistics,
  MostRiddenAttraction,
  PersonalRecords,
} from './Stats.js';
export type {
  OperatingStatus,
  ForecastEntry,
  Showtime,
  OperatingHours,
  DiningAvailabilityEntry,
  LightningLaneState,
  BoardingGroupState,
  LiveDetailDTO,
  LiveDetailResponseDTO,
} from './LiveDetail.js';

export type {
  CrowdCalendarDayDTO,
  WaitSnapshot,
  WaitInsightsDTO,
} from './Intelligence.js';

export {
  SYNC_RUN_OUTCOMES,
  DISNEY_TARGETS,
  DISNEY_FAILURE_KINDS,
} from './DisneySource.js';
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
} from './DisneySource.js';

export type {
  PinDTO,
  PinCriteria,
  SingleDayFeat,
  ParkCompletionScope,
  CatalogCompletionScope,
  SetRequirement,
  UserPinProgressDTO,
  PinTierSummaryDTO,
  PinBoardDTO,
} from './Pin.js';

export type {
  PinShowcasePlacementDTO,
  PinShowcaseDTO,
  PlacePinRequest,
} from './PinShowcase.js';

export {
  SHOWCASE_MAX_PINS,
  SHOWCASE_PIN_SIZE,
  SHOWCASE_BOARD_MARGIN,
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_REFERENCE_SIZE,
  overlapsAnyOtherPin,
  placementToReferencePx,
} from './PinShowcase.js';

