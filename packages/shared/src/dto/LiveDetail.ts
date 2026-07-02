/**
 * Live_Detail DTOs.
 *
 * The live operational information served for a single Experience, projected
 * from the Disney sources (Status, Dining-Status, Forecast, and Schedule
 * channels) into a narrow, validated shape. All times are ISO-8601 instants on
 * the wire; the App renders them in the Park's local time zone (R9.8).
 *
 * Every optional field is present only when the source provides a valid value
 * for it: `status` is always present (`Unknown` when absent or unrecognized);
 * and `showtimes`, `operatingHours`, and `diningAvailability` are always arrays
 * (possibly empty).
 *
 * The `disney-source-resilience` feature moves the live path to ThemeParks.wiki
 * and adds two optional fields that ThemeParks.wiki uniquely provides — coarse
 * Lightning Lane price/return-window state (`lightningLane`, R11.6) and
 * boarding-group / virtual-queue status (`boardingGroup`, R11.7). Both are
 * omitted whenever the upstream does not provide them (R11.8).
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 11.6, 11.7, 11.8
 */

/**
 * Current operational state of an Experience. `Unknown` is assigned when the
 * upstream status is unrecognized or absent (R9.6).
 */
export type OperatingStatus =
  | 'Operating'
  | 'Closed'
  | 'Down'
  | 'Refurbishment'
  | 'Unknown';

/**
 * A single best-effort wait-time forecast entry (R9.4). The whole forecast is
 * represented as absent when missing or unparseable.
 */
export interface ForecastEntry {
  /** Park-local forecast instant, ISO-8601. */
  readonly time: string;
  /** Predicted standby wait, whole minutes in [0, 1440]. */
  readonly waitMinutes: number;
  /** Relative busyness index, 0 to 100 inclusive (R9.4). */
  readonly percentage: number;
}

/**
 * A scheduled performance occurrence on the current day (R9.5). The end time
 * and the `type` label are carried only when present.
 */
export interface Showtime {
  /** Park-local start instant, ISO-8601, current day. */
  readonly start: string;
  /** Park-local end instant, ISO-8601. */
  readonly end?: string;
  /** Showtime_Type label when present upstream. */
  readonly type?: string;
}

/**
 * The opening and closing times for an Experience on the current day (R9.5).
 * The `type` label (Operating_Hours_Type) is carried only when present.
 */
export interface OperatingHours {
  /** Park-local opening instant, ISO-8601, current day. */
  readonly open: string;
  /** Park-local closing instant, ISO-8601, current day. */
  readonly close: string;
  /** Operating_Hours_Type label when present upstream. */
  readonly type?: string;
}

/**
 * A single walk-up dining availability entry from the Dining_Status_Channel
 * (R9.3). The party-size status, party size, and estimated wait are each
 * carried only when present.
 */
export interface DiningAvailabilityEntry {
  /** Walk-up availability status for the party size, when present (R9.3). */
  readonly status?: string;
  /** Party size the entry applies to, when present (R9.3). */
  readonly partySize?: number;
  /** Estimated wait, whole minutes in [0, 1440], when present (R9.3). */
  readonly estimatedWaitMinutes?: number;
}

/**
 * Coarse Lightning Lane price and return-window state for an Experience,
 * sourced only from the ThemeParks.wiki `paidReturnWindow` data (R11.6).
 * Present only when ThemeParks.wiki provides it; every field within is itself
 * carried only when present and parseable (R11.8).
 */
export interface LightningLaneState {
  /** Whether a paid return window is currently offered, when present. */
  readonly available?: boolean;
  /** Coarse Lightning Lane price, when present. */
  readonly price?: {
    /** Price amount in the currency's minor/major unit as reported upstream. */
    readonly amount: number;
    /** ISO-4217 currency code, e.g. `USD`. */
    readonly currency: string;
  };
  /** Park-local return-window start instant, ISO-8601, when present. */
  readonly returnStart?: string;
  /** Park-local return-window end instant, ISO-8601, when present. */
  readonly returnEnd?: string;
  /** Coarse state label, e.g. `AVAILABLE` | `SOLD_OUT`, when present. */
  readonly state?: string;
}

/**
 * Boarding-group / virtual-queue status for an Experience, sourced only from
 * the ThemeParks.wiki `boardingGroup` data (R11.7). Present only when
 * ThemeParks.wiki provides it; every field within is itself carried only when
 * present and parseable (R11.8).
 */
export interface BoardingGroupState {
  /** Whether boarding-group enrollment is currently available, when present. */
  readonly available?: boolean;
  /** Current allocated group range start, when present. */
  readonly currentGroupStart?: number;
  /** Current allocated group range end, when present. */
  readonly currentGroupEnd?: number;
  /** Coarse state label, when present. */
  readonly state?: string;
}

/**
 * The projected live operational detail for a single Experience. Contains only
 * the fields the upstream provides (R11.8); `status` is always present and
 * `showtimes`/`operatingHours`/`diningAvailability` are always arrays (possibly
 * empty). The `lightningLane` and `boardingGroup` fields are carried only when
 * ThemeParks.wiki provides them (R11.6, R11.7).
 */
export interface LiveDetailDTO {
  /** Operating_Status; always present (`Unknown` when absent upstream, R9.6). */
  readonly status: OperatingStatus;
  /** Standby wait, whole minutes in [0, 1440] (R9.2). */
  readonly waitMinutes?: number;
  /** Single_Rider_Wait, whole minutes in [0, 1440] (R9.2). */
  readonly singleRiderWaitMinutes?: number;
  /** Wait_Time_Forecast; absent when missing/unparseable (R9.4). */
  readonly forecast?: readonly ForecastEntry[];
  /** Current-day Showtimes; possibly empty (R9.5). */
  readonly showtimes: readonly Showtime[];
  /** Current-day Operating_Hours; possibly empty (R9.5). */
  readonly operatingHours: readonly OperatingHours[];
  /** Walk-up Dining_Availability; possibly empty (R9.3). */
  readonly diningAvailability: readonly DiningAvailabilityEntry[];
  /** Coarse Lightning Lane state; present only when ThemeParks.wiki provides it (R11.6). */
  readonly lightningLane?: LightningLaneState;
  /** Boarding-group status; present only when ThemeParks.wiki provides it (R11.7). */
  readonly boardingGroup?: BoardingGroupState;
  /** Upstream_Last_Updated; distinct from Retrieved_At. */
  readonly upstreamLastUpdated?: string;
}

/**
 * The HTTP response envelope wrapping a `LiveDetailDTO` with the retrieval
 * metadata served to the App.
 */
export interface LiveDetailResponseDTO {
  readonly liveDetail: LiveDetailDTO;
  /** Retrieved_At time of the served Live_Detail. */
  readonly retrievedAt: string;
  /** Stale indicator (R12.10). */
  readonly stale: boolean;
}
