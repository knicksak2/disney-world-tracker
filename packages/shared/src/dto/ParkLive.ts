import type { Park } from '../enums.js';
import type { LightningLaneState } from './LiveDetail.js';

export interface ParkLiveEntryDTO {
  readonly experienceId: string;
  readonly name: string;
  readonly status: string;
  readonly waitMinutes: number | null;
  readonly lightningLane?: LightningLaneState;
}

export interface ParkLiveSnapshotDTO {
  readonly park: Park;
  readonly entries: readonly ParkLiveEntryDTO[];
  readonly retrievedAt: string;
  readonly stale: boolean;
}
