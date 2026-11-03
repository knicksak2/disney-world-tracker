/**
 * Data shapes for Lightning Lane price persistence and quoting.
 *
 * Validates: Requirements 15.7, 15.8, 15.9
 */

import type { LabelCfg } from '../ticketPrices/types.js';

export interface StoredLlRow {
  readonly passType: 'multi' | 'premier' | 'single';
  readonly park: string;
  readonly date: string;
  readonly experienceId: string | null;
  readonly purchaseId: string | null; // single only
  readonly cents: number;
  readonly available: boolean | null;
  readonly capturedAt: Date; // multi: ll_multipass_captured_at; premier: ll_premier_captured_at; single: captured_at (round 4 L1)
}

export interface LlHistoryRow {
  readonly date: string;
  readonly cents: number;
}

export interface LlBook {
  readonly stored: readonly StoredLlRow[]; // rows for the requested keys
  readonly history: ReadonlyMap<string, readonly LlHistoryRow[]>; // key = `${passType}|${park}|${experienceId ?? ''}`
}

export interface ResolveCfg extends LabelCfg {
  readonly llStaleHours: number;
  readonly lookbackDays: number;
  readonly minSamples: number;
  /** Round 5 M3: the planner's permitted-pair map; `resolveLinePrices` passes `pairPermitted = (allowedNumDaysByGroup[group] ?? []).includes(numDays)` to `resolveTicketPrice`. */
  readonly allowedNumDaysByGroup: Readonly<Record<string, readonly number[]>>;
}

