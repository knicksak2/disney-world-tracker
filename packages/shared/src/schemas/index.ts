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
  tripReactionValueSchema,
  completionPercentSchema,
  foodItemNameSchema,
  foodListNameSchema,
} from './primitives.js';

// DTO schemas
export { userSchema, registerInputSchema, loginInputSchema, changePasswordInputSchema } from './User.js';
export type { RegisterInput, LoginInput, ChangePasswordInput } from './User.js';

export {
  profileSchema,
  profileDisplayNameInputSchema,
  profileAvatarInputSchema,
} from './Profile.js';
export type { ProfileDisplayNameInput, ProfileAvatarInput } from './Profile.js';

export { experienceSchema } from './Experience.js';

export { completionSchema, completionInputSchema } from './Completion.js';
export type { CompletionInput } from './Completion.js';

export {
  experienceLogSchema,
  experienceVisitHistorySchema,
  createExperienceLogInputSchema,
} from './ExperienceLog.js';
export type { CreateExperienceLogInput } from './ExperienceLog.js';

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
  pinShowcaseSharePayloadSchema,
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
export { statsSchema, completionCellSchema, festivalStatsSchema } from './Stats.js';
export { festivalSlugSchema } from './Festival.js';

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

export {
  crowdCalendarDaySchema,
  parkCrowdSummarySchema,
  waitSnapshotSchema,
  waitInsightsSchema,
} from './Intelligence.js';

// Pin-collection schemas.
export {
  pinTierSchema,
  pinTrackSchema,
  pinCountMetricSchema,
  pinCriteriaSchema,
  pinSchema,
  userPinProgressSchema,
} from './Pin.js';

export {
  pinShowcasePlacementSchema,
  pinShowcaseSchema,
  placePinRequestSchema,
} from './PinShowcase.js';

export {
  foodItemSchema,
  submitFoodItemInputSchema,
} from './FoodItem.js';
export type { SubmitFoodItemInput } from './FoodItem.js';

export {
  foodItemLogSchema,
  foodItemLogHistorySchema,
  createFoodItemLogInputSchema,
  updateFoodItemLogInputSchema,
  foodItemLogWithContextSchema,
} from './FoodItemLog.js';
export type {
  CreateFoodItemLogInput,
  UpdateFoodItemLogInput,
  FoodItemLogWithContext,
} from './FoodItemLog.js';

export {
  userSubmittedLocationSchema,
  createUserSubmittedLocationInputSchema,
  locationSuggestionSchema,
} from './UserSubmittedLocation.js';
export type { CreateUserSubmittedLocationInput } from './UserSubmittedLocation.js';

export {
  foodListVisibilitySchema,
  foodListRoleSchema,
  foodListShareRoleSchema,
  createFoodListInputSchema,
  updateFoodListInputSchema,
  addFoodListItemInputSchema,
  reorderFoodListItemsInputSchema,
  shareFoodListInputSchema,
  foodListItemSchema,
  foodListSchema,
  foodListDetailSchema,
  foodListShareSchema,
  savedFoodListItemSchema,
  foodListCollectionSchema,
  foodListDiscoveryPageSchema,
} from './FoodList.js';

export {
  experienceListNameSchema,
  experienceListVisibilitySchema,
  experienceListRoleSchema,
  experienceListShareRoleSchema,
  createExperienceListInputSchema,
  updateExperienceListInputSchema,
  addExperienceListItemInputSchema,
  reorderExperienceListItemsInputSchema,
  shareExperienceListInputSchema,
  experienceListItemSchema,
  experienceListSchema,
  experienceListDetailSchema,
  experienceListShareSchema,
  savedExperienceListItemSchema,
  experienceListCollectionSchema,
  experienceListDiscoveryPageSchema,
} from './ExperienceList.js';

export {
  parkLiveEntrySchema,
  parkLiveSnapshotSchema,
} from './ParkLive.js';
export type {
  ParkLiveEntryDTO,
  ParkLiveSnapshotDTO,
} from './ParkLive.js';

export { currentWeatherSchema } from './Weather.js';
export type { CurrentWeatherDTO } from './Weather.js';
