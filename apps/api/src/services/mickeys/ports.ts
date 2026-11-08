/**
 * Ports for Hidden Mickeys service (design.md Ports).
 *
 * Validates: Requirements 6.3, 6.4
 */

export type TextOutcome =
  | { kind: 'ok'; flagged: boolean }
  | { kind: 'retryable'; code: string };

export interface TextScreen {
  check(text: string): Promise<TextOutcome>;
}
