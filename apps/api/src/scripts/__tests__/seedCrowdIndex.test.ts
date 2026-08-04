import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { runSeedCrowdIndex } from '../seedCrowdIndexLogic.js';
import type { IntelligenceRepo } from '../../services/intelligence/IntelligenceRepo.js';

// Fixture mirrors the REAL WDW Passport month-page markup: <h4> carries classes,
// the crowd bubble div has a long class list, and each day cell has an overall
// crowd bubble (with no preceding <h4>) that must NOT be captured as a park.
const REAL_MARKUP = `
  <div class="md:grid-cols-7 grid">
    <a href="https://wdwpassport.com/past-crowds/june-2026/15" class="crowd-day-level-6 border-b border-r px-3 py-4 text-sm">
      <div class="flex items-center">
        <div class="crowd-bubble-level-6 mr-auto inline-flex h-8 w-8 items-center justify-center rounded-full font-semibold leading-none"> 6 </div>
        <div class="w-5 text-center text-lg font-medium text-black">15</div>
      </div>
      <ul class="mt-3 space-y-2">
        <li class="flex items-center text-xs"> <h4 class="flex-1 text-right leading-tight">Magic Kingdom</h4> <div class="crowd-bubble-level-10 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 font-semibold leading-none text-gray-600">10</div> </li>
        <li class="flex items-center text-xs"> <h4 class="flex-1 text-right leading-tight">Epcot</h4> <div class="crowd-bubble-level-7 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 font-semibold leading-none text-gray-600">7</div> </li>
        <li class="flex items-center text-xs"> <h4 class="flex-1 text-right leading-tight">Animal Kingdom</h4> <div class="crowd-bubble-level-1 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 font-semibold leading-none text-gray-600">1</div> </li>
        <li class="flex items-center text-xs"> <h4 class="flex-1 text-right leading-tight">Typhoon Lagoon</h4> <div class="crowd-bubble-level-5 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 font-semibold leading-none text-gray-600">5</div> </li>
      </ul>
    </a>
    <a href="https://wdwpassport.com/past-crowds/june-2026/16" class="crowd-day-level-3 border-b border-r px-3 py-4 text-sm">
      <div class="flex items-center">
        <div class="crowd-bubble-level-3 mr-auto inline-flex h-8 w-8 items-center justify-center rounded-full font-semibold leading-none"> 3 </div>
        <div class="w-5 text-center text-lg font-medium text-black">16</div>
      </div>
      <ul class="mt-3 space-y-2">
        <li class="flex items-center text-xs"> <h4 class="flex-1 text-right leading-tight">Magic Kingdom</h4> <div class="crowd-bubble-level-2 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 font-semibold leading-none text-gray-600">2</div> </li>
      </ul>
    </a>
  </div>
`;

describe('seedCrowdIndexLogic', () => {
  it('parses real-markup day blocks, binds parks to the right date, maps/clamps, and writes source=seed', async () => {
    const mockRepo = {
      upsertParkCrowdIndices: vi.fn().mockResolvedValue(undefined),
    } as unknown as IntelligenceRepo;

    const mockFsLib = {
      readdir: vi.fn().mockResolvedValue(['june-2026.html', 'ignored.txt']),
      readFile: vi.fn().mockResolvedValue(REAL_MARKUP),
    };

    await runSeedCrowdIndex({
      repo: mockRepo,
      dir: '/test/seed-data',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    // Only the .html file is read
    expect(mockFsLib.readFile).toHaveBeenCalledTimes(1);
    expect(mockFsLib.readFile).toHaveBeenCalledWith(join('/test/seed-data', 'june-2026.html'), 'utf8');

    expect(mockRepo.upsertParkCrowdIndices).toHaveBeenCalledTimes(1);
    const rows = (mockRepo.upsertParkCrowdIndices as any).mock.calls[0][0];

    // Day 15: MK, Epcot, Animal Kingdom (Typhoon Lagoon is not a theme park → ignored).
    // Day 16: MK only. Total = 4 rows. The overall day bubbles (6 and 3) are NOT parks.
    expect(rows).toHaveLength(4);

    // Epcot → EPCOT, 7/5 = 1.4, bound to June 15
    expect(rows).toContainEqual(expect.objectContaining({
      park: 'EPCOT', date: new Date('2026-06-15T00:00:00Z'), crowd_index: 1.4,
      daily_avg_wait: 0, sample_count: 0, source: 'seed',
    }));
    // MK level 10 → 2.0, June 15
    expect(rows).toContainEqual(expect.objectContaining({
      park: 'Magic Kingdom', date: new Date('2026-06-15T00:00:00Z'), crowd_index: 2.0, source: 'seed',
    }));
    // Animal Kingdom level 1 → 0.2 clamped to 0.4, June 15
    expect(rows).toContainEqual(expect.objectContaining({
      park: 'Animal Kingdom', date: new Date('2026-06-15T00:00:00Z'), crowd_index: 0.4, source: 'seed',
    }));
    // Day 16 MK level 2 → 0.4, bound to June 16 (proves per-day binding, not the overall level-3 bubble)
    expect(rows).toContainEqual(expect.objectContaining({
      park: 'Magic Kingdom', date: new Date('2026-06-16T00:00:00Z'), crowd_index: 0.4, source: 'seed',
    }));

    // The day-overall bubbles (levels 6 and 3) must not have been captured as parks.
    const badLevel6 = rows.some((r: any) => r.crowd_index === 6 / 5);
    expect(badLevel6).toBe(false);
  });

  it('skips a missing seed directory without throwing', async () => {
    const mockRepo = { upsertParkCrowdIndices: vi.fn() } as unknown as IntelligenceRepo;
    const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
    const mockFsLib = {
      readdir: vi.fn().mockRejectedValue(enoent),
      readFile: vi.fn(),
    };

    await expect(runSeedCrowdIndex({
      repo: mockRepo, dir: '/missing', fsLib: mockFsLib,
      log: vi.fn(), warn: vi.fn(), error: vi.fn(),
    })).resolves.toBeUndefined();
    expect(mockRepo.upsertParkCrowdIndices).not.toHaveBeenCalled();
  });
});
