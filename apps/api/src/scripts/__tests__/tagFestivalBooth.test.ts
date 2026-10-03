/**
 * Unit tests for tagFestivalBooth CLI pure helpers and orchestration.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.3, 10.1, 10.2
 */

import { describe, expect, it, vi } from 'vitest';
import { FESTIVAL_SLUGS, FESTIVAL_SLUG_LABELS } from '@dwt/shared';

import {
  buildFestivalMenu,
  formatDiscoveryReport,
  parseArgs,
  runTaggingCli,
} from '../tagFestivalBooth.js';
import type { DiscoveredBooth, FestivalTagRepo } from '../../services/catalog/festivalTags/repo.js';

/** Builds a fully-populated mock FestivalTagRepo, overridable per test. */
function makeMockRepo(overrides: Partial<FestivalTagRepo> = {}): FestivalTagRepo {
  return {
    listActiveFestivalBooths: vi.fn().mockResolvedValue([]),
    listActiveEpcotRestaurantIds: vi.fn().mockResolvedValue([]),
    upsertTags: vi.fn().mockResolvedValue([]),
    upsertFestivalEdition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('tagFestivalBooth CLI pure helpers', () => {
  it('buildFestivalMenu lists all festivals in FESTIVAL_SLUGS order with numbers and labels', () => {
    const menu = buildFestivalMenu();
    const lines = menu.split('\n');
    expect(lines[0]).toBe('Select a festival:');

    FESTIVAL_SLUGS.forEach((slug, idx) => {
      const expectedLabel = FESTIVAL_SLUG_LABELS[slug];
      expect(lines[idx + 1]).toBe(`  ${idx + 1}. ${expectedLabel} (${slug})`);
    });
  });

  it('formatDiscoveryReport renders zero-booths "nothing to do" message', () => {
    const report = formatDiscoveryReport([], 'flower-and-garden', 2026);
    expect(report).toBe('No active festival booths found.');
  });

  it('formatDiscoveryReport renders booths and annotates conflicts only for non-null conflictingTag', () => {
    const booths: DiscoveredBooth[] = [
      {
        experienceId: 'b1',
        name: 'Bauernmarkt',
        park: 'EPCOT',
        conflictingTag: null,
        matchKind: 'facet',
        matchingFoodItemIds: [],
      },
      {
        experienceId: 'b2',
        name: 'Cider House',
        park: 'EPCOT',
        conflictingTag: {
          experienceId: 'b2',
          festivalSlug: 'food-and-wine',
          festivalYear: 2026,
          taggedAt: '2026-01-01T00:00:00.000Z',
          matchKind: 'facet',
        },
        matchKind: 'facet',
        matchingFoodItemIds: [],
      },
    ];

    const report = formatDiscoveryReport(booths, 'flower-and-garden', 2026);
    expect(report).toContain('Discovered 2 active festival booth(s) to tag for EPCOT International Flower & Garden Festival (2026):');
    expect(report).toContain('  - Bauernmarkt [EPCOT]');
    expect(report).not.toContain('Bauernmarkt [EPCOT] [CONFLICT');
    expect(report).toContain(
      "  - Cider House [EPCOT] [CONFLICT: tagged as 'food-and-wine' for 2026 - SKIPPED without --force]",
    );
  });

  it('parseArgs correctly parses --year and --force', () => {
    expect(parseArgs(['--year', '2026'])).toEqual({ year: 2026, force: false, skipMenuRefresh: false });
    expect(parseArgs(['--year=2025', '--force'])).toEqual({ year: 2025, force: true, skipMenuRefresh: false });
    expect(parseArgs(['--force'])).toEqual({ year: null, force: true, skipMenuRefresh: false });
    expect(parseArgs([])).toEqual({ year: null, force: false, skipMenuRefresh: false });
    // Invalid year ignored
    expect(parseArgs(['--year', '2010'])).toEqual({ year: null, force: false, skipMenuRefresh: false });
    expect(parseArgs(['--year=abc'])).toEqual({ year: null, force: false, skipMenuRefresh: false });
  });

  it('parseArgs correctly parses --skip-menu-refresh (R3.10)', () => {
    expect(parseArgs(['--skip-menu-refresh'])).toEqual({
      year: null,
      force: false,
      skipMenuRefresh: true,
    });
    expect(parseArgs(['--year', '2026', '--force', '--skip-menu-refresh'])).toEqual({
      year: 2026,
      force: true,
      skipMenuRefresh: true,
    });
  });
});

describe('runTaggingCli orchestration flow', () => {
  it('exits cleanly with no booth-confirm prompt when zero booths are discovered, but still sets the edition window', async () => {
    const mockRepo = makeMockRepo();

    // choice: 1 (food-and-wine), start date: blank (defaults today), end date: blank
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(mockRepo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
    expect(mockRepo.upsertTags).not.toHaveBeenCalled();
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(mockRepo.upsertFestivalEdition).toHaveBeenCalledWith('food-and-wine', 2026, todayIso, null);
    // Festival choice + start date + end date = 3 prompts
    expect(promptFn).toHaveBeenCalledTimes(3);
  });

  it('prompts confirmation and writes tags on confirmation, threading matchKind/matchingFoodItemIds (R10.1)', async () => {
    const mockBooths: DiscoveredBooth[] = [
      {
        experienceId: 'b1',
        name: 'Bauernmarkt',
        park: 'EPCOT',
        conflictingTag: null,
        matchKind: 'menu',
        matchingFoodItemIds: ['fi-1', 'fi-2'],
      },
    ];

    const mockRepo = makeMockRepo({
      listActiveFestivalBooths: vi.fn().mockResolvedValue(mockBooths),
      upsertTags: vi.fn().mockResolvedValue(['b1']),
    });

    // choice: 1, start date: explicit, end date: blank, confirm: y
    const answers = ['1', '2026-08-28', '', 'y'];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(mockRepo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
    expect(mockRepo.upsertFestivalEdition).toHaveBeenCalledWith('food-and-wine', 2026, '2026-08-28', null);
    expect(mockRepo.upsertTags).toHaveBeenCalledWith(
      [
        {
          experienceId: 'b1',
          year: 2026,
          slug: 'food-and-wine',
          matchKind: 'menu',
          matchingFoodItemIds: ['fi-1', 'fi-2'],
        },
      ],
      { force: false },
    );
  });

  it('re-prompts on an invalid edition date before accepting a valid one', async () => {
    const mockRepo = makeMockRepo();

    // choice: 1, start date: invalid then valid, end date: invalid then blank
    const answers = ['1', 'not-a-date', '2026-08-28', 'also-bad', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(mockRepo.upsertFestivalEdition).toHaveBeenCalledWith('food-and-wine', 2026, '2026-08-28', null);
  });

  it('excludes conflicting booths without --force and aborts write if user answers no', async () => {
    const mockBooths: DiscoveredBooth[] = [
      {
        experienceId: 'b1',
        name: 'Bauernmarkt',
        park: 'EPCOT',
        conflictingTag: null,
        matchKind: 'facet',
        matchingFoodItemIds: [],
      },
      {
        experienceId: 'b2',
        name: 'Cider House',
        park: 'EPCOT',
        conflictingTag: {
          experienceId: 'b2',
          festivalSlug: 'food-and-wine',
          festivalYear: 2026,
          taggedAt: '2026-01-01T00:00:00.000Z',
          matchKind: 'facet',
        },
        matchKind: 'facet',
        matchingFoodItemIds: [],
      },
    ];

    const mockRepo = makeMockRepo({
      listActiveFestivalBooths: vi.fn().mockResolvedValue(mockBooths),
    });

    // choice 2: flower-and-garden, start date blank, end date blank, confirm: n
    const answers = ['2', '', '', 'n'];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(mockRepo.upsertTags).not.toHaveBeenCalled();
  });
});

describe('runTaggingCli menu-refresh step (R3.10)', () => {
  function makeDiscoveryRepo(): FestivalTagRepo {
    return makeMockRepo();
  }

  it('refreshes every active restaurant id via getMenuForRestaurant before discovery', async () => {
    const repo = makeDiscoveryRepo();
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));
    const getMenuForRestaurant = vi.fn().mockResolvedValue([]);
    const listActiveRestaurantIds = vi.fn().mockResolvedValue(['r1', 'r2', 'r3']);

    await runTaggingCli(
      repo,
      { year: 2026, force: false, skipMenuRefresh: false },
      promptFn,
      { listActiveRestaurantIds, menuRetrieval: { getMenuForRestaurant } },
    );

    expect(listActiveRestaurantIds).toHaveBeenCalledTimes(1);
    expect(getMenuForRestaurant).toHaveBeenCalledTimes(3);
    expect(getMenuForRestaurant).toHaveBeenCalledWith('r1');
    expect(getMenuForRestaurant).toHaveBeenCalledWith('r2');
    expect(getMenuForRestaurant).toHaveBeenCalledWith('r3');
    // Discovery still ran after the refresh step.
    expect(repo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
  });

  it('a refresh failure for one restaurant does not abort the pass or prevent discovery', async () => {
    const repo = makeDiscoveryRepo();
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));
    const getMenuForRestaurant = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([]);
    const listActiveRestaurantIds = vi.fn().mockResolvedValue(['r1', 'r2']);

    await runTaggingCli(
      repo,
      { year: 2026, force: false, skipMenuRefresh: false },
      promptFn,
      { listActiveRestaurantIds, menuRetrieval: { getMenuForRestaurant } },
    );

    expect(getMenuForRestaurant).toHaveBeenCalledTimes(2);
    expect(repo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
  });

  it('--skip-menu-refresh skips the refresh step entirely', async () => {
    const repo = makeDiscoveryRepo();
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));
    const getMenuForRestaurant = vi.fn().mockResolvedValue([]);
    const listActiveRestaurantIds = vi.fn().mockResolvedValue(['r1']);

    await runTaggingCli(
      repo,
      { year: 2026, force: false, skipMenuRefresh: true },
      promptFn,
      { listActiveRestaurantIds, menuRetrieval: { getMenuForRestaurant } },
    );

    expect(listActiveRestaurantIds).not.toHaveBeenCalled();
    expect(getMenuForRestaurant).not.toHaveBeenCalled();
    expect(repo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
  });

  it('no refresh deps supplied is a no-op (treated like skip)', async () => {
    const repo = makeDiscoveryRepo();
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(
      repo,
      { year: 2026, force: false, skipMenuRefresh: false },
      promptFn,
    );

    expect(repo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
  });
});

describe('runTaggingCli Festival_Edition date window step (R9.3)', () => {
  it('defaults starts_on to today when the operator enters a blank answer', async () => {
    const repo = makeMockRepo();
    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(repo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    const todayIso = new Date().toISOString().slice(0, 10);
    expect(repo.upsertFestivalEdition).toHaveBeenCalledWith('food-and-wine', 2026, todayIso, null);
  });

  it('passes an explicit ends_on through to upsertFestivalEdition when provided', async () => {
    const repo = makeMockRepo();
    const answers = ['1', '2026-08-28', '2026-11-18'];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(repo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(repo.upsertFestivalEdition).toHaveBeenCalledWith(
      'food-and-wine',
      2026,
      '2026-08-28',
      '2026-11-18',
    );
  });

  it('calls upsertFestivalEdition exactly once per run, before discovery', async () => {
    const callOrder: string[] = [];
    const repo = makeMockRepo({
      listActiveFestivalBooths: vi.fn().mockImplementation(() => {
        callOrder.push('discover');
        return Promise.resolve([]);
      }),
      upsertFestivalEdition: vi.fn().mockImplementation(() => {
        callOrder.push('edition');
        return Promise.resolve(undefined);
      }),
    });

    const answers = ['1', '', ''];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(repo, { year: 2026, force: false, skipMenuRefresh: true }, promptFn);

    expect(repo.upsertFestivalEdition).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['edition', 'discover']);
  });
});
