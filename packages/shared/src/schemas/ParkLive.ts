import { z } from 'zod';
import { parkSchema } from './primitives.js';
import { lightningLaneStateSchema } from './LiveDetail.js';
import type { ParkLiveEntryDTO, ParkLiveSnapshotDTO } from '../dto/ParkLive.js';

export const parkLiveEntrySchema = z.object({
  experienceId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  waitMinutes: z.number().int().min(0).max(1440).nullable(),
  lightningLane: lightningLaneStateSchema.optional(),
});

export const parkLiveSnapshotSchema = z.object({
  park: parkSchema,
  entries: z.array(parkLiveEntrySchema),
  retrievedAt: z.string(),
  stale: z.boolean(),
});

export type { ParkLiveEntryDTO, ParkLiveSnapshotDTO };
