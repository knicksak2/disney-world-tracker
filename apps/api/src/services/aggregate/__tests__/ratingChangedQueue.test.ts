/**
 * Unit tests for the RatingChanged BullMQ emitter (task 10.4).
 *
 * The tests verify the emitter's external contract without standing up
 * a real Redis: an in-memory queue stub captures every `add(name, data,
 * opts)` call so the assertions can pin the wire payload and the
 * surrounding metadata (job name, queue routing, default options).
 *
 * Coverage:
 *   - emit enqueues exactly one job per call
 *   - the job is named with `RATING_CHANGED_JOB_NAME`
 *   - the payload is exactly `{experienceId, oldValue, newValue}` for
 *     each of the three valid event shapes (set, replace, remove)
 *   - extra fields on the input event are stripped from the on-wire
 *     payload (defensive contract)
 *   - default job options carry production-sane retry/retention
 *     settings (so the worker side can rely on them)
 *   - `close()` delegates to the underlying queue stub
 *
 * Validates: Requirements 10.7, 10.8, 10.9
 */

import { describe, expect, it, vi } from 'vitest';
import type { JobsOptions } from 'bullmq';

import {
  RATING_CHANGED_JOB_NAME,
  RATING_CHANGED_QUEUE_NAME,
  createRatingChangedEmitter,
  type RatingChangedEvent,
  type RatingChangedQueueLike,
} from '../ratingChangedQueue.js';

// ---------------------------------------------------------------------------
// Fake queue
// ---------------------------------------------------------------------------

/**
 * Captures every `add` call so tests can pin the exact name/data/opts
 * triple. Returns a sentinel job object so the emitter's
 * `await queue.add(...)` resolves.
 */
interface RecordedAdd {
  readonly name: string;
  readonly data: RatingChangedEvent;
  readonly opts: JobsOptions | undefined;
}

interface FakeQueueHandle {
  readonly queue: RatingChangedQueueLike;
  readonly adds: RecordedAdd[];
  readonly close: ReturnType<typeof vi.fn>;
}

function buildFakeQueue(): FakeQueueHandle {
  const adds: RecordedAdd[] = [];
  const close = vi.fn();
  close.mockResolvedValue(undefined);
  const queue: RatingChangedQueueLike = {
    async add(name, data, opts) {
      adds.push({ name, data, opts });
      return { id: `${adds.length}` };
    },
    close: () => close() as Promise<void>,
  };
  return { queue, adds, close };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRatingChangedEmitter', () => {
  it('passes the configured connection to the queue factory', async () => {
    const { queue } = buildFakeQueue();
    const factory = vi.fn(() => queue);
    const sentinelConnection = { host: 'fake', port: 0 };

    createRatingChangedEmitter({
      connection: sentinelConnection,
      queueFactory: factory,
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(sentinelConnection);
  });

  it('enqueues a job with the canonical name and payload on a "set" event', async () => {
    const { queue, adds } = buildFakeQueue();
    const { emit } = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
    });

    await emit({
      experienceId: '00000000-0000-5000-8000-000000000001',
      oldValue: null,
      newValue: 7,
    });

    expect(adds).toHaveLength(1);
    const recorded = adds[0]!;
    expect(recorded.name).toBe(RATING_CHANGED_JOB_NAME);
    expect(recorded.data).toEqual({
      experienceId: '00000000-0000-5000-8000-000000000001',
      oldValue: null,
      newValue: 7,
    });
  });

  it('enqueues correct payloads for replace and remove events', async () => {
    const { queue, adds } = buildFakeQueue();
    const { emit } = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
    });

    // Replace: both oldValue and newValue non-null.
    await emit({
      experienceId: '00000000-0000-5000-8000-000000000002',
      oldValue: 4,
      newValue: 9,
    });
    // Remove: newValue null.
    await emit({
      experienceId: '00000000-0000-5000-8000-000000000003',
      oldValue: 6,
      newValue: null,
    });

    expect(adds).toHaveLength(2);
    expect(adds[0]!.name).toBe(RATING_CHANGED_JOB_NAME);
    expect(adds[0]!.data).toEqual({
      experienceId: '00000000-0000-5000-8000-000000000002',
      oldValue: 4,
      newValue: 9,
    });
    expect(adds[1]!.name).toBe(RATING_CHANGED_JOB_NAME);
    expect(adds[1]!.data).toEqual({
      experienceId: '00000000-0000-5000-8000-000000000003',
      oldValue: 6,
      newValue: null,
    });
  });

  it('strips any extra keys on the input event from the on-wire payload', async () => {
    const { queue, adds } = buildFakeQueue();
    const { emit } = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
    });

    // A future caller mistakenly passes a richer object — the emitter
    // must persist only the documented fields. We cast through unknown
    // because the static type forbids extra keys; the runtime check is
    // the point of this test.
    const richInput = {
      experienceId: '00000000-0000-5000-8000-000000000004',
      oldValue: null,
      newValue: 10,
      userId: 'user-leak',
      secret: 'should-not-survive',
    } as unknown as RatingChangedEvent;
    await emit(richInput);

    expect(adds).toHaveLength(1);
    expect(adds[0]!.data).toEqual({
      experienceId: '00000000-0000-5000-8000-000000000004',
      oldValue: null,
      newValue: 10,
    });
    expect(Object.keys(adds[0]!.data).sort()).toEqual([
      'experienceId',
      'newValue',
      'oldValue',
    ]);
  });

  it('applies retry + retention defaults to enqueued jobs', async () => {
    const { queue, adds } = buildFakeQueue();
    const { emit } = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
    });

    await emit({
      experienceId: '00000000-0000-5000-8000-000000000005',
      oldValue: null,
      newValue: 1,
    });

    const opts = adds[0]!.opts;
    expect(opts).toBeDefined();
    expect(opts?.attempts).toBe(3);
    expect(opts?.backoff).toEqual({ type: 'exponential', delay: 250 });
    expect(opts?.removeOnComplete).toEqual({ count: 100 });
    expect(opts?.removeOnFail).toEqual({ count: 100 });
  });

  it('honours an override of defaultJobOptions verbatim', async () => {
    const { queue, adds } = buildFakeQueue();
    const override: JobsOptions = {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    };
    const { emit } = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
      defaultJobOptions: override,
    });

    await emit({
      experienceId: '00000000-0000-5000-8000-000000000006',
      oldValue: null,
      newValue: 5,
    });

    expect(adds[0]!.opts).toEqual(override);
  });

  it('close() delegates to the underlying queue', async () => {
    const { queue, close } = buildFakeQueue();
    const emitter = createRatingChangedEmitter({
      connection: {},
      queueFactory: () => queue,
    });

    await emitter.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('exposes stable queue and job name constants', () => {
    expect(RATING_CHANGED_QUEUE_NAME).toBe('aggregate-rating-changed');
    expect(RATING_CHANGED_JOB_NAME).toBe('rating-changed');
  });
});
