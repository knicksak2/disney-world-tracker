import { describe, it, expect, vi } from 'vitest';
import { runSeedShapes } from '../seedShapesLogic.js';
import type { IntelligenceRepo } from '../../services/intelligence/IntelligenceRepo.js';
import type { ThemeParksDirectory } from '../../services/live/themeParksDirectory.js';

describe('seedShapes mapping', () => {
  it('maps Enterprise_Id to GUID, fetches RopeDrop, and upserts shapes', async () => {
    const mockRepo = {
      getExperiencesWithUpstreamIds: vi.fn().mockResolvedValue([
        { id: 'exp-1', upstream_entity_id: 'enterprise-123' },
        { id: 'exp-2', upstream_entity_id: 'enterprise-456' },
      ]),
      upsertRideShapes: vi.fn().mockResolvedValue(undefined),
    } as unknown as IntelligenceRepo;

    const mockDirectory = {
      resolveEntityId: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'enterprise-123') return 'guid-abc';
        // Mock a failure for exp-2
        return undefined;
      }),
    } as unknown as ThemeParksDirectory;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      expect(init?.headers?.['User-Agent']).toBe('TestAgent/1.0');

      if (url.includes('guid-abc')) {
        return {
          ok: true,
          json: async () => ({
            best_worst_hours: [
              { dow: 1, hour_et: 9, avg_wait: 45, n: 100 },
              { dow: 1, hour_et: 10, avg_wait: 60, n: 110 },
            ]
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    await runSeedShapes({
      repo: mockRepo,
      directory: mockDirectory,
      fetch: mockFetch as any,
      baseUrl: 'https://ropedropplanner.com/api',
      userAgent: 'TestAgent/1.0',
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      delayMs: 0,
      sleep: async () => {},
    });

    // Validates isolated mapping
    expect(mockDirectory.resolveEntityId).toHaveBeenCalledWith('enterprise-123');
    expect(mockDirectory.resolveEntityId).toHaveBeenCalledWith('enterprise-456');

    // Validates URL shape
    expect(mockFetch).toHaveBeenCalledWith('https://ropedropplanner.com/api/analysis/ride/guid-abc', expect.anything());

    // Validates that upsert is called correctly mapped
    expect(mockRepo.upsertRideShapes).toHaveBeenCalledTimes(1);
    const upsertArg = (mockRepo.upsertRideShapes as any).mock.calls[0][0];
    // RopeDrop dow 1 (Sunday) maps to our day_of_week 0.
    expect(upsertArg).toEqual([
      expect.objectContaining({
        experience_id: 'exp-1',
        day_of_week: 0,
        hour: 9,
        avg_wait_minutes: 45,
        sample_count: 100,
      }),
      expect.objectContaining({
        experience_id: 'exp-1',
        day_of_week: 0,
        hour: 10,
        avg_wait_minutes: 60,
        sample_count: 110,
      }),
    ]);
  });

  it('retries on 429 with backoff, then succeeds', async () => {
    const mockRepo = {
      getExperiencesWithUpstreamIds: vi.fn().mockResolvedValue([
        { id: 'exp-1', upstream_entity_id: 'enterprise-123' },
      ]),
      upsertRideShapes: vi.fn().mockResolvedValue(undefined),
    } as unknown as IntelligenceRepo;

    const mockDirectory = {
      resolveEntityId: vi.fn().mockResolvedValue('guid-abc'),
    } as unknown as ThemeParksDirectory;

    // First two calls are rate-limited, third succeeds.
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 429, headers: { get: () => null } };
      return {
        ok: true,
        json: async () => ({ best_worst_hours: [{ dow: 2, hour_et: 11, avg_wait: 30, n: 50 }] }),
      };
    });

    const sleep = vi.fn().mockResolvedValue(undefined);

    await runSeedShapes({
      repo: mockRepo,
      directory: mockDirectory,
      fetch: mockFetch as any,
      baseUrl: 'https://ropedropplanner.com/api',
      userAgent: 'TestAgent/1.0',
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      delayMs: 10,
      maxRetries: 4,
      sleep,
    });

    // 2 retries + 1 success = 3 fetches
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Backed off twice
    expect(sleep).toHaveBeenCalledTimes(2);
    // Ultimately upserted the successful payload
    expect(mockRepo.upsertRideShapes).toHaveBeenCalledTimes(1);
    const upsertArg = (mockRepo.upsertRideShapes as any).mock.calls[0][0];
    expect(upsertArg[0]).toEqual(expect.objectContaining({ experience_id: 'exp-1', hour: 11, sample_count: 50 }));
  });
});
