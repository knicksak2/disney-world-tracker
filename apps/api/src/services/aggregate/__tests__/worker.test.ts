/**
 * Unit tests for the aggregate worker (task 8.3).
 *
 * The aggregate worker consumes jobs from the
 * `aggregate-rating-changed` queue and forwards each
 * `RatingChanged{experienceId, oldValue, newValue}` payload to
 * {@link AggregateRepo.updateAggregate}. The reconciler scheduler
 * (covered by `reconcileScheduler.test.ts`) is a separate concern.
 *
 * We never stand up a real Redis or BullMQ broker. Instead, the
 * `workerFactory` injection point lets us substitute a fake
 * `Worker`-shaped object that:
 *
 *   - captures the queue name, processor, and worker options;
 *   - exposes a `runJob(payload)` helper so tests can drive the
 *     processor with a synthesized job.
 *
 * Coverage:
 *   - The worker subscribes to {@link RATING_CHANGED_QUEUE_NAME} with
 *     the configured concurrency.
 *   - The processor forwards `(experienceId, oldValue, newValue)` to
 *     `repo.updateAggregate` for set, replace, and remove events.
 *   - A repo failure propagates so BullMQ schedules a retry.
 *   - `close()` delegates to the worker's `close()`.
 *
 * Validates: Requirements 10.7
 */

import { describe, expect, it, vi } from 'vitest';
import type { Worker } from 'bullmq';

import {
  RATING_CHANGED_JOB_NAME,
  RATING_CHANGED_QUEUE_NAME,
  type RatingChangedEvent,
} from '../ratingChangedQueue.js';
import type { AggregateRepo, AggregateRatingState } from '../repo.js';
import { startAggregateWorker } from '../worker.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeWorkerHandle {
  worker: Worker;
  readonly captured: {
    name: string;
    processor: (job: { id?: string; name: string; data: RatingChangedEvent }) => Promise<unknown>;
    opts: Record<string, unknown>;
  };
  runJob(
    data: RatingChangedEvent,
    meta?: { id?: string; name?: string },
  ): Promise<unknown>;
  closed: boolean;
}

/**
 * Build a fake `workerFactory` that captures the registered processor
 * and exposes a `runJob` helper plus a `close()` recorder. Returns
 * both the factory and the handle the tests inspect.
 */
function makeFakeWorkerFactory(): {
  factory: NonNullable<Parameters<typeof startAggregateWorker>[0]['workerFactory']>;
  handle: FakeWorkerHandle;
} {
  const handle: FakeWorkerHandle = {
    worker: {} as Worker, // populated below
    captured: {
      name: '',
      processor: async () => undefined,
      opts: {},
    },
    runJob: async () => undefined,
    closed: false,
  };

  const close = vi.fn(async () => {
    handle.closed = true;
  });

  const onHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const fakeWorker = {
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = onHandlers.get(event) ?? [];
      list.push(listener);
      onHandlers.set(event, list);
      return fakeWorker;
    },
    close,
  } as unknown as Worker;

  handle.worker = fakeWorker;

  const factory: NonNullable<
    Parameters<typeof startAggregateWorker>[0]['workerFactory']
  > = (name, processor, opts) => {
    handle.captured.name = name;
    handle.captured.processor = processor as FakeWorkerHandle['captured']['processor'];
    handle.captured.opts = opts as unknown as Record<string, unknown>;
    handle.runJob = (data, meta) =>
      handle.captured.processor({
        id: meta?.id ?? 'job-1',
        name: meta?.name ?? RATING_CHANGED_JOB_NAME,
        data,
      });
    return fakeWorker;
  };

  return { factory, handle };
}

interface RecordingRepo extends AggregateRepo {
  readonly calls: Array<{
    method: 'updateAggregate' | 'recomputeFromScratch' | 'getAggregate' | 'listExperienceIdsForReconcile';
    args: ReadonlyArray<unknown>;
  }>;
}

function makeRepo(
  overrides: Partial<AggregateRepo> = {},
): RecordingRepo {
  const calls: RecordingRepo['calls'] = [];
  const dummyState: AggregateRatingState = {
    experienceId: 'unused',
    sum: 0,
    count: 0,
    meanX10: null,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };
  const repo: AggregateRepo = {
    updateAggregate:
      overrides.updateAggregate ??
      (async (experienceId, oldValue, newValue) => {
        calls.push({
          method: 'updateAggregate',
          args: [experienceId, oldValue, newValue],
        });
        return { ...dummyState, experienceId };
      }),
    recomputeFromScratch:
      overrides.recomputeFromScratch ??
      (async (experienceId) => {
        calls.push({ method: 'recomputeFromScratch', args: [experienceId] });
        return { ...dummyState, experienceId };
      }),
    getAggregate:
      overrides.getAggregate ??
      (async (experienceId) => {
        calls.push({ method: 'getAggregate', args: [experienceId] });
        return null;
      }),
    listExperienceIdsForReconcile:
      overrides.listExperienceIdsForReconcile ??
      (async () => {
        calls.push({ method: 'listExperienceIdsForReconcile', args: [] });
        return [];
      }),
  };
  // Wire `calls` onto the returned object without breaking the typing.
  return Object.assign(repo, { calls });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startAggregateWorker', () => {
  it('subscribes to the rating-changed queue with the configured concurrency', () => {
    const { factory, handle } = makeFakeWorkerFactory();
    const repo = makeRepo();

    startAggregateWorker({
      connection: {},
      repo,
      concurrency: 7,
      autorun: false,
      workerFactory: factory,
    });

    expect(handle.captured.name).toBe(RATING_CHANGED_QUEUE_NAME);
    expect(handle.captured.opts.concurrency).toBe(7);
    expect(handle.captured.opts.autorun).toBe(false);
  });

  it('forwards a "set" event to repo.updateAggregate(experienceId, null, value)', async () => {
    const { factory, handle } = makeFakeWorkerFactory();
    const repo = makeRepo();

    startAggregateWorker({
      connection: {},
      repo,
      autorun: false,
      workerFactory: factory,
    });

    await handle.runJob({
      experienceId: '00000000-0000-5000-8000-000000000010',
      oldValue: null,
      newValue: 7,
    });

    expect(repo.calls).toEqual([
      {
        method: 'updateAggregate',
        args: ['00000000-0000-5000-8000-000000000010', null, 7],
      },
    ]);
  });

  it('forwards replace and remove events with the right (oldValue, newValue) pair', async () => {
    const { factory, handle } = makeFakeWorkerFactory();
    const repo = makeRepo();

    startAggregateWorker({
      connection: {},
      repo,
      autorun: false,
      workerFactory: factory,
    });

    await handle.runJob({
      experienceId: '00000000-0000-5000-8000-000000000020',
      oldValue: 4,
      newValue: 9,
    });
    await handle.runJob({
      experienceId: '00000000-0000-5000-8000-000000000030',
      oldValue: 6,
      newValue: null,
    });

    expect(repo.calls).toEqual([
      {
        method: 'updateAggregate',
        args: ['00000000-0000-5000-8000-000000000020', 4, 9],
      },
      {
        method: 'updateAggregate',
        args: ['00000000-0000-5000-8000-000000000030', 6, null],
      },
    ]);
  });

  it('lets repo errors propagate so BullMQ can retry the job', async () => {
    const { factory, handle } = makeFakeWorkerFactory();
    const failure = new Error('advisory lock contended');
    const repo = makeRepo({
      updateAggregate: async () => {
        throw failure;
      },
    });

    startAggregateWorker({
      connection: {},
      repo,
      autorun: false,
      workerFactory: factory,
    });

    await expect(
      handle.runJob({
        experienceId: '00000000-0000-5000-8000-000000000040',
        oldValue: null,
        newValue: 5,
      }),
    ).rejects.toBe(failure);
  });

  it('close() delegates to the underlying worker', async () => {
    const { factory, handle } = makeFakeWorkerFactory();
    const repo = makeRepo();
    const ws = startAggregateWorker({
      connection: {},
      repo,
      autorun: false,
      workerFactory: factory,
    });

    expect(handle.closed).toBe(false);
    await ws.close();
    expect(handle.closed).toBe(true);
  });
});
