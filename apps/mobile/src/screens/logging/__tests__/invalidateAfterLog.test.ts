import type { QueryClient } from '@tanstack/react-query';

import { tripFeedKeys } from '../../trips/tripFeedQueryKeys';
import { tripsListKeys } from '../../trips/TripsListScreen';
import { invalidateAfterLog } from '../invalidateAfterLog';

describe('invalidateAfterLog', () => {
  let invalidatedKeys: unknown[];
  let mockQueryClient: QueryClient;

  beforeEach(() => {
    invalidatedKeys = [];
    mockQueryClient = {
      invalidateQueries: jest.fn(({ queryKey }: { queryKey: unknown }) => {
        invalidatedKeys.push(queryKey);
        return Promise.resolve();
      }),
    } as unknown as QueryClient;
  });

  it('invalidates personal experience keys, global stats, and trips list when tripId is null', () => {
    const experienceId = 'exp-123';
    invalidateAfterLog(mockQueryClient, { experienceId, tripId: null });

    expect(invalidatedKeys).toEqual([
      ['experience-logs', 'exp-123'],
      ['experience-completion', 'exp-123'],
      ['experience-rating', 'exp-123'],
      ['experience-aggregate', 'exp-123'],
      ['scoped-food-item-logs', 'exp-123'],
      ['me-stats'],
      ['me', 'trips', 'active'],
      tripsListKeys.list(),
    ]);
  });

  it('invalidates personal keys plus trip feed, summary, and planned items when tripId is non-null', () => {
    const experienceId = 'exp-123';
    const tripId = 'trip-456';
    invalidateAfterLog(mockQueryClient, { experienceId, tripId });

    expect(invalidatedKeys).toEqual([
      ['experience-logs', 'exp-123'],
      ['experience-completion', 'exp-123'],
      ['experience-rating', 'exp-123'],
      ['experience-aggregate', 'exp-123'],
      ['scoped-food-item-logs', 'exp-123'],
      ['me-stats'],
      ['me', 'trips', 'active'],
      tripsListKeys.list(),
      tripFeedKeys.feed('trip-456'),
      ['trips', 'trip-456', 'summary'],
      ['trips', 'trip-456', 'planned-items'],
    ]);
  });
});

