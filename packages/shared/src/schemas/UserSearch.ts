/**
 * Zod schema for the user-search query parameter.
 *
 * Validates the `q` query string for `GET /users/search`. Length bounds 1-100
 * are enforced by `searchQuerySchema` (R8.1, R8.2); the case-insensitive
 * substring matching is performed server-side over the population minus the
 * requesting User.
 *
 * Validates: Requirements 8.1, 8.2
 */

import { z } from 'zod';

import { searchQuerySchema } from './primitives.js';

export const userSearchInputSchema = z
  .object({
    q: searchQuerySchema,
  })
  .strict();

export type UserSearchInput = z.infer<typeof userSearchInputSchema>;
