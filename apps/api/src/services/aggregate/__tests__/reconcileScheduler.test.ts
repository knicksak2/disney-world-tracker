/**
 * Unit tests for `startAggregateReconcileScheduler` (task 8.3).
 *
 * The reconciler walks every Experience known to the repo and calls
 * {@link AggregateRepo.recomputeFromScratch} on each id, every
 * `intervalMs` (default 24h). It is the drift-detection defense in
 * depth described in design.md.
 *
 * The tests do not stand up a real Redis or BullMQ broker. Both
 * `Queue` and `Worker` are stubbed via `vi.mock('bullmq')`. The
 * `workerFactory` injection point is intentionally NOT used here —
 * we want to exercise the `new Worker(...)` path that the production
 * code actually takes, and verify it ends up bound to the right
 * queue/concurrency.
 *
 * Coverage:
 *   - Walks every Experience id and calls `recomputeFromScratch` on
 *     each.
 *   - Continues past per-experience failures and reports the count
 *     of successful recomputes in the job return value.
 *   - Honors a `batchSize` cap.
 *   - Registers the repeatable scheduler entry under the documented
 *     id and interval.
 *   - close() shuts down the worker and queue.
 *
 * Validates: Requirements 10.7 (drift defense)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock BullMQ (vi.hoisted ensures the shared registry is initialized
// before vi.mock's factory runs)
// ---------------------------------------------------------------------------

interface RecordedWorker {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (job: { id?: string; name: string; data?: unknown }) => Promise<any>;
  opts: Record<string, unknown>;
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => {
  return {
    upsertJobScheduler: vi.fn(
      async (
        _id: string,
        _repeat: { every: number },
        _job: { name: string; opts?: unknown },
      ): Promise<unknown> => undefined,
    ),
    queueClose: vi.fn(async (): Promise<void> => undefined),
    recordedWorkers: [] as RecordedWorker[],
  };
});

vi.mock('bullmq', () => {
  class FakeQueue {
    public name: string;
    public opts: unknown;
    public upsertJobScheduler = fakes.upsertJobScheduler;
    public close = fakes.queueClose;
    constructor(name: string, opts: unknown) {
      this.name = name;
      this.opts = opts;
    }
  }
  class FakeWorker {
    public name: string;
    public processor: RecordedWorker['processor'];
    public opts: Record<string, unknown>;
    public on = vi.fn(function (this: FakeWorker, _e: string, _l: unknown) {
      return this;
    });
    public close = vi.fn(async () => undefined);
    constructor(
      name: string,
      processor: RecordedWorker['processor'],
      opts: Record<string, unknown>,
    ) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      fakes.recordedWorkers.push({
        name,
        processor,
        opts,
        on: this.on as RecordedWorker['on'],
        close: this.close as RecordedWorker['close'],
      });
    }
  }
  return { Queue: FakeQueue, Worker: FakeWorker };
});

import {
  AGGREGATE_RECONCILE_INTERVAL_MS,
  AGGREGATE_RECONCILE_JOB_NAME,
  AGGREGATE_RECONCILE_QUEUE_NAME,
  AGGREGATE_RECONCILE_SCHEDULER_ID,
  startAggregateReconcileScheduler,
} from '../worker.js';
import type { AggregateRepo, AggregateRatingState } from '../repo.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<AggregateRepo> = {}): AggregateRepo {
  const dummyState: AggregateRatingState = {
    experienceId: 'unused',
    sum: 0,
    count: 0,
    meanX10: null,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };
  return {
    updateAggregate:
      overrides.updateAggregate ?? (async () => dummyState),
    recomputeFromScratch:
      overrides.recomputeFromScratch ??
      (async (experienceId) => ({ ...dummyState, experienceId })),
    getAggregate: overrides.getAggregate ?? (async () => null),
    listExperienceIdsForReconcile:
      overrides.listExperienceIdsForReconcile ?? (async () => []),
  };
}

beforeEach(() => {
  fakes.recordedWorkers.length = 0;
  fakes.upsertJobScheduler.mockClear();
  fakes.queueClose.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startAggregateReconcileScheduler', () => {
  it('registers the repeatable scheduler entry under the documented id/interval', async () => {
    const repo = makeRepo();
    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      autorun: false,
    });

    expect(fakes.upsertJobScheduler).toHaveBeenCalledTimes(1);
    const args = fakes.upsertJobScheduler.mock.calls[0]!;
    expect(args[0]).toBe(AGGREGATE_RECONCILE_SCHEDULER_ID);
    expect(args[1]).toEqual({ every: AGGREGATE_RECONCILE_INTERVAL_MS });
    const scheduledJob = args[2] as { name: string };
    expect(scheduledJob.name).toBe(AGGREGATE_RECONCILE_JOB_NAME);

    expect(fakes.recordedWorkers).toHaveLength(1);
    expect(fakes.recordedWorkers[0]?.name).toBe(
      AGGREGATE_RECONCILE_QUEUE_NAME,
    );
    // Concurrency forced to 1 so a single in-process reconciler run is the
    // only writer at a time.
    expect(fakes.recordedWorkers[0]?.opts.concurrency).toBe(1);

    await handle.close();
  });

  it('honors an intervalMs override', async () => {
    const repo = makeRepo();
    const customInterval = 1_000;
    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      intervalMs: customInterval,
      autorun: false,
    });

    expect(fakes.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(fakes.upsertJobScheduler.mock.calls[0]![1]).toEqual({
      every: customInterval,
    });

    await handle.close();
  });

  it('walks every Experience id and recomputes each from scratch', async () => {
    const recomputed: string[] = [];
    const repo = makeRepo({
      listExperienceIdsForReconcile: async () => ['exp-a', 'exp-b', 'exp-c'],
      recomputeFromScratch: async (experienceId) => {
        recomputed.push(experienceId);
        return {
          experienceId,
          sum: 0,
          count: 0,
          meanX10: null,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        };
      },
    });

    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      autorun: false,
    });
    const worker = fakes.recordedWorkers[0]!;

    const result = (await worker.processor({
      id: 'job-1',
      name: AGGREGATE_RECONCILE_JOB_NAME,
    })) as { processed: number };

    expect(recomputed).toEqual(['exp-a', 'exp-b', 'exp-c']);
    expect(result.processed).toBe(3);

    await handle.close();
  });

  it('continues past per-experience failures and counts successes only', async () => {
    const repo = makeRepo({
      listExperienceIdsForReconcile: async () => ['exp-a', 'exp-b', 'exp-c'],
      recomputeFromScratch: async (experienceId) => {
        if (experienceId === 'exp-b') {
          throw new Error('boom');
        }
        return {
          experienceId,
          sum: 0,
          count: 0,
          meanX10: null,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        };
      },
    });

    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      autorun: false,
    });
    const worker = fakes.recordedWorkers[0]!;

    const result = (await worker.processor({
      id: 'job-2',
      name: AGGREGATE_RECONCILE_JOB_NAME,
    })) as { processed: number };

    // exp-a and exp-c succeeded; exp-b failed but the run continued.
    expect(result.processed).toBe(2);

    await handle.close();
  });

  it('honors a batchSize cap', async () => {
    const seen: string[] = [];
    const repo = makeRepo({
      listExperienceIdsForReconcile: async () => [
        'exp-a',
        'exp-b',
        'exp-c',
        'exp-d',
        'exp-e',
      ],
      recomputeFromScratch: async (experienceId) => {
        seen.push(experienceId);
        return {
          experienceId,
          sum: 0,
          count: 0,
          meanX10: null,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        };
      },
    });

    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      autorun: false,
      batchSize: 2,
    });
    const worker = fakes.recordedWorkers[0]!;

    const result = (await worker.processor({
      id: 'job-3',
      name: AGGREGATE_RECONCILE_JOB_NAME,
    })) as { processed: number };

    expect(seen).toEqual(['exp-a', 'exp-b']);
    expect(result.processed).toBe(2);

    await handle.close();
  });

  it('close() shuts down the worker and queue', async () => {
    const repo = makeRepo();
    const handle = await startAggregateReconcileScheduler({
      connection: {},
      repo,
      autorun: false,
    });

    await handle.close();

    expect(fakes.recordedWorkers[0]?.close).toHaveBeenCalledTimes(1);
    expect(fakes.queueClose).toHaveBeenCalledTimes(1);
  });
});
