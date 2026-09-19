/**
 * Zustand store for Live Waits screen state (Task 6.1, Requirement 10.1).
 *
 * Tracks the most recently viewed Park in memory.
 */

import { create } from 'zustand';
import type { Park } from '@dwt/shared';

export interface LiveWaitsState {
  readonly lastViewedPark: Park | null;
  readonly setLastViewedPark: (park: Park) => void;
}

export const useLiveWaitsStore = create<LiveWaitsState>((set) => ({
  lastViewedPark: null,
  setLastViewedPark: (park: Park) => set({ lastViewedPark: park }),
}));
