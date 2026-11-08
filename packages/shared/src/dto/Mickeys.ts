import type { Park } from '../enums.js';
import type {
  MickeyConfidenceLabel,
  MickeyDifficulty,
  MickeyStatus,
  MickeyZone,
} from '../constants/mickeys.js';

export interface MickeyListItemDTO {
  readonly id: string;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly land: string | null;
  readonly zone: MickeyZone;
  readonly difficulty: MickeyDifficulty;
  readonly clue1: string;
  readonly official: boolean;
  readonly communityVerified: boolean;
  readonly confidenceLabel: MickeyConfidenceLabel;
  readonly hintLevel: 1 | 2 | 3;
  readonly found: boolean;
}

export interface MickeyDetailDTO extends MickeyListItemDTO {
  readonly clue2?: string; // present only per hintGate
  readonly reveal?: string; // present only per hintGate
  readonly tripId: string | null;
  readonly friendsFoundCount: number;
  readonly userVote?: 'there' | 'gone' | null;
}

export interface MickeyProgressDTO {
  readonly mickeyId: string;
  readonly hintLevel: 1 | 2 | 3;
  readonly foundAt: string | null;
  readonly foundOn: string | null; // YYYY-MM-DD, WDW calendar date
  readonly tripId: string | null;
}

export interface MickeyListPageDTO {
  readonly items: MickeyListItemDTO[];
  readonly nextCursor: string | null;
}

export interface MickeySummaryDTO {
  readonly overall: { total: number; found: number }; // Official only
  // park === null is the entry for Experiences with no owning park (resort-area Experiences).
  // overall is always the sum of these entries.
  readonly byPark: ReadonlyArray<{ park: Park | null; total: number; found: number }>;
  readonly community: { found: number; total?: number };
}

export interface MickeySubmissionDTO {
  readonly id: string;
  readonly status: MickeyStatus;
  readonly official: boolean;
  readonly communityVerified: boolean;
  readonly clue1: string;
  readonly experienceName: string;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface FriendMickeyFindDTO {
  readonly mickeyId: string;
  readonly clue1: string;
  readonly official: boolean;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly foundOn: string;
}

export interface FriendMickeyFindsPageDTO {
  readonly items: FriendMickeyFindDTO[];
  readonly nextCursor: string | null;
}

export interface TripMickeysDTO {
  readonly members: ReadonlyArray<{
    userId: string;
    displayName: string;
    avatarPreset: string | null;
    count: number;
  }>;
  readonly mickeys: ReadonlyArray<{
    mickeyId: string;
    clue1: string;
    official: boolean;
    experienceName: string;
    foundByCount: number;
  }>;
}

export interface MickeyClientConfigDTO {
  readonly enabled: boolean;
  readonly submissionsEnabled: boolean;
}
