import type { Park } from '../enums.js';

export interface CrowdCalendarDayDTO {
  readonly date: string; // YYYY-MM-DD
  readonly park: Park;
  readonly forecastIndex: number;
  readonly observedIndex?: number;
  readonly parkHours: {
    readonly openTime?: string; // ISO8601
    readonly closeTime?: string;
  };
  readonly earlyEntry: boolean;
  readonly extendedEvening: boolean;
  readonly ticketedEvent: boolean;
  readonly llMultipassPriceCents?: number;
  readonly festival?: string;
  // Day-detail extras
  readonly rideSignals?: readonly {
    readonly experienceId: string;
    readonly reliability: number; // 1 - down_rate
    readonly llSelloutMedianHour?: number;
    readonly showtimes?: readonly string[];
  }[];
}

export interface WaitSnapshot {
  readonly experienceId: string;
  readonly isVirtualQueue: boolean;
  readonly showtimes?: readonly string[];
  readonly lightningLane?: {
    readonly available: boolean;
    readonly priceCents?: number;
    readonly returnTime?: string;
  };
  readonly waits: readonly {
    readonly hour: number;
    readonly predictedWaitMinutes: number;
    readonly singleRiderWaitMinutes?: number;
  }[];
}

export interface WaitInsightsDTO {
  readonly experienceId: string;
  readonly p50WaitMinutes: number;
  readonly p90WaitMinutes: number;
  readonly cv: number; // Coefficient of Variation
  readonly bestHour?: number;
  readonly worstHour?: number;
  readonly escalationRate?: number; // Rope-drop value
  readonly downRate: number; // Reliability
  readonly llSelloutMedianHour?: number;
  readonly eventHighlights?: readonly {
    readonly eventType: string;
    readonly waitMultiplier: number;
  }[];
  readonly cascadeHighlights?: readonly {
    readonly downExperienceId: string;
    readonly waitPctDelta: number;
  }[];
  readonly waits?: readonly {
    readonly hour: number;
    readonly predictedWaitMinutes: number;
  }[];
  readonly sampleCount: number;
  readonly hasSingleRider: boolean;
  readonly singleRiderP50WaitMinutes?: number;
  readonly llMultipassPriceCents?: number;
}
