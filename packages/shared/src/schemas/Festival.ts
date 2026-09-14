/**
 * Zod schemas for festival-booth-tagging.
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { z } from 'zod';
import { FESTIVAL_SLUGS } from '../enums.js';

/** FestivalSlug enum schema (R1.2). */
export const festivalSlugSchema = z.enum(FESTIVAL_SLUGS);
