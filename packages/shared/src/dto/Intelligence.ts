import type { Park } from '../enums.js';

export interface CrowdCalendarDayDTO {
  readonly date: string; // YYYY-MM-DD
  readonly park: Park;
  /** Display-scale 1-10 level, projected from the continuous ratio at render time. */
  readonly forecastIndex: number;
  /** Display-scale 1-10 level actually observed. Present only for finalized past dates. */
  readonly observedIndex?: number;
  /**
   * R7.5: the forecast **as originally issued** for this date, read from the
   * frozen `crowd_forecast_log` — never a value recomputed now with hindsight.
   *
   * Reporting a recomputed forecast as "what we predicted" would flatter the
   * model: today's forecast for a past date can see the observed index and
   * simply return it. This is the honest version, and `leadDays` says how far
   * ahead the claim was made.
   */
  readonly capturedForecast?: {
    readonly index: number; // display-scale 1-10
    readonly leadDays: number;
    readonly capturedAt: string; // ISO8601
  };
  /**
   * R7.5: recent measured accuracy at the same lead time, so the number the user
   * sees carries its own error bar. Expressed in display levels (a 0.2 ratio
   * error is 1.0 level) because that is the scale the UI shows.
   */
  readonly forecastAccuracy?: {
    readonly meanAbsoluteErrorLevels: number;
    readonly leadDays: number;
    readonly sampleCount: number;
  };
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
  readonly showtimesAreTypical?: boolean;
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
