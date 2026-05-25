/**
 * Zod schema for `AggregateRatingDTO`.
 *
 * Privacy boundary in the validation layer (R10.10): `.strict()` rejects any
 * field other than `value` and `count`, so even if a server bug attempted to
 * include another User's individual rating in this response, the schema
 * would refuse it before it reached the wire. This belt-and-braces with the
 * narrow DTO type ensures the privacy guarantee is enforced both at compile
 * time and at runtime.
 *
 *   - `value` is `null` when fewer than 3 contributing Ratings exist (R10.4),
 *     otherwise a number in `[1.0, 10.0]` rendered to one decimal place
 *     (R10.1, R10.3).
 *   - `count` is a non-negative integer (R10.2, R10.3, R10.4).
 *
 * Validates: Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.10
 */

import { z } from 'zod';

export const aggregateRatingSchema = z
  .object({
    value: z.number().min(1).max(10).nullable(),
    count: z.number().int().min(0),
  })
  .strict();
