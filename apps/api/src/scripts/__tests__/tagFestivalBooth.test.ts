/**
 * Unit tests for tagFestivalBooth CLI pure helpers and orchestration.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
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
        },
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
    expect(parseArgs(['--year', '2026'])).toEqual({ year: 2026, force: false });
    expect(parseArgs(['--year=2025', '--force'])).toEqual({ year: 2025, force: true });
    expect(parseArgs(['--force'])).toEqual({ year: null, force: true });
    expect(parseArgs([])).toEqual({ year: null, force: false });
    // Invalid year ignored
    expect(parseArgs(['--year', '2010'])).toEqual({ year: null, force: false });
    expect(parseArgs(['--year=abc'])).toEqual({ year: null, force: false });
  });
});

describe('runTaggingCli orchestration flow', () => {
  it('exits cleanly with no prompt when zero booths are discovered', async () => {
    const mockRepo: FestivalTagRepo = {
      listActiveFestivalBooths: vi.fn().mockResolvedValue([]),
      upsertTags: vi.fn().mockResolvedValue([]),
    };

    const promptFn = vi.fn().mockResolvedValueOnce('1'); // choice: 1 (food-and-wine)

    await runTaggingCli(mockRepo, { year: 2026, force: false }, promptFn);

    expect(mockRepo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
    expect(mockRepo.upsertTags).not.toHaveBeenCalled();
    // Only 1 prompt (festival selection) was asked
    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  it('prompts confirmation and writes tags on confirmation', async () => {
    const mockBooths: DiscoveredBooth[] = [
      {
        experienceId: 'b1',
        name: 'Bauernmarkt',
        park: 'EPCOT',
        conflictingTag: null,
      },
    ];

    const mockRepo: FestivalTagRepo = {
      listActiveFestivalBooths: vi.fn().mockResolvedValue(mockBooths),
      upsertTags: vi.fn().mockResolvedValue(['b1']),
    };

    const answers = ['1', 'y'];
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false }, promptFn);

    expect(mockRepo.listActiveFestivalBooths).toHaveBeenCalledWith(2026, 'food-and-wine');
    expect(mockRepo.upsertTags).toHaveBeenCalledWith(
      [{ experienceId: 'b1', year: 2026, slug: 'food-and-wine' }],
      { force: false },
    );
  });

  it('excludes conflicting booths without --force and aborts write if user answers no', async () => {
    const mockBooths: DiscoveredBooth[] = [
      {
        experienceId: 'b1',
        name: 'Bauernmarkt',
        park: 'EPCOT',
        conflictingTag: null,
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
        },
      },
    ];

    const mockRepo: FestivalTagRepo = {
      listActiveFestivalBooths: vi.fn().mockResolvedValue(mockBooths),
      upsertTags: vi.fn().mockResolvedValue([]),
    };

    const answers = ['2', 'n']; // choice 2: flower-and-garden, confirm: n
    let idx = 0;
    const promptFn = vi.fn().mockImplementation(() => Promise.resolve(answers[idx++]!));

    await runTaggingCli(mockRepo, { year: 2026, force: false }, promptFn);

    expect(mockRepo.upsertTags).not.toHaveBeenCalled();
  });
});
