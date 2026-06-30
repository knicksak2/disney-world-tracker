/**
 * Live_Detail DTOs.
 *
 * The category-specific live operational information served by the
 * `Live_Service` for a single Experience, projected from the ThemeParks_API
 * per-entity live endpoint (`/entity/{id}/live`) into a narrow, validated
 * shape. All times are ISO-8601 instants on the wire; the App renders them in
 * the Park's local time zone.
 *
 * Every optional field is present only when the upstream response provides a
 * valid value for it (R1.10): `status` is always present (`Unknown` when the
 * upstream omits or does not recognize the status, R1.4); `showtimes`,
 * `operatingHours`, and `diningAvailability` are always arrays (possibly
 * empty, R1.21); and a paid return window carries the upstream price strings
 * verbatim (R1.14).
 *
 * Validates: Requirements 1.2, 1.10, 1.14, 1.17, 1.21, 1.22, 2.5
 */

/**
 * Current operational state of an Experience. `Unknown` is assigned when the
 * upstream status is unrecognized or absent (R1.3, R1.4).
 */
export type OperatingStatus =
  | 'Operating'
  | 'Closed'
  | 'Down'
  | 'Refurbishment'
  | 'Unknown';

/** State of a Lightning Lane / virtual return-time queue (R1.13). */
export type ReturnWindowState = 'Available' | 'Temporarily_Full' | 'Finished';

/** Allocation status of a virtual queue (boarding group) (R1.15). */
export type BoardingGroupAllocation = 'Available' | 'Paused' | 'Closed';

/**
 * A Lightning Lane or virtual return-time queue. Optional start/end times are
 * carried only when present, expressed in the Park's local time zone (R1.13).
 */
export interface ReturnWindow {
  readonly state: ReturnWindowState;
  /** Park-local return-window start instant, ISO-8601. Absent when not provided. */
  readonly start?: string;
  /** Park-local return-window end instant, ISO-8601. Absent when not provided. */
  readonly end?: string;
}

/**
 * A paid Lightning Lane return-time queue. Carries the same fields as a
 * `ReturnWindow` plus the price amount, currency, and formatted price string
 * exactly as provided by the ThemeParks_API (R1.14).
 */
export interface PaidReturnWindow extends ReturnWindow {
  readonly price: {
    readonly amount: number;
    readonly currency: string;
    /** Formatted price string carried verbatim from upstream (R1.14). */
    readonly formatted: string;
  };
}

/**
 * A virtual queue (boarding group) state (R1.15). The current group range,
 * next allocation time, and estimated wait are carried only when present.
 */
export interface BoardingGroupStatus {
  readonly allocation: BoardingGroupAllocation;
  readonly currentGroupStart?: number;
  readonly currentGroupEnd?: number;
  /** Park-local next-allocation instant, ISO-8601. */
  readonly nextAllocationTime?: string;
  /** Estimated wait, whole minutes in [0, 1440]. */
  readonly estimatedWaitMinutes?: number;
}

/**
 * A single best-effort wait-time forecast entry (R1.16). The whole forecast is
 * represented as absent when missing or unparseable (R1.17).
 */
export interface ForecastEntry {
  /** Park-local forecast instant, ISO-8601. */
  readonly time: string;
  /** Predicted standby wait, whole minutes in [0, 1440]. */
  readonly waitMinutes: number;
  /** Relative busyness index, 0 to 100 inclusive. */
  readonly percentage: number;
}

/**
 * A scheduled performance occurrence on the current day (R1.7, R1.18). The
 * end time and the `type` label are carried only when present.
 */
export interface Showtime {
  /** Park-local start instant, ISO-8601, current day. */
  readonly start: string;
  /** Park-local end instant, ISO-8601. */
  readonly end?: string;
  /** Showtime_Type label when present upstream (R1.18). */
  readonly type?: string;
}

/**
 * The opening and closing times for a Restaurant on the current day (R1.19).
 * The `type` label (Operating_Hours_Type) is carried only when present.
 */
export interface OperatingHours {
  /** Park-local opening instant, ISO-8601, current day. */
  readonly open: string;
  /** Park-local closing instant, ISO-8601, current day. */
  readonly close: string;
  /** Operating_Hours_Type label when present upstream (R1.19). */
  readonly type?: string;
}

/**
 * A single walk-up dining waitlist entry (R1.20). Party size and estimated
 * wait are carried only when present.
 */
export interface DiningAvailabilityEntry {
  readonly partySize?: number;
  /** Estimated wait, whole minutes in [0, 1440]. */
  readonly estimatedWaitMinutes?: number;
}

/**
 * The projected live operational detail for a single Experience. Contains only
 * the fields present in the upstream response (R1.2, R1.10); `status` is
 * always present and `showtimes`/`operatingHours`/`diningAvailability` are
 * always arrays (possibly empty).
 */
export interface LiveDetailDTO {
  /** Operating_Status; always present (`Unknown` when absent upstream, R1.4). */
  readonly status: OperatingStatus;
  /** Standby Wait_Time, whole minutes in [0, 1440] (R1.5, R1.6). */
  readonly waitMinutes?: number;
  /** Single_Rider_Wait, whole minutes in [0, 1440] (R1.11, R1.12). */
  readonly singleRiderWaitMinutes?: number;
  readonly returnWindow?: ReturnWindow;
  readonly paidReturnWindow?: PaidReturnWindow;
  readonly boardingGroup?: BoardingGroupStatus;
  /** Wait_Time_Forecast; absent when missing/unparseable (R1.17). */
  readonly forecast?: readonly ForecastEntry[];
  /** Current-day Showtimes; possibly empty (R1.7, R1.18). */
  readonly showtimes: readonly Showtime[];
  /** Current-day Operating_Hours; possibly empty (R1.19). */
  readonly operatingHours: readonly OperatingHours[];
  /** Walk-up Dining_Availability; possibly empty (R1.20, R1.21). */
  readonly diningAvailability: readonly DiningAvailabilityEntry[];
  /** Upstream_Last_Updated; distinct from Retrieved_At (R1.22). */
  readonly upstreamLastUpdated?: string;
}

/**
 * The HTTP response envelope wrapping a `LiveDetailDTO` with the retrieval
 * metadata served to the App.
 */
export interface LiveDetailResponseDTO {
  readonly liveDetail: LiveDetailDTO;
  /** Retrieved_At time of the served Live_Detail (R2.5). */
  readonly retrievedAt: string;
  /** Stale indicator (R2.6, R2.7, R3.1, R3.5). */
  readonly stale: boolean;
}
