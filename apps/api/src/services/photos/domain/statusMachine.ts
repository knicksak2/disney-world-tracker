import { type PhotoStatus, type PhotoRejectReason, type PhotoTargetKind } from '@dwt/shared';
import { nextAttemptAt, shouldEscalate } from './retryPolicy.js';

const ALLOWED_TRANSITIONS: ReadonlyMap<PhotoStatus, ReadonlySet<PhotoStatus>> = new Map([
  ['uploading', new Set<PhotoStatus>(['pending', 'deleted'])],
  ['pending', new Set<PhotoStatus>(['approved', 'rejected', 'needs_review', 'deleted'])],
  ['needs_review', new Set<PhotoStatus>(['approved', 'rejected', 'deleted'])],
  ['approved', new Set<PhotoStatus>(['hidden', 'deleted'])],
  ['hidden', new Set<PhotoStatus>(['approved', 'deleted'])],
  ['rejected', new Set<PhotoStatus>(['deleted'])],
  ['deleted', new Set<PhotoStatus>()],
]);

export function canTransition(from: PhotoStatus, to: PhotoStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function servingCleanupAfterZeroRows(status: PhotoStatus): 'keep' | 'delete_serving_keys' {
  if (status === 'approved' || status === 'hidden') {
    return 'keep';
  }
  return 'delete_serving_keys';
}

export interface StatusMachineRow {
  status: PhotoStatus;
  attempts: number;
  harmVerdict?: 'pass' | 'flag' | null;
  visionVerdict?: 'pass' | 'reject' | null;
  targetKind: PhotoTargetKind;
}

export interface StatusMachineConfig {
  maxAttempts: number;
}

export type ModerationOutcome =
  | { kind: 'retryable'; code: string }
  | { kind: 'invalid_image' }
  | { kind: 'harm_flag' }
  | { kind: 'vision_reject'; reason: PhotoRejectReason }
  | { kind: 'publish_success' };

export type StatusPatch =
  | {
      status: 'pending';
      nextAttemptAt: Date;
      leaseUntil: null;
      lastErrorCode: string;
      harmVerdict?: 'pass' | 'flag' | null;
      visionVerdict?: 'pass' | 'reject' | null;
    }
  | {
      status: 'needs_review';
      lastErrorCode: string;
      leaseUntil: null;
      harmVerdict?: 'pass' | 'flag' | null;
      visionVerdict?: 'pass' | 'reject' | null;
    }
  | {
      status: 'rejected';
      rejectReason: PhotoRejectReason;
      moderatedAt: Date;
      harmVerdict?: 'pass' | 'flag' | null;
      visionVerdict?: 'pass' | 'reject' | null;
    }
  | {
      status: 'approved';
      harmVerdict: 'pass';
      visionVerdict: 'pass' | null;
      approvedByOperator?: boolean;
      moderatedAt: Date;
      servedAt: Date;
    };

export function applyOutcome(
  row: StatusMachineRow,
  outcome: ModerationOutcome,
  now: Date,
  cfg: StatusMachineConfig
): StatusPatch {
  switch (outcome.kind) {
    case 'retryable': {
      if (shouldEscalate(row.attempts, cfg.maxAttempts)) {
        return {
          status: 'needs_review',
          lastErrorCode: outcome.code,
          leaseUntil: null,
        };
      }
      return {
        status: 'pending',
        nextAttemptAt: nextAttemptAt(now, row.attempts),
        leaseUntil: null,
        lastErrorCode: outcome.code,
      };
    }
    case 'invalid_image':
      return {
        status: 'rejected',
        rejectReason: 'invalid_image',
        moderatedAt: now,
      };
    case 'harm_flag':
      return {
        status: 'rejected',
        rejectReason: 'harm',
        harmVerdict: 'flag',
        moderatedAt: now,
      };
    case 'vision_reject':
      return {
        status: 'rejected',
        rejectReason: outcome.reason,
        visionVerdict: 'reject',
        moderatedAt: now,
      };
    case 'publish_success':
      return {
        status: 'approved',
        harmVerdict: 'pass',
        visionVerdict: row.targetKind === 'food_log' ? 'pass' : null,
        moderatedAt: now,
        servedAt: now,
      };
  }
}

export function operatorApprovePatch(
  row: { targetKind: PhotoTargetKind },
  now: Date = new Date()
): {
  status: 'approved';
  harmVerdict: 'pass';
  visionVerdict: 'pass' | null;
  approvedByOperator: true;
  moderatedAt: Date;
  servedAt: Date;
} {
  return {
    status: 'approved',
    harmVerdict: 'pass',
    visionVerdict: row.targetKind === 'food_log' ? 'pass' : null,
    approvedByOperator: true,
    moderatedAt: now,
    servedAt: now,
  };
}
