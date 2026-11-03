/**
 * Type-only port and interfaces for Admin Ticket Prices actions.
 *
 * (Review F7, round 4 M3). No runtime code.
 *
 * Validates: Requirements 13.2, 19.1, 19.2, 19.3
 */

export interface AdminTicketPricesState {
  readonly enabled: boolean;
  readonly control: {
    readonly lastAttemptAt: string | null;
    readonly lastProbeAt: string | null;
    readonly blockedUntil: string | null;
    readonly inProgressSince: string | null;
    readonly observedHorizonDate: string | null;
    readonly lastDiagnoseAt: string | null;
    readonly lastStatus: string | null;
    readonly lastError: string | null;
  };
  readonly sets: readonly {
    readonly discountGroup: string;
    readonly numDays: number;
    readonly asOf: string | null;
    readonly horizonDate: string | null;
    readonly rowCount: number;
    readonly windowDays: number | null;
    readonly lastError: string | null;
  }[];
  readonly totalRows: number;
  readonly tableSize: string;
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly adultMk1DayPriceCents: number | null;
}

export interface AdminDiagnoseResult {
  readonly token: { readonly status: number; readonly bytes: number; readonly ms: number };
  readonly prices: {
    readonly status: number;
    readonly bytes: number;
    readonly ms: number;
    readonly wafMarker: boolean;
    readonly startDateSent: string;
    readonly retried: boolean;
  };
  readonly maxPricingCalendarDate: string | null;
  readonly adultMk1DayPriceCents: number | null;
  readonly failure?: {
    readonly call: 'token' | 'prices';
    readonly code: string;
    readonly message?: string;
  };
}

export interface AdminTicketPricesPort {
  /** One read of the control row, every set row, ticket_prices row total, pg_size_pretty size, and the resolved non-secret config. */
  readState(): Promise<AdminTicketPricesState>;

  /** Admin 'Refresh now': same claim as a full run with the attempt cooldown bypassed; returns immediately (async run). */
  runNow(): Promise<{
    readonly outcome: 'started' | 'disabled' | 'blocked' | 'already_running';
    readonly blockedUntil?: string;
  }>;

  /** Two calls, writes no price rows, takes the diagnose claim (60 s minimum interval). */
  diagnose(): Promise<
    | AdminDiagnoseResult
    | { readonly refused: 'blocked' | 'already_running' | 'too_soon'; readonly blockedUntil?: string }
  >;

  /** Sets blocked_until = now + TICKET_PRICES_BLOCK_COOLDOWN_MINUTES, reason 'manual'. Works while the kill switch is on or off. */
  blockNow(): Promise<{ readonly blockedUntil: string }>;
}

