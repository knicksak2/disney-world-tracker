import { z } from 'zod';
import {
  FRIEND_FOOD_PAGE_SIZE_DEFAULT,
  FRIEND_FOOD_PAGE_SIZE_MAX,
  FRIEND_FOOD_SEARCH_MAX_LENGTH,
  FRIEND_FOOD_SORTS,
} from '../constants/friendFoodRatings.js';
import { PARKS } from '../enums.js';
import { uuidSchema } from './primitives.js';

export const friendFoodRatingsQuerySchema = z
  .object({
    sort: z.enum(FRIEND_FOOD_SORTS).default('recent'),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(FRIEND_FOOD_PAGE_SIZE_MAX).default(FRIEND_FOOD_PAGE_SIZE_DEFAULT),
    experienceId: uuidSchema.optional(),
    locationId: uuidSchema.optional(),
    park: z.enum(PARKS).optional(),
    q: z.string().trim().min(1).max(FRIEND_FOOD_SEARCH_MAX_LENGTH).optional(),
    minRatedLogs: z.coerce.number().int().min(0).max(10).default(0),
  })
  .strict()
  .refine((v) => !(v.experienceId && v.locationId), {
    message: 'Specify at most one of experienceId or locationId',
  });

export type FriendFoodRatingsQuery = z.infer<typeof friendFoodRatingsQuerySchema>;
