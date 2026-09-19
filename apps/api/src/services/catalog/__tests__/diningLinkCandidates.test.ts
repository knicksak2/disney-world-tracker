import { describe, expect, it, vi } from 'vitest';
import {
  diffDiningLinkCandidates,
  formatDiningLinkCandidateReport,
  readSeedEntries,
  type DiningLinkCandidate,
} from '../diningLinkCandidates.js';

describe('diffDiningLinkCandidates', () => {
  it('returns candidates whose upstreamEntityId is not in the seed', () => {
    const candidates: DiningLinkCandidate[] = [
      { upstreamEntityId: 'a', name: 'Restaurant A', park: 'EPCOT' },
      { upstreamEntityId: 'b', name: 'Restaurant B', park: 'Magic Kingdom' },
      { upstreamEntityId: 'c', name: 'Restaurant C', park: null },
    ];
    const seedEntries = [{ upstreamEntityId: 'a' }];

    const result = diffDiningLinkCandidates(candidates, seedEntries);

    expect(result).toEqual([
      { upstreamEntityId: 'b', name: 'Restaurant B', park: 'Magic Kingdom' },
      { upstreamEntityId: 'c', name: 'Restaurant C', park: null },
    ]);
  });

  it('returns an empty array when every candidate is already seeded', () => {
    const candidates: DiningLinkCandidate[] = [
      { upstreamEntityId: 'a', name: 'Restaurant A', park: 'EPCOT' },
    ];
    const seedEntries = [{ upstreamEntityId: 'a' }, { upstreamEntityId: 'z' }];

    expect(diffDiningLinkCandidates(candidates, seedEntries)).toEqual([]);
  });

  it('returns every candidate when the seed is empty', () => {
    const candidates: DiningLinkCandidate[] = [
      { upstreamEntityId: 'a', name: 'Restaurant A', park: 'EPCOT' },
    ];

    expect(diffDiningLinkCandidates(candidates, [])).toEqual(candidates);
  });

  it('never fabricates or attaches a URL to a reported candidate', () => {
    const candidates: DiningLinkCandidate[] = [
      { upstreamEntityId: 'a', name: 'Restaurant A', park: 'EPCOT' },
    ];

    const result = diffDiningLinkCandidates(candidates, []);

    expect(result[0]).not.toHaveProperty('diningUrl');
  });
});

describe('formatDiningLinkCandidateReport', () => {
  it('returns null when there are no new candidates', () => {
    expect(formatDiningLinkCandidateReport([])).toBeNull();
  });

  it('lists every new candidate by name, park, and upstreamEntityId', () => {
    const report = formatDiningLinkCandidateReport([
      { upstreamEntityId: 'a;entityType=restaurant', name: 'GEO-82', park: 'EPCOT' },
      { upstreamEntityId: 'b;entityType=restaurant', name: 'No Park Restaurant', park: null },
    ]);

    expect(report).toContain('2 restaurant(s)');
    expect(report).toContain('GEO-82 [EPCOT] (a;entityType=restaurant)');
    expect(report).toContain('No Park Restaurant (b;entityType=restaurant)');
    expect(report).not.toContain('[null]');
  });

  it('points the reader at the seed file and the seed script', () => {
    const report = formatDiningLinkCandidateReport([
      { upstreamEntityId: 'a', name: 'Restaurant A', park: 'EPCOT' },
    ]);

    expect(report).toContain('dining-links.json');
    expect(report).toContain('seed-dining-links');
  });
});

describe('readSeedEntries', () => {
  it('parses a well-formed seed file', async () => {
    const fsLib = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify([{ upstreamEntityId: 'a', name: 'A', diningUrl: 'https://x' }]),
      ),
    };

    const entries = await readSeedEntries('/virtual/dining-links.json', fsLib as any);

    expect(entries).toEqual([{ upstreamEntityId: 'a', name: 'A', diningUrl: 'https://x' }]);
  });

  it('returns an empty array when the seed file does not exist (ENOENT)', async () => {
    const enoent = Object.assign(new Error('no file'), { code: 'ENOENT' });
    const fsLib = { readFile: vi.fn().mockRejectedValue(enoent) };

    const entries = await readSeedEntries('/missing/dining-links.json', fsLib as any);

    expect(entries).toEqual([]);
  });

  it('returns an empty array when the file content is not a JSON array', async () => {
    const fsLib = { readFile: vi.fn().mockResolvedValue(JSON.stringify({ not: 'an array' })) };

    const entries = await readSeedEntries('/virtual/dining-links.json', fsLib as any);

    expect(entries).toEqual([]);
  });

  it('propagates a non-ENOENT read failure', async () => {
    const fsLib = { readFile: vi.fn().mockRejectedValue(new Error('permission denied')) };

    await expect(readSeedEntries('/virtual/dining-links.json', fsLib as any)).rejects.toThrow(
      'permission denied',
    );
  });
});
