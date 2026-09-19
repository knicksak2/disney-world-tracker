/**
 * Pure projection from a park-wide ThemeParksLiveResponse onto tracked Experiences only.
 * (Requirement 9.6, design.md Section 7, Property 1)
 */

import type { ThemeParksLiveResponse } from './themeParksLiveClient.js';
import type { ParkLiveEntrySnapshot } from './parkLiveCache.js';
import { projectLightningLane } from './themeParksLiveProject.js';

export type { ParkLiveEntrySnapshot };

/**
 * Pure — no I/O.
 * Maps each entry in response.liveData whose ThemeParks entity id matches a key in
 * `upstreamIdToExperienceId` to a ParkLiveEntrySnapshot. Entries not in the map
 * (including the park entity itself) are discarded.
 *
 * Never throws — tolerant of missing fields, malformed queues, and non-array liveData.
 */
export function projectParkLive(
  response: ThemeParksLiveResponse | null | undefined,
  upstreamIdToExperienceId: ReadonlyMap<string, string>,
): readonly ParkLiveEntrySnapshot[] {
  if (!response || !Array.isArray(response.liveData)) {
    return [];
  }

  const result: ParkLiveEntrySnapshot[] = [];

  for (const entry of response.liveData) {
    if (!entry || typeof entry.id !== 'string') {
      continue;
    }

    const experienceId = upstreamIdToExperienceId.get(entry.id);
    if (!experienceId) {
      continue;
    }

    const name = typeof entry.name === 'string' ? entry.name : '';
    const status = typeof entry.status === 'string' ? entry.status : 'UNKNOWN';

    let waitMinutes: number | null = null;
    const rawWait = entry.queue?.STANDBY?.waitTime;
    if (typeof rawWait === 'number' && Number.isFinite(rawWait) && rawWait >= 0) {
      waitMinutes = Math.min(1440, Math.round(rawWait));
    }

    const lightningLane = projectLightningLane(entry);

    result.push({
      experienceId,
      name,
      status,
      waitMinutes,
      ...(lightningLane !== undefined ? { lightningLane } : {}),
    });
  }

  return result;
}
