/**
 * Barrel for shared Zod validation schemas.
 *
 * Each file in this folder mirrors a DTO from `packages/shared/src/dto/` and
 * additionally exposes any input schemas needed to validate request bodies
 * for that domain. The shared primitives (email, password, rating value,
 * note body, search query, recipient list, …) live in `./primitives.ts`.
 */

// Reusable primitives — re-exported so callers can compose without reaching
// into the implementation detail of each domain schema.
export {
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
} from './primitives.js';

// DTO schemas
export { userSchema, registerInputSchema, loginInputSchema, changePasswordInputSchema } from './User.js';
export type { RegisterInput, LoginInput, ChangePasswordInput } from './User.js';

export {
  profileSchema,
  profileDisplayNameInputSchema,
} from './Profile.js';
export type { ProfileDisplayNameInput } from './Profile.js';

export { experienceSchema } from './Experience.js';

export { completionSchema, completionInputSchema } from './Completion.js';
export type { CompletionInput } from './Completion.js';

export { ratingSchema, ratingInputSchema } from './Rating.js';
export type { RatingInput } from './Rating.js';

export { noteSchema, noteInputSchema } from './Note.js';
export type { NoteInput } from './Note.js';

export {
  friendRequestSchema,
  friendRequestInputSchema,
} from './FriendRequest.js';
export type { FriendRequestInput } from './FriendRequest.js';

export { friendshipSchema } from './Friendship.js';

export {
  shareSchema,
  sharePayloadSchema,
  experienceSharePayloadSchema,
  progressSharePayloadSchema,
  shareInputSchema,
} from './Share.js';
export type { ShareInput } from './Share.js';

export { shareRecipientSchema } from './ShareRecipient.js';

export { shareReactionSchema } from './ShareReaction.js';

export {
  notificationPreferenceSchema,
  notificationPreferenceInputSchema,
} from './NotificationPreference.js';
export type { NotificationPreferenceInput } from './NotificationPreference.js';

export { inboxItemSchema, inboxResponseSchema } from './Inbox.js';

export { aggregateRatingSchema } from './AggregateRating.js';
export { leaderboardEntrySchema } from './LeaderboardEntry.js';
export { statsSchema, completionCellSchema } from './Stats.js';

export { userSearchInputSchema } from './UserSearch.js';
export type { UserSearchInput } from './UserSearch.js';

export {
  liveDetailSchema,
  liveDetailResponseSchema,
  operatingStatusSchema,
  forecastEntrySchema,
  showtimeSchema,
  operatingHoursSchema,
  diningAvailabilityEntrySchema,
  lightningLaneStateSchema,
  boardingGroupStateSchema,
} from './LiveDetail.js';
