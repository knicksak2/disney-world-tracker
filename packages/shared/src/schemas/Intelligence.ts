import { z } from 'zod';
import { parkSchema } from './primitives.js';

export const crowdCalendarDaySchema = z.object({
  date: z.string(),
  park: parkSchema,
  forecastIndex: z.number(),
  observedIndex: z.number().optional(),
  parkHours: z.object({
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
  }),
  earlyEntry: z.boolean(),
  extendedEvening: z.boolean(),
  ticketedEvent: z.boolean(),
  llMultipassPriceCents: z.number().optional(),
  festival: z.string().optional(),
  rideSignals: z.array(z.object({
    experienceId: z.string().uuid(),
    reliability: z.number(),
    llSelloutMedianHour: z.number().optional(),
    showtimes: z.array(z.string()).optional(),
  })).optional(),
});

export const waitSnapshotSchema = z.object({
  experienceId: z.string().uuid(),
  isVirtualQueue: z.boolean(),
  showtimes: z.array(z.string()).optional(),
  showtimesAreTypical: z.boolean().optional(),
  lightningLane: z.object({
    available: z.boolean(),
    priceCents: z.number().optional(),
    returnTime: z.string().optional(),
  }).optional(),
  waits: z.array(z.object({
    hour: z.number(),
    predictedWaitMinutes: z.number(),
    singleRiderWaitMinutes: z.number().optional(),
  })),
});

export const waitInsightsSchema = z.object({
  experienceId: z.string().uuid(),
  p50WaitMinutes: z.number(),
  p90WaitMinutes: z.number(),
  cv: z.number(),
  bestHour: z.number().optional(),
  worstHour: z.number().optional(),
  escalationRate: z.number().optional(),
  downRate: z.number(),
  llSelloutMedianHour: z.number().optional(),
  eventHighlights: z.array(z.object({
    eventType: z.string(),
    waitMultiplier: z.number(),
  })).optional(),
  cascadeHighlights: z.array(z.object({
    downExperienceId: z.string().uuid(),
    waitPctDelta: z.number(),
  })).optional(),
  waits: z.array(z.object({
    hour: z.number(),
    predictedWaitMinutes: z.number(),
  })).optional(),
  sampleCount: z.number(),
  hasSingleRider: z.boolean(),
  singleRiderP50WaitMinutes: z.number().optional(),
  llMultipassPriceCents: z.number().optional(),
});
