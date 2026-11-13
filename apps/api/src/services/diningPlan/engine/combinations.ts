/**
 * Combinations of per-stay plan choices (Requirements 25.9, 25.10; design.md "Multi-Stay Extension" step 7;
 * Property 32).
 *
 * Every `compare` stay chooses no plan or one plan available for all its nights; `have_plan` and `no_plan` stays are
 * fixed. With at most 3 `compare` stays there are at most 4^3 = 64 Combinations, each evaluated in full.
 */

import { DINING_PLAN_CODES, type DiningPlanCode, type DiningStayOptionCode } from '@dwt/shared';

import type { PlanStayRuntime } from './stays.js';

export type Assignment = readonly (DiningPlanCode | null)[];

const OPTION_RANK = new Map<DiningPlanCode | null, number>([[null, 0], ...DINING_PLAN_CODES.map((c, i) => [c, i + 1] as const)]);

/** Every Combination: the Cartesian product of the stays' options, in stay (date) order. */
export function enumerateAssignments(stays: readonly PlanStayRuntime[]): Assignment[] {
  let out: (DiningPlanCode | null)[][] = [[]];
  for (const stay of stays) {
    const next: (DiningPlanCode | null)[][] = [];
    for (const partial of out) for (const option of stay.options) next.push([...partial, option]);
    out = next;
  }
  return out;
}

/** Every `compare` stay without a plan; fixed stays keep their option (held plans still apply). */
export function baselineOf(stays: readonly PlanStayRuntime[]): Assignment {
  return stays.map((s) => (s.status === 'compare' ? null : s.options[0]!));
}

/** "`plan` on every `compare` stay where it is available, none elsewhere"; null when no compare stay offers it. */
export function uniformOf(stays: readonly PlanStayRuntime[], plan: DiningPlanCode): Assignment | null {
  if (!stays.some((s) => s.status === 'compare' && s.options.includes(plan))) return null;
  return stays.map((s) => (s.status === 'compare' ? (s.options.includes(plan) ? plan : null) : s.options[0]!));
}

export function sameAssignment(a: Assignment, b: Assignment): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Plans bought: the `compare` stays given a plan (fixed stays are the same in every Combination). */
export function plansBought(stays: readonly PlanStayRuntime[], a: Assignment): number {
  return stays.reduce((n, s, i) => (s.status === 'compare' && a[i] !== null ? n + 1 : n), 0);
}

/**
 * Ranking (Requirement 25.10): the lower total first; then fewer plans bought; then, stay by stay in date order, the
 * option earlier in No_Plan, quick_service, table_service, deluxe.
 */
export function compareRanked(
  stays: readonly PlanStayRuntime[],
  a: { readonly assign: Assignment; readonly totalCents: number },
  b: { readonly assign: Assignment; readonly totalCents: number },
): number {
  if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
  const pa = plansBought(stays, a.assign);
  const pb = plansBought(stays, b.assign);
  if (pa !== pb) return pa - pb;
  for (let i = 0; i < a.assign.length; i += 1) {
    const d = OPTION_RANK.get(a.assign[i]!)! - OPTION_RANK.get(b.assign[i]!)!;
    if (d !== 0) return d;
  }
  return 0;
}

export function assignmentKey(a: Assignment): string {
  return a.map((x) => x ?? 'none').join(',');
}

/** The Combination as the DTO shows it: option code per stay key. */
export function combinationRecord(stays: readonly PlanStayRuntime[], a: Assignment): Record<string, DiningStayOptionCode> {
  return Object.fromEntries(stays.map((s, i) => [s.key, a[i] ?? 'none']));
}
