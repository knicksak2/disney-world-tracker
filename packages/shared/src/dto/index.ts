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
export type { CompletionDTO } from './Completion.js';
export type { RatingDTO } from './Rating.js';
export type { NoteDTO } from './Note.js';
export type { FriendRequestDTO } from './FriendRequest.js';
export type { FriendshipDTO } from './Friendship.js';
export type {
  ShareDTO,
  SharePayload,
  ExperienceSharePayload,
  ProgressSharePayload,
} from './Share.js';
export type { ShareRecipientDTO } from './ShareRecipient.js';
export type { AggregateRatingDTO } from './AggregateRating.js';
export type { LeaderboardEntryDTO } from './LeaderboardEntry.js';
export type { StatsDTO, StatsBreakdown } from './Stats.js';
export type {
  OperatingStatus,
  ReturnWindowState,
  BoardingGroupAllocation,
  ReturnWindow,
  PaidReturnWindow,
  BoardingGroupStatus,
  ForecastEntry,
  Showtime,
  OperatingHours,
  DiningAvailabilityEntry,
  LiveDetailDTO,
  LiveDetailResponseDTO,
} from './LiveDetail.js';
